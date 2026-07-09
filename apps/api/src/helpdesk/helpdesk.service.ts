import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { buildAdapter } from './adapters';

@Injectable()
export class HelpdeskService {
  private readonly logger = new Logger(HelpdeskService.name);
  private adapter = buildAdapter();
  constructor(private prisma: PrismaService) {}

  /** Poll every 30 minutes. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async cron() {
    try {
      const result = await this.sync();
      this.logger.log(`Helpdesk sync: ${result.upserted} tickets, ${result.linked} linked to assets`);
    } catch (e: any) {
      this.logger.warn(`Helpdesk sync failed: ${e.message}`);
    }
  }

  /** Pull the latest tickets and mirror them locally. */
  async sync() {
    const since = new Date(); since.setHours(since.getHours() - 24);
    const tickets = await this.adapter.fetchRecent(since.toISOString());
    let upserted = 0, linked = 0;
    for (const t of tickets) {
      const asset = t.assetTagHint
        ? await this.prisma.asset.findUnique({ where: { assetTag: t.assetTagHint } })
        : null;
      const existing = await this.prisma.helpdeskLink.findFirst({
        where: { ticketExternalId: t.externalId, system: t.system },
      });
      if (existing) {
        await this.prisma.helpdeskLink.update({
          where: { id: existing.id },
          data: {
            summary: t.summary,
            closedAt: t.closedAtIso ? new Date(t.closedAtIso) : null,
            assetId: asset?.id ?? existing.assetId,
          },
        });
      } else {
        await this.prisma.helpdeskLink.create({
          data: {
            ticketExternalId: t.externalId,
            system: t.system,
            summary: t.summary,
            openedAt: new Date(t.openedAtIso),
            closedAt: t.closedAtIso ? new Date(t.closedAtIso) : null,
            assetId: asset?.id,
          },
        });
      }
      upserted++;
      if (asset) linked++;
    }
    return { upserted, linked, system: this.adapter.name };
  }

  byAsset(assetId: string) {
    return this.prisma.helpdeskLink.findMany({
      where: { assetId },
      orderBy: { openedAt: 'desc' },
      take: 25,
    });
  }

  recent(limit = 100) {
    return this.prisma.helpdeskLink.findMany({
      orderBy: { openedAt: 'desc' },
      take: limit,
    });
  }
}
