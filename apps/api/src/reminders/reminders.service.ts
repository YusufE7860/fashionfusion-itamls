import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ReminderDto {
  title: string;
  notes?: string;
  dueAt?: string | null;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  assignedToId?: string | null;   // null = broadcast
}

export interface UserCtx { userId: string; permissions: string[] }

@Injectable()
export class RemindersService {
  constructor(private prisma: PrismaService) {}

  /** Everything the logged-in user should see: broadcast + their own. */
  listMine(ctx: UserCtx, includeCompleted = false) {
    return this.prisma.reminder.findMany({
      where: {
        OR: [{ assignedToId: ctx.userId }, { assignedToId: null }],
        ...(includeCompleted ? {} : { completedAt: null }),
      },
      orderBy: [{ completedAt: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      include: {
        assignedTo:  { select: { id: true, fullName: true } },
        createdBy:   { select: { id: true, fullName: true } },
        completedBy: { select: { id: true, fullName: true } },
      },
    });
  }

  listAll(includeCompleted = false) {
    return this.prisma.reminder.findMany({
      where: includeCompleted ? {} : { completedAt: null },
      orderBy: [{ completedAt: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      include: {
        assignedTo:  { select: { id: true, fullName: true } },
        createdBy:   { select: { id: true, fullName: true } },
      },
    });
  }

  async create(dto: ReminderDto, ctx: UserCtx) {
    if (!dto.title?.trim()) throw new BadRequestException('title required');
    return this.prisma.reminder.create({
      data: {
        title: dto.title.trim(),
        notes: dto.notes ?? null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        priority: dto.priority ?? 'NORMAL',
        assignedToId: dto.assignedToId ?? null,
        createdById: ctx.userId,
      },
    });
  }

  async update(id: string, dto: ReminderDto, ctx: UserCtx) {
    const r = await this.prisma.reminder.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    // Only creator OR admin can edit
    const canEdit = r.createdById === ctx.userId || ctx.permissions.includes('users:manage');
    if (!canEdit) throw new BadRequestException('Not allowed to edit this reminder');
    return this.prisma.reminder.update({
      where: { id },
      data: {
        title: dto.title?.trim() ?? r.title,
        notes: dto.notes ?? r.notes,
        dueAt: dto.dueAt === undefined ? r.dueAt : (dto.dueAt ? new Date(dto.dueAt) : null),
        priority: dto.priority ?? r.priority,
        assignedToId: dto.assignedToId === undefined ? r.assignedToId : (dto.assignedToId || null),
      },
    });
  }

  async complete(id: string, ctx: UserCtx) {
    return this.prisma.reminder.update({
      where: { id },
      data: { completedAt: new Date(), completedById: ctx.userId },
    });
  }

  async uncomplete(id: string) {
    return this.prisma.reminder.update({ where: { id }, data: { completedAt: null, completedById: null } });
  }

  async remove(id: string, ctx: UserCtx) {
    const r = await this.prisma.reminder.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    const canDelete = r.createdById === ctx.userId || ctx.permissions.includes('users:manage');
    if (!canDelete) throw new BadRequestException('Not allowed to delete this reminder');
    await this.prisma.reminder.delete({ where: { id } });
    return { ok: true };
  }
}
