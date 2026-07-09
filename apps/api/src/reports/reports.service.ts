import { Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';

function fromCents(c: number) { return (c / 100).toFixed(2); }

type ReportName =
  | 'assets-by-category'
  | 'assets-by-store'
  | 'warranty-expiring-90'
  | 'repair-cost'
  | 'store-equipment-value';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async data(name: ReportName) {
    switch (name) {
      case 'assets-by-category': {
        const rows = await this.prisma.asset.findMany({
          include: { sku: { include: { category: true } } },
        });
        const grouped = new Map<string, { count: number; valueCents: number }>();
        for (const a of rows) {
          const k = a.sku.category.name;
          const e = grouped.get(k) ?? { count: 0, valueCents: 0 };
          e.count += 1;
          e.valueCents += a.currentValueCents;
          grouped.set(k, e);
        }
        return {
          title: 'Assets by Category',
          columns: ['Category', 'Count', 'Total value (ZAR)'],
          rows: [...grouped.entries()]
            .sort((a, b) => b[1].valueCents - a[1].valueCents)
            .map(([k, v]) => [k, v.count, fromCents(v.valueCents)]),
        };
      }
      case 'assets-by-store': {
        const stores = await this.prisma.store.findMany({
          include: {
            assignedAssets: { select: { currentValueCents: true } },
          },
        });
        return {
          title: 'Assets by Store',
          columns: ['Code', 'Name', 'Region', 'Asset count', 'Total value (ZAR)'],
          rows: stores
            .map((s) => ({
              code: s.code, name: s.name, region: s.region,
              count: s.assignedAssets.length,
              value: s.assignedAssets.reduce((sum, a) => sum + a.currentValueCents, 0),
            }))
            .sort((a, b) => b.value - a.value)
            .map((r) => [r.code, r.name, r.region, r.count, fromCents(r.value)]),
        };
      }
      case 'warranty-expiring-90': {
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + 90);
        const rows = await this.prisma.asset.findMany({
          where: { warrantyExpiry: { lte: cutoff, gte: new Date() } },
          include: { sku: true, supplier: true, location: true, assignedStore: true },
          orderBy: { warrantyExpiry: 'asc' },
        });
        return {
          title: 'Warranties expiring in next 90 days',
          columns: ['Asset Tag', 'Model', 'Supplier', 'Location', 'Expires'],
          rows: rows.map((a) => [
            a.assetTag,
            `${a.sku.manufacturer} ${a.sku.model}`,
            a.supplier?.name ?? '—',
            a.assignedStore?.name ?? a.location?.name ?? '—',
            a.warrantyExpiry ? a.warrantyExpiry.toISOString().slice(0, 10) : '—',
          ]),
        };
      }
      case 'repair-cost': {
        const rows = await this.prisma.repair.findMany({
          include: { asset: { include: { sku: true } }, supplier: true },
          orderBy: { createdAt: 'desc' },
        });
        return {
          title: 'Repair cost report',
          columns: ['Code', 'Asset', 'Supplier', 'Status', 'Warranty?', 'Cost (ZAR)'],
          rows: rows.map((r) => [
            r.code,
            `${r.asset.assetTag} – ${r.asset.sku.model}`,
            r.supplier?.name ?? '—',
            r.status,
            r.warrantyClaim ? 'Yes' : 'No',
            fromCents(r.costCents),
          ]),
        };
      }
      case 'store-equipment-value': {
        const stores = await this.prisma.store.findMany({
          include: { assignedAssets: { include: { sku: { include: { category: true } } } } },
        });
        const out: any[][] = [];
        for (const s of stores) {
          const byCat = new Map<string, { count: number; value: number }>();
          for (const a of s.assignedAssets) {
            const e = byCat.get(a.sku.category.name) ?? { count: 0, value: 0 };
            e.count += 1;
            e.value += a.currentValueCents;
            byCat.set(a.sku.category.name, e);
          }
          for (const [cat, v] of byCat.entries()) {
            out.push([s.code, s.name, cat, v.count, fromCents(v.value)]);
          }
        }
        return {
          title: 'Store equipment value',
          columns: ['Store code', 'Store', 'Category', 'Count', 'Value (ZAR)'],
          rows: out,
        };
      }
      default:
        throw new NotFoundException('Unknown report');
    }
  }

  async xlsx(name: ReportName): Promise<Buffer> {
    const { title, columns, rows } = await this.data(name);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Fashion Fusion ITAMLS';
    const sheet = wb.addWorksheet(title.slice(0, 30));
    sheet.addRow([title]).font = { bold: true, size: 14, color: { argb: 'FF0E2A47' } };
    sheet.addRow([]);
    const header = sheet.addRow(columns);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E2A47' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });
    for (const r of rows) sheet.addRow(r);
    sheet.columns.forEach((c) => { c.width = Math.max(14, (c.values?.length ?? 0) > 0 ? 18 : 14); });
    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out as ArrayBuffer);
  }

  async pdf(name: ReportName): Promise<Buffer> {
    const { title, columns, rows } = await this.data(name);
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise<Buffer>((r) => doc.on('end', () => r(Buffer.concat(chunks))));

    // Header band
    doc.rect(0, 0, doc.page.width, 60).fill('#0E2A47');
    doc.fillColor('#C9A227').font('Helvetica-Bold').fontSize(9)
       .text('FASHION FUSION', 40, 18);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(16)
       .text(title, 40, 30);
    doc.fillColor('#000');

    let y = 90;
    const colWidth = (doc.page.width - 80) / columns.length;

    // Header row
    doc.rect(40, y, doc.page.width - 80, 22).fill('#0E2A47');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9);
    columns.forEach((c, i) => doc.text(String(c), 44 + i * colWidth, y + 7, { width: colWidth - 8 }));
    y += 22;

    doc.fillColor('#000').font('Helvetica').fontSize(8.5);
    for (const row of rows) {
      if (y > doc.page.height - 60) { doc.addPage(); y = 50; }
      doc.rect(40, y, doc.page.width - 80, 18).fill(y % 36 === 0 ? '#FAFBFD' : '#FFFFFF');
      doc.fillColor('#000');
      row.forEach((cell, i) =>
        doc.text(String(cell ?? ''), 44 + i * colWidth, y + 5, { width: colWidth - 8, ellipsis: true }),
      );
      y += 18;
    }

    doc.fillColor('#888').fontSize(7)
       .text(`Generated ${new Date().toLocaleString()} · Fashion Fusion ITAMLS`,
             40, doc.page.height - 40);
    doc.end();
    return done;
  }
}
