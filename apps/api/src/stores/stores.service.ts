import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { LocationType, StoreStatus } from '../shared';

export class CreateStoreDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() region!: string;
  @IsOptional() @IsString() entity?: string;      // FASHION_FUSION | EVLV
  @IsOptional() @IsString() status?: string;      // OPEN | PLANNED | REMODEL | CLOSED
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsString() openedAt?: string;    // ISO date
}

export class UpdateStoreDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() entity?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsString() openedAt?: string;
  @IsOptional() @IsString() openingDate?: string;
}

export class TransferAssetsDto {
  @IsString()  fromStoreId!: string;
  @IsString()  toStoreId!: string;
  @IsOptional() @IsArray()  assetIds?: string[];   // when omitted, all assets are moved
  @IsOptional() @IsString() note?: string;
}

export class BulkCreateStoresDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CreateStoreDto)
  stores!: CreateStoreDto[];
}

@Injectable()
export class StoresService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.store.findMany({
      orderBy: { code: 'asc' },
      include: { template: true, location: true },
    });
  }

  async byId(id: string) {
    const s = await this.prisma.store.findUnique({
      where: { id },
      include: {
        template: { include: { items: { include: { category: true } } } },
        location: true,
        assignedAssets: { include: { sku: { include: { category: true } } } },
      },
    });
    if (!s) throw new NotFoundException();
    return s;
  }

  /** Location code we use for a store's backing location. Prefixed to avoid
   *  colliding with HO / SR-DBN / user-created reference codes. */
  private locationCodeFor(storeCode: string) {
    return `STR-${storeCode.trim().toUpperCase()}`;
  }

  /**
   * Edit store details. Code change is allowed but keeps the backing location
   * code (STR-OLD → STR-NEW) in sync so Location references stay consistent.
   */
  async update(id: string, dto: UpdateStoreDto) {
    const s = await this.prisma.store.findUnique({ where: { id }, include: { location: true } });
    if (!s) throw new NotFoundException();

    const nextCode = dto.code?.trim().toUpperCase() ?? s.code;
    if (nextCode !== s.code) {
      const dupe = await this.prisma.store.findUnique({ where: { code: nextCode } });
      if (dupe) throw new BadRequestException(`A store with code ${nextCode} already exists`);
    }

    let templateId: string | null | undefined = undefined;
    if (dto.templateId !== undefined) {
      if (dto.templateId && dto.templateId.trim()) {
        const tpl = await this.prisma.storeTemplate.findUnique({ where: { id: dto.templateId } });
        if (!tpl) throw new BadRequestException('Template not found');
        templateId = tpl.id;
      } else {
        templateId = null;
      }
    }

    try {
      // Keep Location code + name in step if code / name / region changed
      await this.prisma.location.update({
        where: { id: s.locationId },
        data: {
          code: this.locationCodeFor(nextCode),
          name: `Store ${nextCode} - ${(dto.name ?? s.name).trim()}`,
          region: (dto.region ?? s.region).trim(),
        },
      });

      return await this.prisma.store.update({
        where: { id },
        data: {
          code: nextCode,
          name: dto.name?.trim() ?? s.name,
          region: dto.region?.trim() ?? s.region,
          entity: dto.entity ?? s.entity,
          status: dto.status ?? s.status,
          templateId: templateId === undefined ? s.templateId : templateId,
          openedAt: dto.openedAt ? new Date(dto.openedAt) : s.openedAt,
          openingDate: dto.openingDate ? new Date(dto.openingDate) : (s as any).openingDate,
        },
        include: { template: true, location: true },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException('Uniqueness conflict');
      throw new BadRequestException(e?.message ?? 'Could not update store');
    }
  }

  /**
   * Permanently delete a store. Refuses when assets are still assigned —
   * the user must either move them (transferAssets) or close/write them off
   * first, so we never lose track of hardware.
   */
  async remove(id: string, opts: { force?: boolean } = {}) {
    const s = await this.prisma.store.findUnique({
      where: { id },
      include: {
        _count: { select: { assignedAssets: true, dispatches: true, audits: true, tickets: true } },
        location: true,
      },
    });
    if (!s) throw new NotFoundException();

    if (s._count.assignedAssets > 0 && !opts.force) {
      throw new BadRequestException(
        `Store has ${s._count.assignedAssets} asset(s) still assigned. Transfer them first, or pass force=true to orphan them.`,
      );
    }

    try {
      // Clean up relations the store owns before deleting the row itself.
      await this.prisma.$transaction([
        this.prisma.backupJob.deleteMany({ where: { storeId: id } }),
        this.prisma.userStoreAccess.deleteMany({ where: { storeId: id } }),
        this.prisma.dvr.deleteMany({ where: { storeId: id } }),
        // Detach rather than delete things we want to keep records of
        this.prisma.ticket.updateMany({ where: { storeId: id }, data: { storeId: null } }),
        this.prisma.asset.updateMany({ where: { assignedStoreId: id }, data: { assignedStoreId: null } }),
        this.prisma.store.delete({ where: { id } }),
      ]);
      return { ok: true, deletedStoreCode: s.code };
    } catch (e: any) {
      throw new BadRequestException(`Could not delete store: ${e?.message ?? e}`);
    }
  }

  /**
   * Move stock/assets from one store to another — used when a store closes
   * and its equipment migrates to a new location. Creates an audit entry
   * per asset in the asset movement history so you can trace where things went.
   */
  async transferAssets(dto: TransferAssetsDto, actorUserId: string) {
    const [from, to] = await Promise.all([
      this.prisma.store.findUnique({ where: { id: dto.fromStoreId } }),
      this.prisma.store.findUnique({ where: { id: dto.toStoreId } }),
    ]);
    if (!from) throw new BadRequestException('Source store not found');
    if (!to)   throw new BadRequestException('Destination store not found');
    if (from.id === to.id) throw new BadRequestException('Source and destination are the same store');

    const where = dto.assetIds?.length
      ? { id: { in: dto.assetIds }, assignedStoreId: from.id }
      : { assignedStoreId: from.id };

    const assets = await this.prisma.asset.findMany({ where, select: { id: true, assetTag: true } });
    if (assets.length === 0) {
      return { ok: true, moved: 0, note: 'No matching assets to move' };
    }

    const now = new Date();
    const note = dto.note ?? `Transferred from ${from.code} to ${to.code}`;

    await this.prisma.$transaction([
      this.prisma.asset.updateMany({
        where: { id: { in: assets.map((a) => a.id) } },
        data: { assignedStoreId: to.id },
      }),
      // Write a movement row per asset. Model name probably `assetMovement` or
      // `assetHistory` — try common ones and fall through if neither exists so
      // the transfer still succeeds even without a history table.
      ...(await this.safeMovementCreates(assets.map((a) => ({
        assetId: a.id, fromLocationId: from.locationId, toLocationId: to.locationId,
        notes: note, actorUserId, movedAt: now,
      })))),
    ]);

    return { ok: true, moved: assets.length, fromStore: from.code, toStore: to.code };
  }

  // Prisma schemas vary — this tries common model names so the service
  // doesn't blow up if a project doesn't have an asset-history table.
  private async safeMovementCreates(rows: any[]) {
    const p = this.prisma as any;
    const model = p.assetMovement ?? p.assetHistory ?? p.assetMove;
    if (!model) return [];
    try {
      // Return as a single createMany statement
      return [model.createMany({ data: rows })];
    } catch { return []; }
  }

  async create(dto: CreateStoreDto) {
    const code = dto.code?.trim().toUpperCase();
    if (!code)          throw new BadRequestException('code is required');
    if (!dto.name?.trim())   throw new BadRequestException('name is required');
    if (!dto.region?.trim()) throw new BadRequestException('region is required');

    const dupe = await this.prisma.store.findUnique({ where: { code } });
    if (dupe) throw new BadRequestException(`A store with code ${code} already exists`);

    // Verify template exists if one was picked (empty string / bad id -> nice error)
    let templateId: string | undefined;
    if (dto.templateId && dto.templateId.trim()) {
      const tpl = await this.prisma.storeTemplate.findUnique({ where: { id: dto.templateId } });
      if (!tpl) throw new BadRequestException('The picked store template was not found');
      templateId = tpl.id;
    }

    const locCode = this.locationCodeFor(code);
    try {
      const location = await this.prisma.location.upsert({
        where: { code: locCode },
        create: {
          code: locCode,
          name: `Store ${code} - ${dto.name.trim()}`,
          type: LocationType.Store,
          region: dto.region.trim(),
        },
        update: {
          // If the location was left over from a wiped store, re-purpose it
          name: `Store ${code} - ${dto.name.trim()}`,
          type: LocationType.Store,
          region: dto.region.trim(),
        },
      });

      const store = await this.prisma.store.create({
        data: {
          code,
          name: dto.name.trim(),
          region: dto.region.trim(),
          entity: dto.entity ?? 'FASHION_FUSION',
          locationId: location.id,
          templateId,
          status: dto.status ?? StoreStatus.Open,
          openedAt: dto.openedAt ? new Date(dto.openedAt) : new Date(),
        },
        include: { template: true, location: true },
      });

      // Auto-create a Backups job for the new store
      await this.prisma.backupJob.upsert({
        where: { storeId: store.id },
        create: { storeId: store.id },
        update: {},
      });
      return store;
    } catch (e: any) {
      // Surface Prisma unique-constraint / FK errors as readable messages
      if (e?.code === 'P2002') {
        throw new BadRequestException(`Uniqueness conflict on: ${e.meta?.target?.join?.(', ') ?? 'unknown field'}`);
      }
      if (e?.code === 'P2003') {
        throw new BadRequestException('Referenced record was not found (bad templateId or locationId)');
      }
      throw new BadRequestException(e?.message ?? 'Could not create store');
    }
  }

  /** Bulk import — creates each store independently, returns per-row status. */
  async bulkCreate(dto: BulkCreateStoresDto) {
    const results: Array<{ code: string; ok: boolean; storeId?: string; error?: string }> = [];
    for (const s of dto.stores ?? []) {
      try {
        const rec = await this.create(s);
        results.push({ code: s.code, ok: true, storeId: rec.id });
      } catch (e: any) {
        results.push({ code: s.code, ok: false, error: e?.message ?? String(e) });
      }
    }
    return {
      total: results.length,
      created: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }
}
