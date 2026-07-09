import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { PrismaService } from '../prisma/prisma.service';
import { AssetStatus } from '../shared';

export interface CsvRow {
  assetTag?: string;
  serialNo?: string;
  skuCode?: string;
  supplierName?: string;
  purchaseDate?: string;
  purchaseCostCents?: string;
  warrantyExpiry?: string;
  locationCode?: string;
  storeCode?: string;
  condition?: string;
}

export interface ImportRowResult {
  rowNumber: number;
  raw: CsvRow;
  ok: boolean;
  errors: string[];
  willCreate?: { assetTag: string; skuCode: string };
}

@Injectable()
export class AssetsImportService {
  constructor(private prisma: PrismaService) {}

  parseCsv(csv: string): CsvRow[] {
    return parse(csv, { columns: true, skip_empty_lines: true, trim: true });
  }

  async dryRun(csv: string): Promise<{ rows: ImportRowResult[]; summary: { total: number; ok: number; errors: number } }> {
    const rows = this.parseCsv(csv);
    const skus       = await this.prisma.sku.findMany();
    const suppliers  = await this.prisma.supplier.findMany();
    const locations  = await this.prisma.location.findMany();
    const stores     = await this.prisma.store.findMany();
    const existing   = new Set((await this.prisma.asset.findMany({ select: { assetTag: true } })).map((a) => a.assetTag));

    const results: ImportRowResult[] = rows.map((raw, i) => {
      const errs: string[] = [];
      const r: ImportRowResult = { rowNumber: i + 2, raw, ok: false, errors: errs };
      if (!raw.assetTag) errs.push('assetTag is required');
      else if (existing.has(raw.assetTag)) errs.push(`assetTag "${raw.assetTag}" already exists`);

      if (!raw.skuCode) errs.push('skuCode is required');
      else if (!skus.find((s) => s.code === raw.skuCode)) errs.push(`SKU "${raw.skuCode}" not found`);

      if (raw.supplierName && !suppliers.find((s) => s.name === raw.supplierName))
        errs.push(`Supplier "${raw.supplierName}" not found`);
      if (raw.locationCode && !locations.find((l) => l.code === raw.locationCode))
        errs.push(`Location "${raw.locationCode}" not found`);
      if (raw.storeCode && !stores.find((s) => s.code === raw.storeCode))
        errs.push(`Store "${raw.storeCode}" not found`);

      if (raw.purchaseCostCents && isNaN(Number(raw.purchaseCostCents)))
        errs.push('purchaseCostCents must be a number');
      if (raw.purchaseDate && isNaN(Date.parse(raw.purchaseDate)))
        errs.push('purchaseDate must be an ISO date (YYYY-MM-DD)');
      if (raw.warrantyExpiry && isNaN(Date.parse(raw.warrantyExpiry)))
        errs.push('warrantyExpiry must be an ISO date');

      r.ok = errs.length === 0;
      if (r.ok) r.willCreate = { assetTag: raw.assetTag!, skuCode: raw.skuCode! };
      return r;
    });

    return {
      rows: results,
      summary: {
        total: results.length,
        ok: results.filter((x) => x.ok).length,
        errors: results.filter((x) => !x.ok).length,
      },
    };
  }

  async commit(csv: string, actorId: string) {
    const dry = await this.dryRun(csv);
    if (dry.summary.errors > 0) {
      return { committed: 0, errors: dry.summary.errors, dryRun: dry };
    }
    const skus       = await this.prisma.sku.findMany();
    const suppliers  = await this.prisma.supplier.findMany();
    const locations  = await this.prisma.location.findMany();
    const stores     = await this.prisma.store.findMany();
    const findSku       = (c?: string) => skus.find((s) => s.code === c);
    const findSupplier  = (n?: string) => suppliers.find((s) => s.name === n);
    const findLocation  = (c?: string) => locations.find((l) => l.code === c);
    const findStore     = (c?: string) => stores.find((s) => s.code === c);

    let committed = 0;
    for (const r of dry.rows) {
      if (!r.ok) continue;
      const sku = findSku(r.raw.skuCode)!;
      const cost = Number(r.raw.purchaseCostCents ?? 0) || sku.unitCostCents;
      const a = await this.prisma.asset.create({
        data: {
          assetTag: r.raw.assetTag!,
          serialNo: r.raw.serialNo || undefined,
          skuId: sku.id,
          supplierId: findSupplier(r.raw.supplierName)?.id,
          purchaseDate: r.raw.purchaseDate ? new Date(r.raw.purchaseDate) : new Date(),
          purchaseCostCents: cost,
          currentValueCents: cost,
          warrantyExpiry: r.raw.warrantyExpiry ? new Date(r.raw.warrantyExpiry) : undefined,
          condition: r.raw.condition || 'GOOD',
          locationId: findLocation(r.raw.locationCode)?.id,
          assignedStoreId: findStore(r.raw.storeCode)?.id,
          status: r.raw.storeCode ? AssetStatus.InStore : AssetStatus.InStock,
          source: 'IMPORT',
        },
      });
      await this.prisma.assetHistory.create({
        data: {
          assetId: a.id, eventType: 'PURCHASED',
          toLocationId: findLocation(r.raw.locationCode)?.id,
          actorId, notes: `Bulk import row ${r.rowNumber}`,
        },
      });
      committed++;
    }
    return { committed, errors: 0, dryRun: dry };
  }

  templateCsv() {
    return [
      'assetTag,serialNo,skuCode,supplierName,purchaseDate,purchaseCostCents,warrantyExpiry,locationCode,storeCode,condition',
      'FF-POS-G-005,CN-EXAMPLE-1,POS-DELL-3000,Dell South Africa,2025-04-12,1250000,2027-04-12,STR-001,001,GOOD',
      'FF-MON-G-005,SN-EXAMPLE-2,MON-DELL-24,Dell South Africa,2025-04-12,350000,2027-04-12,STR-001,001,GOOD',
    ].join('\n');
  }
}
