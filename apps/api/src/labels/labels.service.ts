import { Injectable, NotFoundException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LabelsService {
  constructor(private prisma: PrismaService) {}

  private resolveUrl(assetId: string) {
    const webBase = process.env.WEB_BASE_URL ?? 'http://localhost:5173';
    return `${webBase}/assets/${assetId}`;
  }

  async qrPng(assetId: string): Promise<Buffer> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException();
    return QRCode.toBuffer(this.resolveUrl(assetId), { type: 'png', width: 480, margin: 1 });
  }

  /**
   * Build a printable PDF asset label (62mm × 29mm — common Brother / Dymo size).
   * Contains: QR code, asset tag, SKU model and serial number.
   */
  async labelPdf(assetId: string): Promise<Buffer> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: { sku: true },
    });
    if (!asset) throw new NotFoundException();

    const qrBuffer = await QRCode.toBuffer(this.resolveUrl(assetId), {
      type: 'png', width: 240, margin: 0,
    });

    // 62mm × 29mm at 72dpi: 176pt × 82pt
    const W = 176, H = 82;
    const doc = new PDFDocument({ size: [W, H], margin: 6 });

    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    // QR on left
    doc.image(qrBuffer, 6, 6, { fit: [70, 70] });

    // Text on right
    const textX = 82;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0E2A47')
       .text('FASHION FUSION', textX, 8, { width: W - textX - 6 });
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000')
       .text(asset.assetTag, textX, 22, { width: W - textX - 6 });
    doc.font('Helvetica').fontSize(7).fillColor('#222')
       .text(`${asset.sku.manufacturer} ${asset.sku.model}`, textX, 40, { width: W - textX - 6 });
    if (asset.serialNo) {
      doc.font('Helvetica').fontSize(6).fillColor('#555')
         .text(`S/N ${asset.serialNo}`, textX, 56, { width: W - textX - 6 });
    }
    doc.font('Helvetica').fontSize(5).fillColor('#888')
       .text('itamls.fashionfusion.local', textX, 70, { width: W - textX - 6 });

    doc.end();
    return done;
  }
}
