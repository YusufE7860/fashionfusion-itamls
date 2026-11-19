import {
  BadRequestException, Body, Controller, Get, Param, Patch, Post, Query,
  Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PortalScopeService, computePresence } from './portal.service';
import { NotifyService } from '../notify/notify.service';

/**
 * Store Portal API.
 *
 * Mounted at /portal, all routes auth-required. Every route resolves the
 * caller's accessible stores via PortalScopeService and filters by that.
 *
 * Role gate: controller rejects anyone whose role is not STORE_MANAGER or
 * AREA_MANAGER. Admins + technicians use the main app; they don't need this
 * portal and letting them in would silently narrow their view to scope they
 * don't have.
 *
 * Shape of a portal user ("me"):
 *   {
 *     userId, fullName, email, role,
 *     stores: [{ id, code, name }],          // every store they can see
 *     isMultiStore: boolean                  // area manager / 2IC
 *   }
 */
@UseGuards(JwtAuthGuard)
@Controller('portal')
export class PortalController {
  constructor(
    private prisma: PrismaService,
    private scope: PortalScopeService,
    private notify: NotifyService,
  ) {}

  // ---------- Identity + scope ----------

  @Get('me')
  async me(@Req() req: any) {
    const userId = req.user?.sub as string;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, fullName: true, email: true,
        role: { select: { code: true, name: true } },
      },
    });
    if (!user) throw new BadRequestException('user not found');
    this.requirePortalRole(user.role?.code);

    const storeIds = await this.scope.storeIdsForUser(userId);
    const stores = storeIds.length
      ? await this.prisma.store.findMany({
          where: { id: { in: storeIds } },
          select: { id: true, code: true, name: true, region: true, entity: true },
          orderBy: { code: 'asc' },
        })
      : [];

    // Weekend on-call: if today is Sat or Sun, surface whoever's covering
    // the shift so the store knows which cell number to try. Falls through
    // to null during the week (regular assigned tech handles it).
    const onCall = await this.resolveWeekendOnCall(storeIds);

    // Default IT contact: the technician routed for this store's area (via
    // AreaManager.assignedTechId). Shown in the "Your IT Contact" widget
    // when nothing else is more relevant (no open calls, not a weekend).
    // That way the store ALWAYS has a human to reach out to.
    const defaultContact = await this.resolveDefaultTech(storeIds);

    return {
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role?.code,
      roleName: user.role?.name,
      stores,
      isMultiStore: stores.length > 1,
      onCall,          // weekend on-call tech, or null
      defaultContact,  // general IT contact for this area, or null
    };
  }

  /** Resolve the "regular" tech who covers these stores on a normal weekday:
   *  the User.id stored on AreaManager.assignedTechId. Picks the first match
   *  across the user's stores. Falls back to any active TECHNICIAN / IT_MANAGER
   *  so the widget is never empty. */
  private async resolveDefaultTech(storeIds: string[]) {
    if (!storeIds.length) return null;

    const stores = await this.prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: {
        areaManager: {
          select: {
            assignedTech: {
              select: {
                id: true, fullName: true, email: true, phone: true,
                lastActiveAt: true, presenceStatus: true, presenceSetAt: true,
                role: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    for (const s of stores) {
      const t = s.areaManager?.assignedTech;
      if (t) return {
        id: t.id, fullName: t.fullName, email: t.email, phone: t.phone,
        roleName: t.role?.name ?? 'IT',
        presence: computePresence(t),
      };
    }

    // Fallback - any active IT user so the widget never comes up blank.
    const any = await this.prisma.user.findFirst({
      where: { isActive: true, role: { code: { in: ['IT_MANAGER', 'TECHNICIAN', 'ADMINISTRATOR'] } } },
      select: {
        id: true, fullName: true, email: true, phone: true,
        lastActiveAt: true, presenceStatus: true, presenceSetAt: true,
        role: { select: { name: true } },
      },
      orderBy: { role: { code: 'asc' } },  // IT_MANAGER before TECHNICIAN
    });
    if (!any) return null;
    return {
      id: any.id, fullName: any.fullName, email: any.email, phone: any.phone,
      roleName: any.role?.name ?? 'IT',
      presence: computePresence(any),
    };
  }

  /** Current user sets or clears their own presence (BUSY / LUNCH / AWAY /
   *  AVAILABLE, or empty/null to go back to auto). Only techs would normally
   *  call this - the portal doesn't offer the control. */
  @Patch('me/presence')
  async setPresence(@Req() req: any, @Body() body: { status?: string | null }) {
    const userId = req.user?.sub as string;
    const next = body.status?.toUpperCase();
    const allowed = ['AVAILABLE','BUSY','LUNCH','AWAY'];
    const data = (next && allowed.includes(next))
      ? { presenceStatus: next, presenceSetAt: new Date() }
      : { presenceStatus: null, presenceSetAt: null };
    await this.prisma.user.update({ where: { id: userId }, data });
    return { ok: true, status: next ?? null };
  }

  /** Find the technician currently on-call for this weekend (Sat/Sun). Returns
   *  null during the week or when no shift covers the current time. Scope
   *  matching: 'ALL' always matches; 'R:XXX' matches region code; 'S:XXX'
   *  matches store code. */
  private async resolveWeekendOnCall(storeIds: string[]) {
    const now = new Date();
    const dow = now.getDay();          // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) return null;

    const stores = storeIds.length ? await this.prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { code: true, regionRef: { select: { code: true } } },
    }) : [];
    const storeCodes  = new Set(stores.map(s => s.code));
    const regionCodes = new Set(stores.map(s => s.regionRef?.code).filter(Boolean));

    const shifts = await this.prisma.onCallShift.findMany({
      where: { startAt: { lte: now }, endAt: { gt: now } },
      include: {
        technician: {
          select: {
            id: true, fullName: true, email: true, phone: true,
            lastActiveAt: true, presenceStatus: true, presenceSetAt: true,
          },
        },
      },
    });

    for (const s of shifts) {
      const scopeOk = s.scope === 'ALL'
        || s.scope.split(',').map(x => x.trim()).some(tok => {
          if (tok.startsWith('R:')) return regionCodes.has(tok.slice(2));
          if (tok.startsWith('S:')) return storeCodes.has(tok.slice(2));
          return false;
        });
      if (!scopeOk) continue;
      const t = s.technician;
      return {
        id: t.id,
        fullName: t.fullName,
        email: t.email,
        phone: t.phone,
        until: s.endAt,
        notes: s.notes,
        presence: computePresence(t),
      };
    }
    return null;
  }

  // ---------- Issue catalog ----------

  /** The list of issues a store can pick from when logging a call.
   *  Pulls from TicketCategory (already seeded with ~30 Fashion Fusion
   *  issues + defaultPriority + issueTemplate). We expose only active
   *  entries, sorted by sortOrder for consistent ordering. */
  @Get('issue-types')
  async issueTypes(@Req() req: any) {
    this.requirePortalRole((req.user?.role ?? '').toUpperCase());
    const rows = await this.prisma.ticketCategory.findMany({
      where: { isActive: true },
      select: {
        id: true, code: true, name: true, description: true,
        defaultPriority: true, issueTemplate: true, sortOrder: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows;
  }

  // ---------- Tickets (calls) ----------

  /** List tickets scoped to the user's stores.
   * Query: status=open|in_progress|closed|all (default open)
   */
  @Get('tickets')
  async listTickets(@Req() req: any, @Query('status') status: string = 'open') {
    const userId = req.user?.sub as string;
    const storeIds = await this.ensureScope(userId, req);
    if (!storeIds.length) return [];

    const statusFilter = ticketStatusFilter(status);

    const rows = await this.prisma.ticket.findMany({
      where: {
        storeId: { in: storeIds },
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      select: {
        id: true, code: true, subject: true, status: true, priority: true,
        createdAt: true, updatedAt: true, firstResponseAt: true,
        store: { select: { code: true, name: true } },
        assignedTo: {
          select: {
            id: true, fullName: true, email: true, phone: true,
            lastActiveAt: true, presenceStatus: true, presenceSetAt: true,
            role: { select: { code: true, name: true } },
          },
        },
        category: { select: { name: true } },
        // Last external-visible comment for the "Last update from IT" preview
        comments: {
          where: { isInternal: false },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, createdAt: true, author: { select: { fullName: true } } },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 300,
    });

    // Attach computed presence to the assigned tech so the UI doesn't need
    // to recompute it from timestamps itself.
    return rows.map(t => ({
      ...t,
      assignedTo: t.assignedTo ? {
        id: t.assignedTo.id,
        fullName: t.assignedTo.fullName,
        email: t.assignedTo.email,
        phone: t.assignedTo.phone,
        roleName: t.assignedTo.role?.name,
        presence: computePresence(t.assignedTo),
      } : null,
      lastUpdate: t.comments[0] ?? null,
      comments: undefined,
    }));
  }

  /** Create a ticket (call).
   *  New flow: the portal picks a categoryId from the issue catalog, and we
   *  derive subject + priority from that category. Caller can override
   *  priority (admin-set) or subject (free text) but neither is required. */
  @Post('tickets')
  async createTicket(
    @Req() req: any,
    @Body() body: {
      storeId: string;
      categoryId: string;         // now required - picked from issue catalog
      description?: string;        // the structured answers from issueTemplate
      subject?: string;            // optional override
      priority?: string;           // optional override
    },
  ) {
    const userId = req.user?.sub as string;
    await this.ensureScope(userId, req);
    if (!body.storeId) throw new BadRequestException('storeId is required');
    if (!body.categoryId) throw new BadRequestException('categoryId is required - pick an issue');
    await this.scope.requireStoreAccess(userId, body.storeId);

    const cat = await this.prisma.ticketCategory.findUnique({
      where: { id: body.categoryId },
      select: { id: true, name: true, defaultPriority: true, isActive: true },
    });
    if (!cat || !cat.isActive) throw new BadRequestException('issue not found or inactive');

    // Priority: explicit override wins, else category's defaultPriority.
    const priorityMap: Record<string, string> = {
      LOW: 'P4', MEDIUM: 'P3', HIGH: 'P2', CRITICAL: 'P1',
      P1: 'P1', P2: 'P2', P3: 'P3', P4: 'P4',
    };
    const priority = body.priority
      ? (priorityMap[body.priority.toUpperCase()] ?? cat.defaultPriority)
      : cat.defaultPriority;

    // Subject: explicit override wins, else category name so techs see a
    // readable one-liner in the queue.
    const subject = (body.subject?.trim() || cat.name).slice(0, 200);

    const code = await nextCode(this.prisma, 'TKT');
    const ticket = await this.prisma.ticket.create({
      data: {
        code, subject,
        description: body.description?.trim().slice(0, 4000) ?? '',
        storeId: body.storeId,
        reporterId: userId,
        priority,
        status: 'NEW',
        categoryId: cat.id,
        source: 'APP',
      },
      select: { id: true, code: true, subject: true, status: true, priority: true },
    });

    // Fire-and-forget notification. Routing resolves assigned tech and pushes
    // to all their registered devices. Failure here never blocks ticket create.
    try {
      await this.notify?.notifyNewTicket(ticket.id);
    } catch { /* silent */ }

    return ticket;
  }

  /** Single ticket detail - comments, events. */
  @Get('tickets/:id')
  async ticketDetail(@Req() req: any, @Param('id') id: string) {
    const userId = req.user?.sub as string;
    const storeIds = await this.ensureScope(userId, req);
    const t = await this.prisma.ticket.findFirst({
      where: { id, storeId: { in: storeIds } },
      include: {
        store: { select: { code: true, name: true } },
        assignedTo: { select: { fullName: true } },
        reporter:   { select: { fullName: true } },
        comments: {
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, body: true, createdAt: true,
            author: { select: { fullName: true } },
          },
        },
      },
    });
    if (!t) throw new BadRequestException('ticket not found or outside scope');
    return t;
  }

  // ---------- Repairs ----------

  @Get('repairs')
  async listRepairs(@Req() req: any, @Query('status') status: string = 'open') {
    const userId = req.user?.sub as string;
    const storeIds = await this.ensureScope(userId, req);
    if (!storeIds.length) return [];

    const where: any = { storeId: { in: storeIds } };
    if (status === 'open') {
      where.status = { notIn: ['REPLACED', 'WRITTEN_OFF', 'CANCELLED', 'RETURNED'] };
    } else if (status === 'closed') {
      where.status = { in: ['REPLACED', 'WRITTEN_OFF', 'CANCELLED', 'RETURNED'] };
    }

    return this.prisma.repair.findMany({
      where,
      select: {
        id: true, code: true, status: true,
        itemDescription: true, faultDesc: true,
        technicianName: true, waybillNumber: true,
        dispatchedDate: true, returnedDate: true,
        createdAt: true, updatedAt: true,
        store:     { select: { code: true, name: true } },
        asset:     { select: { assetTag: true, serialNo: true } },
        supplier:  { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  @Post('repairs')
  async createRepair(
    @Req() req: any,
    @Body() body: {
      storeId: string;
      assetId?: string;
      itemDescription?: string;
      faultDesc: string;
      technicianName?: string;
      waybillNumber?: string;
      dispatchedDate?: string;   // ISO date
    },
  ) {
    const userId = req.user?.sub as string;
    await this.ensureScope(userId, req);
    if (!body.storeId || !body.faultDesc?.trim()) {
      throw new BadRequestException('storeId and faultDesc are required');
    }
    if (!body.assetId && !body.itemDescription?.trim()) {
      throw new BadRequestException('either assetId or itemDescription required');
    }
    await this.scope.requireStoreAccess(userId, body.storeId);

    const code = await nextCode(this.prisma, 'RPR');
    const dispatched = body.dispatchedDate ? new Date(body.dispatchedDate) : null;
    const initialStatus = dispatched ? 'COLLECTED' : 'LOGGED';

    return this.prisma.repair.create({
      data: {
        code,
        storeId: body.storeId,
        reportedById: userId,
        assetId: body.assetId ?? null,
        itemDescription: body.itemDescription?.trim().slice(0, 300) ?? null,
        faultDesc: body.faultDesc.trim().slice(0, 2000),
        technicianName: body.technicianName?.trim().slice(0, 120) ?? null,
        waybillNumber: body.waybillNumber?.trim().slice(0, 80) ?? null,
        dispatchedDate: dispatched,
        status: initialStatus,
      },
      select: { id: true, code: true, status: true },
    });
  }

  @Patch('repairs/:id')
  async updateRepair(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: Partial<{
      technicianName: string;
      waybillNumber: string;
      dispatchedDate: string;
      returnedDate: string;
      resolutionNotes: string;
      status: string;
    }>,
  ) {
    const userId = req.user?.sub as string;
    const storeIds = await this.ensureScope(userId, req);
    const existing = await this.prisma.repair.findFirst({
      where: { id, storeId: { in: storeIds } },
      select: { id: true },
    });
    if (!existing) throw new BadRequestException('repair not found or outside scope');

    return this.prisma.repair.update({
      where: { id },
      data: {
        ...(body.technicianName  !== undefined && { technicianName:  body.technicianName.trim().slice(0, 120) }),
        ...(body.waybillNumber   !== undefined && { waybillNumber:   body.waybillNumber.trim().slice(0, 80) }),
        ...(body.dispatchedDate  !== undefined && { dispatchedDate:  body.dispatchedDate ? new Date(body.dispatchedDate) : null }),
        ...(body.returnedDate    !== undefined && { returnedDate:    body.returnedDate ? new Date(body.returnedDate) : null }),
        ...(body.resolutionNotes !== undefined && { resolutionNotes: body.resolutionNotes.trim().slice(0, 2000) }),
        ...(body.status          !== undefined && { status: body.status.toUpperCase() }),
      },
    });
  }

  // ---------- Assets ----------

  /** Asset register for the user's stores.
   *  Asset facts (manufacturer, model, category) come from the linked Sku -
   *  Asset itself just has tag/serial and location. We flatten the response
   *  so the portal UI can render without knowing about Sku indirection.
   */
  @Get('assets')
  async listAssets(@Req() req: any, @Query('search') search?: string) {
    const userId = req.user?.sub as string;
    const storeIds = await this.ensureScope(userId, req);
    if (!storeIds.length) return [];

    const where: any = { assignedStoreId: { in: storeIds } };
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { assetTag: { contains: q, mode: 'insensitive' } },
        { serialNo: { contains: q, mode: 'insensitive' } },
        { hostname: { contains: q, mode: 'insensitive' } },
        { sku: { OR: [
          { model:        { contains: q, mode: 'insensitive' } },
          { manufacturer: { contains: q, mode: 'insensitive' } },
          { name:         { contains: q, mode: 'insensitive' } },
        ] } },
      ];
    }

    const rows = await this.prisma.asset.findMany({
      where,
      select: {
        id: true, assetTag: true, serialNo: true, status: true, condition: true,
        purchaseDate: true, warrantyExpiry: true, hostname: true,
        sku: {
          select: {
            manufacturer: true, model: true, name: true,
            category: { select: { name: true } },
          },
        },
        assignedStore: { select: { code: true, name: true } },
        assignedUser:  { select: { fullName: true } },
      },
      orderBy: [{ assetTag: 'asc' }],
      take: 500,
    });

    // Flatten sku fields so the UI doesn't need to know about the indirection.
    return rows.map(a => ({
      id: a.id,
      assetNumber:  a.assetTag,
      serialNumber: a.serialNo,
      hostname:     a.hostname,
      manufacturer: a.sku?.manufacturer,
      model:        a.sku?.model ?? a.sku?.name,
      status:       a.status,
      condition:    a.condition,
      purchaseDate: a.purchaseDate,
      warrantyExpiry: a.warrantyExpiry,
      category: a.sku?.category ? { name: a.sku.category.name } : null,
      store: a.assignedStore ? { code: a.assignedStore.code, name: a.assignedStore.name } : null,
      assignedUser: a.assignedUser,
    }));
  }

  // ---------- Internal helpers ----------

  private async ensureScope(userId: string, req: any): Promise<string[]> {
    const role = (req.user?.role ?? '').toUpperCase();
    this.requirePortalRole(role);
    return this.scope.storeIdsForUser(userId);
  }

  private requirePortalRole(roleCode: string | undefined) {
    if (!roleCode) throw new BadRequestException('role missing on token');
    if (!['STORE_MANAGER', 'AREA_MANAGER'].includes(roleCode.toUpperCase())) {
      throw new BadRequestException(
        'the store portal is for STORE_MANAGER / AREA_MANAGER only - use the main app',
      );
    }
  }
}

// Map UI-friendly status words to the ticket status values used in DB.
// Schema values: NEW | ASSIGNED | IN_PROGRESS | WAITING_ON_USER | RESOLVED | CLOSED | REOPENED
function ticketStatusFilter(s: string): any | null {
  switch (s.toLowerCase()) {
    case 'open':        return { in: ['NEW', 'ASSIGNED', 'REOPENED'] };
    case 'in_progress': return { in: ['IN_PROGRESS', 'WAITING_ON_USER'] };
    case 'closed':      return { in: ['RESOLVED', 'CLOSED'] };
    case 'all':         return null;
    default:            return null;
  }
}

/** Mint the next sequential code. Cheap and collision-safe for our scale. */
async function nextCode(prisma: PrismaService, prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const likeRoot = `${prefix}-${year}-`;
  const latest = prefix === 'TKT'
    ? await prisma.ticket.findFirst({
        where: { code: { startsWith: likeRoot } },
        orderBy: { code: 'desc' }, select: { code: true },
      })
    : await prisma.repair.findFirst({
        where: { code: { startsWith: likeRoot } },
        orderBy: { code: 'desc' }, select: { code: true },
      });
  const n = latest ? parseInt(latest.code.slice(likeRoot.length), 10) + 1 : 1;
  return `${likeRoot}${String(n).padStart(5, '0')}`;
}
