import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseRequestStatus } from '../shared';

export class PrLineDto {
  @IsString() skuId!: string;
  @IsInt() @Min(1) qty!: number;
  @IsInt() @Min(0) estUnitCostCents!: number;
}
export class CreatePrDto {
  @IsOptional() @IsString() justification?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PrLineDto) lines!: PrLineDto[];
}

@Injectable()
export class PrService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.purchaseRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        requester: true,
        approver: true,
        lines: { include: { sku: true } },
      },
      take: 100,
    });
  }

  async byId(id: string) {
    const pr = await this.prisma.purchaseRequest.findUnique({
      where: { id },
      include: {
        requester: true,
        approver: true,
        lines: { include: { sku: { include: { category: true } } } },
        pos: { include: { supplier: true } },
      },
    });
    if (!pr) throw new NotFoundException();
    return pr;
  }

  private async nextCode() {
    const c = await this.prisma.purchaseRequest.count();
    return `PR-${new Date().getFullYear()}-${String(c + 1).padStart(5, '0')}`;
  }

  async create(dto: CreatePrDto, requesterId: string) {
    const total = dto.lines.reduce((s, l) => s + l.qty * l.estUnitCostCents, 0);
    return this.prisma.purchaseRequest.create({
      data: {
        code: await this.nextCode(),
        requesterId,
        status: PurchaseRequestStatus.Draft,
        justification: dto.justification,
        totalEstCents: total,
        lines: { create: dto.lines.map((l) => ({ skuId: l.skuId, qty: l.qty, estUnitCostCents: l.estUnitCostCents })) },
      },
      include: { lines: true },
    });
  }

  async transition(id: string, target: string, actorId: string) {
    const pr = await this.prisma.purchaseRequest.findUnique({ where: { id } });
    if (!pr) throw new NotFoundException();
    const allowed: Record<string, string[]> = {
      [PurchaseRequestStatus.Draft]:           [PurchaseRequestStatus.Submitted],
      [PurchaseRequestStatus.Submitted]:       [PurchaseRequestStatus.ItApproved, PurchaseRequestStatus.Rejected],
      [PurchaseRequestStatus.ItApproved]:      [PurchaseRequestStatus.FinanceApproved, PurchaseRequestStatus.Rejected],
      [PurchaseRequestStatus.FinanceApproved]: [PurchaseRequestStatus.Ordered],
      [PurchaseRequestStatus.Ordered]:         [PurchaseRequestStatus.Closed],
    };
    const next = allowed[pr.status] ?? [];
    if (!next.includes(target)) {
      throw new BadRequestException(`Cannot transition ${pr.status} → ${target}`);
    }
    const data: any = { status: target };
    if (target === PurchaseRequestStatus.ItApproved || target === PurchaseRequestStatus.FinanceApproved) {
      data.approverId = actorId;
    }
    return this.prisma.purchaseRequest.update({ where: { id }, data });
  }
}
