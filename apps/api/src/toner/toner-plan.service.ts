import { Injectable } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { MONTHS } from '../shared';

export class UpsertPlanDto {
  @IsString() storeId!: string;
  @IsString() tonerTypeId!: string;
  @IsInt() year!: number;
  @IsOptional() @IsInt() @Min(0) jan?: number;
  @IsOptional() @IsInt() @Min(0) feb?: number;
  @IsOptional() @IsInt() @Min(0) mar?: number;
  @IsOptional() @IsInt() @Min(0) apr?: number;
  @IsOptional() @IsInt() @Min(0) may?: number;
  @IsOptional() @IsInt() @Min(0) jun?: number;
  @IsOptional() @IsInt() @Min(0) jul?: number;
  @IsOptional() @IsInt() @Min(0) aug?: number;
  @IsOptional() @IsInt() @Min(0) sep?: number;
  @IsOptional() @IsInt() @Min(0) oct?: number;
  @IsOptional() @IsInt() @Min(0) nov?: number;
  @IsOptional() @IsInt() @Min(0) dec?: number;
}

@Injectable()
export class TonerPlanService {
  constructor(private prisma: PrismaService) {}

  list(year: number) {
    return this.prisma.tonerPlan.findMany({
      where: { year },
      include: { store: true, tonerType: true },
      orderBy: [{ store: { code: 'asc' } }, { tonerType: { code: 'asc' } }],
    });
  }

  upsert(dto: UpsertPlanDto) {
    const monthly: any = {};
    for (const m of MONTHS) if ((dto as any)[m] !== undefined) monthly[m] = (dto as any)[m];
    return this.prisma.tonerPlan.upsert({
      where: { storeId_tonerTypeId_year: { storeId: dto.storeId, tonerTypeId: dto.tonerTypeId, year: dto.year } },
      create: { storeId: dto.storeId, tonerTypeId: dto.tonerTypeId, year: dto.year, ...monthly },
      update: monthly,
      include: { store: true, tonerType: true },
    });
  }

  remove(id: string) {
    return this.prisma.tonerPlan.delete({ where: { id } });
  }

  /** Annual rollup by (entity × toner) for dashboard. */
  async annualSummary(year: number) {
    const plans = await this.prisma.tonerPlan.findMany({
      where: { year },
      include: { store: true, tonerType: true },
    });
    const out = new Map<string, { entity: string; tonerCode: string; tonerName: string; totalQty: number; totalCostCents: number; perMonth: number[] }>();
    for (const p of plans) {
      const key = `${p.store.entity}|${p.tonerType.code}`;
      const e = out.get(key) ?? {
        entity: p.store.entity,
        tonerCode: p.tonerType.code,
        tonerName: p.tonerType.name,
        totalQty: 0, totalCostCents: 0,
        perMonth: Array(12).fill(0),
      };
      const qtys = [p.jan, p.feb, p.mar, p.apr, p.may, p.jun, p.jul, p.aug, p.sep, p.oct, p.nov, p.dec];
      qtys.forEach((q, i) => { e.perMonth[i] += q; e.totalQty += q; });
      e.totalCostCents += qtys.reduce((s, q) => s + q, 0) * p.tonerType.unitCostCents;
      out.set(key, e);
    }
    return [...out.values()].sort((a, b) => a.entity.localeCompare(b.entity) || a.tonerCode.localeCompare(b.tonerCode));
  }
}
