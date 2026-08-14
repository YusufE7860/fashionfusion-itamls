import {
  BadRequestException, Injectable, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeysService } from '../discovery/api-keys.service';

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
  storeId: string;
  usesRemaining?: number;
  expiresInHours?: number;
}
export interface EnrollDto {
  token: string;
  pcName: string;
  role?: 'TILL' | 'BACKOFFICE';
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
}

@Injectable()
export class AgentsService {
  constructor(private prisma: PrismaService, private apiKeys: ApiKeysService) {}

  // ---------- Enrollment tokens ----------
  async issueToken(dto: IssueTokenDto, createdById?: string) {
    const store = await this.prisma.store.findUnique({ where: { id: dto.storeId } });
    if (!store) throw new NotFoundException('Unknown store');
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
        token, storeId: store.id,
        usesRemaining: dto.usesRemaining ?? 5,
        expiresAt, createdById,
      },
    });
    return { ...rec, storeCode: store.code, storeName: store.name };
  }

  async listTokens(storeId?: string) {
    return this.prisma.enrollmentToken.findMany({
      where: storeId ? { storeId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
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

    const store = await this.prisma.store.findUnique({ where: { id: t.storeId } });
    if (!store) throw new UnauthorizedException('Store not found');

    // Upsert the PC row keyed by (storeId, name)
    const pc = await this.prisma.storePc.upsert({
      where: { storeId_name: { storeId: store.id, name: dto.pcName } },
      create: {
        storeId: store.id, name: dto.pcName,
        role: dto.role ?? 'TILL',
        agentInstalledAt: new Date(),
        agentVersion: dto.agentVersion, osVersion: dto.osVersion, osBuild: dto.osBuild,
        cpuModel: dto.cpuModel, ramGb: dto.ramGb, ipAddress: dto.ipAddress,
      },
      update: {
        agentInstalledAt: new Date(),
        agentVersion: dto.agentVersion, osVersion: dto.osVersion, osBuild: dto.osBuild,
        cpuModel: dto.cpuModel, ramGb: dto.ramGb, ipAddress: dto.ipAddress,
        lastSeenAt: new Date(),
      },
    });

    // Revoke previous key so re-enrollment always returns a fresh one.
    if (pc.apiKeyId) {
      await this.prisma.apiKey.update({
        where: { id: pc.apiKeyId },
        data: { revokedAt: new Date() },
      });
    }
    const minted = await this.apiKeys.create(
      `Agent: ${store.code}/${pc.name}`,
      'AGENT',
      t.createdById ?? undefined,
    );
    await this.prisma.apiKey.update({
      where: { id: minted.id },
      data: { storeId: store.id, pcId: pc.id },
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
      storeId: store.id,
      storeCode: store.code,
      storeName: store.name,
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
    return { ok: true, ingested: entries.length };
  }

  // ---------- Reporting ----------
  listPcs(storeId?: string) {
    return this.prisma.storePc.findMany({
      where: storeId ? { storeId } : undefined,
      include: {
        store: { select: { id: true, code: true, name: true } },
        _count: { select: { runs: true } },
      },
      orderBy: [{ store: { code: 'asc' } }, { name: 'asc' }],
    });
  }

  pcSoftware(pcId: string) {
    return this.prisma.pcSoftwareEntry.findMany({
      where: { pcId }, orderBy: { name: 'asc' }, take: 2000,
    });
  }
}
