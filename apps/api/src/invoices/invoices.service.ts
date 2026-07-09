import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export interface ListInvoicesQuery {
  q?: string;
  supplierId?: string;
  assetId?: string;
  grvId?: string;
}

export interface CreateInvoiceInput {
  docNo: string;
  supplierId: string;
  invoiceDate: string; // ISO
  totalCents: number;
  linkedAssetId?: string;
  linkedGrvId?: string;
  linkedPoId?: string;
  file: {
    originalName: string;
    mimeType: string;
    buffer: Buffer;
  };
}

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  async list(q: ListInvoicesQuery) {
    const where: any = {};
    if (q.supplierId) where.supplierId = q.supplierId;
    if (q.assetId) where.linkedAssetId = q.assetId;
    if (q.grvId) where.linkedGrvId = q.grvId;
    if (q.q) {
      where.OR = [
        { docNo: { contains: q.q, mode: 'insensitive' } },
        { ocrText: { contains: q.q, mode: 'insensitive' } },
        { supplier: { name: { contains: q.q, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.invoice.findMany({
      where,
      include: { supplier: true, linkedGrv: true },
      orderBy: { invoiceDate: 'desc' },
      take: 200,
    });
  }

  async byId(id: string) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id }, include: { supplier: true, linkedGrv: true },
    });
    if (!inv) throw new NotFoundException();
    return inv;
  }

  async create(input: CreateInvoiceInput) {
    const key = this.storage.generateObjectKey(input.file.originalName);
    await this.storage.putObject(key, input.file.buffer, input.file.mimeType);

    return this.prisma.invoice.create({
      data: {
        docNo: input.docNo,
        supplierId: input.supplierId,
        invoiceDate: new Date(input.invoiceDate),
        totalCents: input.totalCents,
        fileUrl: key,
        linkedAssetId: input.linkedAssetId,
        linkedGrvId: input.linkedGrvId,
        linkedPoId: input.linkedPoId,
      },
      include: { supplier: true },
    });
  }

  async downloadUrl(id: string) {
    const inv = await this.byId(id);
    if (!inv.fileUrl) throw new NotFoundException('No file attached');
    return this.storage.presignedGet(inv.fileUrl, 5 * 60);
  }

  async streamInline(id: string) {
    const inv = await this.byId(id);
    if (!inv.fileUrl) throw new NotFoundException('No file attached');
    const stream = await this.storage.getStream(inv.fileUrl);
    return { stream, key: inv.fileUrl, inv };
  }
}
