import {
  BadRequestException, Injectable, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../discovery/api-keys.service';
import { PinPadsService, AgentPinPadDto } from '../pinpads/pinpads.service';

/**
 * PC-agent lifecycle:
 *   1. Admin generates an EnrollmentToken for a store (short, human-friendly code)
 *   2. Installer POSTs /agents/enroll { token, pcName, os, ... }
 *      - We validate + decrement the token
 *      - Create/upsert the StorePc
 *      - Mint a per-PC ApiKey (scope=AGENT, storeId=store, pcId=pc)
 *      - Return { pcId, storeCode, agentKey, endpoints }
 *   3. Agent uses that key on subsequent inventory + backup calls
 */

export interface IssueTokenDto {
  scope?: 'STORE' | 'HQ';
  storeId?: string;         // required when scope=STORE
  departmentId?: string;    // required when scope=HQ
  usesRemaining?: number;
  expiresInHours?: number;
}
export interface EnrollDto {
  token: string;
  pcName: string;
  role?: 'TILL' | 'BACKOFFICE' | 'HQ';
  osVersion?: string;
  osBuild?: string;
  cpuModel?: string;
  ramGb?: number;
  ipAddress?: string;
  agentVersion?: string;
}
export interface InventoryDto {
  agentVersion?: string;
  osVersion?: string;
  osBuild?: string;
  cpuModel?: string;
  ramGb?: number;
  ipAddress?: string;
  entries: Array<{
    name: string; version?: string; publisher?: string;
    installDate?: string; source?: string;
  }>;
  pinPads?: AgentPinPadDto[];
}

@Injectable()
export class AgentsService {
  constructor(
    private prisma: PrismaService,
    private apiKeys: ApiKeysService,
    private pinPads: PinPadsService,
  ) {}

  // ---------- Enrollment tokens ----------
  async issueToken(dto: IssueTokenDto, createdById?: string) {
    const scope = dto.scope ?? 'STORE';
    let scopeName = ''; let storeCode: string | null = null;
    let storeId: string | null = null; let departmentId: string | null = null;

    if (scope === 'STORE') {
      if (!dto.storeId) throw new BadRequestException('storeId required for STORE-scoped tokens');
      const store = await this.prisma.store.findUnique({ where: { id: dto.storeId } });
      if (!store) throw new NotFoundException('Unknown store');
      storeId = store.id; storeCode = store.code; scopeName = store.name;
    } else if (scope === 'HQ') {
      if (!dto.departmentId) throw new BadRequestException('departmentId required for HQ-scoped tokens');
      const dept = await this.prisma.department.findUnique({ where: { id: dto.departmentId } });
      if (!dept) throw new NotFoundException('Unknown department');
      departmentId = dept.id; storeCode = `HQ-${dept.code}`; scopeName = `HQ / ${dept.name}`;
    } else {
      throw new BadRequestException(`Unknown scope ${scope}`);
    }

    // 12-char no-lookalike alphabet -- easy to read + type
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(12);
    let token = '';
    for (let i = 0; i < 12; i++) token += alphabet[bytes[i] % alphabet.length];
    const expiresAt = dto.expiresInHours
      ? new Date(Date.now() + dto.expiresInHours * 3600 * 1000)
      : new Date(Date.now() + 24 * 3600 * 1000);
    const rec = await this.prisma.enrollmentToken.create({
      data: {
        token, scope, storeId, departmentId,
        usesRemaining: dto.usesRemaining ?? 5,
        expiresAt, createdById,
      },
    });
    return { ...rec, storeCode, storeName: scopeName };
  }

  async listTokens(filter: { storeId?: string; departmentId?: string; scope?: string } = {}) {
    const where: any = {};
    if (filter.storeId)      where.storeId = filter.storeId;
    if (filter.departmentId) where.departmentId = filter.departmentId;
    if (filter.scope)        where.scope = filter.scope;
    return this.prisma.enrollmentToken.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200,
    });
  }

  async revokeToken(id: string) {
    return this.prisma.enrollmentToken.update({
      where: { id }, data: { revokedAt: new Date(), usesRemaining: 0 },
    });
  }

  // ---------- Enrollment (public) ----------
  async enroll(dto: EnrollDto, _sourceIp?: string) {
    if (!dto.token?.trim())  throw new BadRequestException('token required');
    if (!dto.pcName?.trim()) throw new BadRequestException('pcName required');

    const t = await this.prisma.enrollmentToken.findUnique({ where: { token: dto.token.trim() } });
    if (!t)                 throw new UnauthorizedException('Unknown enrollment token');
    if (t.revokedAt)        throw new UnauthorizedException('Token revoked');
    if (t.usesRemaining <= 0) throw new UnauthorizedException('Token exhausted');
    if (t.expiresAt && t.expiresAt < new Date()) throw new UnauthorizedException('Token expired');

    // Resolve target based on scope
    let storeCode = '';
    let scopeName = '';
    let storeId: string | null = null;
    let departmentId: string | null = null;
    let apiKeyLabel = '';

    if (t.scope === 'HQ') {
      if (!t.departmentId) throw new UnauthorizedException('Malformed HQ token');
      const dept = await this.prisma.department.findUnique({ where: { id: t.departmentId } });
      if (!dept) throw new UnauthorizedException('Department not found');
      departmentId = dept.id; storeCode = `HQ-${dept.code}`; scopeName = `HQ / ${dept.name}`;
      apiKeyLabel = `Agent: HQ-${dept.code}/${dto.pcName}`;
    } else {
      if (!t.storeId) throw new UnauthorizedException('Malformed store token');
      const store = await this.prisma.store.findUnique({ where: { id: t.storeId } });
      if (!store) throw new UnauthorizedException('Store not found');
      storeId = store.id; storeCode = store.code; scopeName = store.name;
      apiKeyLabel = `Agent: ${store.code}/${dto.pcName}`;
    }

    // Upsert the PC row — keyed by (storeId|departmentId, name)
    const existing = storeId
      ? await this.prisma.storePc.findFirst({ where: { storeId, name: dto.pcName } })
      : await this.prisma.storePc.findFirst({ where: { departmentId, name: dto.pcName } });

    const pcData = {
      role: dto.role ?? (t.scope === 'HQ' ? 'HQ' : 'TILL'),
      agentInstalledAt: new Date(),
      agentVersion: dto.agentVersion, osVersion: dto.osVersion, osBuild: dto.osBuild,
      cpuModel: dto.cpuModel, ramGb: dto.ramGb, ipAddress: dto.ipAddress,
      lastSeenAt: new Date(),
    };

    const pc = existing
      ? await this.prisma.storePc.update({ where: { id: existing.id }, data: pcData })
      : await this.prisma.storePc.create({
          data: {
            ...pcData, name: dto.pcName,
            scope: t.scope, storeId, departmentId,
          },
        });

    // ---- Auto-create / link an Asset row in the register ----
    // Every enrolled PC should show up in the asset list. If one already
    // exists for this hostname, reuse it; otherwise create one against the
    // AUTO-DISC-PC fallback SKU. Admin can reassign to a proper SKU later.
    let assetId = pc.assetId ?? null;
    if (!assetId) {
      const existing = await this.prisma.asset.findFirst({
        where: { hostname: dto.pcName },
      });
      if (existing) {
        assetId = existing.id;
      } else {
        const fallbackSku = await this.prisma.sku.findUnique({ where: { code: 'AUTO-DISC-PC' } });
        if (fallbackSku) {
          // Resolve a location: for HQ, use the HEAD_OFFICE; for stores, use the store's location
          let locationId: string | null = null;
          if (storeId) {
            const s = await this.prisma.store.findUnique({ where: { id: storeId }, select: { locationId: true } });
            locationId = s?.locationId ?? null;
          } else {
            const ho = await this.prisma.location.findFirst({ where: { type: 'HEAD_OFFICE' }, select: { id: true } });
            locationId = ho?.id ?? null;
          }
          // Build a stable asset tag from the hostname. If a collision would
          // happen (rare), append a short random suffix.
          let assetTag = `AUTO-${dto.pcName}`.toUpperCase().replace(/[^A-Z0-9-]/g, '-').slice(0, 60);
          const dupe = await this.prisma.asset.findUnique({ where: { assetTag } });
          if (dupe) assetTag = `${assetTag}-${randomBytes(2).toString('hex').toUpperCase()}`;

          const asset = await this.prisma.asset.create({
            data: {
              assetTag, skuId: fallbackSku.id,
              hostname: dto.pcName,
              osVersion: dto.osVersion, cpuModel: dto.cpuModel, ramGb: dto.ramGb,
              lastSeenAt: new Date(),
              locationId, source: 'AGENT',
              status: 'IN_STORE',
              assignedStoreId: storeId ?? undefined,
              assignedDepartmentId: departmentId ?? undefined,
              condition: 'GOOD',
            },
          });
          await this.prisma.assetHistory.create({
            data: {
              assetId: asset.id, eventType: 'AUTO_DISCOVERED',
              toLocationId: locationId ?? undefined,
              notes: `Auto-created from agent enrollment (${t.scope === 'HQ' ? scopeName : storeCode})`,
            },
          });
          assetId = asset.id;
        }
      }
      if (assetId) {
        await this.prisma.storePc.update({ where: { id: pc.id }, data: { assetId } });
      }
    } else {
      // Update existing linked asset with latest hardware info + assignment
      await this.prisma.asset.update({
        where: { id: assetId },
        data: {
          hostname: dto.pcName,
          osVersion: dto.osVersion ?? undefined,
          cpuModel: dto.cpuModel ?? undefined,
          ramGb: dto.ramGb ?? undefined,
          lastSeenAt: new Date(),
          assignedStoreId: storeId ?? undefined,
          assignedDepartmentId: departmentId ?? undefined,
        },
      });
    }

    // Revoke previous key so re-enrollment always returns a fresh one.
    if (pc.apiKeyId) {
      await this.prisma.apiKey.update({
        where: { id: pc.apiKeyId },
        data: { revokedAt: new Date() },
      });
    }
    const minted = await this.apiKeys.create(
      apiKeyLabel, 'AGENT', t.createdById ?? undefined,
    );
    await this.prisma.apiKey.update({
      where: { id: minted.id },
      data: { storeId: storeId ?? undefined, pcId: pc.id },
    });
    await this.prisma.storePc.update({
      where: { id: pc.id }, data: { apiKeyId: minted.id },
    });
    await this.prisma.enrollmentToken.update({
      where: { id: t.id },
      data: { usesRemaining: { decrement: 1 }, lastUsedAt: new Date() },
    });

    return {
      pcId: pc.id,
      pcName: pc.name,
      scope: t.scope,
      storeId, departmentId,
      storeCode,
      storeName: scopeName,
      agentKey: minted.key,
      agentKeyPrefix: minted.prefix,
      endpoints: {
        inventory: '/agents/inventory',
        backupConfig: '/backups/config',
        backupStart: '/backups/start',
        backupComplete: '/backups/{runId}/complete',
        backupFail: '/backups/{runId}/fail',
      },
    };
  }

  // ---------- Software inventory (called by agent) ----------
  async ingestInventory(agentKey: string, dto: InventoryDto, _sourceIp?: string) {
    const k = await this.apiKeys.validate(agentKey);
    if (!k) throw new UnauthorizedException('Invalid agent key');
    if (!k.pcId) throw new UnauthorizedException('Agent key not bound to a PC');

    const pcId = k.pcId;
    const entries = (dto.entries ?? []).filter((e) => e?.name?.trim());
    // Full-replace snapshot: delete old rows, insert fresh
    await this.prisma.$transaction([
      this.prisma.pcSoftwareEntry.deleteMany({ where: { pcId } }),
      ...(entries.length
        ? [this.prisma.pcSoftwareEntry.createMany({
            data: entries.map((e) => ({
              pcId,
              name: e.name.slice(0, 300),
              version: e.version?.slice(0, 100),
              publisher: e.publisher?.slice(0, 200),
              installDate: e.installDate ? new Date(e.installDate) : null,
              source: (e.source ?? 'REGISTRY').slice(0, 40),
            })),
          })]
        : []),
      this.prisma.storePc.update({
        where: { id: pcId },
        data: {
          lastInventoryAt: new Date(),
          lastSeenAt: new Date(),
          ...(dto.agentVersion && { agentVersion: dto.agentVersion }),
          ...(dto.osVersion && { osVersion: dto.osVersion }),
          ...(dto.osBuild && { osBuild: dto.osBuild }),
          ...(dto.cpuModel && { cpuModel: dto.cpuModel }),
          ...(dto.ramGb && { ramGb: dto.ramGb }),
          ...(dto.ipAddress && { ipAddress: dto.ipAddress }),
        },
      }),
    ]);

    // ---- Refresh the linked Asset row with the latest hardware info ----
    // The enroll flow creates the Asset; on each inventory we keep OS / CPU
    // / RAM / lastSeenAt current so the asset detail page is always fresh.
    try {
      const linkedPc = await this.prisma.storePc.findUnique({
        where: { id: pcId }, select: { assetId: true },
      });
      if (linkedPc?.assetId) {
        await this.prisma.asset.update({
          where: { id: linkedPc.assetId },
          data: {
            osVersion: dto.osVersion ?? undefined,
            cpuModel:  dto.cpuModel  ?? undefined,
            ramGb:     dto.ramGb     ?? undefined,
            lastSeenAt: new Date(),
          },
        });
      }
    } catch { /* non-fatal — inventory ingest itself already succeeded */ }

    // ---- PIN pads (Verifone/Nedbank) — store-scope only, HQ PCs don't have PIN pads ----
    let padsIngested = 0;
    if (dto.pinPads?.length) {
      const pc = await this.prisma.storePc.findUnique({
        where: { id: pcId },
        include: { store: { select: { id: true, code: true } } },
      });
      if (pc && pc.store) {
        const res = await this.pinPads.ingestFromAgent(
          pc.id, pc.store.id, pc.store.code, pc.name, dto.pinPads,
        );
        padsIngested = res.ingested;
      }
    }

    return { ok: true, ingested: entries.length, pinPadsIngested: padsIngested };
  }

  // ---------- Reporting ----------
  async listPcs(filter: { storeId?: string; departmentId?: string; scope?: string } = {}) {
    const where: any = {};
    if (filter.storeId)      where.storeId = filter.storeId;
    if (filter.departmentId) where.departmentId = filter.departmentId;
    if (filter.scope)        where.scope = filter.scope;
    const pcs = await this.prisma.storePc.findMany({
      where,
      include: {
        store: { select: { id: true, code: true, name: true } },
        _count: { select: { runs: true } },
      },
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
    });
    // Attach department info for HQ PCs (Prisma relation is optional and we
    // don't have a StorePc.department relation, so hydrate manually).
    const deptIds = [...new Set(pcs.map((p) => p.departmentId).filter(Boolean) as string[])];
    const depts = deptIds.length
      ? await this.prisma.department.findMany({ where: { id: { in: deptIds } }, select: { id: true, code: true, name: true } })
      : [];
    const byId = new Map(depts.map((d) => [d.id, d]));
    return pcs.map((p) => ({ ...p, department: p.departmentId ? byId.get(p.departmentId) : null }));
  }

  pcSoftware(pcId: string) {
    return this.prisma.pcSoftwareEntry.findMany({
      where: { pcId }, orderBy: { name: 'asc' }, take: 2000,
    });
  }

  // ---------- Per-PC backup config ----------
  async getPc(pcId: string) {
    const pc = await this.prisma.storePc.findUnique({
      where: { id: pcId },
      include: { store: { select: { id: true, code: true, name: true } } },
    });
    if (!pc) throw new NotFoundException();
    let paths: string[] = [];
    try { const p = JSON.parse(pc.backupPaths); paths = Array.isArray(p) ? p : []; } catch {}
    const dept = pc.departmentId
      ? await this.prisma.department.findUnique({ where: { id: pc.departmentId }, select: { id: true, code: true, name: true } })
      : null;
    return { ...pc, backupPathsList: paths, department: dept };
  }

  async updatePcBackupPaths(pcId: string, paths: string[]) {
    const pc = await this.prisma.storePc.findUnique({ where: { id: pcId } });
    if (!pc) throw new NotFoundException();
    const clean = (paths ?? [])
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => p.length > 0 && p.length < 500);
    return this.prisma.storePc.update({
      where: { id: pcId },
      data: { backupPaths: JSON.stringify(clean) },
    });
  }

  async setPcActive(pcId: string, isActive: boolean) {
    const pc = await this.prisma.storePc.findUnique({ where: { id: pcId } });
    if (!pc) throw new NotFoundException();
    return this.prisma.storePc.update({ where: { id: pcId }, data: { isActive } });
  }
}
