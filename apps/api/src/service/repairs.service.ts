import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AssetStatus, RepairStatus } from '../shared';

export class CreateRepairDto {
  @IsString() assetId!: string;
  @IsString() faultDesc!: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsBoolean() warrantyClaim?: boolean;
}

export class TransitionRepairDto {
  @IsString() target!: string; // SENT, AT_SUPPLIER, RETURNED, REPLACED, WRITTEN_OFF
  @IsOptional() @IsInt() @Min(0) costCents?: number;
  @IsOptional() @IsString() outcome?: string;
}

@Injectable()
export class RepairsService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.repair.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        asset: { include: { sku: true, location: true } },
        supplier: true,
      },
      take: 100,
    });
  }

  byAsset(assetId: string) {
    return this.prisma.repair.findMany({
      where: { assetId },
      orderBy: { createdAt: 'desc' },
      include: { supplier: true },
    });
  }

  private async nextCode() {
    const c = await this.prisma.repair.count();
    return `REP-${new Date().getFullYear()}-${String(c + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateRepairDto, actorId: string) {
    const code = await this.nextCode();
    return this.prisma.$transaction(async (tx) => {
      const repair = await tx.repair.create({
        data: {
          code,
          assetId: dto.assetId,
          faultDesc: dto.faultDesc,
          supplierId: dto.supplierId,
          warrantyClaim: dto.warrantyClaim ?? false,
          status: RepairStatus.Logged,
        },
      });
      await tx.assetHistory.create({
        data: {
          assetId: dto.assetId,
          eventType: 'REPAIR_IN',
          refTable: 'repair',
          refId: repair.id,
          actorId,
          notes: dto.faultDesc,
        },
      });
      return repair;
    });
  }

  async transition(id: string, dto: TransitionRepairDto, actorId: string) {
    const r = await this.prisma.repair.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    const allowed: Record<string, string[]> = {
      [RepairStatus.Logged]:     [RepairStatus.Sent, RepairStatus.WrittenOff],
      [RepairStatus.Sent]:       [RepairStatus.AtSupplier],
      [RepairStatus.AtSupplier]: [RepairStatus.Returned, RepairStatus.Replaced, RepairStatus.WrittenOff],
    };
    const next = allowed[r.status] ?? [];
    if (!next.includes(dto.target)) {
      throw new BadRequestException(`Cannot transition ${r.status} → ${dto.target}`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updates: any = { status: dto.target };
      if (dto.target === RepairStatus.Sent) updates.sentAt = new Date();
      if (dto.target === RepairStatus.Returned || dto.target === RepairStatus.Replaced) {
        updates.receivedAt = new Date();
      }
      if (dto.costCents !== undefined) updates.costCents = dto.costCents;
      if (dto.outcome) updates.outcome = dto.outcome;

      const updated = await tx.repair.update({ where: { id }, data: updates });

      // Reflect on the asset
      if (dto.target === RepairStatus.Sent) {
        await tx.asset.update({ where: { id: r.assetId }, data: { status: AssetStatus.Repair } });
      } else if (dto.target === RepairStatus.Returned) {
        await tx.asset.update({ where: { id: r.assetId }, data: { status: AssetStatus.InStock } });
        await tx.assetHistory.create({
          data: { assetId: r.assetId, eventType: 'REPAIR_OUT', refTable: 'repair', refId: r.id, actorId },
        });
      } else if (dto.target === RepairStatus.WrittenOff) {
        await tx.asset.update({ where: { id: r.assetId }, data: { status: AssetStatus.WrittenOff } });
        await tx.assetHistory.create({
          data: { assetId: r.assetId, eventType: 'RETIRED', refTable: 'repair', refId: r.id, actorId, notes: 'Written off via repair' },
        });
      }
      return updated;
    });
  }
}
