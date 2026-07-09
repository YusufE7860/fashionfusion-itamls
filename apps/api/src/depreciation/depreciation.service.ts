import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DepreciationService {
  private readonly logger = new Logger(DepreciationService.name);
  constructor(private prisma: PrismaService) {}

  /** Run automatically at 02:00 on the 1st of every month. */
  @Cron('0 2 1 * *')
  async monthlyCron() {
    this.logger.log('Scheduled monthly depreciation run starting…');
    const result = await this.run();
    this.logger.log(`Depreciation run complete: ${result.assetsUpdated} assets, ${result.totalDepreciationCents} cents`);
  }

  /**
   * Run straight-line depreciation across all active assets.
   * For each asset:
   *   monthly_depreciation = purchase_cost / (depreciation_years * 12)
   *   accumulated = monthly_depreciation * months_since_purchase
   *   current_value = max(residual, purchase_cost - accumulated)
   *
   * Residual is 10% of purchase cost (configurable per category later).
   */
  async run(asOf: Date = new Date()) {
    const assets = await this.prisma.asset.findMany({
      where: {
        status: { notIn: ['DISPOSED', 'WRITTEN_OFF', 'LOST'] },
        purchaseDate: { not: null },
        purchaseCostCents: { gt: 0 },
      },
      include: { sku: true },
    });

    let totalDep = 0;
    let updated = 0;

    for (const a of assets) {
      const years = a.sku.depreciationYears > 0 ? a.sku.depreciationYears : 4;
      const monthlyDep = Math.floor(a.purchaseCostCents / (years * 12));
      const monthsSincePurchase = a.purchaseDate
        ? Math.max(0, monthsBetween(a.purchaseDate, asOf))
        : 0;
      const accumulated = Math.min(
        monthlyDep * monthsSincePurchase,
        Math.floor(a.purchaseCostCents * 0.9), // residual 10%
      );
      const newValue = a.purchaseCostCents - accumulated;
      if (newValue !== a.currentValueCents) {
        await this.prisma.asset.update({
          where: { id: a.id },
          data: { currentValueCents: newValue },
        });
        totalDep += a.currentValueCents - newValue;
        updated++;
      }
    }

    await this.prisma.depreciationRun.create({
      data: {
        period: asOf.toISOString().slice(0, 7), // YYYY-MM
        totalDepreciationCents: totalDep,
      },
    });

    return { assetsUpdated: updated, totalDepreciationCents: totalDep, period: asOf.toISOString().slice(0, 7) };
  }

  history(limit = 24) {
    return this.prisma.depreciationRun.findMany({
      orderBy: { postedAt: 'desc' },
      take: limit,
    });
  }

  /** Project next-12-month replacement spend (sum of purchase cost for assets reaching end of life). */
  async forecast() {
    const now = new Date();
    const horizon = new Date(now);
    horizon.setFullYear(horizon.getFullYear() + 1);

    const assets = await this.prisma.asset.findMany({
      where: {
        status: { notIn: ['DISPOSED', 'WRITTEN_OFF', 'LOST'] },
        purchaseDate: { not: null },
      },
      include: { sku: { include: { category: true } } },
    });

    const buckets = new Map<string, { category: string; replaceCents: number; count: number }>();
    for (const a of assets) {
      if (!a.purchaseDate) continue;
      const years = a.sku.depreciationYears > 0 ? a.sku.depreciationYears : 4;
      const eol = new Date(a.purchaseDate);
      eol.setFullYear(eol.getFullYear() + years);
      if (eol >= now && eol <= horizon) {
        const month = eol.toISOString().slice(0, 7);
        const e = buckets.get(month) ?? { category: a.sku.category.name, replaceCents: 0, count: 0 };
        e.replaceCents += a.purchaseCostCents;
        e.count += 1;
        buckets.set(month, e);
      }
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v }));
  }
}

function monthsBetween(from: Date, to: Date) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}
