import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Verifone PIN pad inventory.
 *
 * Ingestion path: the PC agent's daily inventory push includes a `pinPads`
 * array. Each entry is upserted here — if the serial is new we create a row
 * and log DETECTED; if the pad has moved to a different PC/store we log
 * MOVED_PC / MOVED_STORE. lastDetectedAt is bumped every push.
 *
 * A cron (in the alerts / retention module) marks any pad with
 * lastDetectedAt < now - 7d as MISSING. Once marked RETURNED (by an
 * operator, with a Nedbank return reference), the pad is frozen and
 * subsequent agent detections re-open it as UNKNOWN for review.
 */

const MISSING_AFTER_DAYS = 7;

export interface AgentPinPadDto {
  serialNo: string;
  model?: string;
  manufacturer?: string;
  productId?: string;
  usbDeviceId?: string;
}

export interface PinPadFilter {
  storeId?: string;
  status?: string;
  q?: string;
}

@Injectable()
export class PinPadsService {
  constructor(private prisma: PrismaService) {}

  // ---------- Query ----------
  list(filter: PinPadFilter = {}) {
    const where: any = {};
    if (filter.storeId) where.currentStoreId = filter.storeId;
    if (filter.status)  where.status = filter.status;
    if (filter.q) {
      where.OR = [
        { serialNo: { contains: filter.q, mode: 'insensitive' } },
        { currentStoreCode: { contains: filter.q, mode: 'insensitive' } },
        { currentPcName: { contains: filter.q, mode: 'insensitive' } },
        { model: { contains: filter.q, mode: 'insensitive' } },
        { notes: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.pinPad.findMany({
      where,
      orderBy: [{ status: 'asc' }, { currentStoreCode: 'asc' }, { currentPcName: 'asc' }],
      take: 5000,
    });
  }

  async get(id: string) {
    const p = await this.prisma.pinPad.findUnique({
      where: { id },
      include: { events: { orderBy: { occurredAt: 'desc' }, take: 100 } },
    });
    if (!p) throw new NotFoundException();
    return p;
  }

  summary() {
    return this.prisma.pinPad.groupBy({
      by: ['status'], _count: { _all: true },
    }).then((rows) => rows.reduce((acc, r) => {
      acc[r.status] = r._count._all; return acc;
    }, {} as Record<string, number>));
  }

  // ---------- CSV export (the point of the whole feature) ----------
  async exportCsv(filter: PinPadFilter = {}) {
    const rows = await this.list(filter);
    const header = [
      'Serial', 'Model', 'Manufacturer',
      'Store Code', 'Store Name', 'PC', 'Status',
      'First Detected', 'Last Detected',
      'Received From Nedbank', 'Nedbank Received Ref',
      'Returned To Nedbank', 'Nedbank Return Ref',
      'Notes',
    ];
    // We need the store name in the row — pull those in a batch
    const storeIds = [...new Set(rows.map((r) => r.currentStoreId).filter(Boolean) as string[])];
    const stores = storeIds.length
      ? await this.prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } })
      : [];
    const storeNameById = new Map(stores.map((s) => [s.id, s.name]));

    const esc = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const iso = (d: Date | null | undefined) => d ? new Date(d).toISOString().slice(0, 10) : '';

    const csvRows = [header.join(',')];
    for (const p of rows) {
      csvRows.push([
        p.serialNo, p.model ?? '', p.manufacturer,
        p.currentStoreCode ?? '',
        p.currentStoreId ? (storeNameById.get(p.currentStoreId) ?? '') : '',
        p.currentPcName ?? '',
        p.status,
        iso(p.firstDetectedAt),
        iso(p.lastDetectedAt),
        iso(p.receivedFromNedbankAt), p.receivedRef ?? '',
        iso(p.returnedToNedbankAt),   p.returnRef ?? '',
        p.notes ?? '',
      ].map(esc).join(','));
    }
    return csvRows.join('\n');
  }

