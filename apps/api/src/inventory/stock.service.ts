import { Injectable } from '@nestjs/common';
import { IsInt, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

export class UpsertStockDto {
  @IsString() skuId!: string;
  @IsString() locationId!: string;
  @IsInt() @Min(0) qtyOnHand!: number;
  @IsInt() @Min(0) reorderLevel!: number;
}
export class AdjustStockDto {
  @IsString() skuId!: string;
  @IsString() locationId!: string;
  @IsInt() delta!: number;
  @IsString() reason!: string;
}

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  async byLocation(locationId?: string) {
    return this.prisma.stock.findMany({
      where: locationId ? { locationId } : undefined,
      include: { sku: { include: { category: true } }, location: true },
      orderBy: [{ location: { code: 'asc' } }, { sku: { code: 'asc' } }],
    });
  }

  async lowStock() {
    const rows = await this.prisma.stock.findMany({
      include: { sku: true, location: true },
    });
    return rows.filter((r) => r.reorderLevel > 0 && r.qtyOnHand <= r.reorderLevel);
  }

  upsert(dto: UpsertStockDto) {
    return this.prisma.stock.upsert({
      where: { skuId_locationId: { skuId: dto.skuId, locationId: dto.locationId } },
      create: { ...dto },
      update: { qtyOnHand: dto.qtyOnHand, reorderLevel: dto.reorderLevel },
      include: { sku: true, location: true },
    });
  }

  /** Add/subtract quantity and write a stock_movements row. */
  async adjust(dto: AdjustStockDto) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.stock.upsert({
        where: { skuId_locationId: { skuId: dto.skuId, locationId: dto.locationId } },
        create: { skuId: dto.skuId, locationId: dto.locationId, qtyOnHand: Math.max(0, dto.delta) },
        update: { qtyOnHand: { increment: dto.delta } },
      });
      await tx.stockMovement.create({
        data: {
          skuId: dto.skuId,
          toLocationId: dto.delta > 0 ? dto.locationId : null,
          fromLocationId: dto.delta < 0 ? dto.locationId : null,
          qty: Math.abs(dto.delta),
          reason: dto.reason ?? 'ADJUSTMENT',
        },
      });
      return row;
    });
  }
}
