import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { AssetStatus } from '../shared';

export class GrvLineDto {
  @IsString() skuId!: string;
  @IsInt() @Min(1) qty!: number;
  @IsInt() @Min(0) unitCostCents!: number;
  @IsOptional() @IsString() serialNumbers?: string;   // CSV
  @IsOptional() @IsString() warrantyExpiry?: string;  // ISO
}

export class CreateGrvDto {
  @IsString() supplierId!: string;
  @IsOptional() @IsString() invoiceNo?: string;
  @IsOptional() @IsString() invoiceDate?: string;
  @IsOptional() @IsString() deliveryNoteNo?: string;
  @IsString() receivingLocationId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => GrvLineDto) lines!: GrvLineDto[];
}

@Injectable()
export class GrvService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.grv.findMany({
      orderBy: { receivedAt: 'desc' },
      include: { supplier: true, lines: { include: { sku: true } } },
      take: 100,
    });
  }

  async byId(id: string) {
    const g = await this.prisma.grv.findUnique({
      where: { id },
      include: { supplier: true, lines: { include: { sku: true } } },
    });
    if (!g) throw new NotFoundException();
    return g;
  }

  private async nextCode() {
    const count = await this.prisma.grv.count();
    return `GRV-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;
  }

  async create(dto: CreateGrvDto, actorId: string) {
    const code = await this.nextCode();
    const total = dto.lines.reduce((s, l) => s + l.qty * l.unitCostCents, 0);
    return this.prisma.$transaction(async (tx) => {
      const grv = await tx.grv.create({
        data: {
          code,
          supplierId: dto.supplierId,
          invoiceNo: dto.invoiceNo,
          invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : undefined,
          deliveryNoteNo: dto.deliveryNoteNo,
          totalCents: total,
          receivedById: actorId,
          status: 'DRAFT',
          lines: {
            create: dto.lines.map((l) => ({
              skuId: l.skuId,
              qty: l.qty,
              unitCostCents: l.unitCostCents,
              serialNumbers: l.serialNumbers,
              warrantyExpiry: l.warrantyExpiry ? new Date(l.warrantyExpiry) : undefined,
            })),
          },
        },
        include: { lines: true },
      });
      return grv;
    });
  }

  async confirm(id: string, receivingLocationId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const grv = await tx.grv.findUnique({
        where: { id },
        include: { lines: { include: { sku: true } } },
      });
      if (!grv) throw new NotFoundException();
      if (grv.status === 'CONFIRMED') throw new BadRequestException('Already confirmed');

      for (const line of grv.lines) {
        if (line.sku.isSerialised) {
          const serials = (line.serialNumbers ?? '').split(',').map((s) => s.trim()).filter(Boolean);
          if (serials.length !== line.qty) {
            throw new BadRequestException(
              `Line for SKU ${line.sku.code}: expected ${line.qty} serials, got ${serials.length}`,
            );
          }
          for (const serial of serials) {
            const tagCount = await tx.asset.count();
            const tag = `FF-${String(tagCount + 1).padStart(6, '0')}`;
            const a = await tx.asset.create({
              data: {
                assetTag: tag,
                serialNo: serial,
                skuId: line.skuId,
                supplierId: grv.supplierId,
                purchaseDate: grv.invoiceDate ?? grv.receivedAt,
                purchaseCostCents: line.unitCostCents,
                currentValueCents: line.unitCostCents,
                warrantyExpiry: line.warrantyExpiry ?? undefined,
                locationId: receivingLocationId,
                status: AssetStatus.InStock,
              },
            });
            await tx.assetHistory.create({
              data: {
                assetId: a.id,
                eventType: 'RECEIVED',
                toLocationId: receivingLocationId,
                refTable: 'grv',
                refId: grv.id,
                actorId,
              },
            });
          }
        } else {
          // Non-serialised: bump stock + write movement
          await tx.stock.upsert({
            where: { skuId_locationId: { skuId: line.skuId, locationId: receivingLocationId } },
            create: {
              skuId: line.skuId,
              locationId: receivingLocationId,
              qtyOnHand: line.qty,
              reorderLevel: line.sku.reorderLevel,
            },
            update: { qtyOnHand: { increment: line.qty } },
          });
          await tx.stockMovement.create({
            data: {
              skuId: line.skuId,
              toLocationId: receivingLocationId,
              qty: line.qty,
              reason: 'GRV',
              refTable: 'grv',
              refId: grv.id,
            },
          });
        }
      }
      return tx.grv.update({ where: { id }, data: { status: 'CONFIRMED' } });
    });
  }
}
