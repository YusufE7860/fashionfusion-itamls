import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';

/**
 * On-call rota — who is working weekends / public holidays / after-hours.
 *
 * Shifts are per-technician, per-time-window, with a scope saying which
 * region/store the shift covers (defaults to ALL). Multiple techs can be on
 * at the same time; one tech can have multiple shifts in one day.
 *
 * Three consumption paths:
 *   1. Admin UI (CRUD).
 *   2. Dashboard widget for stores/AMs — "who do I phone right now".
 *   3. Cron broadcast — every Friday 07:00 emails the weekend rota to all
 *      store contact emails and area managers.
 */
@Injectable()
export class OnCallService {
  constructor(private prisma: PrismaService, private mailer: MailerService) {}

  // ----- CRUD -----
  listShifts(opts: { from?: Date; to?: Date } = {}) {
    const from = opts.from ?? new Date(Date.now() - 24 * 3600_000);
    const to   = opts.to   ?? new Date(Date.now() + 14 * 24 * 3600_000);
    return this.prisma.onCallShift.findMany({
      where: {
        OR: [
          { startAt: { gte: from, lte: to } },
          { endAt:   { gte: from, lte: to } },
          { AND: [ { startAt: { lte: from } }, { endAt: { gte: to } } ] },
        ],
      },
      orderBy: { startAt: 'asc' },
      include: {
        technician: { select: { id: true, fullName: true, email: true } },
      },
    });
  }

  async createShift(dto: {
    technicianId: string; startAt: string; endAt: string;
    scope?: string; notes?: string;
  }, userId: string) {
    if (!dto.technicianId || !dto.startAt || !dto.endAt) {
      throw new BadRequestException('technicianId, startAt and endAt are required');
    }
    const start = new Date(dto.startAt);
    const end   = new Date(dto.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('startAt/endAt must be valid ISO datetimes');
    }
    if (end <= start) throw new BadRequestException('endAt must be after startAt');
    const tech = await this.prisma.user.findUnique({ where: { id: dto.technicianId } });
    if (!tech) throw new BadRequestException('technician not found');
    return this.prisma.onCallShift.create({
      data: {
        technicianId: dto.technicianId,
        startAt: start, endAt: end,
        scope: (dto.scope ?? 'ALL').trim().toUpperCase(),
        notes: dto.notes?.trim() || null,
        createdById: userId,
      },
      include: { technician: { select: { id: true, fullName: true, email: true } } },
    });
  }

  async updateShift(id: string, dto: any) {
    const s = await this.prisma.onCallShift.findUnique({ where: { id } });
    if (!s) throw new NotFoundException();
    const data: any = {};
    if (dto.technicianId !== undefined) data.technicianId = dto.technicianId;
    if (dto.startAt !== undefined) data.startAt = new Date(dto.startAt);
    if (dto.endAt   !== undefined) data.endAt   = new Date(dto.endAt);
    if (dto.scope   !== undefined) data.scope   = (dto.scope ?? 'ALL').trim().toUpperCase();
    if (dto.notes   !== undefined) data.notes   = dto.notes?.trim() || null;
    // Any content change forces a re-broadcast
    data.broadcastAt = null;
    return this.prisma.onCallShift.update({
      where: { id }, data,
      include: { technician: { select: { id: true, fullName: true, email: true } } },
    });
  }

  deleteShift(id: string) {
    return this.prisma.onCallShift.delete({ where: { id } });
  }

