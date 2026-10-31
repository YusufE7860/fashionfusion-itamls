import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/**
 * Business-hours engine for SLA calculation.
 *
 *   addBusinessMs(from, minutes)
 *     → DateTime that is `minutes` minutes of business time after `from`.
 *       Only counts time inside configured open hours; skips weekends,
 *       holidays, and after-hours windows automatically.
 *
 *   isBusinessOpen(at)
 *     → true if the given instant falls inside business hours (not a
 *       holiday, not a closed day, within open/close window).
 *
 *   deductWindowMs({ start, end })
 *     → how much of [start, end) was INSIDE business hours. Used to
 *       calculate SLA burn-down and after-the-fact "effective elapsed".
 *
 * All times operate in the configured timezone (default
 * Africa/Johannesburg). Internally we work with Date objects but
 * interpret day-of-week and time-of-day in that TZ.
 */
@Injectable()
export class BusinessHoursService {
  constructor(private prisma: PrismaService) {}

  private cfgCache: any = null;
  private cfgCachedAt = 0;
  private holidaysCache: Date[] = [];
  private holidaysCachedAt = 0;

  async getConfig() {
    // 30s cache — business hours barely change but SLA calc happens
    // on every ticket view.
    if (this.cfgCache && Date.now() - this.cfgCachedAt < 30_000) return this.cfgCache;
    const row = await this.prisma.businessHours.upsert({
      where: { id: 1 }, update: {}, create: { id: 1 },
    });
    this.cfgCache = row;
    this.cfgCachedAt = Date.now();
    return row;
  }

  async getHolidays(): Promise<Date[]> {
    if (this.holidaysCache.length && Date.now() - this.holidaysCachedAt < 60_000) {
      return this.holidaysCache;
    }
    const rows = await this.prisma.holiday.findMany({ select: { date: true, recurring: true } });
    // Normalise to UTC midnight for comparison
    this.holidaysCache = rows.map((r) => this.midnightUtc(r.date));
    this.holidaysCachedAt = Date.now();
    return this.holidaysCache;
  }

  invalidateCaches() {
    this.cfgCache = null;
    this.holidaysCache = [];
  }

  // ========================================================================
  //  Public: add N minutes of business time to a date
  // ========================================================================
  async addBusinessMs(from: Date, minutesToAdd: number): Promise<Date> {
    if (minutesToAdd <= 0) return from;
    const cfg = await this.getConfig();
    const holidays = await this.getHolidays();
    let remaining = minutesToAdd * 60_000;
    let cursor = new Date(from);
    // Hard safety cap — 365 days of business time is pathological for SLA.
    const MAX_ITERS = 365 * 2;
    for (let i = 0; i < MAX_ITERS && remaining > 0; i++) {
      const dayWindow = this.getDayWindow(cursor, cfg, holidays);
      if (!dayWindow) {
        // Closed day — jump to next day's open time
        cursor = this.nextDayStart(cursor, cfg, holidays);
        continue;
      }
      const [dayStart, dayEnd] = dayWindow;
      if (cursor < dayStart) cursor = dayStart;
      if (cursor >= dayEnd) {
        cursor = this.nextDayStart(cursor, cfg, holidays);
        continue;
      }
      const roomMs = dayEnd.getTime() - cursor.getTime();
      if (roomMs >= remaining) {
        return new Date(cursor.getTime() + remaining);
      }
      remaining -= roomMs;
      cursor = this.nextDayStart(cursor, cfg, holidays);
    }
    return cursor;
  }

  // ========================================================================
  //  Public: how much of a window was inside business hours
  // ========================================================================
  async businessMsBetween(start: Date, end: Date): Promise<number> {
    if (end <= start) return 0;
    const cfg = await this.getConfig();
    const holidays = await this.getHolidays();
    let total = 0;
    let cursor = new Date(start);
    const MAX_ITERS = 365 * 2;
    for (let i = 0; i < MAX_ITERS && cursor < end; i++) {
      const dayWindow = this.getDayWindow(cursor, cfg, holidays);
      if (!dayWindow) {
        cursor = this.nextDayStart(cursor, cfg, holidays);
        continue;
      }
      const [dayStart, dayEnd] = dayWindow;
      const chunkStart = cursor > dayStart ? cursor : dayStart;
      const chunkEnd   = end < dayEnd ? end : dayEnd;
      if (chunkEnd > chunkStart) total += chunkEnd.getTime() - chunkStart.getTime();
      cursor = this.nextDayStart(cursor, cfg, holidays);
    }
    return total;
  }

