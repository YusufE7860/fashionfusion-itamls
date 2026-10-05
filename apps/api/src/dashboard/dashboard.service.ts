import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WIDGET_REGISTRY, definitionOf, registryFor } from './widget-registry';

export interface AddWidgetDto {
  type: string;
  title?: string;
  config?: any;
  width?: 'S' | 'M' | 'L';
}

export interface UpdateWidgetDto {
  title?: string;
  config?: any;
  width?: 'S' | 'M' | 'L';
  position?: number;
}

export interface UserCtx { userId: string; permissions: string[] }

/**
 * Each user owns a list of widgets on their dashboard. The widget TYPE comes
 * from the server registry; config and title are user-editable overrides.
 */
@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  // What can this user even add? Registry filtered by their permissions.
  catalog(ctx: UserCtx) {
    const by: Record<string, any[]> = {};
    for (const w of registryFor(ctx.permissions)) {
      (by[w.category] ??= []).push({
        type: w.type, title: w.title, description: w.description,
        category: w.category, kind: w.kind, defaultWidth: w.defaultWidth ?? 'M',
        configSchema: w.configSchema ?? [],
      });
    }
    return Object.entries(by).map(([category, items]) => ({ category, items }));
  }

  // User's current dashboard (ordered)
  list(ctx: UserCtx) {
    return this.prisma.dashboardWidget.findMany({
      where: { userId: ctx.userId, isActive: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async add(dto: AddWidgetDto, ctx: UserCtx) {
    const def = definitionOf(dto.type);
    if (!def) throw new BadRequestException(`Unknown widget type: ${dto.type}`);
    // Permission check
    if (def.requires?.some((p) => !ctx.permissions.includes(p))) {
      throw new BadRequestException('You do not have permission for this widget');
    }
    const last = await this.prisma.dashboardWidget.findFirst({
      where: { userId: ctx.userId }, orderBy: { position: 'desc' }, select: { position: true },
    });
    return this.prisma.dashboardWidget.create({
      data: {
        userId: ctx.userId,
        type: dto.type,
        title: dto.title ?? null,
        config: dto.config ?? null,
        width: dto.width ?? def.defaultWidth ?? 'M',
        position: (last?.position ?? -1) + 1,
      },
    });
  }

  async update(id: string, dto: UpdateWidgetDto, ctx: UserCtx) {
    const w = await this.prisma.dashboardWidget.findUnique({ where: { id } });
    if (!w || w.userId !== ctx.userId) throw new NotFoundException();
    return this.prisma.dashboardWidget.update({
      where: { id },
      data: {
        title: dto.title ?? w.title,
        config: dto.config === undefined ? w.config : dto.config,
        width: dto.width ?? w.width,
        position: dto.position ?? w.position,
      },
    });
  }

  async remove(id: string, ctx: UserCtx) {
    const w = await this.prisma.dashboardWidget.findUnique({ where: { id } });
    if (!w || w.userId !== ctx.userId) throw new NotFoundException();
    await this.prisma.dashboardWidget.delete({ where: { id } });
    return { ok: true };
  }

  async reorder(ids: string[], ctx: UserCtx) {
    // Verify ownership of all ids
    const owned = await this.prisma.dashboardWidget.findMany({
      where: { id: { in: ids }, userId: ctx.userId }, select: { id: true },
    });
    if (owned.length !== ids.length) throw new BadRequestException('Some widgets not yours');
    await this.prisma.$transaction(ids.map((id, position) =>
      this.prisma.dashboardWidget.update({ where: { id }, data: { position } }),
    ));
    return { ok: true };
  }

  // Fetch data for a specific widget. Dispatches to registry.
  async data(id: string, ctx: UserCtx) {
    const w = await this.prisma.dashboardWidget.findUnique({ where: { id } });
    if (!w || w.userId !== ctx.userId) throw new NotFoundException();
    const def = definitionOf(w.type);
    if (!def) return { error: `Widget type "${w.type}" is no longer registered`, orphan: true };
    if (def.requires?.some((p) => !ctx.permissions.includes(p))) {
      return { error: 'No permission for this widget' };
    }
    try {
      const payload = await def.fetch({ prisma: this.prisma, userId: ctx.userId, permissions: ctx.permissions, config: w.config });
      return { kind: def.kind, title: w.title ?? def.title, type: def.type, width: w.width, payload };
    } catch (e: any) {
      return { kind: def.kind, title: w.title ?? def.title, type: def.type, width: w.width, error: e.message };
    }
  }

  // One-shot preset for a user who has NO widgets yet: give them a sensible start.
  async seedDefaultsIfEmpty(ctx: UserCtx) {
    const count = await this.prisma.dashboardWidget.count({ where: { userId: ctx.userId } });
    if (count > 0) return { seeded: false };
    const picks = ['tickets.mineOpen','tickets.mineList','tickets.slaBreaches','tickets.recent']
      .map((t) => definitionOf(t))
      .filter((d): d is NonNullable<typeof d> => !!d)
      .filter((d) => !d.requires || d.requires.every((p) => ctx.permissions.includes(p)));
    await this.prisma.$transaction(picks.map((d, i) => this.prisma.dashboardWidget.create({
      data: { userId: ctx.userId, type: d.type, width: d.defaultWidth ?? 'M', position: i },
    })));
    return { seeded: picks.length };
  }
}
