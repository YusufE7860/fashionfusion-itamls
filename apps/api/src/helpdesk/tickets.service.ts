import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { StorageService } from '../storage/storage.service';
import { HelpdeskRoutingService } from './routing.service';
import { HelpdeskWebhooksService } from './webhooks.service';

function escapeHtml(s: string) {
  return (s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}

const REOPEN_ESCALATION_THRESHOLD = 3;  // bump priority after this many reopens
const PRIORITY_BUMP: Record<string, string> = { P4: 'P3', P3: 'P2', P2: 'P1', P1: 'P1' };

const STATUSES = ['NEW','ASSIGNED','IN_PROGRESS','WAITING_ON_USER','RESOLVED','CLOSED','REOPENED'] as const;
type Status = typeof STATUSES[number];
const PRIORITIES = ['P1','P2','P3','P4'] as const;
type Priority = typeof PRIORITIES[number];

/** Legal status transitions — anything not listed is rejected. */
const TRANSITIONS: Record<Status, Status[]> = {
  NEW:             ['ASSIGNED', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED'],
  ASSIGNED:        ['NEW', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS:     ['ASSIGNED', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED'],
  WAITING_ON_USER: ['IN_PROGRESS', 'ASSIGNED', 'RESOLVED', 'CLOSED'],
  RESOLVED:        ['REOPENED', 'CLOSED'],
  CLOSED:          ['REOPENED'],
  REOPENED:        ['ASSIGNED', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED'],
};

export interface CreateTicketDto {
  subject: string;
  description: string;
  categoryId: string;
  priority?: Priority;
  storeId?: string;
  departmentId?: string;
  assetId?: string;
  source?: 'APP' | 'EMAIL' | 'PHONE' | 'AGENT' | 'OPS_APP';
  /** When logged by Ops app on behalf of a store user who is not an ITAMLS user */
  externalReporterEmail?: string | null;
  externalReporterName?: string | null;
}

export interface UpdateTicketDto {
  subject?: string;
  status?: Status;
  priority?: Priority;
  categoryId?: string;
  assignedToId?: string | null;
  storeId?: string | null;
  departmentId?: string | null;
  assetId?: string | null;
}

export interface ListTicketsQuery {
  status?: string;         // comma-separated
  priority?: string;       // comma-separated
  categoryId?: string;
  storeId?: string;
  assignedToId?: string;
  reporterId?: string;
  q?: string;              // free-text on subject/code/description
  openOnly?: string;       // 'true' -> excludes RESOLVED, CLOSED
  fromDate?: string;
  toDate?: string;
  limit?: string;
  offset?: string;
}

interface UserCtx { userId: string; permissions: string[] }

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private storage: StorageService,
    private routing: HelpdeskRoutingService,
    private webhooks: HelpdeskWebhooksService,
  ) {}

  /** Snapshot a ticket for webhook payloads (lean shape — no comments/events). */
  private async publicShape(id: string) {
    return this.prisma.ticket.findUnique({
      where: { id },
      include: {
        reporter:   { select: { id: true, fullName: true, email: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        store:      { select: { id: true, code: true, name: true } },
        category:   { select: { id: true, code: true, name: true } },
      },
    });
  }

  // ============================================================
  //  Attachments
  // ============================================================
  async addAttachment(
    ticketId: string,
    file: { originalname: string; buffer: Buffer; mimetype: string; size: number },
    ctx: UserCtx,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('file required');
    if (file.size > 25 * 1024 * 1024) throw new BadRequestException('File too large (25 MB max)');

    // Existence + access check via .get()
    await this.get(ticketId, ctx);

    const cleanName = file.originalname.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200) || 'file';
    const stamp = new Date().toISOString().slice(0, 10);
    const objKey = `tickets/${ticketId}/${stamp}/${randomBytes(6).toString('hex')}-${cleanName}`;
    await this.storage.putObject(objKey, file.buffer, file.mimetype || 'application/octet-stream');

    const [rec] = await this.prisma.$transaction([
      this.prisma.ticketAttachment.create({
        data: {
          ticketId, uploadedById: ctx.userId,
          filename: cleanName, storageKey: objKey,
          sizeBytes: file.size, contentType: file.mimetype,
        },
        include: { uploadedBy: { select: { id: true, fullName: true } } },
      }),
      this.prisma.ticketEvent.create({
        data: { ticketId, actorId: ctx.userId, eventType: 'ATTACHMENT_ADDED', notes: cleanName },
      }),
    ]);
    return rec;
  }

  async getAttachmentDownloadUrl(attachmentId: string, ctx: UserCtx) {
    const a = await this.prisma.ticketAttachment.findUnique({ where: { id: attachmentId } });
    if (!a) throw new NotFoundException();
    await this.get(a.ticketId, ctx);  // access check
    return this.storage.presignedGet(a.storageKey, 5 * 60);
  }

  async deleteAttachment(attachmentId: string, ctx: UserCtx) {
    const a = await this.prisma.ticketAttachment.findUnique({ where: { id: attachmentId } });
    if (!a) throw new NotFoundException();
    // Uploader can always delete; techs can delete any
    const isTech = ctx.permissions.includes('tickets:assign');
    if (!isTech && a.uploadedById !== ctx.userId) throw new ForbiddenException();
    await this.storage.remove(a.storageKey).catch(() => {});
    await this.prisma.ticketAttachment.delete({ where: { id: attachmentId } });
    return { ok: true };
  }

  // ============================================================
  //  Access control helpers
  // ============================================================
  private async allowedStoreIds(ctx: UserCtx): Promise<string[] | null> {
    if (ctx.permissions.includes('tickets:read:all')) return null; // no filter
    const rows = await this.prisma.userStoreAccess.findMany({
      where: { userId: ctx.userId }, select: { storeId: true },
    });
    return rows.map((r) => r.storeId);
  }

  // ============================================================
  //  Ticket code generator — FF-YYMM-NNNN
  // ============================================================
  private async nextCode(): Promise<string> {
    const now = new Date();
    const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth()+1).padStart(2,'0')}`;
    // Count tickets so far this month for a running sequence
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth()+1, 1);
    const count = await this.prisma.ticket.count({
      where: { createdAt: { gte: monthStart, lt: monthEnd } },
    });
    return `FF-${yymm}-${String(count + 1).padStart(4, '0')}`;
  }

  // ============================================================
  //  SLA calculation
  // ============================================================
  private calcSlaTargets(policy: { p1FirstResponseMinutes: number; p1ResolveMinutes: number; p2FirstResponseMinutes: number; p2ResolveMinutes: number; p3FirstResponseMinutes: number; p3ResolveMinutes: number; p4FirstResponseMinutes: number; p4ResolveMinutes: number }, priority: Priority, from = new Date()) {
    const map: Record<Priority, { fr: number; res: number }> = {
      P1: { fr: policy.p1FirstResponseMinutes, res: policy.p1ResolveMinutes },
      P2: { fr: policy.p2FirstResponseMinutes, res: policy.p2ResolveMinutes },
      P3: { fr: policy.p3FirstResponseMinutes, res: policy.p3ResolveMinutes },
      P4: { fr: policy.p4FirstResponseMinutes, res: policy.p4ResolveMinutes },
    };
    const { fr, res } = map[priority];
    return {
      slaFirstResponseBy: new Date(from.getTime() + fr * 60_000),
      slaResolveBy:       new Date(from.getTime() + res * 60_000),
    };
  }

  // ============================================================
  //  Create
  // ============================================================
  async create(dto: CreateTicketDto, ctx: UserCtx) {
    if (!dto.subject?.trim())     throw new BadRequestException('subject required');
    if (!dto.description?.trim()) throw new BadRequestException('description required');
    if (!dto.categoryId)          throw new BadRequestException('categoryId required');

    const category = await this.prisma.ticketCategory.findUnique({
      where: { id: dto.categoryId }, include: { slaPolicy: true, defaultAssignee: true },
    });
    if (!category || !category.isActive) throw new BadRequestException('Unknown or inactive category');

    // If reporter is a StoreManager without dvrs:read:all, verify the storeId matches an accessible store
    if (dto.storeId && !ctx.permissions.includes('tickets:read:all')) {
      const allowed = await this.allowedStoreIds(ctx);
      if (allowed !== null && !allowed.includes(dto.storeId)) {
        // If the user's own user record has a storeId, permit that specifically
        const u = await this.prisma.user.findUnique({ where: { id: ctx.userId }, select: { storeId: true } });
        if (u?.storeId !== dto.storeId) throw new ForbiddenException('You cannot log tickets against this store');
      }
    }

    const priority = (dto.priority ?? category.defaultPriority) as Priority;
    if (!PRIORITIES.includes(priority)) throw new BadRequestException(`Invalid priority ${priority}`);

    const sla = category.slaPolicy
      || await this.prisma.slaPolicy.findFirst({ where: { isDefault: true } });
    const now = new Date();
    const slaTargets = sla ? this.calcSlaTargets(sla, priority, now) : null;

    const code = await this.nextCode();
    // Smart auto-assignment via Store → Area Manager → Technician.
    // Also snapshots the AM onto the ticket for reporting + CC on emails.
    const route = await this.routing.pickRoute({ storeId: dto.storeId, categoryId: category.id });
    const assigneeId = route.assigneeId;
    const initialStatus: Status = assigneeId ? 'ASSIGNED' : 'NEW';

    const ticket = await this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.create({
        data: {
          code, subject: dto.subject.trim(), description: dto.description.trim(),
          status: initialStatus, priority,
          reporterId: ctx.userId ?? null,
          externalReporterEmail: (dto as any).externalReporterEmail ?? null,
          externalReporterName:  (dto as any).externalReporterName ?? null,
          storeId: dto.storeId, departmentId: dto.departmentId, assetId: dto.assetId,
          assignedToId: assigneeId,
          areaManagerId: route.areaManagerId,
          categoryId: category.id,
          source: dto.source ?? 'APP',
          slaPolicyId: sla?.id,
          slaFirstResponseBy: slaTargets?.slaFirstResponseBy,
          slaResolveBy:       slaTargets?.slaResolveBy,
        },
      });
      await tx.ticketEvent.create({
        data: { ticketId: t.id, actorId: ctx.userId, eventType: 'CREATED',
                notes: `Created via ${dto.source ?? 'APP'}` },
      });
      if (assigneeId) {
        await tx.ticketEvent.create({
          data: { ticketId: t.id, actorId: ctx.userId, eventType: 'ASSIGNED',
                  toValue: assigneeId, notes: 'Auto-assigned via category default' },
        });
      }
      return t;
    });

    // Fire-and-forget email to assignee (if any)
    if (assigneeId) this.notifyAssignment(ticket.id, assigneeId).catch(() => {});

    // Webhook: ticket.created
    const snapshot = await this.publicShape(ticket.id);
    this.webhooks.emit('ticket.created', { ticket: snapshot, actor: { id: ctx.userId, name: '' } }).catch(() => {});
    return this.get(ticket.id, ctx);
  }

  // ============================================================
  //  Get
  // ============================================================
  async get(id: string, ctx: UserCtx) {
    const t = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        reporter:   { select: { id: true, fullName: true, email: true } },
        assignedTo: { select: { id: true, fullName: true, email: true } },
        store:      { select: { id: true, code: true, name: true } },
        department: { select: { id: true, code: true, name: true } },
        asset:      { select: { id: true, assetTag: true, serialNo: true, hostname: true, sku: { select: { name: true, model: true } } } },
        category:   { select: { id: true, code: true, name: true, defaultPriority: true } },
        slaPolicy:  true,
        comments:   { include: { author: { select: { id: true, fullName: true, email: true } } }, orderBy: { createdAt: 'asc' } },
        events:     { include: { actor: { select: { id: true, fullName: true } } }, orderBy: { occurredAt: 'desc' }, take: 100 },
        attachments:{ include: { uploadedBy: { select: { id: true, fullName: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!t) throw new NotFoundException();

    // Store-scope enforcement
    if (t.storeId) {
      const allowed = await this.allowedStoreIds(ctx);
      if (allowed !== null && !allowed.includes(t.storeId)) {
        // Reporter can always see their own ticket
        if (t.reporterId !== ctx.userId) throw new NotFoundException();
      }
    }
    // Filter internal comments from non-IT users
    if (!ctx.permissions.includes('tickets:read:all')) {
      t.comments = t.comments.filter((c: any) => !c.isInternal);
    }
    return t;
  }

  // ============================================================
  //  List (with filters + pagination)
  // ============================================================
  async list(q: ListTicketsQuery, ctx: UserCtx) {
    const where: any = {};
    const csv = (v?: string) => v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const statuses  = csv(q.status);
    const priorities = csv(q.priority);
    if (statuses.length)   where.status   = { in: statuses };
    if (priorities.length) where.priority = { in: priorities };
    if (q.categoryId)      where.categoryId = q.categoryId;
    if (q.storeId)         where.storeId    = q.storeId;
    if (q.assignedToId)    where.assignedToId = q.assignedToId === 'unassigned' ? null : q.assignedToId;
    if (q.reporterId)      where.reporterId  = q.reporterId;
    if (q.openOnly === 'true') where.status = { notIn: ['RESOLVED', 'CLOSED'] };
    if (q.fromDate) where.createdAt = { ...(where.createdAt ?? {}), gte: new Date(q.fromDate) };
    if (q.toDate)   where.createdAt = { ...(where.createdAt ?? {}), lte: new Date(q.toDate) };
    if (q.q?.trim()) {
      const needle = q.q.trim();
      where.OR = [
        { subject:     { contains: needle, mode: 'insensitive' } },
        { code:        { contains: needle, mode: 'insensitive' } },
        { description: { contains: needle, mode: 'insensitive' } },
      ];
    }

    // Store-scope filter
    const allowed = await this.allowedStoreIds(ctx);
    if (allowed !== null) {
      // Non-IT: see tickets for allowed stores OR tickets they reported themselves OR HQ tickets they raised
      where.OR = [
        ...(where.OR ?? []),
        { storeId: { in: allowed } },
        { reporterId: ctx.userId },
      ];
    }

    const take = Math.min(Number(q.limit) || 50, 200);
    const skip = Math.max(Number(q.offset) || 0, 0);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where, take, skip,
        orderBy: [{ status: 'asc' }, { priority: 'asc' }, { createdAt: 'desc' }],
        include: {
          reporter:   { select: { id: true, fullName: true } },
          assignedTo: { select: { id: true, fullName: true } },
          store:      { select: { id: true, code: true, name: true } },
          category:   { select: { id: true, code: true, name: true } },
          _count:     { select: { comments: true } },
        },
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return { items, total, limit: take, offset: skip };
  }

  // ============================================================
  //  Update (partial edits + status/priority/assignment)
  // ============================================================
  async update(id: string, dto: UpdateTicketDto, ctx: UserCtx) {
    const before = await this.get(id, ctx);

    const canAssign = ctx.permissions.includes('tickets:assign');
    const isReporter = before.reporterId === ctx.userId;
    if (!canAssign && !isReporter) throw new ForbiddenException('Not allowed to edit this ticket');

    // Reporter can edit subject/description while NEW; only tech can change status/assign/priority
    if (!canAssign) {
      const rw: (keyof UpdateTicketDto)[] = ['subject'];  // reporter can only fix subject
      for (const k of Object.keys(dto) as (keyof UpdateTicketDto)[]) {
        if (!rw.includes(k) && dto[k] !== undefined) delete dto[k];
      }
      if (before.status !== 'NEW') throw new ForbiddenException('Ticket is being worked; ask the assignee to update');
    }

    // Status transition guard
    if (dto.status && dto.status !== before.status) {
      const legal = TRANSITIONS[before.status as Status] ?? [];
      if (!legal.includes(dto.status)) {
        throw new BadRequestException(`Cannot move ${before.status} -> ${dto.status}`);
      }
    }

    // If moving to REOPENED, set reopenedAt and clear resolved/closed timestamps
    const now = new Date();
    const data: any = { ...dto };
    if (dto.status === 'REOPENED') {
      data.reopenedAt = now;
      data.resolvedAt = null;
      data.closedAt   = null;
      // Reopen counter + escalation: after N reopens, bump priority one step
      const nextCount = before.reopenCount + 1;
      data.reopenCount = nextCount;
      if (nextCount >= REOPEN_ESCALATION_THRESHOLD && PRIORITY_BUMP[before.priority] !== before.priority) {
        data.priority = PRIORITY_BUMP[before.priority];
      }
    }
    if (dto.status === 'RESOLVED') data.resolvedAt = now;
    if (dto.status === 'CLOSED')   data.closedAt   = now;

    // SLA pause: WAITING_ON_USER starts the pause clock; moving out of it
    // accumulates the paused time into totalWaitingMs so SLA math stays fair.
    if (before.status !== 'WAITING_ON_USER' && dto.status === 'WAITING_ON_USER') {
      data.waitingOnUserSinceAt = now;
    }
    if (before.status === 'WAITING_ON_USER' && dto.status && dto.status !== 'WAITING_ON_USER' && before.waitingOnUserSinceAt) {
      const elapsed = now.getTime() - new Date(before.waitingOnUserSinceAt).getTime();
      data.waitingOnUserSinceAt = null;
      data.totalWaitingMs = (before.totalWaitingMs ?? 0) + elapsed;
      // Push the SLA deadlines forward by the paused interval
      if (before.slaFirstResponseBy && !before.firstResponseAt) {
        data.slaFirstResponseBy = new Date(new Date(before.slaFirstResponseBy).getTime() + elapsed);
      }
      if (before.slaResolveBy) {
        data.slaResolveBy = new Date(new Date(before.slaResolveBy).getTime() + elapsed);
      }
    }

    // If assigning for the first time and it's still NEW, move to ASSIGNED implicitly
    if (dto.assignedToId && !before.assignedToId && before.status === 'NEW' && !dto.status) {
      data.status = 'ASSIGNED';
    }

    // Priority change may recompute SLA targets
    if (dto.priority && dto.priority !== before.priority && before.slaPolicy) {
      const targets = this.calcSlaTargets(before.slaPolicy as any, dto.priority, before.createdAt);
      data.slaFirstResponseBy = targets.slaFirstResponseBy;
      data.slaResolveBy       = targets.slaResolveBy;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.update({ where: { id }, data });
      const events: any[] = [];
      if (dto.status && dto.status !== before.status) {
        events.push({ ticketId: id, actorId: ctx.userId, eventType: 'STATUS_CHANGED',
                      fromValue: before.status, toValue: dto.status });
      }
      if (dto.priority && dto.priority !== before.priority) {
        events.push({ ticketId: id, actorId: ctx.userId, eventType: 'PRIORITY_CHANGED',
                      fromValue: before.priority, toValue: dto.priority });
      }
      if (dto.assignedToId !== undefined && dto.assignedToId !== before.assignedToId) {
        events.push({ ticketId: id, actorId: ctx.userId, eventType: 'ASSIGNED',
                      fromValue: before.assignedToId ?? undefined, toValue: dto.assignedToId ?? undefined });
      }
      if (dto.categoryId && dto.categoryId !== before.categoryId) {
        events.push({ ticketId: id, actorId: ctx.userId, eventType: 'CATEGORY_CHANGED',
                      fromValue: before.categoryId, toValue: dto.categoryId });
      }
      if (events.length) await tx.ticketEvent.createMany({ data: events });
      return t;
    });

    // Notify newly-assigned user
    if (dto.assignedToId && dto.assignedToId !== before.assignedToId) {
      this.notifyAssignment(id, dto.assignedToId).catch(() => {});
    }

    // Fire webhooks for every meaningful change
    const snapshot = await this.publicShape(id);
    const changed: Record<string, any> = {};
    if (dto.status && dto.status !== before.status) {
      changed.status = { from: before.status, to: dto.status };
      this.webhooks.emit('ticket.status_changed', { ticket: snapshot, changedFields: changed, actor: { id: ctx.userId, name: '' } }).catch(() => {});
      if (dto.status === 'RESOLVED') this.webhooks.emit('ticket.resolved', { ticket: snapshot }).catch(() => {});
      if (dto.status === 'CLOSED')   this.webhooks.emit('ticket.closed',   { ticket: snapshot }).catch(() => {});
      if (dto.status === 'REOPENED') this.webhooks.emit('ticket.reopened', { ticket: snapshot }).catch(() => {});
    }
    if (dto.priority && dto.priority !== before.priority) {
      changed.priority = { from: before.priority, to: dto.priority };
      this.webhooks.emit('ticket.priority_changed', { ticket: snapshot, changedFields: changed }).catch(() => {});
    }
    if (dto.assignedToId !== undefined && dto.assignedToId !== before.assignedToId) {
      changed.assignedToId = { from: before.assignedToId, to: dto.assignedToId };
      this.webhooks.emit('ticket.assigned', { ticket: snapshot, changedFields: changed }).catch(() => {});
    }
    return this.get(updated.id, ctx);
  }

  /** Reporter rates their resolved ticket. */
  async rateSatisfaction(id: string, rating: number, commentBody: string | undefined, ctx: UserCtx) {
    if (rating < 1 || rating > 5) throw new BadRequestException('rating must be 1-5');
    const t = await this.get(id, ctx);
    if (t.reporterId !== ctx.userId) throw new ForbiddenException('Only the reporter can rate');
    if (t.status !== 'RESOLVED' && t.status !== 'CLOSED') {
      throw new BadRequestException('Can only rate once a ticket is resolved');
    }
    return this.prisma.ticket.update({
      where: { id },
      data: {
        satisfactionRating: rating,
        satisfactionComment: commentBody?.trim() || null,
        satisfactionAt: new Date(),
      },
    });
  }

  // ============================================================
  //  Comment
  // ============================================================
  async addComment(id: string, body: string, isInternal: boolean, ctx: UserCtx) {
    if (!body?.trim()) throw new BadRequestException('body required');
    const ticket = await this.get(id, ctx);
    const isTech = ctx.permissions.includes('tickets:assign');
    if (isInternal && !isTech) throw new ForbiddenException('Only IT can post internal notes');

    const now = new Date();
    const isFirstTechResponse = isTech && !ticket.firstResponseAt;

    await this.prisma.$transaction(async (tx) => {
      await tx.ticketComment.create({
        data: { ticketId: id, authorId: ctx.userId, body: body.trim(), isInternal },
      });
      await tx.ticketEvent.create({
        data: { ticketId: id, actorId: ctx.userId, eventType: 'COMMENT_ADDED',
                notes: isInternal ? 'Internal note' : 'Reply' },
      });
      if (isFirstTechResponse) {
        await tx.ticket.update({ where: { id }, data: { firstResponseAt: now } });
      }
    });

    // Notify the "other side" of the conversation. If this is a public reply
    // from a tech, also email the full reply body to the reporter so the user
    // can simply reply by email — POP3 ingest will match the [FF-YYMM-NNNN]
    // tag in the subject and append their reply as a new comment.
    // The "other side" may be an ITAMLS user (notifyId) OR the external reporter
    // (identified on the ticket itself) — notifyComment handles both.
    const notifyId = isTech ? ticket.reporterId : ticket.assignedToId;
    if (!isInternal) this.notifyComment(id, notifyId, body.trim(), isTech).catch(() => {});

    // Webhook (public comments only — internal notes stay private)
    if (!isInternal) {
      const snapshot = await this.publicShape(id);
      this.webhooks.emit('ticket.comment_added', {
        ticket: snapshot,
        comment: { id: '', body: body.trim(), author: ctx.userId, isInternal: false },
      }).catch(() => {});
    }
    return this.get(id, ctx);
  }

  // ============================================================
  //  Bulk assign
  // ============================================================
  async bulkAssign(ticketIds: string[], assignedToId: string | null, ctx: UserCtx) {
    if (!ctx.permissions.includes('tickets:assign')) throw new ForbiddenException();
    let updated = 0;
    for (const id of ticketIds) {
      try {
        await this.update(id, { assignedToId }, ctx);
        updated++;
      } catch { /* skip individual failures */ }
    }
    return { updated };
  }

  // ============================================================
  //  Notifications (best-effort — swallow errors)
  // ============================================================
  private async notifyAssignment(ticketId: string, userId: string) {
    const [ticket, user] = await Promise.all([
      this.prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { store: true, category: true, reporter: true },
      }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!ticket || !user?.email) return;
    const web = process.env.WEB_BASE_URL ?? '';
    const subject = `[${ticket.code}] ${ticket.priority} · ${ticket.subject}`;
    const body = `You have been assigned a ticket.

Code: ${ticket.code}
Priority: ${ticket.priority}
Category: ${ticket.category.name}
Store: ${ticket.store?.code ?? '—'} ${ticket.store?.name ?? ''}
Reporter: ${ticket.reporter.fullName}

${ticket.description}

Open: ${web}/helpdesk/tickets/${ticket.id}
`;
    await this.mailer.send(user.email, subject, body.replace(/\n/g, '<br>'), body);
  }

  private async notifyComment(ticketId: string, userId: string | null, replyBody?: string, fromTech?: boolean) {
    const [ticket, user, author] = await Promise.all([
      this.prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { areaManager: { select: { email: true, fullName: true } } },
      }),
      userId ? this.prisma.user.findUnique({ where: { id: userId } }) : Promise.resolve(null as any),
      fromTech ? this.prisma.user.findFirst({ where: { role: { code: { in: ['ADMINISTRATOR','IT_MANAGER','TECHNICIAN'] } } }, select: { fullName: true } }) : Promise.resolve(null as any),
    ]);
    if (!ticket) return;

    // Resolve the "to" email:
    //  - If userId resolves to an ITAMLS user with an email, use that.
    //  - Otherwise fall back to the ticket's external reporter email.
    //  - CC the Area Manager (entity) if we're emailing the reporter.
    const recipient = user?.email ?? ticket.externalReporterEmail;
    if (!recipient) return;

    const greetingName = user?.fullName ?? ticket.externalReporterName ?? '';
    const web = process.env.WEB_BASE_URL ?? '';
    // Keep the ticket code in the subject so email replies thread back via POP3 ingest
    const subject = `[${ticket.code}] ${ticket.subject}`;

    const greet = greetingName ? `Hi ${greetingName.split(' ')[0]},` : 'Hi,';
    const whoLabel = fromTech ? (author?.fullName ? `IT (${author.fullName})` : 'IT') : 'the reporter';
    const bodyText = replyBody
      ? `${greet}\n\n${whoLabel} replied to ticket ${ticket.code}:\n\n---\n${replyBody}\n---\n\nReply to this email to add a comment, or open the ticket:\n${web}/helpdesk/tickets/${ticket.id}\n\n— ITAMLS Helpdesk`
      : `There's a new reply on ticket ${ticket.code}.\n\nOpen: ${web}/helpdesk/tickets/${ticket.id}`;

    const html = this.mailer.wrap(
      `Reply on ${ticket.code}`,
      `<p>${escapeHtml(greet)}</p>
       <p>${escapeHtml(whoLabel)} replied to <strong>${escapeHtml(ticket.subject)}</strong>:</p>
       <blockquote style="margin:12px 0;padding:12px 16px;border-left:3px solid #fe6620;background:#0f1626;color:#e8eef9;white-space:pre-wrap;">${escapeHtml(replyBody ?? '')}</blockquote>
       <p style="font-size:12px;color:#7a8aa8;">Reply to this email to add a comment to the ticket.</p>
       <p><a href="${web}/helpdesk/tickets/${ticket.id}" style="color:#fe6620;">Open ticket ${ticket.code}</a></p>`,
    );
    // Primary recipient + optional AM CC
    const toList: string[] = [recipient];
    if (fromTech && ticket.areaManager?.email && ticket.areaManager.email !== recipient) {
      toList.push(ticket.areaManager.email);
    }
    await this.mailer.send(toList, subject, html, bodyText);
  }

  // ============================================================
  //  SLA breach sweep — invoked by cron
  // ============================================================
  async runSlaBreachSweep() {
    const now = new Date();
    // Response breaches: no first response by deadline, not resolved yet
    const responseBreaches = await this.prisma.ticket.findMany({
      where: {
        slaBreachedResponse: false,
        firstResponseAt: null,
        slaFirstResponseBy: { lt: now },
        status: { notIn: ['RESOLVED', 'CLOSED'] },
      },
      select: { id: true },
    });
    // Resolve breaches: not resolved by deadline
    const resolveBreaches = await this.prisma.ticket.findMany({
      where: {
        slaBreachedResolve: false,
        slaResolveBy: { lt: now },
        status: { notIn: ['RESOLVED', 'CLOSED'] },
      },
      select: { id: true },
    });

    if (responseBreaches.length) {
      await this.prisma.$transaction([
        this.prisma.ticket.updateMany({
          where: { id: { in: responseBreaches.map((r) => r.id) } },
          data: { slaBreachedResponse: true },
        }),
        this.prisma.ticketEvent.createMany({
          data: responseBreaches.map((r) => ({
            ticketId: r.id, eventType: 'SLA_BREACHED',
            notes: 'First response SLA breached',
          })),
        }),
      ]);
    }
    if (resolveBreaches.length) {
      await this.prisma.$transaction([
        this.prisma.ticket.updateMany({
          where: { id: { in: resolveBreaches.map((r) => r.id) } },
          data: { slaBreachedResolve: true },
        }),
        this.prisma.ticketEvent.createMany({
          data: resolveBreaches.map((r) => ({
            ticketId: r.id, eventType: 'SLA_BREACHED',
            notes: 'Resolution SLA breached',
          })),
        }),
      ]);
    }
    // Webhooks on breach
    for (const r of [...responseBreaches, ...resolveBreaches]) {
      const snap = await this.publicShape(r.id);
      this.webhooks.emit('ticket.sla_breached', { ticket: snap }).catch(() => {});
    }

    return {
      responseBreaches: responseBreaches.length,
      resolveBreaches: resolveBreaches.length,
    };
  }

  // ============================================================
  //  Reports
  // ============================================================
  async reports(fromDate?: string, toDate?: string) {
    const from = fromDate ? new Date(fromDate) : new Date(Date.now() - 30 * 86400_000);
    const to   = toDate   ? new Date(toDate)   : new Date();
    const range = { gte: from, lte: to };

    const [byStatus, byPriority, byCategory, byStore, byAssignee, all, resolved, totalCount, openCount] = await Promise.all([
      this.prisma.ticket.groupBy({ by: ['status'],   where: { createdAt: range }, _count: { _all: true } }),
      this.prisma.ticket.groupBy({ by: ['priority'], where: { createdAt: range }, _count: { _all: true } }),
      this.prisma.ticket.groupBy({ by: ['categoryId'], where: { createdAt: range }, _count: { _all: true } }),
      this.prisma.ticket.groupBy({ by: ['storeId'],    where: { createdAt: range }, _count: { _all: true } }),
      this.prisma.ticket.groupBy({ by: ['assignedToId'], where: { createdAt: range }, _count: { _all: true } }),
      this.prisma.ticket.findMany({
        where: { createdAt: range },
        select: { createdAt: true, resolvedAt: true, firstResponseAt: true,
                  slaBreachedResponse: true, slaBreachedResolve: true, priority: true,
                  status: true, storeId: true },
      }),
      this.prisma.ticket.findMany({
        where: { createdAt: range, resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true, firstResponseAt: true, priority: true },
      }),
      this.prisma.ticket.count({ where: { createdAt: range } }),
      this.prisma.ticket.count({ where: { status: { notIn: ['RESOLVED','CLOSED'] } } }),
    ]);

    // Hydrate group names
    const [categories, stores, users] = await Promise.all([
      this.prisma.ticketCategory.findMany({ select: { id: true, code: true, name: true } }),
      this.prisma.store.findMany({ select: { id: true, code: true, name: true } }),
      this.prisma.user.findMany({ select: { id: true, fullName: true } }),
    ]);
    const catName = new Map(categories.map((c) => [c.id, `${c.code} — ${c.name}`]));
    const storeName = new Map(stores.map((s) => [s.id, `${s.code} — ${s.name}`]));
    const userName = new Map(users.map((u) => [u.id, u.fullName]));

    // MTTR / MTTFR — averages in minutes
    const durs = (arr: { createdAt: Date; end: Date | null }[]) => {
      const nums = arr.map((r) => r.end ? (r.end.getTime() - r.createdAt.getTime()) / 60_000 : null)
                      .filter((v): v is number => v !== null);
      if (!nums.length) return { avg: 0, count: 0 };
      return { avg: Math.round(nums.reduce((a,b) => a+b, 0) / nums.length), count: nums.length };
    };
    const mttrByPriority: Record<string, { avg: number; count: number }> = {};
    const mttfrByPriority: Record<string, { avg: number; count: number }> = {};
    for (const p of ['P1','P2','P3','P4']) {
      const rows = resolved.filter((t) => t.priority === p);
      mttrByPriority[p]  = durs(rows.map((r) => ({ createdAt: r.createdAt, end: r.resolvedAt })));
      mttfrByPriority[p] = durs(rows.map((r) => ({ createdAt: r.createdAt, end: r.firstResponseAt })));
    }

    const responseSla = all.length ? Math.round(((all.length - all.filter((t) => t.slaBreachedResponse).length) / all.length) * 100) : 100;
    const resolveSla  = all.length ? Math.round(((all.length - all.filter((t) => t.slaBreachedResolve).length) / all.length) * 100) : 100;

    // Daily trend
    const days: Record<string, { created: number; resolved: number }> = {};
    for (const t of all) {
      const d = t.createdAt.toISOString().slice(0, 10);
      (days[d] = days[d] ?? { created: 0, resolved: 0 }).created++;
    }
    for (const t of resolved) {
      const d = t.resolvedAt!.toISOString().slice(0, 10);
      (days[d] = days[d] ?? { created: 0, resolved: 0 }).resolved++;
    }
    const trend = Object.entries(days)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({ date, ...v }));

    // ---- Technician scorecard: for each tech, open/closed/avg-MTTR/sla% ----
    const techIds = byAssignee.map((r) => r.assignedToId).filter((v): v is string => !!v);
    const technicians = await Promise.all(
      techIds.map(async (id) => {
        const [rows, openNow] = await Promise.all([
          this.prisma.ticket.findMany({
            where: { assignedToId: id, createdAt: range },
            select: { createdAt: true, resolvedAt: true, firstResponseAt: true, slaBreachedResponse: true, slaBreachedResolve: true, status: true, satisfactionRating: true },
          }),
          this.prisma.ticket.count({ where: { assignedToId: id, status: { notIn: ['RESOLVED','CLOSED'] } } }),
        ]);
        const resolved = rows.filter((r) => r.resolvedAt);
        const mttr = resolved.length
          ? Math.round(resolved.reduce((s, r) => s + ((r.resolvedAt!.getTime() - r.createdAt.getTime()) / 60_000), 0) / resolved.length)
          : 0;
        const breached = rows.filter((r) => r.slaBreachedResolve || r.slaBreachedResponse).length;
        const slaPct = rows.length ? Math.round(((rows.length - breached) / rows.length) * 100) : 100;
        const rated = rows.filter((r) => r.satisfactionRating !== null);
        const avgRating = rated.length
          ? +(rated.reduce((s, r) => s + (r.satisfactionRating ?? 0), 0) / rated.length).toFixed(2)
          : null;
        return {
          userId: id, name: userName.get(id) ?? '—',
          total: rows.length, openNow, resolved: resolved.length,
          mttrMinutes: mttr, slaPercent: slaPct,
          avgSatisfaction: avgRating, ratedCount: rated.length,
        };
      }),
    );

    // ---- Common issues: tokenize subjects, strip stopwords, top-N ----
    const subjects = await this.prisma.ticket.findMany({
      where: { createdAt: range }, select: { subject: true, categoryId: true },
    });
    const stop = new Set(['the','and','for','not','with','our','your','this','that','there','they','them','are','was','has','have','will','can','cant','will','when','what','why','how','who','which','just','only','from','into','out','off','very','been','also','its','it','on','at','in','of','to','a','is','or','as','if','by','be','an','my','me']);
    const tokens: Record<string, number> = {};
    for (const s of subjects) {
      for (const raw of (s.subject ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
        const w = raw.trim();
        if (w.length < 3 || stop.has(w)) continue;
        tokens[w] = (tokens[w] ?? 0) + 1;
      }
    }
    const commonTerms = Object.entries(tokens)
      .map(([term, count]) => ({ term, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);

    // ---- Satisfaction summary ----
    const satRows = await this.prisma.ticket.findMany({
      where: { createdAt: range, satisfactionRating: { not: null } },
      select: { satisfactionRating: true },
    });
    const satBuckets = [1,2,3,4,5].map((n) => ({ rating: n, count: satRows.filter((r) => r.satisfactionRating === n).length }));
    const satAvg = satRows.length
      ? +(satRows.reduce((s, r) => s + (r.satisfactionRating ?? 0), 0) / satRows.length).toFixed(2)
      : null;

    // ---- Reopen stats ----
    const reopens = await this.prisma.ticket.findMany({
      where: { createdAt: range, reopenCount: { gt: 0 } },
      select: { code: true, subject: true, reopenCount: true, priority: true, assignedToId: true },
      orderBy: { reopenCount: 'desc' },
      take: 20,
    });

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      totals: { inRange: totalCount, openNow: openCount },
      byStatus:   byStatus.map((r) => ({ status: r.status, count: r._count._all })),
      byPriority: byPriority.map((r) => ({ priority: r.priority, count: r._count._all })),
      byCategory: byCategory.map((r) => ({ categoryId: r.categoryId, name: catName.get(r.categoryId), count: r._count._all }))
                            .sort((a, b) => b.count - a.count),
      byStore:    byStore.map((r) => ({ storeId: r.storeId, name: r.storeId ? storeName.get(r.storeId) : 'HQ / No store', count: r._count._all }))
                         .sort((a, b) => b.count - a.count),
      byAssignee: byAssignee.map((r) => ({ userId: r.assignedToId, name: r.assignedToId ? userName.get(r.assignedToId) : 'Unassigned', count: r._count._all }))
                            .sort((a, b) => b.count - a.count),
      mttrByPriority, mttfrByPriority,
      sla: { responsePercent: responseSla, resolvePercent: resolveSla },
      trend,

      // v2 additions
      technicians: technicians.sort((a, b) => b.total - a.total),
      commonIssues: commonTerms,
      satisfaction: { average: satAvg, buckets: satBuckets, totalRatings: satRows.length },
      topReopens: reopens.map((r) => ({ ...r, assignee: r.assignedToId ? userName.get(r.assignedToId) : null })),
    };
  }
}
