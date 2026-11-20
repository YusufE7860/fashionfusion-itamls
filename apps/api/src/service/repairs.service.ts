import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AssetStatus, RepairStatus } from '../shared';

export class CreateRepairDto {
  @IsString() assetId!: string;
  @IsString() faultDesc!: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsBoolean() warrantyClaim?: boolean;
}

export class TransitionRepairDto {
  @IsString() target!: string; // SENT, AT_SUPPLIER, RETURNED, REPLACED, WRITTEN_OFF
  @IsOptional() @IsInt() @Min(0) costCents?: number;
  @IsOptional() @IsString() outcome?: string;
}

/** Sent by a tech on a helpdesk ticket after they've triaged it and decided
 *  the item needs physical repair. All fields optional except the fault
 *  (we carry over the ticket description if blank) and the item description. */
export class ConvertTicketToRepairDto {
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsString() itemDescription?: string;
  @IsOptional() @IsString() faultDesc?: string;
  @IsOptional() @IsString() technicianName?: string;
  @IsOptional() @IsString() waybillNumber?: string;
  @IsOptional() @IsString() dispatchedDate?: string;   // ISO date
}

@Injectable()
export class RepairsService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.repair.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        asset: { include: { sku: true, location: true } },
        supplier: true,
      },
      take: 100,
    });
  }

  byAsset(assetId: string) {
    return this.prisma.repair.findMany({
      where: { assetId },
      orderBy: { createdAt: 'desc' },
      include: { supplier: true },
    });
  }

  private async nextCode() {
    const c = await this.prisma.repair.count();
    return `REP-${new Date().getFullYear()}-${String(c + 1).padStart(5, '0')}`;
  }

  /** Technician converts a helpdesk ticket into a repair.
   *  - Pulls store + asset + fault from the ticket if not overridden.
   *  - Creates the Repair with status LOGGED (or COLLECTED if a dispatch date was given).
   *  - Posts a visible ticket comment linking the two so the store can see progress.
   *  - Flips the ticket to WAITING_ON_USER so it doesn't inflate SLA while the item
   *    is away being repaired.
   */
  async convertTicketToRepair(ticketId: string, dto: ConvertTicketToRepairDto, actorId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true, code: true, subject: true, description: true,
        storeId: true, assetId: true, status: true,
      },
    });
    if (!ticket) throw new NotFoundException('ticket not found');

    const faultDesc = (dto.faultDesc?.trim() || ticket.description || ticket.subject || '').slice(0, 2000);
    if (!faultDesc) throw new BadRequestException('cannot create repair with no fault description');

    const assetId = dto.assetId ?? ticket.assetId ?? null;
    if (!assetId && !dto.itemDescription?.trim()) {
      throw new BadRequestException('either assetId or itemDescription is required');
    }

    const code = await this.nextCode();
    const dispatched = dto.dispatchedDate ? new Date(dto.dispatchedDate) : null;
    const initialStatus = dispatched ? 'COLLECTED' : 'LOGGED';

    return this.prisma.$transaction(async (tx) => {
      const repair = await tx.repair.create({
        data: {
          code,
          ticketId: ticket.id,
          storeId: ticket.storeId,
          reportedById: actorId,
          assetId,
          itemDescription: dto.itemDescription?.trim().slice(0, 300) ?? null,
          faultDesc,
          technicianName: dto.technicianName?.trim().slice(0, 120) ?? null,
          waybillNumber: dto.waybillNumber?.trim().slice(0, 80) ?? null,
          dispatchedDate: dispatched,
          status: initialStatus,
        },
      });
      // Breadcrumb on the asset if we have one.
      if (assetId) {
        await tx.assetHistory.create({
          data: {
            assetId,
            eventType: 'REPAIR_IN',
            refTable: 'repair',
            refId: repair.id,
            actorId,
            notes: `Converted from ticket ${ticket.code}`,
          },
        });
      }
      // Visible comment on the ticket so the store can see what's happening.
      const waybillLine = repair.waybillNumber ? `\nWaybill: ${repair.waybillNumber}` : '';
      const techLine    = repair.technicianName ? `\nCollected by: ${repair.technicianName}` : '';
      const dateLine    = repair.dispatchedDate ? `\nDispatched: ${repair.dispatchedDate.toISOString().slice(0,10)}` : '';
      await tx.ticketComment.create({
        data: {
          ticketId: ticket.id,
          authorId: actorId,
          body: `This item has been sent for repair.\nRepair ref: ${repair.code}${techLine}${waybillLine}${dateLine}\n\nWe'll update you when it's back.`,
          isInternal: false,
        },
      });
      // Move the ticket to WAITING_ON_USER so SLA pauses while the item is away.
      if (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED') {
        await tx.ticket.update({
          where: { id: ticket.id },
          data: { status: 'WAITING_ON_USER', waitingOnUserSinceAt: new Date() },
        });
      }
      return repair;
    });
  }

  async create(dto: CreateRepairDto, actorId: string) {
    const code = await this.nextCode();
    return this.prisma.$transaction(async (tx) => {
      const repair = await tx.repair.create({
        data: {
          code,
          assetId: dto.assetId,
          faultDesc: dto.faultDesc,
          supplierId: dto.supplierId,
          warrantyClaim: dto.warrantyClaim ?? false,
          status: RepairStatus.Logged,
        },
      });
      await tx.assetHistory.create({
        data: {
          assetId: dto.assetId,
          eventType: 'REPAIR_IN',
          refTable: 'repair',
          refId: repair.id,
          actorId,
          notes: dto.faultDesc,
        },
      });
      return repair;
    });
  }

  async transition(id: string, dto: TransitionRepairDto, actorId: string) {
    const r = await this.prisma.repair.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    const allowed: Record<string, string[]> = {
      [RepairStatus.Logged]:     [RepairStatus.Sent, RepairStatus.WrittenOff],
      [RepairStatus.Sent]:       [RepairStatus.AtSupplier],
      [RepairStatus.AtSupplier]: [RepairStatus.Returned, RepairStatus.Replaced, RepairStatus.WrittenOff],
    };
    const next = allowed[r.status] ?? [];
    if (!next.includes(dto.target)) {
      throw new BadRequestException(`Cannot transition ${r.status} → ${dto.target}`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updates: any = { status: dto.target };
      if (dto.target === RepairStatus.Sent) updates.sentAt = new Date();
      if (dto.target === RepairStatus.Returned || dto.target === RepairStatus.Replaced) {
        updates.receivedAt = new Date();
      }
      if (dto.costCents !== undefined) updates.costCents = dto.costCents;
      if (dto.outcome) updates.outcome = dto.outcome;

      const updated = await tx.repair.update({ where: { id }, data: updates });

      // Reflect on the asset. Portal-logged repairs may have no asset link
      // (store user described the item in free text), in which case we skip
      // the asset-status / history writes.
      if (r.assetId) {
        if (dto.target === RepairStatus.Sent) {
          await tx.asset.update({ where: { id: r.assetId }, data: { status: AssetStatus.Repair } });
        } else if (dto.target === RepairStatus.Returned) {
          await tx.asset.update({ where: { id: r.assetId }, data: { status: AssetStatus.InStock } });
          await tx.assetHistory.create({
            data: { assetId: r.assetId, eventType: 'REPAIR_OUT', refTable: 'repair', refId: r.id, actorId },
          });
        } else if (dto.target === RepairStatus.WrittenOff) {
          await tx.asset.update({ where: { id: r.assetId }, data: { status: AssetStatus.WrittenOff } });
          await tx.assetHistory.create({
            data: { assetId: r.assetId, eventType: 'RETIRED', refTable: 'repair', refId: r.id, actorId, notes: 'Written off via repair' },
          });
        }
      }
      return updated;
    });
  }
}
