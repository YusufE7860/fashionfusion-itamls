import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DispatchNoteService {
  constructor(private prisma: PrismaService) {}

  async pdf(ibtId: string): Promise<Buffer> {
    const ibt = await this.prisma.ibt.findUnique({
      where: { id: ibtId },
      include: {
        fromLoc: true,
        toLoc: true,
        requestedBy: true,
        approvedBy: true,
        dispatchedBy: true,
        lines: {
          include: {
            sku: { include: { category: true } },
            asset: true,
          },
        },
      },
    });
    if (!ibt) throw new NotFoundException();

    const webBase = process.env.WEB_BASE_URL ?? 'http://localhost:5173';
    const receiveUrl = `${webBase}/ibt?id=${ibtId}&action=receive`;
    const qrBuffer = await QRCode.toBuffer(receiveUrl, { type: 'png', width: 300, margin: 1 });

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise<Buffer>((r) => doc.on('end', () => r(Buffer.concat(chunks))));

    const W = doc.page.width;
    const H = doc.page.height;

    // ---------- Header band ----------
    doc.rect(0, 0, W, 90).fill('#050810');
    doc.fillColor('#fe6620').font('Helvetica-Bold').fontSize(9)
       .text('FASHION FUSION', 40, 24, { characterSpacing: 4 });
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(22)
       .text('DISPATCH NOTE', 40, 38);
    doc.fillColor('#7a8aa8').font('Helvetica').fontSize(9)
       .text('IT Asset Management & Logistics System', 40, 66);

    // QR top right
    doc.image(qrBuffer, W - 110, 12, { fit: [70, 70] });
    doc.fillColor('#7a8aa8').fontSize(6.5).text('Scan to receive', W - 110, 84, { width: 70, align: 'center' });

    // Orange accent stripe
    doc.rect(0, 90, W, 3).fill('#fe6620');

    // ---------- Meta block ----------
    let y = 115;
    doc.fillColor('#050810').font('Helvetica-Bold').fontSize(11).text(ibt.code, 40, y);
    doc.fillColor('#5b6772').font('Helvetica').fontSize(8)
       .text(`Issued ${new Date().toLocaleDateString('en-ZA')}`, 40, y + 16);

    y = 150;
    const colW = (W - 80) / 3;
    function metaCol(x: number, label: string, value: string) {
      doc.fillColor('#7a8aa8').font('Helvetica-Bold').fontSize(7)
         .text(label.toUpperCase(), x, y, { characterSpacing: 1 });
      doc.fillColor('#050810').font('Helvetica').fontSize(10)
         .text(value, x, y + 12, { width: colW - 8 });
    }
    metaCol(40,             'FROM', ibt.fromLoc?.name ?? '—');
    metaCol(40 + colW,      'TO',   ibt.toLoc?.name ?? '—');
    metaCol(40 + 2*colW,    'STATUS', ibt.status);

    y = 200;
    metaCol(40,             'REQUESTED BY', ibt.requestedBy?.fullName ?? '—');
    metaCol(40 + colW,      'APPROVED BY',  ibt.approvedBy?.fullName  ?? '—');
    metaCol(40 + 2*colW,    'DISPATCHED BY', ibt.dispatchedBy?.fullName ?? '—');

    y = 250;
    metaCol(40,             'COURIER',  ibt.courier ?? '—');
    metaCol(40 + colW,      'TRACKING', ibt.trackingNo ?? '—');
    metaCol(40 + 2*colW,    'BOX NUMBER(S)', ibt.boxNumbers ?? '—');

    // ---------- Line items ----------
    y = 305;
    doc.rect(40, y, W - 80, 22).fill('#050810');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
    const colTag   = 50;
    const colItem  = 130;
    const colSerial = 340;
    const colQty   = 470;
    doc.text('ASSET TAG', colTag,    y + 7, { characterSpacing: 1 });
    doc.text('ITEM',      colItem,   y + 7, { characterSpacing: 1 });
    doc.text('SERIAL',    colSerial, y + 7, { characterSpacing: 1 });
    doc.text('QTY',       colQty,    y + 7, { characterSpacing: 1 });

    y += 22;
    doc.fillColor('#050810').font('Helvetica').fontSize(9);
    for (const [i, line] of ibt.lines.entries()) {
      if (i % 2 === 0) {
        doc.rect(40, y, W - 80, 22).fillColor('#fafbfd').fill();
      }
      doc.fillColor('#050810').font('Helvetica');
      doc.text(line.asset?.assetTag ?? '—', colTag,    y + 7, { width: colItem - colTag - 5 });
      doc.text(`${line.sku.manufacturer} ${line.sku.model}`, colItem, y + 7, { width: colSerial - colItem - 5 });
      doc.text(line.asset?.serialNo ?? '—', colSerial, y + 7, { width: colQty - colSerial - 5 });
      doc.text(String(line.qty), colQty, y + 7);
      y += 22;
      if (y > H - 220) { doc.addPage(); y = 50; }
    }

    // ---------- Receiving section ----------
    y = Math.max(y + 30, H - 200);
    doc.fillColor('#050810').font('Helvetica-Bold').fontSize(10)
       .text('RECEIVING', 40, y, { characterSpacing: 2 });
    doc.rect(40, y + 18, 50, 1).fill('#fe6620');

    y += 32;
    doc.fillColor('#5b6772').font('Helvetica').fontSize(9)
       .text('I confirm that all items listed above have been received in good condition unless noted otherwise.',
              40, y, { width: W - 80 });

    y += 36;
    // Signature line
    doc.strokeColor('#5b6772').lineWidth(0.5).moveTo(40, y + 30).lineTo(280, y + 30).stroke();
    doc.fillColor('#7a8aa8').fontSize(7).text('SIGNATURE', 40, y + 36, { characterSpacing: 1 });

    // Print name
    doc.strokeColor('#5b6772').lineWidth(0.5).moveTo(310, y + 30).lineTo(450, y + 30).stroke();
    doc.fillColor('#7a8aa8').fontSize(7).text('PRINT NAME', 310, y + 36, { characterSpacing: 1 });

    // Date
    doc.strokeColor('#5b6772').lineWidth(0.5).moveTo(470, y + 30).lineTo(W - 40, y + 30).stroke();
    doc.fillColor('#7a8aa8').fontSize(7).text('DATE', 470, y + 36, { characterSpacing: 1 });

    // Footer
    doc.fillColor('#7a8aa8').fontSize(7)
       .text(`Generated ${new Date().toLocaleString('en-ZA')} · Fashion Fusion ITAMLS`,
              40, H - 30, { width: W - 80, align: 'center' });

    doc.end();
    return done;
  }
}
