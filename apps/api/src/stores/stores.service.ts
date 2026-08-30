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
