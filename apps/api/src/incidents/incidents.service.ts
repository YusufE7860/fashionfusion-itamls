import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const INC_STATUSES  = ['INVESTIGATING','IDENTIFIED','MONITORING','RESOLVED'] as const;
export const INC_SEVERITIES = ['MAINTENANCE','MINOR','MAJOR','CRITICAL'] as const;

@Injectable()
export class IncidentsService {
  constructor(private prisma: PrismaService) {}

  // Public view — current state + last 20 updates. No auth required.
  async publicStatus() {
    const active = await this.prisma.incident.findMany({
      where: { status: { not: 'RESOLVED' } },
      orderBy: { severity: 'desc' },
      include: { updates: { orderBy: { postedAt: 'desc' }, take: 10 } },
    });
    const recentResolved = await this.prisma.incident.findMany({
      where: { status: 'RESOLVED', resolvedAt: { gte: new Date(Date.now() - 14 * 24 * 3600_000) } },
      orderBy: { resolvedAt: 'desc' },
      take: 10,
      include: { updates: { orderBy: { postedAt: 'desc' }, take: 3 } },
    });
    // Overall health = worst active severity. "all clear" when nothing's active.
    const sevRank = { MAINTENANCE: 1, MINOR: 2, MAJOR: 3, CRITICAL: 4 } as any;
    const worst = active.reduce((acc, i) => Math.max(acc, sevRank[i.severity] ?? 0), 0);
    const overall = active.length === 0 ? 'ALL_CLEAR'
      : worst >= 4 ? 'CRITICAL'
      : worst >= 3 ? 'MAJOR'
      : worst >= 2 ? 'MINOR'
      : 'MAINTENANCE';
    return { overall, active, recentResolved };
  }

  // ----- Admin -----
  list(includeResolved = false) {
    return this.prisma.incident.findMany({
      where: includeResolved ? {} : { status: { not: 'RESOLVED' } },
      orderBy: { startedAt: 'desc' },
      include: { updates: { orderBy: { postedAt: 'desc' }, take: 5 } },
    });
  }

  async get(id: string) {
    const i = await this.prisma.incident.findUnique({
      where: { id }, include: { updates: { orderBy: { postedAt: 'asc' } } },
    });
    if (!i) throw new NotFoundException();
    return i;
  }

  async create(dto: any, userId: string) {
    if (!dto.title?.trim()) throw new BadRequestException('title required');
    if (dto.status && !(INC_STATUSES as readonly string[]).includes(dto.status)) {
      throw new BadRequestException('invalid status');
    }
    if (dto.severity && !(INC_SEVERITIES as readonly string[]).includes(dto.severity)) {
      throw new BadRequestException('invalid severity');
    }
    const i = await this.prisma.incident.create({
      data: {
        title:    dto.title.trim(),
        summary:  dto.summary ?? '',
        status:   dto.status ?? 'INVESTIGATING',
        severity: dto.severity ?? 'MINOR',
        affectedServices: (dto.affectedServices ?? '').toUpperCase(),
        createdById: userId,
      },
    });
    await this.prisma.incidentUpdate.create({
      data: { incidentId: i.id, status: i.status, body: dto.summary ?? 'Investigating.', authorId: userId },
    });
    return i;
  }

  async addUpdate(incidentId: string, dto: { status: string; body: string }, userId: string) {
    if (!(INC_STATUSES as readonly string[]).includes(dto.status)) {
      throw new BadRequestException('invalid status');
    }
    const upd = await this.prisma.incidentUpdate.create({
      data: { incidentId, status: dto.status, body: dto.body ?? '', authorId: userId },
    });
    await this.prisma.incident.update({
      where: { id: incidentId },
      data: {
        status: dto.status,
        resolvedAt: dto.status === 'RESOLVED' ? new Date() : null,
      },
    });
    return upd;
  }

  async remove(id: string) {
    await this.prisma.incident.delete({ where: { id } });
    return { ok: true };
  }
}
