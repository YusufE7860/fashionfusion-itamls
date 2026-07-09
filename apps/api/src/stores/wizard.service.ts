import { Injectable, NotFoundException } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

export class WizardDto {
  @IsString() name!: string;
  @IsString() region!: string;
  @IsString() templateId!: string;
  @IsInt() @Min(0) posPoints!: number;
  @IsInt() @Min(0) offices!: number;
  @IsInt() @Min(0) printers!: number;
  @IsInt() @Min(0) screens!: number;
  @IsOptional() @IsInt() @Min(0) installationCostCents?: number;
  @IsOptional() @IsInt() @Min(0) travelCostCents?: number;
  @IsOptional() @IsInt() @Min(0) labourCostCents?: number;
  @IsOptional() @IsInt() @Min(0) contingencyPct?: number;
}

@Injectable()
export class WizardService {
  constructor(private prisma: PrismaService) {}

  async run(dto: WizardDto) {
    const template = await this.prisma.storeTemplate.findUnique({
      where: { id: dto.templateId },
      include: { items: { include: { category: true } } },
    });
    if (!template) throw new NotFoundException('Template not found');

    // Build equipment list from template, override by inputs where applicable
    const items = template.items.map((i) => ({
      categoryId: i.categoryId,
      categoryName: i.category.name,
      requiredQty: i.requiredQty,
    }));

    // Cost via average SKU unit cost in each category
    const equipment: {
      categoryName: string;
      qty: number;
      unitCostCents: number;
      lineCostCents: number;
    }[] = [];
    let equipmentTotal = 0;
    for (const it of items) {
      const skus = await this.prisma.sku.findMany({
        where: { categoryId: it.categoryId, unitCostCents: { gt: 0 } },
      });
      const avg =
        skus.length === 0
          ? 0
          : Math.round(skus.reduce((s, k) => s + k.unitCostCents, 0) / skus.length);
      const line = avg * it.requiredQty;
      equipmentTotal += line;
      equipment.push({
        categoryName: it.categoryName,
        qty: it.requiredQty,
        unitCostCents: avg,
        lineCostCents: line,
      });
    }
    const installation = dto.installationCostCents ?? 5000_00;
    const travel = dto.travelCostCents ?? 2500_00;
    const labour = dto.labourCostCents ?? 4000_00;
    const subtotal = equipmentTotal + installation + travel + labour;
    const contingencyPct = dto.contingencyPct ?? 10;
    const contingency = Math.round(subtotal * (contingencyPct / 100));
    const total = subtotal + contingency;

    return {
      input: dto,
      equipment,
      costs: {
        equipmentCents: equipmentTotal,
        installationCents: installation,
        travelCents: travel,
        labourCents: labour,
        contingencyCents: contingency,
        contingencyPct,
        totalCents: total,
      },
    };
  }
}
