import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssetStatus, ComplianceState, ComplianceLineDto } from '../shared';

@Injectable()
export class ComplianceService {
  constructor(private prisma: PrismaService) {}

  /**
   * For a store, return one line per template item with required vs installed
   * counts, and a ComplianceState (INSTALLED / PARTIAL / MISSING).
   */
  async forStore(storeId: string): Promise<ComplianceLineDto[]> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: { template: { include: { items: { include: { category: true } } } } },
    });
    if (!store) throw new NotFoundException();
    if (!store.template) return [];

    // Count assets at the store, grouped by category
    const assets = await this.prisma.asset.findMany({
      where: { assignedStoreId: storeId, status: AssetStatus.InStore },
      include: { sku: true },
    });
    const byCategory = new Map<string, number>();
    for (const a of assets) {
      byCategory.set(a.sku.categoryId, (byCategory.get(a.sku.categoryId) ?? 0) + 1);
    }

    return store.template.items.map((item) => {
      const installed = byCategory.get(item.categoryId) ?? 0;
      let state: typeof ComplianceState[keyof typeof ComplianceState] = ComplianceState.Missing;
      if (installed >= item.requiredQty && item.requiredQty > 0) state = ComplianceState.Installed;
      else if (installed > 0) state = ComplianceState.Partial;
      return {
        templateItemId: item.id,
        categoryId: item.categoryId,
        categoryName: item.category.name,
        requiredQty: item.requiredQty,
        installedQty: installed,
        state,
      };
    });
  }

  /** Roll-up across all stores. */
  async summary() {
    const stores = await this.prisma.store.findMany({ select: { id: true, code: true, name: true } });
    const out: { storeId: string; storeCode: string; storeName: string; compliantPct: number; missing: number }[] = [];
    for (const s of stores) {
      const lines = await this.forStore(s.id);
      if (lines.length === 0) continue;
      const installed = lines.filter((l) => l.state === ComplianceState.Installed).length;
      const missing = lines.filter((l) => l.state === ComplianceState.Missing).length;
      out.push({
        storeId: s.id, storeCode: s.code, storeName: s.name,
        compliantPct: Math.round((installed / lines.length) * 100),
        missing,
      });
    }
    return out;
  }
}
