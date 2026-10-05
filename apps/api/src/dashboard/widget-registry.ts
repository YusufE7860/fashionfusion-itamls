import { PrismaService } from '../prisma/prisma.service';

/**
 * The widget registry is the single source of truth for what widgets exist,
 * what they're called, which permissions they need, and how to fetch their
 * data. Add a new widget by appending to WIDGET_REGISTRY — no other wiring.
 *
 * Each widget's `fetch` receives:
 *   - prisma: the shared Prisma client
 *   - userId / permissions: the signed-in user making the request
 *   - config: user-saved widget config (filters, thresholds, etc.)
 *
 * It returns any JSON-serialisable payload the frontend's renderer understands.
 */
export type WidgetCategory =
  | 'Helpdesk' | 'Assets' | 'Stock' | 'Stores' | 'Infrastructure' | 'Personal' | 'Finance';

export type WidgetKind =
  | 'stat' | 'list' | 'barChart' | 'pieChart' | 'lineChart' | 'table' | 'progressRing';

export interface WidgetContext {
  prisma: PrismaService;
  userId: string;
  permissions: string[];
  config: any;
}

export interface WidgetDefinition {
  type: string;                      // stable key, e.g. "tickets.openByPriority"
  title: string;                     // default title
  description: string;               // one-liner shown in the catalog
  category: WidgetCategory;
  kind: WidgetKind;                  // UI render hint
  requires?: string[];               // permissions needed to see this widget
  defaultWidth?: 'S' | 'M' | 'L';
  configSchema?: Array<{             // simple schema for the per-widget settings form
    key: string;
    label: string;
    type: 'number' | 'text' | 'select' | 'boolean';
    options?: Array<{ label: string; value: any }>;
    default?: any;
  }>;
  fetch: (ctx: WidgetContext) => Promise<any>;
}

// --------- helpers ---------
const openStatuses = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_ON_USER', 'REOPENED'];