  // ---------- Mutations ----------
  async confirm(id: string, actorUserId?: string) {
    const p = await this.prisma.pinPad.findUnique({ where: { id } });
    if (!p) throw new NotFoundException();
    if (p.status === 'RETURNED') throw new BadRequestException('This pad has been returned to Nedbank; cannot re-assign without a fresh detection.');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.pinPad.update({
        where: { id }, data: { status: 'ASSIGNED' },
      });
      await tx.pinPadEvent.create({
        data: {
          pinPadId: id, eventType: 'ASSIGNED',
          toPcId: p.currentPcId, toStoreId: p.currentStoreId,
          toPcName: p.currentPcName, toStoreCode: p.currentStoreCode,
          actorUserId,
        },
      });
      return updated;
    });
  }

  async markReturned(id: string, dto: { returnRef?: string; notes?: string; returnedAt?: string }, actorUserId?: string) {
    const p = await this.prisma.pinPad.findUnique({ where: { id } });
    if (!p) throw new NotFoundException();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.pinPad.update({
        where: { id },
        data: {
          status: 'RETURNED',
          returnedToNedbankAt: dto.returnedAt ? new Date(dto.returnedAt) : new Date(),
          returnRef: dto.returnRef ?? p.returnRef,
          notes: dto.notes ?? p.notes,
        },
      });
      await tx.pinPadEvent.create({
        data: {
          pinPadId: id, eventType: 'RETURNED',
          fromPcId: p.currentPcId, fromStoreId: p.currentStoreId,
          fromPcName: p.currentPcName, fromStoreCode: p.currentStoreCode,
          actorUserId, notes: dto.returnRef,
        },
      });
      return updated;
    });
  }

  async setReceived(id: string, dto: { receivedRef?: string; receivedAt?: string }, actorUserId?: string) {
    const p = await this.prisma.pinPad.findUnique({ where: { id } });
    if (!p) throw new NotFoundException();
    return this.prisma.pinPad.update({
      where: { id },
      data: {
        receivedFromNedbankAt: dto.receivedAt ? new Date(dto.receivedAt) : (p.receivedFromNedbankAt ?? new Date()),
        receivedRef: dto.receivedRef ?? p.receivedRef,
      },
    });
  }

  async updateNotes(id: string, notes: string) {
    return this.prisma.pinPad.update({ where: { id }, data: { notes } });
  }

  async manualCreate(dto: {
    serialNo: string; model?: string; storeId?: string; notes?: string;
    receivedRef?: string; receivedAt?: string;
  }, actorUserId?: string) {
    if (!dto.serialNo?.trim()) throw new BadRequestException('serialNo required');
    const existing = await this.prisma.pinPad.findUnique({ where: { serialNo: dto.serialNo } });
    if (existing) throw new BadRequestException('That serial is already in the system');
    let storeCode: string | null = null;
    if (dto.storeId) {
      const s = await this.prisma.store.findUnique({ where: { id: dto.storeId } });
      if (s) storeCode = s.code;
    }
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.pinPad.create({
        data: {
          serialNo: dto.serialNo, model: dto.model, notes: dto.notes,
          status: dto.storeId ? 'ASSIGNED' : 'UNKNOWN',
          currentStoreId: dto.storeId, currentStoreCode: storeCode,
          receivedFromNedbankAt: dto.receivedAt ? new Date(dto.receivedAt) : null,
          receivedRef: dto.receivedRef,
        },
      });
      await tx.pinPadEvent.create({
        data: { pinPadId: p.id, eventType: 'DETECTED', toStoreId: dto.storeId, toStoreCode: storeCode, actorUserId, notes: 'Manual entry' },
      });
      return p;
    });
  }

  // ---------- Agent ingest (called from AgentsService) ----------
  async ingestFromAgent(pcId: string, storeId: string, storeCode: string, pcName: string, pads: AgentPinPadDto[]) {
    if (!pads?.length) return { ingested: 0 };
    let ingested = 0;
    for (const dto of pads) {
      if (!dto.serialNo?.trim()) continue;
      const existing = await this.prisma.pinPad.findUnique({ where: { serialNo: dto.serialNo.trim() } });
      const now = new Date();
      if (!existing) {
        // First detection
        await this.prisma.$transaction([
          this.prisma.pinPad.create({
            data: {
              serialNo: dto.serialNo.trim(),
              model: dto.model, manufacturer: dto.manufacturer ?? 'Verifone',
              productId: dto.productId, usbDeviceId: dto.usbDeviceId,
              currentPcId: pcId, currentStoreId: storeId,
              currentPcName: pcName, currentStoreCode: storeCode,
              status: 'DETECTED',
              lastDetectedAt: now, firstDetectedAt: now,
            },
          }),
        ]);
        const p = await this.prisma.pinPad.findUnique({ where: { serialNo: dto.serialNo.trim() } });
        if (p) {
          await this.prisma.pinPadEvent.create({
            data: {
              pinPadId: p.id, eventType: 'DETECTED',
              toPcId: pcId, toStoreId: storeId,
              toPcName: pcName, toStoreCode: storeCode,
            },
          });
        }
        ingested++;
        continue;
      }

      // Existing — check for movement
      const movedPc    = existing.currentPcId != null && existing.currentPcId !== pcId;
      const movedStore = existing.currentStoreId != null && existing.currentStoreId !== storeId;
      const reappeared = existing.status === 'MISSING' || existing.status === 'RETURNED';

      const nextStatus = reappeared ? 'UNKNOWN'  // needs admin review — was returned/missing then reappeared
                       : (existing.status === 'DETECTED' || existing.status === 'ASSIGNED') ? existing.status
                       : 'DETECTED';

      await this.prisma.pinPad.update({
        where: { id: existing.id },
        data: {
          lastDetectedAt: now,
          currentPcId: pcId, currentStoreId: storeId,
          currentPcName: pcName, currentStoreCode: storeCode,
          model: dto.model ?? existing.model,
          productId: dto.productId ?? existing.productId,
          usbDeviceId: dto.usbDeviceId ?? existing.usbDeviceId,
          status: nextStatus,
          markedMissingAt: null,   // clear if it was missing
        },
      });

      if (movedPc || movedStore) {
        await this.prisma.pinPadEvent.create({
          data: {
            pinPadId: existing.id,
            eventType: movedStore ? 'MOVED_STORE' : 'MOVED_PC',
            fromPcId: existing.currentPcId, fromStoreId: existing.currentStoreId,
            fromPcName: existing.currentPcName, fromStoreCode: existing.currentStoreCode,
            toPcId: pcId, toStoreId: storeId,
            toPcName: pcName, toStoreCode: storeCode,
          },
        });
      }
      ingested++;
    }
    return { ingested };
  }

  // ---------- Cron: mark stale as MISSING ----------
  async markStaleMissing() {
    const cutoff = new Date(Date.now() - MISSING_AFTER_DAYS * 24 * 3600 * 1000);
    const stale = await this.prisma.pinPad.findMany({
      where: {
        lastDetectedAt: { lt: cutoff },
        status: { in: ['DETECTED', 'ASSIGNED'] },
      },
      select: { id: true, currentPcId: true, currentStoreId: true, currentPcName: true, currentStoreCode: true },
    });
    if (!stale.length) return { markedMissing: 0 };
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.pinPad.updateMany({
        where: { id: { in: stale.map((s) => s.id) } },
        data: { status: 'MISSING', markedMissingAt: now },
      }),
      this.prisma.pinPadEvent.createMany({
        data: stale.map((s) => ({
          pinPadId: s.id, eventType: 'MARKED_MISSING', occurredAt: now,
          fromPcId: s.currentPcId, fromStoreId: s.currentStoreId,
          fromPcName: s.currentPcName, fromStoreCode: s.currentStoreCode,
          notes: `Auto-marked after ${MISSING_AFTER_DAYS} days without check-in`,
        })),
      }),
    ]);
    return { markedMissing: stale.length };
  }
}
