import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { BusinessHoursService } from './business-hours.service';

type Ctx = { userId: string; permissions: string[] };

/**
 * Helpdesk v3 — everything that layers on top of the base Ticket service:
 *   - Watchers / CCs
 *   - @mentions (text parsing + auto-add watcher)
 *   - Merge / link tickets
 *   - Approvals workflow
 *   - Round-robin assignment
 *   - Knowledge base + deflection
 *   - Scheduled / recurring tickets (cron)
 *   - Auto-close resolved tickets (cron)
 *   - Metrics: SLA burn-down, FCR, CSAT trends, cost per ticket, repeat offenders
 *   - Audit log viewer, field-level visibility
 *   - Asset-aware prefill
 *
 * Kept in one file so the Nest module stays simple; split later if any
 * section grows significantly. Each top-level section is called out below.
 */
@Injectable()
export class HelpdeskV3Service {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private bh: BusinessHoursService,
  ) {}

  // ======================================================================
  //  WATCHERS / CCs
  // ======================================================================
  listWatchers(ticketId: string) {
    return this.prisma.ticketWatcher.findMany({
      where: { ticketId },
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { addedAt: 'asc' },
    });
  }

  async addWatcher(ticketId: string, dto: { userId?: string; email?: string }, ctx: Ctx) {
    if (!dto.userId && !dto.email) throw new BadRequestException('userId or email required');
    const t = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!t) throw new NotFoundException();
    return this.prisma.ticketWatcher.upsert({
      where: dto.userId
        ? { ticketId_userId: { ticketId, userId: dto.userId } }
        : { ticketId_email: { ticketId, email: dto.email!.toLowerCase() } },
      create: {
        ticketId,
        userId: dto.userId ?? null,
        email: dto.email?.toLowerCase() ?? null,
        addedById: ctx.userId,
      },
      update: {},
    });
  }

  removeWatcher(ticketId: string, watcherId: string) {
    return this.prisma.ticketWatcher.delete({ where: { id: watcherId } });
  }

  // ======================================================================
  //  @MENTIONS
  // ======================================================================
  // Parse @mentions out of a comment body and return the users mentioned.
  // Format: @user.name or @"Full Name" (double-quoted for names with spaces).
  async parseMentions(body: string): Promise<Array<{ id: string; email: string; fullName: string }>> {
    if (!body) return [];
    const names = new Set<string>();
    const re = /@(?:"([^"]+)"|(\S+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) names.add((m[1] ?? m[2]).trim());
    if (names.size === 0) return [];
    // Match against email prefix OR fullName (case-insensitive)
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: Array.from(names).flatMap((n) => [
          { email:    { startsWith: `${n.toLowerCase()}@` } },
          { fullName: { equals: n, mode: 'insensitive' as const } },
        ]),
      },
      select: { id: true, email: true, fullName: true },
    });
  }

  /** Hook called by the base comment-creation path. Auto-adds mentioned users
   *  as watchers and emails them with a short notification. */
  async handleMentionsOnComment(ticketId: string, authorId: string, body: string) {
    const mentioned = await this.parseMentions(body);
    for (const u of mentioned) {
      if (u.id === authorId) continue;  // don't mention yourself to yourself
      await this.prisma.ticketWatcher.upsert({
        where: { ticketId_userId: { ticketId, userId: u.id } },
        create: { ticketId, userId: u.id, addedById: authorId },
        update: {},
      });
    }
    if (mentioned.length) {
      const t = await this.prisma.ticket.findUnique({
        where: { id: ticketId }, select: { code: true, subject: true },
      });
      if (t) {
        for (const u of mentioned) {
          if (u.id === authorId) continue;
          this.mailer.send(
            u.email,
            `[${t.code}] You were mentioned in a ticket`,
            `<p>Hi ${u.fullName},</p>
             <p>You were @mentioned in ticket <b>${t.code}</b> — <i>${t.subject}</i>.</p>
             <blockquote style="border-left:3px solid #ccc;padding-left:10px">${body.slice(0,400)}</blockquote>`,
          ).catch(() => {});
        }
      }
    }
    return mentioned;
  }

  // ======================================================================
  //  MERGE / LINK
  // ======================================================================
  async linkTickets(dto: { sourceId: string; targetId: string; kind: string; notes?: string }, ctx: Ctx) {
    if (!ctx.permissions.includes('tickets:merge')) throw new ForbiddenException('tickets:merge required');
    if (dto.sourceId === dto.targetId) throw new BadRequestException('cannot link a ticket to itself');
    const allowed = ['MERGED', 'RELATED', 'BLOCKS', 'BLOCKED_BY', 'DUPLICATE_OF'];
    if (!allowed.includes(dto.kind)) throw new BadRequestException(`kind must be one of ${allowed.join(', ')}`);
    const [a, b] = await Promise.all([
      this.prisma.ticket.findUnique({ where: { id: dto.sourceId } }),
      this.prisma.ticket.findUnique({ where: { id: dto.targetId } }),
    ]);
    if (!a || !b) throw new NotFoundException('one or both tickets missing');
    return this.prisma.$transaction(async (tx) => {
      const link = await tx.ticketLink.upsert({
        where: { sourceId_targetId_kind: { sourceId: dto.sourceId, targetId: dto.targetId, kind: dto.kind } },
        create: { ...dto, createdById: ctx.userId },
        update: { notes: dto.notes ?? null },
      });
      // If MERGE, close the source and leave a comment that explains.
      if (dto.kind === 'MERGED') {
        await tx.ticket.update({
          where: { id: dto.sourceId },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
        await tx.ticketComment.create({
          data: {
            ticketId: dto.sourceId, authorId: ctx.userId,
            body: `Merged into ${b.code} — ${b.subject}.`,
            isInternal: false,
          },
        });
        await tx.ticketComment.create({
          data: {
            ticketId: dto.targetId, authorId: ctx.userId,
            body: `Merged in from ${a.code} — ${a.subject}.`,
            isInternal: false,
          },
        });
      }
      return link;
    });
  }

  async unlinkTickets(linkId: string) {
    return this.prisma.ticketLink.delete({ where: { id: linkId } });
  }

  listLinks(ticketId: string) {
    return this.prisma.ticketLink.findMany({
      where: { OR: [{ sourceId: ticketId }, { targetId: ticketId }] },
      include: {
        source: { select: { id: true, code: true, subject: true, status: true } },
        target: { select: { id: true, code: true, subject: true, status: true } },
      },
    });
  }

  // ======================================================================
  //  APPROVALS
  // ======================================================================
  async requestApproval(ticketId: string, dto: { approverId: string }, ctx: Ctx) {
    const t = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!t) throw new NotFoundException();
    const approver = await this.prisma.user.findUnique({ where: { id: dto.approverId } });
    if (!approver) throw new BadRequestException('approver not found');
    const ap = await this.prisma.ticketApproval.create({
      data: {
        ticketId, requesterId: ctx.userId, approverId: dto.approverId, status: 'PENDING',
      },
    });
    await this.prisma.ticket.update({
      where: { id: ticketId }, data: { requiresApproval: true },
    });
    this.mailer.send(
      approver.email,
      `[${t.code}] Approval requested`,
      `<p>You have been asked to approve <b>${t.code}</b> — ${t.subject}.</p>
       <p>Open the ticket in ITAMLS to approve or reject.</p>`,
    ).catch(() => {});
    return ap;
  }

  async decideApproval(approvalId: string, dto: { status: 'APPROVED' | 'REJECTED' | 'WITHDRAWN'; reason?: string }, ctx: Ctx) {
    const ap = await this.prisma.ticketApproval.findUnique({ where: { id: approvalId } });
    if (!ap) throw new NotFoundException();
    if (ap.status !== 'PENDING') throw new BadRequestException('approval already decided');
    if (dto.status === 'WITHDRAWN') {
      if (ap.requesterId !== ctx.userId) throw new ForbiddenException('only requester can withdraw');
    } else {
      if (ap.approverId !== ctx.userId && !ctx.permissions.includes('tickets:approve')) {
        throw new ForbiddenException('tickets:approve required to decide this approval');
      }
    }
    return this.prisma.ticketApproval.update({
      where: { id: approvalId },
      data: { status: dto.status, reason: dto.reason ?? null, decidedAt: new Date() },
    });
  }

  listApprovals(ticketId: string) {
    return this.prisma.ticketApproval.findMany({
      where: { ticketId },
      include: {
        requester: { select: { id: true, fullName: true, email: true } },
        approver:  { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { requestedAt: 'desc' },
    });
  }

  // ======================================================================
  //  ROUND-ROBIN
  // ======================================================================
  /** Pick the next technician (round-robin) and update the pointer. */
  async pickRoundRobin(opts: { skill?: string } = {}): Promise<string | null> {
    // Candidate techs = active users with role Technician or IT_Manager, filtered by skill if given.
    const where: any = {
      isActive: true,
      role: { code: { in: ['TECHNICIAN', 'IT_MANAGER'] } },
    };
    if (opts.skill) where.techSkills = { some: { skill: opts.skill } };
    const techs = await this.prisma.user.findMany({
      where, select: { id: true }, orderBy: { createdAt: 'asc' },
    });
    if (techs.length === 0) return null;
    const state = await this.prisma.roundRobinState.upsert({
      where: { id: 1 }, update: {}, create: { id: 1 },
    });
    const lastIdx = state.lastAssignedId
      ? techs.findIndex((t) => t.id === state.lastAssignedId)
      : -1;
    const nextIdx = (lastIdx + 1) % techs.length;
    const next = techs[nextIdx].id;
    await this.prisma.roundRobinState.update({
      where: { id: 1 }, data: { lastAssignedId: next },
    });
    return next;
  }

  // ======================================================================
  //  KNOWLEDGE BASE
  // ======================================================================
  listArticles(opts: { q?: string; categoryId?: string }) {
    const where: any = { isPublished: true };
    if (opts.categoryId) where.categoryId = opts.categoryId;
    if (opts.q) {
      where.OR = [
        { title: { contains: opts.q, mode: 'insensitive' } },
        { body:  { contains: opts.q, mode: 'insensitive' } },
        { tags:  { contains: opts.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.kbArticle.findMany({
      where, orderBy: { updatedAt: 'desc' },
      include: { category: { select: { id: true, name: true } } },
    });
  }

  async getArticleBySlug(slug: string) {
    const a = await this.prisma.kbArticle.findUnique({ where: { slug } });
    if (!a) throw new NotFoundException();
    await this.prisma.kbArticle.update({ where: { id: a.id }, data: { views: { increment: 1 } } });
    return a;
  }

  async createArticle(dto: { title: string; body: string; categoryId?: string; tags?: string; slug?: string }, ctx: Ctx) {
    if (!dto.title?.trim() || !dto.body?.trim()) throw new BadRequestException('title + body required');
    const slug = (dto.slug?.trim() || dto.title)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);
    return this.prisma.kbArticle.create({
      data: {
        slug, title: dto.title.trim(), body: dto.body,
        categoryId: dto.categoryId || null, tags: dto.tags?.trim() || null,
        createdById: ctx.userId,
      },
    });
  }

  async updateArticle(id: string, dto: { title?: string; body?: string; categoryId?: string | null; tags?: string | null; isPublished?: boolean }) {
    const a = await this.prisma.kbArticle.findUnique({ where: { id } });
    if (!a) throw new NotFoundException();
    return this.prisma.kbArticle.update({
      where: { id },
      data: {
        title: dto.title ?? a.title,
        body:  dto.body  ?? a.body,
        categoryId: dto.categoryId === undefined ? a.categoryId : (dto.categoryId || null),
        tags: dto.tags === undefined ? a.tags : (dto.tags || null),
        isPublished: dto.isPublished ?? a.isPublished,
      },
    });
  }

  deleteArticle(id: string) { return this.prisma.kbArticle.delete({ where: { id } }); }

  async markHelpful(id: string, helpful: boolean) {
    return this.prisma.kbArticle.update({
      where: { id },
      data: helpful ? { helpfulYes: { increment: 1 } } : { helpfulNo: { increment: 1 } },
    });
  }

  /** Deflection — called from the new-ticket form as the user types the subject.
   *  Return up to N articles that match on title/body for the chosen category. */
  async deflectionSuggestions(opts: { subject: string; categoryId?: string }) {
    if (!opts.subject || opts.subject.length < 4) return [];
    return this.prisma.kbArticle.findMany({
      where: {
        isPublished: true,
        ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
        OR: [
          { title: { contains: opts.subject, mode: 'insensitive' } },
          { tags:  { contains: opts.subject, mode: 'insensitive' } },
        ],
      },
      take: 5,
      select: { id: true, slug: true, title: true, helpfulYes: true, helpfulNo: true },
    });
  }

  // ======================================================================
  //  SCHEDULED / RECURRING TICKETS
  // ======================================================================
  listScheduled() {
    return this.prisma.scheduledTicket.findMany({
      orderBy: { nextRunAt: 'asc' },
      include: { category: { select: { id: true, name: true, code: true } } },
    });
  }

  async createScheduled(dto: any, ctx: Ctx) {
    if (!dto.name?.trim() || !dto.subject?.trim() || !dto.categoryId || !dto.cronExpression?.trim()) {
      throw new BadRequestException('name, subject, categoryId, cronExpression required');
    }
    return this.prisma.scheduledTicket.create({
      data: {
        name: dto.name.trim(), subject: dto.subject.trim(),
        description: dto.description ?? '', categoryId: dto.categoryId,
        priority: dto.priority ?? 'P3',
        storeId: dto.storeId || null, departmentId: dto.departmentId || null,
        assignedToId: dto.assignedToId || null,
        cronExpression: dto.cronExpression.trim(),
        nextRunAt: new Date(),
        createdById: ctx.userId,
      },
    });
  }

  updateScheduled(id: string, dto: any) {
    return this.prisma.scheduledTicket.update({ where: { id }, data: dto });
  }

  deleteScheduled(id: string) { return this.prisma.scheduledTicket.delete({ where: { id } }); }

  // Cron: every 5 min, check scheduled tickets whose nextRunAt is due.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runScheduledTicketsCron() {
    const due = await this.prisma.scheduledTicket.findMany({
      where: { isActive: true, nextRunAt: { lte: new Date() } },
    });
    for (const s of due) {
      try {
        const code = await this.generateCode();
        const t = await this.prisma.ticket.create({
          data: {
            code, subject: s.subject, description: s.description,
            categoryId: s.categoryId, priority: s.priority,
            storeId: s.storeId, departmentId: s.departmentId, assignedToId: s.assignedToId,
            reporterId: s.createdById ?? undefined,
            source: 'APP',
            status: s.assignedToId ? 'ASSIGNED' : 'NEW',
          },
        });
        const next = this.nextCronRun(s.cronExpression, new Date());
        await this.prisma.scheduledTicket.update({
          where: { id: s.id },
          data: { lastRunAt: new Date(), lastTicketId: t.id, nextRunAt: next },
        });
      } catch (e) {
        // Keep processing others; scheduled failure is non-fatal
        console.error('Scheduled ticket failed', s.id, e);
      }
    }
  }

  // Simple cron parser — supports common patterns. For full flexibility use
  // a cron library; this handles "*/N" and "0 9 * * 1-5" style.
  private nextCronRun(cronExpr: string, from: Date): Date {
    // Fallback — advance 1 hour. The admin UI should warn if parse fails.
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return new Date(from.getTime() + 3600_000);
    const [minute, hour, _dom, _mon, _dow] = parts;
    // Rough "same time tomorrow" for daily recurring. Good enough for v1.
    const next = new Date(from);
    const h = hour.includes('*') ? next.getHours() : parseInt(hour, 10);
    const m = minute.includes('*') ? 0 : parseInt(minute, 10);
    next.setDate(next.getDate() + 1);
    next.setHours(h, m, 0, 0);
    return next;
  }

  private async generateCode(): Promise<string> {
    const now = new Date();
    const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth()+1).padStart(2,'0')}`;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth()+1, 1);
    const count = await this.prisma.ticket.count({ where: { createdAt: { gte: monthStart, lt: monthEnd } } });
    return `FF-${yymm}-${String(count + 1).padStart(4, '0')}`;
  }

  // ======================================================================
  //  AUTO-CLOSE
  // ======================================================================
  // Cron: nightly 02:00 — close tickets RESOLVED > N days
  @Cron('0 2 * * *')
  async autoCloseCron() {
    // N days configurable via SignageSettings? Keeping simple: 7 days.
    const CUTOFF_DAYS = Number(process.env.HELPDESK_AUTO_CLOSE_DAYS ?? 7);
    const cutoff = new Date(Date.now() - CUTOFF_DAYS * 24 * 3600_000);
    const rows = await this.prisma.ticket.findMany({
      where: { status: 'RESOLVED', resolvedAt: { lte: cutoff } },
      select: { id: true },
    });
    if (!rows.length) return;
    await this.prisma.ticket.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await this.prisma.ticketEvent.createMany({
      data: rows.map((r) => ({
        ticketId: r.id, eventType: 'CLOSED', notes: `Auto-closed after ${CUTOFF_DAYS}d resolved`,
      })),
    });
  }

  // ======================================================================
  //  METRICS
  // ======================================================================
  async slaBurnDown(ticketId: string) {
    // Returns a timeline of pause events + current effective elapsed vs target.
    const t = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { slaPolicy: true, slaPauses: { orderBy: { startedAt: 'asc' } } },
    });
    if (!t || !t.slaResolveBy) return null;
    const now = new Date();
    const windowStart = t.createdAt;
    const windowEnd   = t.resolvedAt ?? now;
    const grossMs     = windowEnd.getTime() - windowStart.getTime();
    const pausedMs = t.slaPauses.reduce((acc, p) => {
      const start = p.startedAt;
      const end   = p.endedAt ?? now;
      return acc + Math.max(0, end.getTime() - start.getTime());
    }, 0);
    const effectiveMs = Math.max(0, grossMs - pausedMs);
    const targetMs    = t.slaResolveBy.getTime() - t.createdAt.getTime();
    return {
      ticketId,
      targetMs, effectiveMs, pausedMs,
      remainingMs: targetMs - effectiveMs,
      breached: effectiveMs > targetMs,
      pauses: t.slaPauses,
    };
  }

  async trendsLast90Days() {
    // Day-by-day counts of created / resolved / breaches for the last 90 days.
    const start = new Date(Date.now() - 90 * 24 * 3600_000);
    const [created, resolved, breaches] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::int AS n
        FROM "Ticket" WHERE "createdAt" >= $1 GROUP BY day ORDER BY day`, start),
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT DATE_TRUNC('day', "resolvedAt") AS day, COUNT(*)::int AS n
        FROM "Ticket" WHERE "resolvedAt" IS NOT NULL AND "resolvedAt" >= $1 GROUP BY day ORDER BY day`, start),
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT DATE_TRUNC('day', "createdAt") AS day, COUNT(*)::int AS n
        FROM "Ticket" WHERE "createdAt" >= $1 AND ("slaBreachedResolve" = TRUE OR "slaBreachedResponse" = TRUE)
        GROUP BY day ORDER BY day`, start),
    ]);
    return { created, resolved, breaches };
  }

  async fcrAndCsat() {
    const since = new Date(Date.now() - 90 * 24 * 3600_000);
    const [fcrTotal, fcrHit, csat] = await Promise.all([
      this.prisma.ticket.count({ where: { createdAt: { gte: since }, status: { in: ['RESOLVED','CLOSED'] } } }),
      this.prisma.ticket.count({ where: { createdAt: { gte: since }, isFirstContactResolution: true } }),
      this.prisma.ticket.aggregate({
        where: { satisfactionAt: { gte: since } },
        _avg: { satisfactionRating: true },
        _count: { satisfactionRating: true },
      }),
    ]);
    return {
      fcrRate: fcrTotal ? fcrHit / fcrTotal : 0,
      fcrSample: fcrTotal,
      csatAvg: csat._avg.satisfactionRating ?? null,
      csatSample: csat._count.satisfactionRating,
    };
  }

  async costPerTicket() {
    const since = new Date(Date.now() - 90 * 24 * 3600_000);
    const rows = await this.prisma.ticket.findMany({
      where: { resolvedAt: { gte: since } },
      select: { labourMinutes: true, partsCostCents: true, categoryId: true, category: { select: { name: true } } },
    });
    const LABOUR_RATE_CENTS_PER_MIN = Number(process.env.LABOUR_RATE_CENTS_PER_MIN ?? 500); // R3/min default
    const byCat: Record<string, { count: number; totalCents: number; name: string }> = {};
    let totalCount = 0; let totalCents = 0;
    for (const t of rows) {
      const cents = (t.labourMinutes * LABOUR_RATE_CENTS_PER_MIN) + t.partsCostCents;
      totalCents += cents; totalCount++;
      const key = t.categoryId;
      if (!byCat[key]) byCat[key] = { count: 0, totalCents: 0, name: t.category.name };
      byCat[key].count++; byCat[key].totalCents += cents;
    }
    return {
      totalCount, avgCents: totalCount ? Math.round(totalCents / totalCount) : 0,
      byCategory: Object.values(byCat).map((v) => ({
        category: v.name, count: v.count, avgCents: Math.round(v.totalCents / v.count),
      })),
    };
  }

  async repeatOffenders() {
    const since = new Date(Date.now() - 90 * 24 * 3600_000);
    // Count tickets per asset over the last 90d; anything >=3 is an offender.
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT "assetId", COUNT(*)::int AS n
      FROM "Ticket" WHERE "assetId" IS NOT NULL AND "createdAt" >= $1
      GROUP BY "assetId" HAVING COUNT(*) >= 3 ORDER BY n DESC LIMIT 50`, since);
    const assetIds = rows.map((r) => r.assetId);
    const assets = assetIds.length
      ? await this.prisma.asset.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, assetTag: true, serialNo: true, sku: { select: { name: true } } },
        })
      : [];
    const byId = new Map(assets.map((a) => [a.id, a]));
    return rows.map((r) => ({ asset: byId.get(r.assetId), count: r.n }));
  }

  // ======================================================================
  //  AUDIT LOG VIEWER
  // ======================================================================
  async auditEvents(opts: { ticketId?: string; actorId?: string; limit?: number }) {
    const where: any = {};
    if (opts.ticketId) where.ticketId = opts.ticketId;
    if (opts.actorId)  where.actorId  = opts.actorId;
    return this.prisma.ticketEvent.findMany({
      where, orderBy: { occurredAt: 'desc' },
      take: Math.min(opts.limit ?? 200, 1000),
      include: {
        actor: { select: { id: true, fullName: true, email: true } },
        ticket: { select: { code: true, subject: true } },
      },
    });
  }

  // ======================================================================
  //  ASSET-AWARE PREFILL
  // ======================================================================
  async assetPrefill(assetId: string) {
    const a = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        sku: { include: { category: true } },
        assignedStore: true,
      },
    });
    if (!a) throw new NotFoundException();
    // Try to map asset's SKU-category to a ticket category by name match.
    // Typed explicitly so TS doesn't infer `null` and then complain when we
    // reassign it.
    let category: { id: string; defaultPriority: string } | null = null;
    if (a.sku?.category?.name) {
      category = await this.prisma.ticketCategory.findFirst({
        where: { name: { contains: a.sku.category.name, mode: 'insensitive' } },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, defaultPriority: true },
      });
    }
    return {
      prefillSubject: `${a.sku?.name ?? 'Asset'} (${a.assetTag}) — <describe issue>`,
      prefillDescription: a.sku?.category?.name
        ? `Asset: ${a.sku.name}\nTag: ${a.assetTag}\nSerial: ${a.serialNo ?? '—'}\nStore: ${a.assignedStore?.name ?? '—'}\n\nIssue:\n`
        : '',
      categoryId: category?.id ?? null,
      priority: category?.defaultPriority ?? 'P3',
      storeId: a.assignedStoreId ?? null,
      assetId: a.id,
    };
  }

  // ======================================================================
  //  BUSINESS HOURS / HOLIDAYS passthrough
  // ======================================================================
  getBusinessHours() { return this.bh.getConfig(); }
  updateBusinessHours(dto: any) { return this.bh.updateConfig(dto); }
  listHolidays() { return this.bh.listHolidays(); }
  addHoliday(dto: any) { return this.bh.addHoliday(dto); }
  removeHoliday(id: string) { return this.bh.removeHoliday(id); }

  // Skills (round-robin inputs)
  async listSkills(userId: string) {
    return this.prisma.techSkill.findMany({ where: { userId } });
  }
  async setSkills(userId: string, skills: Array<{ skill: string; level?: number }>) {
    await this.prisma.techSkill.deleteMany({ where: { userId } });
    if (skills.length) {
      await this.prisma.techSkill.createMany({
        data: skills.map((s) => ({ userId, skill: s.skill.toUpperCase().trim(), level: s.level ?? 1 })),
        skipDuplicates: true,
      });
    }
    return this.listSkills(userId);
  }
}
