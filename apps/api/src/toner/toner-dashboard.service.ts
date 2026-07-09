import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MONTHS } from '../shared';

@Injectable()
export class TonerDashboardService {
  constructor(private prisma: PrismaService) {}

  async overview(year: number) {
    const [types, plans, orders] = await Promise.all([
      this.prisma.tonerType.findMany({ orderBy: { code: 'asc' } }),
      this.prisma.tonerPlan.findMany({ where: { year } }),
      this.prisma.tonerOrder.findMany({
        where: { period: { startsWith: String(year) } },
        include: { lines: true },
      }),
    ]);

    // Annual forecast per toner type
    const forecast = new Map<string, number>();
    for (const p of plans) {
      const qty = [p.jan,p.feb,p.mar,p.apr,p.may,p.jun,p.jul,p.aug,p.sep,p.oct,p.nov,p.dec].reduce((s, x) => s + x, 0);
      forecast.set(p.tonerTypeId, (forecast.get(p.tonerTypeId) ?? 0) + qty);
    }

    // Dispatched / received YTD
    const dispatched = new Map<string, number>();
    const received   = new Map<string, number>();
    for (const o of orders) {
      for (const l of o.lines) {
        dispatched.set(l.tonerTypeId, (dispatched.get(l.tonerTypeId) ?? 0) + l.dispatchedQty);
        received.set  (l.tonerTypeId, (received.get(l.tonerTypeId)   ?? 0) + l.receivedQty);
      }
    }

    const perType = types.map((t) => {
      const annualForecast = forecast.get(t.id) ?? 0;
      const dispatchedYtd  = dispatched.get(t.id) ?? 0;
      const receivedYtd    = received.get(t.id) ?? 0;
      const annualCostCents = annualForecast * t.unitCostCents;
      return {
        id: t.id,
        code: t.code,
        name: t.name,
        unitCostCents: t.unitCostCents,
        hqStock: t.hqStock,
        reorderLevel: t.reorderLevel,
        annualForecast,
        dispatchedYtd,
        receivedYtd,
        remaining: Math.max(0, annualForecast - dispatchedYtd),
        annualCostCents,
        recommendedPurchase: Math.max(0, annualForecast - dispatchedYtd - t.hqStock),
      };
    });

    // Order status counts
    const counts: Record<string, number> = { DRAFT: 0, DISPATCHED: 0, RECEIVED: 0, CLOSED: 0, CANCELLED: 0 };
    for (const o of orders) counts[o.status] = (counts[o.status] ?? 0) + 1;

    return { year, perType, ordersByStatus: counts, months: MONTHS };
  }
}
