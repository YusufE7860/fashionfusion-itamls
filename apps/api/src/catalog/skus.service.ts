import { Injectable, NotFoundException } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

export class CreateSkuDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() categoryId!: string;
  @IsString() manufacturer!: string;
  @IsString() model!: string;
  @IsOptional() @IsBoolean() isSerialised?: boolean;
  @IsOptional() @IsInt() @Min(0) warrantyMonths?: number;
  @IsOptional() @IsInt() @Min(0) depreciationYears?: number;
  @IsOptional() @IsInt() @Min(0) reorderLevel?: number;
  @IsOptional() @IsInt() @Min(0) unitCostCents?: number;
}

export class UpdateSkuDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() manufacturer?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsBoolean() isSerialised?: boolean;
  @IsOptional() @IsInt() @Min(0) warrantyMonths?: number;
  @IsOptional() @IsInt() @Min(0) depreciationYears?: number;
  @IsOptional() @IsInt() @Min(0) reorderLevel?: number;
  @IsOptional() @IsInt() @Min(0) unitCostCents?: number;
  /** If true, also overwrite zero-valued assets of this SKU with the new unit cost. */
  @IsOptional() @IsBoolean() cascadeToAssets?: boolean;
}

@Injectable()
export class SkusService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.sku.findMany({ orderBy: { code: 'asc' }, include: { category: true } });
  }

  create(dto: CreateSkuDto) {
    return this.prisma.sku.create({ data: dto });
  }

  async update(id: string, dto: UpdateSkuDto) {
    const { cascadeToAssets, ...patch } = dto;
    const sku = await this.prisma.sku.findUnique({ where: { id } });
    if (!sku) throw new NotFoundException();

    const updated = await this.prisma.sku.update({ where: { id }, data: patch });

    let updatedAssets = 0;
    if (cascadeToAssets && typeof patch.unitCostCents === 'number' && patch.unitCostCents > 0) {
      const result = await this.prisma.asset.updateMany({
        where: {
          skuId: id,
          OR: [
            { purchaseCostCents: 0 },
            { currentValueCents: 0 },
          ],
        },
        data: {
          purchaseCostCents: patch.unitCostCents,
          currentValueCents: patch.unitCostCents,
        },
      });
      updatedAssets = result.count;
    }

    return { sku: updated, updatedAssets };
  }
}
