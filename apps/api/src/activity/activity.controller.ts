import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('activity')
export class ActivityController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @RequirePermissions(Permissions.AuditLogRead)
  async list(
    @Query('actorId') actorId?: string,
    @Query('targetType') targetType?: string,
    @Query('method') method?: string,
    @Query('q') q?: string,
    @Query('limit') limit = '200',
  ) {
    const where: any = {};
    if (actorId) where.actorId = actorId;
    if (targetType) where.targetType = { contains: targetType };
    if (method) where.method = method;
    if (q) where.OR = [
      { path: { contains: q, mode: 'insensitive' } },
      { payload: { contains: q, mode: 'insensitive' } },
    ];
    const rows = await this.prisma.auditEvent.findMany({
      where, orderBy: { occurredAt: 'desc' }, take: Math.min(500, Number(limit) || 200),
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))] as string[];
    const users = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, email: true } })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({ ...r, actor: r.actorId ? userMap.get(r.actorId) ?? null : null }));
  }
}
