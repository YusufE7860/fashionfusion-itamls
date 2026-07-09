import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { MONTHS, TonerOrderStatus } from '../shared';

const MONTH_KEY = (m: number) => MONTHS[m]; // 0..11

export class GenerateOrderDto {
  @IsInt() year!: number;
  @IsInt() @Min(1) month!: number; // 1..12
  @IsOptional() @IsString() notes?: string;
}

export class DispatchLineDto {
  @IsInt() @Min(0) dispatchedQty!: number;
  @IsOptional() @IsString() courier?: string;
  @IsOptional() @IsString() trackingNo?: string;
  @IsOptional() @IsString() boxNumbers?: string;
}

export class ReceiveLineDto {
  @IsInt() @Min(0) receivedQty!: number;
  @IsOptional() @IsString() signedBy?: string;
  @IsOptional() @IsString() signatureDataUrl?: string;
}

@Injectable()
export class TonerOrdersService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.tonerOrder.findMany({
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { lines: true } } },
      take: 50,
    });
  }

  async byId(id: string) {
    const o = await this.prisma.tonerOrder.findUnique({
      where: { id },
      include: {
        lines: {
          include: { store: true, tonerType: true },
          orderBy: [{ store: { code: 'asc' } }, { tonerType: { code: 'asc' } }],
        },
      },
    });
    if (!o) throw new NotFoundException();
    return o;
  }

  /**
   * Snapshot the plan into a new TonerOrder: one line per (store, tonerType)
   * where the planned month qty > 0. Idempotent — re-running for the same month
   * returns the existing order.
   */
  async generate(dto: GenerateOrderDto) {
    const period = `${dto.year}-${String(dto.month).padStart(2, '0')}`;
    const existing = await this.prisma.tonerOrder.findFirst({ where: { period } });
    if (existing) return this.byId(existing.id);

    const monthKey = MONTH_KEY(dto.month - 1);
    const plans = await this.prisma.tonerPlan.findMany({
      where: { year: dto.year, [monthKey]: { gt: 0 } } as any,
      include: { store: true, tonerType: true },
    });

    const count = await this.prisma.tonerOrder.count();
    const code = `TON-${dto.year}-${String(count + 1).padStart(4, '0')}`;

    const order = await this.prisma.tonerOrder.create({
      data: {
        code,
        period,
        status: TonerOrderStatus.Draft,
        notes: dto.notes,
        lines: {
          create: plans.map((p) => ({
            storeId: p.storeId,
            tonerTypeId: p.tonerTypeId,
            plannedQty: (p as any)[monthKey] as number,
          })),
        },
      },
    });
    return this.byId(order.id);
  }

  /** Dispatch a single line — decrements HQ stock and records courier/tracking. */
  async dispatchLine(lineId: string, dto: DispatchLineDto) {
    return this.prisma.$transaction(async (tx) => {
      const line = await tx.tonerOrderLine.findUnique({
        where: { id: lineId }, include: { tonerType: true },
      });
      if (!line) throw new NotFoundException();
      if (dto.dispatchedQty < 0) throw new BadRequestException('Negative qty');

      // Update HQ stock by the delta (new dispatched - previously dispatched)
      const delta = dto.dispatchedQty - line.dispatchedQty;
      if (delta !== 0) {
        await tx.tonerType.update({
          where: { id: line.tonerTypeId },
          data: { hqStock: { decrement: delta } },
        });
      }
      const updated = await tx.tonerOrderLine.update({
        where: { id: lineId },
        data: {
          dispatchedQty: dto.dispatchedQty,
          courier: dto.courier,
          trackingNo: dto.trackingNo,
          boxNumbers: dto.boxNumbers,
          dispatchedAt: dto.dispatchedQty > 0 ? new Date() : null,
        },
      });

      // If all lines dispatched in the parent order, flip status
      await this.maybeAdvanceStatus(tx, line.orderId);
      return updated;
    });
  }

  /** Bulk dispatch all lines for a store in a given order. */
  async dispatchStore(orderId: string, storeId: string, dto: DispatchLineDto) {
    const lines = await this.prisma.tonerOrderLine.findMany({ where: { orderId, storeId } });
    for (const line of lines) {
      await this.dispatchLine(line.id, {
        dispatchedQty: line.plannedQty,
        courier: dto.courier,
        trackingNo: dto.trackingNo,
        boxNumbers: dto.boxNumbers,
      });
    }
    return this.byId(orderId);
  }

  async receiveLine(lineId: string, dto: ReceiveLineDto) {
    return this.prisma.tonerOrderLine.update({
      where: { id: lineId },
      data: {
        receivedQty: dto.receivedQty,
        signedBy: dto.signedBy,
        receivedAt: dto.receivedQty > 0 ? new Date() : null,
      },
    });
  }

  async close(orderId: string) {
    return this.prisma.tonerOrder.update({
      where: { id: orderId },
      data: { status: TonerOrderStatus.Closed, closedAt: new Date() },
    });
  }

  async cancel(orderId: string) {
    return this.prisma.tonerOrder.update({
      where: { id: orderId },
      data: { status: TonerOrderStatus.Cancelled },
    });
  }

  private async maybeAdvanceStatus(tx: any, orderId: string) {
    const lines = await tx.tonerOrderLine.findMany({ where: { orderId } });
    const allDispatched = lines.length > 0 && lines.every((l: any) => l.dispatchedQty >= l.plannedQty);
    const allReceived   = lines.length > 0 && lines.every((l: any) => l.receivedQty >= l.plannedQty);
    let nextStatus: string | null = null;
    if (allReceived) nextStatus = TonerOrderStatus.Received;
    else if (allDispatched) nextStatus = TonerOrderStatus.Dispatched;
    if (nextStatus) await tx.tonerOrder.update({ where: { id: orderId }, data: { status: nextStatus } });
  }
}
