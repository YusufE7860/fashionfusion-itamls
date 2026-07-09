import { Injectable, NotFoundException } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseRequestStatus } from '../shared';

export class CreatePoDto {
  @IsString() prId!: string;
  @IsString() supplierId!: string;
  @IsOptional() @IsString() expectedDelivery?: string;
}

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