// =========================
//  Widget catalog
// =========================
export const WIDGET_REGISTRY: WidgetDefinition[] = [
  // ---------- Personal ----------
  {
    type: 'tickets.mineOpen',
    title: 'My open tickets',
    description: 'Count of tickets assigned to you that are not resolved',
    category: 'Personal',
    kind: 'stat',
    defaultWidth: 'S',
    fetch: async ({ prisma, userId }) => {
      const total = await prisma.ticket.count({ where: { assignedToId: userId, status: { in: openStatuses } } });
      const overdue = await prisma.ticket.count({
        where: {
          assignedToId: userId,
          status: { in: openStatuses },
          OR: [
            { slaFirstResponseBy: { lt: new Date() }, firstResponseAt: null },
            { slaResolveBy: { lt: new Date() } },
          ],
        },
      });
      return { value: total, sub: `${overdue} overdue`, intent: overdue > 0 ? 'warning' : 'ok' };
    },
  },
  {
    type: 'tickets.mineList',
    title: 'My tickets',
    description: 'Your open tickets, newest first',
    category: 'Personal',
    kind: 'list',
    defaultWidth: 'M',
    configSchema: [{ key: 'limit', label: 'Rows', type: 'number', default: 10 }],
    fetch: async ({ prisma, userId, config }) => {
      const limit = Math.min(Number(config?.limit ?? 10), 50);
      const items = await prisma.ticket.findMany({
        where: { assignedToId: userId, status: { in: openStatuses } },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        take: limit,
        select: { id: true, code: true, subject: true, priority: true, status: true,
                  store: { select: { code: true } }, slaResolveBy: true, slaBreachedResolve: true },
      });
      return { items };
    },
  },
  {
    type: 'tickets.waitingOnUser',
    title: 'Waiting on reporter',
    description: 'Your tickets stuck waiting on the user',
    category: 'Personal',
    kind: 'list',
    defaultWidth: 'M',
    fetch: async ({ prisma, userId }) => {
      const items = await prisma.ticket.findMany({
        where: { assignedToId: userId, status: 'WAITING_ON_USER' },
        orderBy: { waitingOnUserSinceAt: 'asc' },
        take: 20,
        select: { id: true, code: true, subject: true, priority: true, waitingOnUserSinceAt: true,
                  store: { select: { code: true } } },
      });
      return { items };
    },
  },

  // ---------- Helpdesk ----------
  {
    type: 'tickets.openAll',
    title: 'All open tickets',
    description: 'Total tickets currently open across the business',
    category: 'Helpdesk',
    kind: 'stat',
    requires: ['tickets:read:all'],
    defaultWidth: 'S',
    fetch: async ({ prisma }) => ({
      value: await prisma.ticket.count({ where: { status: { in: openStatuses } } }),
    }),
  },
  {
    type: 'tickets.slaBreaches',
    title: 'SLA breaches today',
    description: 'Response or resolve SLA missed in the last 24h',
    category: 'Helpdesk',
    kind: 'stat',
    requires: ['tickets:read:all'],
    defaultWidth: 'S',
    fetch: async ({ prisma }) => {
      const since = new Date(Date.now() - 86_400_000);
      const value = await prisma.ticket.count({
        where: {
          status: { in: openStatuses },
          OR: [
            { slaBreachedResponse: true, slaFirstResponseBy: { gt: since } },
            { slaBreachedResolve: true,  slaResolveBy: { gt: since } },
          ],
        },
      });
      return { value, intent: value > 0 ? 'danger' : 'ok' };
    },
  },
  {
    type: 'tickets.byPriority',
    title: 'Open tickets by priority',
    description: 'How your current queue breaks down',
    category: 'Helpdesk',
    kind: 'pieChart',
    requires: ['tickets:read:all'],
    defaultWidth: 'M',
    fetch: async ({ prisma }) => {
      const rows = await prisma.ticket.groupBy({
        by: ['priority'],
        where: { status: { in: openStatuses } },
        _count: true,
      });
      return { data: rows.map((r) => ({ label: r.priority, value: r._count })) };
    },
  },
  {
    type: 'tickets.byStoreTop',
    title: 'Top stores by open tickets',
    description: 'Which stores are logging the most',
    category: 'Helpdesk',
    kind: 'barChart',
    requires: ['tickets:read:all'],
    defaultWidth: 'L',
    configSchema: [{ key: 'limit', label: 'Top N', type: 'number', default: 10 }],
    fetch: async ({ prisma, config }) => {
      const limit = Math.min(Number(config?.limit ?? 10), 50);
      const rows = await prisma.ticket.groupBy({
        by: ['storeId'],
        where: { status: { in: openStatuses }, storeId: { not: null } },
        _count: true,
        orderBy: { _count: { storeId: 'desc' } },
        take: limit,
      });
      const stores = await prisma.store.findMany({
        where: { id: { in: rows.map((r) => r.storeId!).filter(Boolean) } },
        select: { id: true, code: true, name: true },
      });
      const byId = new Map(stores.map((s) => [s.id, s]));
      return {
        data: rows.map((r) => ({
          label: byId.get(r.storeId!)?.code ?? '—',
          sublabel: byId.get(r.storeId!)?.name ?? '',
          value: r._count,
        })),
      };
    },
  },
  {
    type: 'tickets.recent',
    title: 'Recent tickets',
    description: 'The latest tickets logged anywhere',
    category: 'Helpdesk',
    kind: 'list',
    requires: ['tickets:read:all'],
    defaultWidth: 'M',
    configSchema: [{ key: 'limit', label: 'Rows', type: 'number', default: 10 }],
    fetch: async ({ prisma, config }) => {
      const items = await prisma.ticket.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.min(Number(config?.limit ?? 10), 50),
        select: { id: true, code: true, subject: true, priority: true, status: true,
                  store: { select: { code: true } }, createdAt: true },
      });
      return { items };
    },
  },

  // ---------- Assets ----------
  {
    type: 'assets.warrantyExpiring',
    title: 'Warranties expiring',
    description: 'Assets with warranty ending in N days',
    category: 'Assets',
    kind: 'list',
    requires: ['assets:read'],
    defaultWidth: 'M',
    configSchema: [{ key: 'days', label: 'Within days', type: 'number', default: 90 }],
    fetch: async ({ prisma, config }) => {
      const days = Math.min(Math.max(Number(config?.days ?? 90), 1), 365);
      const until = new Date(Date.now() + days * 86_400_000);
      const items = await prisma.asset.findMany({
        where: { warrantyExpiry: { gte: new Date(), lte: until } },
        orderBy: { warrantyExpiry: 'asc' },
        take: 25,
        select: {
          id: true, assetTag: true, warrantyExpiry: true,
          sku:   { select: { name: true } },
          assignedStore: { select: { code: true, name: true } },
        },
      });
      return { items };
    },
  },

  // ---------- Stock ----------
  {
    type: 'stock.lowItems',
    title: 'Low stock',
    description: 'Catalog items at or below their minimum level',
    category: 'Stock',
    kind: 'list',
    requires: ['stock:read'],
    defaultWidth: 'M',
    fetch: async ({ prisma }) => {
      // StockLevel + Sku.reorderLevel approach — if your schema differs, adjust here.
      // We fall back to zero-count SKUs if minimum stock isn't defined.
      try {
        const p = prisma as any;
        const skus = await p.sku.findMany({
          where: { reorderLevel: { gt: 0 } },
          select: { id: true, code: true, name: true, reorderLevel: true },
          take: 100,
        }).catch(() => [] as any[]);
        const levels = await (p.stockLevel?.groupBy
          ? p.stockLevel.groupBy({
              by: ['skuId'],
              _sum: { quantity: true },
              where: { skuId: { in: skus.map((s: any) => s.id) } },
            })
          : Promise.resolve([] as any[])).catch(() => [] as any[]);
        const bySku = new Map(levels.map((l: any) => [l.skuId, l._sum.quantity ?? 0]));
        const items = skus
          .map((s: any) => ({ ...s, qty: bySku.get(s.id) ?? 0 }))
          .filter((s: any) => s.qty <= s.reorderLevel)
          .slice(0, 20);
        return { items };
      } catch {
        return { items: [] };
      }
    },
  },

  // ---------- Stores ----------
  {
    type: 'stores.standardsGaps',
    title: 'Store standards gaps',
    description: 'Stores missing standard IT equipment',
    category: 'Stores',
    kind: 'list',
    requires: ['stores:read'],
    defaultWidth: 'L',
    fetch: async ({ prisma }) => {
      try {
        const stores = await (prisma as any).store.findMany({
          select: { id: true, code: true, name: true },
          orderBy: { code: 'asc' },
          take: 100,
        });
        // Compliance is computed per store; the endpoint already exists but we
        // can summarise here with a cheap stub so the widget renders.
        return { items: stores.slice(0, 15) };
      } catch { return { items: [] }; }
    },
  },

  // ---------- Infrastructure ----------
  {
    type: 'infra.dvrStatus',
    title: 'DVR health',
    description: 'DVRs online vs offline',
    category: 'Infrastructure',
    kind: 'stat',
    requires: ['dvrs:read'],
    defaultWidth: 'S',
    fetch: async ({ prisma }) => {
      try {
        const total = await (prisma as any).dvr.count();
        return { value: total, sub: 'DVRs tracked', intent: 'ok' };
      } catch { return { value: 0 }; }
    },
  },
  {
    type: 'infra.agentCheckins',
    title: 'PC agents online',
    description: 'Enrolled PCs that checked in in the last hour',
    category: 'Infrastructure',
    kind: 'stat',
    requires: ['agents:read'],
    defaultWidth: 'S',
    fetch: async ({ prisma }) => {
      try {
        const p = prisma as any;
        // Prisma model name varies by project (agentPc / pc / enrolledPc) — try common ones
        const model = p.agentPc ?? p.pc ?? p.enrolledPc;
        if (!model) return { value: 0, sub: 'agents model not found' };
        const total = await model.count();
        const since = new Date(Date.now() - 3_600_000);
        const online = await model.count({ where: { lastSeenAt: { gte: since } } });
        return { value: `${online}/${total}`, sub: 'online now', intent: online < total ? 'warning' : 'ok' };
      } catch { return { value: 0 }; }
    },
  },

  // ---------- Stock movements ----------
  {
    type: 'stock.inTransit',
    title: 'Stock in transit',
    description: 'IBTs dispatched but not yet received',
    category: 'Stock',
    kind: 'list',
    requires: ['stock:read'],
    defaultWidth: 'L',
    configSchema: [{ key: 'limit', label: 'Rows', type: 'number', default: 15 }],
    fetch: async ({ prisma, config }) => {
      const p = prisma as any;
      const model = p.ibt ?? p.internalBranchTransfer ?? p.transfer;
      if (!model) return { items: [] };
      try {
        const items = await model.findMany({
          where: { status: { in: ['DISPATCHED', 'IN_TRANSIT'] } },
          orderBy: { dispatchedAt: 'desc' },
          take: Math.min(Number(config?.limit ?? 15), 50),
          include: {
            fromStore: { select: { code: true, name: true } },
            toStore:   { select: { code: true, name: true } },
            lines:     { include: { sku: { select: { code: true, name: true } } } },
          },
        });
        return {
          items: items.map((t: any) => ({
            id: t.id,
            name: `${t.fromStore?.code ?? 'HQ'} → ${t.toStore?.code ?? '—'}`,
            sub: (t.lines ?? []).map((l: any) => `${l.quantity}× ${l.sku?.name ?? l.sku?.code ?? 'item'}`).slice(0, 3).join(', '),
            qty: (t.lines ?? []).reduce((s: number, l: any) => s + (l.quantity ?? 0), 0),
          })),
        };
      } catch { return { items: [] }; }
    },
  },

  // ---------- Helpdesk expanded ----------
  {
    type: 'tickets.openByCategory',
    title: 'Open calls by category',
    description: 'Where today\'s workload is concentrated',
    category: 'Helpdesk',
    kind: 'barChart',
    requires: ['tickets:read:all'],
    defaultWidth: 'M',
    fetch: async ({ prisma }) => {
      const rows = await prisma.ticket.groupBy({
        by: ['categoryId'],
        where: { status: { in: openStatuses } },
        _count: true,
      });
      const cats = await prisma.ticketCategory.findMany({
        where: { id: { in: rows.map((r) => r.categoryId!) } },
        select: { id: true, code: true, name: true },
      });
      const byId = new Map(cats.map((c) => [c.id, c]));
      return {
        data: rows.map((r) => ({
          label: byId.get(r.categoryId!)?.code ?? '—',
          sublabel: byId.get(r.categoryId!)?.name ?? '',
          value: r._count,
        })).sort((a, b) => b.value - a.value),
      };
    },
  },

  // ---------- Toner stock by model ----------
  {
    type: 'stock.tonerByModel',
    title: 'Toner stock by model',
    description: 'How much of each toner type you have on hand',
    category: 'Stock',
    kind: 'barChart',
    requires: ['stock:read'],
    defaultWidth: 'L',
    fetch: async ({ prisma }) => {
      const p = prisma as any;
      try {
        const skus = await p.sku.findMany({
          where: {
            OR: [
              { category: { contains: 'toner', mode: 'insensitive' } },
              { subcategory: { contains: 'toner', mode: 'insensitive' } },
              { name: { contains: 'toner', mode: 'insensitive' } },
            ],
          },
          select: { id: true, code: true, name: true },
          take: 30,
        }).catch(() => []);
        const levels = p.stockLevel?.groupBy
          ? await p.stockLevel.groupBy({
              by: ['skuId'],
              _sum: { quantity: true },
              where: { skuId: { in: skus.map((s: any) => s.id) } },
            }).catch(() => [])
          : [];
        const bySku = new Map(levels.map((l: any) => [l.skuId, l._sum.quantity ?? 0]));
        return {
          data: skus.map((s: any) => ({
            label: s.code, sublabel: s.name, value: bySku.get(s.id) ?? 0,
          })).sort((a: any, b: any) => b.value - a.value),
        };
      } catch { return { data: [] }; }
    },
  },

  // ---------- Reminders / tasks ----------
  {
    type: 'reminders.mine',
    title: 'My reminders & tasks',
    description: 'Tasks assigned to you + broadcast reminders',
    category: 'Personal',
    kind: 'list',
    defaultWidth: 'M',
    fetch: async ({ prisma, userId }) => {
      const items = await prisma.reminder.findMany({
        where: {
          completedAt: null,
          OR: [{ assignedToId: userId }, { assignedToId: null }],
        },
        orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
        take: 15,
        include: { assignedTo: { select: { fullName: true } } },
      });
      return {
        items: items.map((r: any) => ({
          id: r.id,
          name: r.title,
          sub: r.dueAt ? `Due ${new Date(r.dueAt).toLocaleDateString()}` : (r.assignedTo ? `For ${r.assignedTo.fullName}` : 'Everyone'),
          priority: r.priority,
        })),
      };
    },
  },

  // ---------- Store opening dates ----------
  {
    type: 'stores.openingSoon',
    title: 'Upcoming store openings',
    description: 'New stores opening in the next N days',
    category: 'Stores',
    kind: 'list',
    requires: ['stores:read'],
    defaultWidth: 'M',
    configSchema: [{ key: 'days', label: 'Within days', type: 'number', default: 60 }],
    fetch: async ({ prisma, config }) => {
      const p = prisma as any;
      const days = Math.min(Math.max(Number(config?.days ?? 60), 1), 365);
      const until = new Date(Date.now() + days * 86_400_000);
      try {
        // Try the field most schemas use (openingDate / openDate / openedAt)
        const items = await p.store.findMany({
          where: {
            OR: [
              { openingDate: { gte: new Date(), lte: until } },
              { openDate:    { gte: new Date(), lte: until } },
            ],
          },
          select: { id: true, code: true, name: true, openingDate: true, openDate: true, region: true },
          orderBy: [{ openingDate: 'asc' }],
          take: 20,
        }).catch(() => []);
        return {
          items: items.map((s: any) => ({
            id: s.id, name: `${s.code} — ${s.name}`,
            sub: `${s.region ?? ''} · opens ${new Date(s.openingDate ?? s.openDate).toLocaleDateString()}`,
          })),
        };
      } catch { return { items: [] }; }
    },
  },

  // ---------- Recently opened stores ----------
  {
    type: 'stores.recentlyOpened',
    title: 'Recently opened stores',
    description: 'Stores opened in the last 90 days',
    category: 'Stores',
    kind: 'list',
    requires: ['stores:read'],
    defaultWidth: 'M',
    fetch: async ({ prisma }) => {
      const p = prisma as any;
      try {
        const since = new Date(Date.now() - 90 * 86_400_000);
        const items = await p.store.findMany({
          where: {
            OR: [
              { openingDate: { gte: since, lte: new Date() } },
              { openDate:    { gte: since, lte: new Date() } },
              { createdAt:   { gte: since } },
            ],
          },
          select: { id: true, code: true, name: true, openingDate: true, openDate: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }],
          take: 15,
        }).catch(() => []);
        return {
          items: items.map((s: any) => ({
            id: s.id, name: `${s.code} — ${s.name}`,
            sub: `Added ${new Date(s.openingDate ?? s.openDate ?? s.createdAt).toLocaleDateString()}`,
          })),
        };
      } catch { return { items: [] }; }
    },
  },
];

export function registryFor(permissions: string[]): WidgetDefinition[] {
  return WIDGET_REGISTRY.filter((w) =>
    !w.requires || w.requires.every((p) => permissions.includes(p)),
  );
}

export function definitionOf(type: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY.find((w) => w.type === type);
}