  async isOpen(at: Date = new Date()): Promise<boolean> {
    const cfg = await this.getConfig();
    const holidays = await this.getHolidays();
    const dayWindow = this.getDayWindow(at, cfg, holidays);
    if (!dayWindow) return false;
    const [dayStart, dayEnd] = dayWindow;
    return at >= dayStart && at < dayEnd;
  }

  // ========================================================================
  //  Internals
  // ========================================================================
  private midnightUtc(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  private isHoliday(d: Date, holidays: Date[]): boolean {
    const mid = this.midnightUtc(d).getTime();
    return holidays.some((h) => this.midnightUtc(h).getTime() === mid);
  }

  /**
   * Return the business window [open, close) for the local day containing
   * `at`, or null if the day is closed (weekend without config, or holiday).
   */
  private getDayWindow(at: Date, cfg: any, holidays: Date[]): [Date, Date] | null {
    if (this.isHoliday(at, holidays)) return null;
    const dayKey = this.dayKeyFor(at);
    const openStr  = cfg[`${dayKey}Open`]  as string | null;
    const closeStr = cfg[`${dayKey}Close`] as string | null;
    if (!openStr || !closeStr) return null;
    const [oH, oM] = openStr.split(':').map(Number);
    const [cH, cM] = closeStr.split(':').map(Number);
    const open  = this.setLocalTime(at, oH, oM);
    const close = this.setLocalTime(at, cH, cM);
    if (close <= open) return null;
    return [open, close];
  }

  private dayKeyFor(d: Date): DayKey {
    // 0 = Sunday in JS
    const idx = d.getDay();
    return (['sun','mon','tue','wed','thu','fri','sat'] as DayKey[])[idx];
  }

  private setLocalTime(d: Date, h: number, m: number): Date {
    const o = new Date(d);
    o.setHours(h, m, 0, 0);
    return o;
  }

  private nextDayStart(from: Date, cfg: any, holidays: Date[]): Date {
    // Jump to 00:00 of the next calendar day, then advance until we find
    // a day that is actually open. Walk one day at a time.
    for (let i = 1; i < 30; i++) {
      const day = new Date(from);
      day.setDate(day.getDate() + i);
      day.setHours(0, 0, 0, 0);
      const w = this.getDayWindow(day, cfg, holidays);
      if (w) return w[0];
    }
    // Nothing open in the next month — give up and return far-future.
    return new Date(from.getTime() + 365 * 24 * 3600_000);
  }

  // ========================================================================
  //  Admin ops (CRUD for config + holidays)
  // ========================================================================
  async updateConfig(dto: any) {
    const allowed = [
      'monOpen','monClose','tueOpen','tueClose','wedOpen','wedClose','thuOpen','thuClose',
      'friOpen','friClose','satOpen','satClose','sunOpen','sunClose','timezone',
    ];
    const data: any = {};
    for (const k of allowed) if (k in dto) data[k] = dto[k] === '' ? null : dto[k];
    const row = await this.prisma.businessHours.upsert({
      where: { id: 1 }, update: data, create: { id: 1, ...data },
    });
    this.invalidateCaches();
    return row;
  }

  listHolidays() {
    return this.prisma.holiday.findMany({ orderBy: { date: 'asc' } });
  }

  async addHoliday(dto: { date: string; name: string; recurring?: boolean }) {
    if (!dto.date || !dto.name) throw new BadRequestException('date + name required');
    const parsed = new Date(dto.date);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('bad date');
    const row = await this.prisma.holiday.create({
      data: { date: this.midnightUtc(parsed), name: dto.name.trim(), recurring: !!dto.recurring },
    });
    this.invalidateCaches();
    return row;
  }

  async removeHoliday(id: string) {
    await this.prisma.holiday.delete({ where: { id } });
    this.invalidateCaches();
    return { ok: true };
  }
}
