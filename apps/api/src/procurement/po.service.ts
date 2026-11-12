import { Injectable, NotFoundException } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseRequestStatus } from '../shared';
// pdfkit used here mirrors helpdesk/exports.service.ts and stores/wizard.service.ts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');

export class CreatePoDto {
  @IsString() prId!: string;
  @IsString() supplierId!: string;
  @IsOptional() @IsString() expectedDelivery?: string;
}

/**
 * Company profile that stamps the PO's "Issued by" side (addresses, VAT
 * number, contact details). Matching the printed book Fashion Fusion
 * currently uses. Evolve gets a parallel profile and will be swappable
 * by the operator later; for now we hardcode FF because the printed book
 * is their primary reference.
 */
const FF_PROFILE = {
  tradingName: 'Fashion Fusion Distribution (Pty) Ltd',
  coRegNo:     '2013/141828/07',
  addressLines: ['17 Alexander Rd, Westmead', 'Pinetown', '3608'],
  postal:      ['P.O Box 65256', 'Reservoir Hills', '4090'],
  tel:         '031 312 6948',
  fax:         '086 657 5544',
  email:       'accounts@fashionfusion.co.za',
  vat:         '4230271928',
  header:      'FASHION FUSION',   // rendered big and bold, matches stamped header
  subHeader:   'Distribution',
} as const;

const VAT_RATE = 0.15;