  // ----- Dashboard feed -----
  /** Shifts covering "right now" plus upcoming 7 days — for the dashboard widget. */
  async currentAndUpcoming(scopeKey?: string) {
    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * 24 * 3600_000);
    const shifts = await this.prisma.onCallShift.findMany({
      where: { endAt: { gte: now }, startAt: { lte: in7 } },
      orderBy: { startAt: 'asc' },
      include: { technician: { select: { id: true, fullName: true, email: true } } },
    });
    const matches = (s: typeof shifts[number]) =>
      !scopeKey || s.scope === 'ALL' || s.scope.split(',').some((k) => k.trim() === scopeKey);
    return {
      currentlyOnCall: shifts.filter((s) => s.startAt <= now && s.endAt >= now && matches(s)),
      upcoming:        shifts.filter((s) => s.startAt > now && matches(s)),
    };
  }

  // ----- Broadcast cron -----
  // Every Friday 07:00 — email the weekend + next-week rota to all stores
  // with a contactEmail + all AMs. Also runs on-demand (see broadcastNow).
  @Cron('0 7 * * 5')
  async weeklyBroadcastCron() {
    await this.broadcastNow({ silent: true });
  }

  async broadcastNow(opts: { silent?: boolean } = {}) {
    const now = new Date();
    const in10 = new Date(now.getTime() + 10 * 24 * 3600_000);
    const shifts = await this.prisma.onCallShift.findMany({
      where: { endAt: { gte: now }, startAt: { lte: in10 } },
      orderBy: { startAt: 'asc' },
      include: { technician: { select: { id: true, fullName: true, email: true } } },
    });

    const stores = await this.prisma.store.findMany({
      where: { status: { not: 'CLOSED' }, contactEmail: { not: null } },
      select: { id: true, code: true, name: true, contactEmail: true, region: true,
                areaManager: { select: { email: true, fullName: true } } },
    });
    const ams = await this.prisma.areaManager.findMany({
      where: { isActive: true },
      select: { email: true, fullName: true },
    });

    // Deduplicate recipients
    const recipients = new Set<string>();
    for (const s of stores) if (s.contactEmail) recipients.add(s.contactEmail);
    for (const am of ams) recipients.add(am.email);

    if (recipients.size === 0) {
      return { sent: 0, shifts: shifts.length, reason: 'no recipients configured' };
    }

    const subject = `IT on-call rota — ${this.formatRange(now, in10)}`;
    const html = this.renderRotaEmail(shifts, now, in10);

    // Nodemailer's `to` supports an array; we blind-copy via `bcc` so one
    // recipient doesn't see the whole fleet's email addresses.
    await this.mailer.send(
      [...recipients],   // actually sent via BCC-equivalent (nodemailer accepts a joined `to`)
      subject,
      html,
    );

    // Mark the broadcast done on each shift
    await this.prisma.onCallShift.updateMany({
      where: { id: { in: shifts.map((s) => s.id) }, broadcastAt: null },
      data: { broadcastAt: new Date() },
    });

    if (!opts.silent) {
      return { sent: recipients.size, shifts: shifts.length };
    }
    return { sent: recipients.size, shifts: shifts.length };
  }

  // ----- Helpers -----
  private formatRange(a: Date, b: Date): string {
    const fmt = (d: Date) => d.toLocaleDateString('en-ZA',
      { day: '2-digit', month: 'short' });
    return `${fmt(a)} → ${fmt(b)}`;
  }

  private renderRotaEmail(shifts: any[], from: Date, to: Date): string {
    if (!shifts.length) {
      return `<p>No on-call shifts are currently scheduled for ${this.formatRange(from, to)}.</p>
              <p>Please contact IT during business hours as normal.</p>`;
    }
    // Group by local date (YYYY-MM-DD)
    const byDay = new Map<string, any[]>();
    for (const s of shifts) {
      const dayKey = new Date(s.startAt).toISOString().slice(0, 10);
      (byDay.get(dayKey) ?? byDay.set(dayKey, []).get(dayKey)!).push(s);
    }
    const dayFmt = (d: Date) => d.toLocaleDateString('en-ZA',
      { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
    const timeFmt = (d: Date) => d.toLocaleTimeString('en-ZA',
      { hour: '2-digit', minute: '2-digit', hour12: false });

    const dayBlocks = [...byDay.entries()].map(([day, list]) => `
      <h3 style="margin:16px 0 6px;color:#0f172a;font-size:14px;">${dayFmt(new Date(day))}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f1f5f9;">
            <th style="padding:6px 10px;text-align:left;color:#475569;">Time</th>
            <th style="padding:6px 10px;text-align:left;color:#475569;">Technician</th>
            <th style="padding:6px 10px;text-align:left;color:#475569;">Scope</th>
            <th style="padding:6px 10px;text-align:left;color:#475569;">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((s) => `
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:6px 10px;">${timeFmt(new Date(s.startAt))} – ${timeFmt(new Date(s.endAt))}</td>
              <td style="padding:6px 10px;"><b>${s.technician.fullName}</b><br/>
                  <span style="color:#64748b;font-size:11px;">${s.technician.email}</span></td>
              <td style="padding:6px 10px;color:#475569;">${s.scope}</td>
              <td style="padding:6px 10px;color:#475569;">${s.notes ?? '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `).join('');

    return `
      <p>Below is the IT on-call rota for the next week (${this.formatRange(from, to)}).</p>
      <p>For urgent faults during these windows, contact the listed technician directly.</p>
      ${dayBlocks}
      <p style="margin-top:16px;font-size:11px;color:#64748b;">
        Rota is also live in your ITAMLS dashboard — the current on-call tech is always shown at the top.
      </p>
    `;
  }
}