@Injectable()
export class PoService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.purchaseOrder.findMany({
      orderBy: { sentAt: 'desc' },
      include: { supplier: true, pr: true },
      take: 100,
    });
  }

  /** Full PO payload used by the PDF renderer + a potential detail view. */
  async detail(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        pr: {
          include: {
            lines: {
              include: {
                sku: { include: { category: true, supplier: true } },
              },
            },
            requester: { select: { id: true, fullName: true, email: true } },
            approver:  { select: { id: true, fullName: true, email: true } },
          },
        },
      },
    });
    if (!po) throw new NotFoundException('PO not found');
    return po;
  }

  /**
   * Render the PO as a PDF that visually matches Fashion Fusion's
   * current paper book — same column headings (CODE / DESCRIPTION / QTY /
   * PRICE / TOTAL EXCL VAT), same supplier + issuer blocks, same signature
   * footer. Deliberately plain so it reads as a legitimate PO to suppliers
   * who are used to the printed version.
   */
  async pdf(id: string): Promise<{ buf: Buffer; filename: string }> {
    const po = await this.detail(id);
    const buf = await this.renderPdf(po);
    return { buf, filename: `PO-${po.code}.pdf` };
  }

  private renderPdf(po: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data',  (c: Buffer) => chunks.push(c));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // -- Convenience helpers ------------------------------------------------
      const pageW = doc.page.width;
      const margin = 36;
      const contentW = pageW - margin * 2;
      const money = (c: number) =>
        'R ' + (c / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const box = (x: number, y: number, w: number, h: number) =>
        doc.lineWidth(0.6).strokeColor('#1e293b').rect(x, y, w, h).stroke();

      // -- Header row: FF/Distribution block (left) + PURCHASE ORDER block ----
      const topY = margin;
      const leftW  = contentW * 0.55;
      const rightW = contentW - leftW;
      const headerH = 70;

      // Left: logo text block (no raster logo — renders cleanly without font files)
      box(margin, topY, leftW, headerH);
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(24)
        .text(FF_PROFILE.header, margin + 10, topY + 8, { width: leftW - 20 });
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#334155')
        .text(FF_PROFILE.subHeader, margin + 10, topY + 38);
      doc.font('Helvetica').fontSize(8).fillColor('#64748b')
        .text(`Co. Reg. No. ${FF_PROFILE.coRegNo}`, margin + 10, topY + 55);

      // Right: PURCHASE ORDER + date / pages / doc no
      const rX = margin + leftW;
      box(rX, topY, rightW, headerH);
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a')
        .text('PURCHASE ORDER', rX, topY + 6, { width: rightW, align: 'center' });
      const dtY = topY + 28;
      doc.font('Helvetica').fontSize(9).fillColor('#0f172a');
      doc.text(`Date:    ${formatDate(po.sentAt ?? new Date())}`, rX + 8, dtY);
      doc.text(`Doc No:  ${po.code}`,                              rX + 8, dtY + 14);
      doc.text(`Pages:   1`,                                       rX + 8, dtY + 28);

      // -- Supplier block (left) + Issued-by block (right) --------------------
      const detailsY = topY + headerH + 8;
      const detailsH = 110;

      box(margin, detailsY, leftW, detailsH);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a')
        .text('SUPPLIER DETAILS', margin + 8, detailsY + 6);
      doc.font('Helvetica').fontSize(10).fillColor('#0f172a');
      const sLines = [
        ['Name:',    po.supplier?.name ?? ''],
        ['Address:', '—'],
        ['Contact:', po.supplier?.contactName ?? ''],
        ['Phone:',   po.supplier?.phone ?? ''],
        ['Email:',   po.supplier?.email ?? ''],
      ];
      let sY = detailsY + 24;
      for (const [k, v] of sLines) {
        doc.font('Helvetica-Bold').text(k, margin + 8, sY, { continued: true, width: leftW - 20 });
        doc.font('Helvetica').text(' ' + v);
        sY += 14;
      }

      // Issued-by (right)
      box(rX, detailsY, rightW, detailsH);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a')
        .text(FF_PROFILE.tradingName, rX + 8, detailsY + 6);
      doc.font('Helvetica').fontSize(9).fillColor('#334155');
      let iY = detailsY + 22;
      const iLine = (s: string) => { doc.text(s, rX + 8, iY, { width: rightW - 16 }); iY += 11; };
      FF_PROFILE.addressLines.forEach(iLine);
      iY += 2;
      FF_PROFILE.postal.forEach(iLine);
      iY += 2;
      iLine(`Tel: ${FF_PROFILE.tel}   Fax: ${FF_PROFILE.fax}`);
      iLine(`email: ${FF_PROFILE.email}`);
      iLine(`VAT Reg No. ${FF_PROFILE.vat}`);

      // -- Reference strip ---------------------------------------------------
      const refY = detailsY + detailsH + 6;
      const refH = 20;
      box(margin, refY, contentW, refH);
      const thirdW = contentW / 3;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#334155');
      doc.text('ACCOUNT',       margin + 8,                refY + 6);
      doc.text('TAX EXEMPT',    margin + thirdW + 8,       refY + 6);
      doc.text('ORDER REF/STORE', margin + thirdW * 2 + 8, refY + 6);

      // -- Line items table --------------------------------------------------
      const tableY = refY + refH + 6;
      const cols = [
        { key: 'code',  label: 'CODE',        x: margin,                  w: 70 },
        { key: 'desc',  label: 'DESCRIPTION', x: margin + 70,             w: contentW - 70 - 60 - 90 - 110 },
        { key: 'qty',   label: 'QTY',         x: contentW + margin - 260, w: 60,  align: 'right' as const },
        { key: 'price', label: 'PRICE',       x: contentW + margin - 200, w: 90,  align: 'right' as const },
        { key: 'total', label: 'TOTAL (EXCL VAT)', x: contentW + margin - 110, w: 110, align: 'right' as const },
      ];
      // Header row
      const headerRowH = 20;
      box(margin, tableY, contentW, headerRowH);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
      for (const c of cols) {
        doc.text(c.label, c.x + 4, tableY + 6, { width: c.w - 8, align: (c as any).align ?? 'left' });
      }
      // Rows
      const rowH = 20;
      const maxRows = 18;
      const lines = (po.pr?.lines ?? []) as any[];
      let rowY = tableY + headerRowH;
      doc.font('Helvetica').fontSize(9).fillColor('#0f172a');
      for (let i = 0; i < maxRows; i++) {
        box(margin, rowY, contentW, rowH);
        const line = lines[i];
        if (line) {
          const lineTotal = line.qty * line.estUnitCostCents;
          doc.text(line.sku?.code ?? '', cols[0].x + 4, rowY + 6, { width: cols[0].w - 8 });
          doc.text(line.sku?.name ?? '', cols[1].x + 4, rowY + 6, { width: cols[1].w - 8 });
          doc.text(String(line.qty),      cols[2].x + 4, rowY + 6, { width: cols[2].w - 8, align: 'right' });
          doc.text(money(line.estUnitCostCents), cols[3].x + 4, rowY + 6, { width: cols[3].w - 8, align: 'right' });
          doc.text(money(lineTotal),      cols[4].x + 4, rowY + 6, { width: cols[4].w - 8, align: 'right' });
        }
        rowY += rowH;
      }

      // -- Footer: signatures + totals --------------------------------------
      const footerY = rowY + 6;
      const footerH = 90;
      const sigW = contentW * 0.55;
      const totW = contentW - sigW;

      // Signatures box (left)
      box(margin, footerY, sigW, footerH);
      const colW = sigW / 2;
      // Headings
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
      doc.text('REQUESTED BY',  margin + 8,        footerY + 6, { width: colW - 16 });
      doc.text('AUTHORISED BY', margin + colW + 8, footerY + 6, { width: colW - 16 });
      doc.font('Helvetica').fontSize(9).fillColor('#334155');
      const sigRows: Array<[string, string]> = [
        ['Name:', po.pr?.requester?.fullName ?? ''],
        ['Sign:', ''],
        ['Date:', po.sentAt ? formatDate(po.sentAt) : ''],
      ];
      const authRows: Array<[string, string]> = [
        ['Name:', po.pr?.approver?.fullName ?? ''],
        ['Sign:', ''],
        ['Date:', po.sentAt ? formatDate(po.sentAt) : ''],
      ];
      let sigY = footerY + 24;
      for (let i = 0; i < 3; i++) {
        doc.text(`${sigRows[i][0]} ${sigRows[i][1]}`,    margin + 8,        sigY, { width: colW - 16 });
        doc.text(`${authRows[i][0]} ${authRows[i][1]}`,  margin + colW + 8, sigY, { width: colW - 16 });
        sigY += 18;
      }

      // Totals (right)
      const tX = margin + sigW;
      box(tX, footerY, totW, footerH);
      const subtotal = lines.reduce((s: number, l: any) => s + l.qty * l.estUnitCostCents, 0);
      const vat = Math.round(subtotal * VAT_RATE);
      const total = subtotal + vat;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a');
      const totals: Array<[string, number]> = [
        ['SUBTOTAL', subtotal],
        ['VAT (15%)', vat],
        ['TOTAL', total],
      ];
      let tY = footerY + 12;
      for (const [label, cents] of totals) {
        doc.font('Helvetica-Bold').text(label, tX + 8, tY, { width: totW * 0.45 });
        doc.font('Helvetica').text(money(cents), tX + totW * 0.45, tY, { width: totW * 0.5 - 8, align: 'right' });
        tY += 24;
      }

      doc.end();
    });
  }

  private async nextCode() {
    const c = await this.prisma.purchaseOrder.count();
    return `PO-${new Date().getFullYear()}-${String(c + 1).padStart(5, '0')}`;
  }

  async create(dto: CreatePoDto) {
    const pr = await this.prisma.purchaseRequest.findUnique({
      where: { id: dto.prId },
      include: { lines: true },
    });
    if (!pr) throw new NotFoundException('PR not found');
    const total = pr.lines.reduce((s, l) => s + l.qty * l.estUnitCostCents, 0);
    const po = await this.prisma.purchaseOrder.create({
      data: {
        code: await this.nextCode(),
        prId: pr.id,
        supplierId: dto.supplierId,
        totalCents: total,
        status: 'SENT',
        sentAt: new Date(),
        expectedDelivery: dto.expectedDelivery ? new Date(dto.expectedDelivery) : undefined,
      },
      include: { supplier: true, pr: true },
    });
    await this.prisma.purchaseRequest.update({
      where: { id: pr.id },
      data: { status: PurchaseRequestStatus.Ordered },
    });
    return po;
  }
}

function formatDate(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

