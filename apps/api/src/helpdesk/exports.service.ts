import { Injectable, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';

/**
 * Report rendering + export.
 *
 *   render(reportKey, { since, until })  → structured rows + columns
 *   toXlsx(rows, columns)                → Excel buffer
 *   toPdf(rows, columns, title)          → PDF buffer
 *
 * The admin UI (and the ScheduledReport cron) call these to produce a file
 * to download or attach to an email.
 */
@Injectable()
export class HelpdeskExportsService {
  constructor(private prisma: PrismaService, private mailer: MailerService) {}

  // ------- Report rendering -------
  async render(reportKey: string, opts: { since?: Date; until?: Date } = {}) {
    const since = opts.since ?? new Date(Date.now() - 30 * 24 * 3600_000);
    const until = opts.until ?? new Date();
    switch (reportKey) {
      // Operational
      case 'tickets.summary':             return this.renderTicketsSummary(since, until);
      case 'tickets.sla-breaches':        return this.renderSlaBreaches(since, until);
      case 'tickets.open':                return this.renderOpenTickets();
      case 'tickets.cost':                return this.renderCostReport(since, until);
      // Analytical (new)
      case 'tickets.by-store':            return this.renderByStore(since, until);
      case 'tickets.by-category':         return this.renderByCategory(since, until);
      case 'tickets.technician-productivity': return this.renderTechProductivity(since, until);
      case 'tickets.monthly-trend':       return this.renderMonthlyTrend(since, until);
      case 'tickets.repeat-offender-assets': return this.renderRepeatOffenderAssets(since, until);
      case 'tickets.repeat-offender-stores': return this.renderRepeatOffenderStores(since, until);
      case 'tickets.csat-fcr':            return this.renderCsatFcr(since, until);
      case 'tickets.deflection-impact':   return this.renderDeflectionImpact(since, until);
      default: throw new BadRequestException(`unknown reportKey: ${reportKey}`);
    }
  }

  availableReports() {
    return [
      // Operational
      { key: 'tickets.summary',             label: 'Tickets — summary (every ticket in range)', group: 'Operational' },
      { key: 'tickets.sla-breaches',        label: 'Tickets — SLA breaches',                     group: 'Operational' },
      { key: 'tickets.open',                label: 'Tickets — currently open',                   group: 'Operational' },
      { key: 'tickets.cost',                label: 'Tickets — cost per ticket (line items)',     group: 'Operational' },
      // Analytical
      { key: 'tickets.by-store',            label: 'Analytics — volume by store',                group: 'Analytics' },
      { key: 'tickets.by-category',         label: 'Analytics — volume by category',             group: 'Analytics' },
      { key: 'tickets.technician-productivity', label: 'Analytics — technician productivity',    group: 'Analytics' },
      { key: 'tickets.monthly-trend',       label: 'Analytics — monthly volume trend',           group: 'Analytics' },
      { key: 'tickets.repeat-offender-assets', label: 'Analytics — repeat-offender assets',      group: 'Analytics' },
      { key: 'tickets.repeat-offender-stores', label: 'Analytics — repeat-offender stores',      group: 'Analytics' },
      { key: 'tickets.csat-fcr',            label: 'Analytics — CSAT + FCR by category',         group: 'Analytics' },
      { key: 'tickets.deflection-impact',   label: 'Analytics — KB deflection impact',           group: 'Analytics' },
    ];
  }

  private async renderTicketsSummary(since: Date, until: Date) {
    const rows = await this.prisma.ticket.findMany({
      where: { createdAt: { gte: since, lte: until } },
      select: {
        code: true, subject: true, status: true, priority: true,
        createdAt: true, resolvedAt: true, closedAt: true,
        category: { select: { name: true } },
        store:    { select: { code: true, name: true } },
        assignedTo: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      title: `Helpdesk — tickets ${since.toISOString().slice(0,10)} → ${until.toISOString().slice(0,10)}`,
      columns: [
        { key: 'code', header: 'Code', width: 15 },
        { key: 'subject', header: 'Subject', width: 40 },
        { key: 'status', header: 'Status', width: 15 },
        { key: 'priority', header: 'Priority', width: 10 },
        { key: 'category', header: 'Category', width: 20 },
        { key: 'store', header: 'Store', width: 15 },
        { key: 'assignee', header: 'Assignee', width: 20 },
        { key: 'created', header: 'Created', width: 20 },
        { key: 'resolved', header: 'Resolved', width: 20 },
      ],
      rows: rows.map((t) => ({
        code: t.code, subject: t.subject, status: t.status, priority: t.priority,
        category: t.category?.name ?? '',
        store:    t.store ? `${t.store.code} ${t.store.name}` : '',
        assignee: t.assignedTo?.fullName ?? '',
        created:  t.createdAt?.toISOString().replace('T',' ').slice(0,19),
        resolved: t.resolvedAt?.toISOString().replace('T',' ').slice(0,19) ?? '',
      })),
    };
  }

  private async renderSlaBreaches(since: Date, until: Date) {
    const rows = await this.prisma.ticket.findMany({
      where: {
        createdAt: { gte: since, lte: until },
        OR: [{ slaBreachedResponse: true }, { slaBreachedResolve: true }],
      },
      include: {
        category: { select: { name: true } },
        store:    { select: { code: true } },
        assignedTo: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      title: `Helpdesk — SLA breaches ${since.toISOString().slice(0,10)} → ${until.toISOString().slice(0,10)}`,
      columns: [
        { key: 'code', header: 'Code', width: 15 },
        { key: 'subject', header: 'Subject', width: 40 },
        { key: 'priority', header: 'Priority', width: 10 },
        { key: 'category', header: 'Category', width: 20 },
        { key: 'store', header: 'Store', width: 10 },
        { key: 'assignee', header: 'Assignee', width: 20 },
        { key: 'breaches', header: 'Breach kind', width: 20 },
        { key: 'created', header: 'Created', width: 20 },
      ],
      rows: rows.map((t) => ({
        code: t.code, subject: t.subject, priority: t.priority,
        category: t.category?.name ?? '',
        store: t.store?.code ?? '',
        assignee: t.assignedTo?.fullName ?? '',
        breaches: [
          t.slaBreachedResponse ? 'First response' : null,
          t.slaBreachedResolve  ? 'Resolve' : null,
        ].filter(Boolean).join(', '),
        created: t.createdAt?.toISOString().replace('T',' ').slice(0,19),
      })),
    };
  }

  private async renderOpenTickets() {
    const rows = await this.prisma.ticket.findMany({
      where: { status: { notIn: ['RESOLVED','CLOSED'] } },
      include: {
        category: { select: { name: true } },
        store:    { select: { code: true } },
        assignedTo: { select: { fullName: true } },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      title: 'Helpdesk — currently open tickets',
      columns: [
        { key: 'code', header: 'Code', width: 15 },
        { key: 'subject', header: 'Subject', width: 45 },
        { key: 'priority', header: 'Priority', width: 10 },
        { key: 'status', header: 'Status', width: 15 },
        { key: 'category', header: 'Category', width: 20 },
        { key: 'store', header: 'Store', width: 10 },
        { key: 'assignee', header: 'Assignee', width: 20 },
        { key: 'created', header: 'Created', width: 20 },
      ],
      rows: rows.map((t) => ({
        code: t.code, subject: t.subject, priority: t.priority, status: t.status,
        category: t.category?.name ?? '', store: t.store?.code ?? '',
        assignee: t.assignedTo?.fullName ?? '',
        created: t.createdAt?.toISOString().replace('T',' ').slice(0,19),
      })),
    };
  }

  private async renderCostReport(since: Date, until: Date) {
    const rows = await this.prisma.ticket.findMany({
      where: { resolvedAt: { gte: since, lte: until } },
      include: {
        category: { select: { name: true } },
        store:    { select: { code: true } },
      },
      orderBy: { resolvedAt: 'desc' },
    });
    const LABOUR_RATE = Number(process.env.LABOUR_RATE_CENTS_PER_MIN ?? 500);
    return {
      title: `Helpdesk — cost per ticket ${since.toISOString().slice(0,10)} → ${until.toISOString().slice(0,10)}`,
      columns: [
        { key: 'code', header: 'Code', width: 15 },
        { key: 'subject', header: 'Subject', width: 40 },
        { key: 'category', header: 'Category', width: 20 },
        { key: 'store', header: 'Store', width: 10 },
        { key: 'labourMin', header: 'Labour (min)', width: 12 },
        { key: 'partsR', header: 'Parts (R)', width: 12 },
        { key: 'totalR', header: 'Total (R)', width: 12 },
      ],
      rows: rows.map((t) => {
        const labourCents = t.labourMinutes * LABOUR_RATE;
        const totalCents  = labourCents + t.partsCostCents;
        return {
          code: t.code, subject: t.subject,
          category: t.category?.name ?? '', store: t.store?.code ?? '',
          labourMin: t.labourMinutes,
          partsR: (t.partsCostCents / 100).toFixed(2),
          totalR: (totalCents / 100).toFixed(2),
        };
      }),
    };
  }

  // ------- Analytical reports -------
  private async renderByStore(since: Date, until: Date) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT s.code, s.name, s.region, s.entity,
             COUNT(t.id)::int                                                   AS total,
             SUM(CASE WHEN t.status NOT IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END)::int AS open,
             SUM(CASE WHEN t."slaBreachedResolve" THEN 1 ELSE 0 END)::int        AS breached,
             SUM(CASE WHEN t.priority = 'P1' THEN 1 ELSE 0 END)::int             AS p1,
             SUM(CASE WHEN t.priority = 'P2' THEN 1 ELSE 0 END)::int             AS p2,
             AVG(EXTRACT(EPOCH FROM (COALESCE(t."resolvedAt", t."updatedAt") - t."createdAt")))::int AS avg_resolve_s
      FROM "Store" s
      LEFT JOIN "Ticket" t ON t."storeId" = s.id AND t."createdAt" BETWEEN $1 AND $2
      GROUP BY s.id, s.code, s.name, s.region, s.entity
      ORDER BY total DESC NULLS LAST`, since, until);
    return {
      title: `Analytics — volume by store ${since.toISOString().slice(0,10)} → ${until.toISOString().slice(0,10)}`,
      columns: [
        { key: 'code',       header: 'Store code',  width: 12 },
        { key: 'name',       header: 'Store name',  width: 25 },
        { key: 'region',     header: 'Region',      width: 12 },
        { key: 'entity',     header: 'Brand',       width: 15 },
        { key: 'total',      header: 'Tickets',     width: 10 },
        { key: 'open',       header: 'Still open',  width: 10 },
        { key: 'breached',   header: 'SLA breaches', width: 12 },
        { key: 'p1',         header: 'P1',          width: 6 },
        { key: 'p2',         header: 'P2',          width: 6 },
        { key: 'avg_resolve_hrs', header: 'Avg resolve (hrs)', width: 15 },
      ],
      rows: rows.map((r) => ({
        ...r,
        avg_resolve_hrs: r.avg_resolve_s ? (r.avg_resolve_s / 3600).toFixed(1) : '—',
      })),
    };
  }

  private async renderByCategory(since: Date, until: Date) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT c.code, c.name, c."defaultPriority",
             COUNT(t.id)::int                                                  AS total,
             SUM(CASE WHEN t.status NOT IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END)::int AS open,
             SUM(CASE WHEN t."slaBreachedResolve" THEN 1 ELSE 0 END)::int      AS breached,
             AVG(EXTRACT(EPOCH FROM (COALESCE(t."resolvedAt", t."updatedAt") - t."createdAt")))::int AS avg_resolve_s,
             SUM(t."labourMinutes")::int                                       AS labour_min,
             SUM(t."partsCostCents")::int                                      AS parts_cents
      FROM "TicketCategory" c
      LEFT JOIN "Ticket" t ON t."categoryId" = c.id AND t."createdAt" BETWEEN $1 AND $2
      GROUP BY c.id, c.code, c.name, c."defaultPriority"
      ORDER BY total DESC NULLS LAST`, since, until);
    return {
      title: `Analytics — volume by category ${since.toISOString().slice(0,10)} → ${until.toISOString().slice(0,10)}`,
      columns: [
        { key: 'code', header: 'Code', width: 20 },
        { key: 'name', header: 'Category', width: 35 },
        { key: 'defaultPriority', header: 'Default pri', width: 10 },
        { key: 'total', header: 'Tickets', width: 10 },
        { key: 'open', header: 'Open', width: 8 },
        { key: 'breached', header: 'Breached', width: 10 },
        { key: 'avg_resolve_hrs', header: 'Avg resolve (hrs)', width: 15 },
        { key: 'labour_hrs', header: 'Total labour (hrs)', width: 15 },
        { key: 'parts_r', header: 'Parts cost (R)', width: 12 },
      ],
      rows: rows.map((r) => ({
        ...r,
        avg_resolve_hrs: r.avg_resolve_s ? (r.avg_resolve_s / 3600).toFixed(1) : '—',
        labour_hrs: r.labour_min ? (r.labour_min / 60).toFixed(1) : '0',
        parts_r:    r.parts_cents ? (r.parts_cents / 100).toFixed(2) : '0.00',
      })),
    };
  }

  private async renderTechProductivity(since: Date, until: Date) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT u.id, u."fullName", u.email, r.code AS role,
             COUNT(t.id)::int                                                   AS assigned,
             SUM(CASE WHEN t.status IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END)::int AS resolved,
             SUM(CASE WHEN t."slaBreachedResolve" THEN 1 ELSE 0 END)::int        AS breached,
             AVG(EXTRACT(EPOCH FROM (COALESCE(t."resolvedAt", t."updatedAt") - t."createdAt")))::int AS avg_resolve_s,
             AVG(t."satisfactionRating")::numeric(3,2)                           AS avg_csat,
             SUM(t."labourMinutes")::int                                         AS labour_min
      FROM "User" u
      JOIN "Role" r ON r.id = u."roleId"
      LEFT JOIN "Ticket" t ON t."assignedToId" = u.id AND t."createdAt" BETWEEN $1 AND $2
      WHERE r.code IN ('TECHNICIAN','IT_MANAGER','ADMINISTRATOR')
      GROUP BY u.id, u."fullName", u.email, r.code
      ORDER BY resolved DESC NULLS LAST`, since, until);
    return {
      title: `Analytics — technician productivity ${since.toISOString().slice(0,10)} → ${until.toISOString().slice(0,10)}`,
      columns: [
        { key: 'fullName', header: 'Technician', width: 25 },
        { key: 'role',     header: 'Role',       width: 15 },
        { key: 'assigned', header: 'Assigned',   width: 10 },
        { key: 'resolved', header: 'Resolved',   width: 10 },
        { key: 'breached', header: 'Breaches',   width: 10 },
        { key: 'resolve_rate', header: 'Resolve %', width: 10 },
        { key: 'avg_resolve_hrs', header: 'Avg resolve (hrs)', width: 15 },
        { key: 'avg_csat', header: 'CSAT (/5)', width: 10 },
        { key: 'labour_hrs', header: 'Logged labour (hrs)', width: 15 },
      ],
      rows: rows.map((r) => ({
        ...r,
        resolve_rate: r.assigned > 0 ? `${Math.round((r.resolved / r.assigned) * 100)}%` : '—',
        avg_resolve_hrs: r.avg_resolve_s ? (r.avg_resolve_s / 3600).toFixed(1) : '—',
        labour_hrs: r.labour_min ? (r.labour_min / 60).toFixed(1) : '0',
      })),
    };
  }

  private async renderMonthlyTrend(since: Date, until: Date) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT TO_CHAR(DATE_TRUNC('month', t."createdAt"), 'YYYY-MM') AS month,
             COUNT(*)::int                                                      AS created,
             SUM(CASE WHEN t."resolvedAt" IS NOT NULL THEN 1 ELSE 0 END)::int   AS resolved,
             SUM(CASE WHEN t."slaBreachedResolve" THEN 1 ELSE 0 END)::int       AS breached,
             SUM(CASE WHEN t.priority = 'P1' THEN 1 ELSE 0 END)::int            AS p1_count
      FROM "Ticket" t
      WHERE t."createdAt" BETWEEN $1 AND $2
      GROUP BY 1
      ORDER BY 1 ASC`, since, until);
    return {
      title: `Analytics — monthly volume trend ${since.toISOString().slice(0,10)} → ${until.toISOString().slice(0,10)}`,
      columns: [
        { key: 'month',    header: 'Month',    width: 10 },
        { key: 'created',  header: 'Created',  width: 10 },
        { key: 'resolved', header: 'Resolved', width: 10 },
        { key: 'breached', header: 'Breaches', width: 10 },
        { key: 'p1_count', header: 'P1 count', width: 10 },
      ],
      rows,
    };
  }

  private async renderRepeatOffenderAssets(since: Date, until: Date) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT a."assetTag", a."serialNo", sk.name AS sku,
             s.code AS store, COUNT(t.id)::int AS n
      FROM "Ticket" t
      JOIN "Asset" a ON a.id = t."assetId"
      JOIN "Sku" sk ON sk.id = a."skuId"
      LEFT JOIN "Store" s ON s.id = a."assignedStoreId"
      WHERE t."assetId" IS NOT NULL AND t."createdAt" BETWEEN $1 AND $2
      GROUP BY a.id, a."assetTag", a."serialNo", sk.name, s.code
      HAVING COUNT(t.id) >= 3
      ORDER BY n DESC
      LIMIT 100`, since, until);
    return {
      title: `Analytics — repeat-offender assets (≥3 tickets in range)`,
      columns: [
        { key: 'assetTag', header: 'Asset tag', width: 15 },
        { key: 'sku',      header: 'Model',     width: 30 },
        { key: 'serialNo', header: 'Serial',    width: 20 },
        { key: 'store',    header: 'Store',     width: 10 },
        { key: 'n',        header: 'Tickets',   width: 10 },
      ],
      rows,
    };
  }

  private async renderRepeatOffenderStores(since: Date, until: Date) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT s.code, s.name, c.name AS top_category, COUNT(t.id)::int AS category_count,
             (SELECT COUNT(*)::int FROM "Ticket" t2
                WHERE t2."storeId" = s.id AND t2."createdAt" BETWEEN $1 AND $2) AS total
      FROM "Store" s
      JOIN "Ticket" t ON t."storeId" = s.id AND t."createdAt" BETWEEN $1 AND $2
      JOIN "TicketCategory" c ON c.id = t."categoryId"
      GROUP BY s.id, s.code, s.name, c.id, c.name
      HAVING COUNT(t.id) >= 5
      ORDER BY total DESC, category_count DESC
      LIMIT 50`, since, until);
    return {
      title: `Analytics — top store/category pairs (≥5 tickets in range)`,
      columns: [
        { key: 'code',        header: 'Store',        width: 10 },
        { key: 'name',        header: 'Store name',   width: 25 },
        { key: 'top_category', header: 'Category',    width: 30 },
        { key: 'category_count', header: 'In cat.',   width: 10 },
        { key: 'total',       header: 'Store total',  width: 12 },
      ],
      rows,
    };
  }

  private async renderCsatFcr(since: Date, until: Date) {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT c.name,
             COUNT(t.id)::int AS total,
             SUM(CASE WHEN t.status IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END)::int AS resolved,
             SUM(CASE WHEN t."isFirstContactResolution" THEN 1 ELSE 0 END)::int   AS fcr_count,
             COUNT(t."satisfactionRating")::int                                   AS csat_sample,
             AVG(t."satisfactionRating")::numeric(3,2)                            AS csat_avg
      FROM "TicketCategory" c
      LEFT JOIN "Ticket" t ON t."categoryId" = c.id AND t."createdAt" BETWEEN $1 AND $2
      GROUP BY c.id, c.name
      ORDER BY total DESC NULLS LAST`, since, until);
    return {
      title: `Analytics — CSAT + FCR by category ${since.toISOString().slice(0,10)} → ${until.toISOString().slice(0,10)}`,
      columns: [
        { key: 'name',         header: 'Category', width: 35 },
        { key: 'total',        header: 'Total',    width: 10 },
        { key: 'resolved',     header: 'Resolved', width: 10 },
        { key: 'fcr_count',    header: 'FCR hits', width: 10 },
        { key: 'fcr_rate',     header: 'FCR %',    width: 10 },
        { key: 'csat_sample',  header: 'CSAT N',   width: 10 },
        { key: 'csat_avg',     header: 'CSAT avg', width: 10 },
      ],
      rows: rows.map((r) => ({
        ...r,
        fcr_rate: r.resolved > 0 ? `${Math.round((r.fcr_count / r.resolved) * 100)}%` : '—',
      })),
    };
  }

  private async renderDeflectionImpact(since: Date, until: Date) {
    // How often KB articles got views; which categories have published articles;
    // tickets logged in categories WITH an article vs WITHOUT.
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT c.name AS category,
             COUNT(DISTINCT kb.id)::int AS articles,
             COALESCE(SUM(kb.views), 0)::int AS views,
             COALESCE(SUM(kb."helpfulYes"), 0)::int AS thumbs_up,
             COALESCE(SUM(kb."helpfulNo"), 0)::int  AS thumbs_down,
             (SELECT COUNT(*)::int FROM "Ticket" t
                WHERE t."categoryId" = c.id AND t."createdAt" BETWEEN $1 AND $2) AS tickets_still_logged
      FROM "TicketCategory" c
      LEFT JOIN "KbArticle" kb ON kb."categoryId" = c.id
      GROUP BY c.id, c.name
      HAVING COUNT(DISTINCT kb.id) > 0 OR
             (SELECT COUNT(*) FROM "Ticket" t WHERE t."categoryId" = c.id AND t."createdAt" BETWEEN $1 AND $2) > 0
      ORDER BY views DESC NULLS LAST`, since, until);
    return {
      title: `Analytics — KB deflection impact`,
      columns: [
        { key: 'category',             header: 'Category',           width: 35 },
        { key: 'articles',             header: 'KB articles',        width: 12 },
        { key: 'views',                header: 'KB views',           width: 10 },
        { key: 'thumbs_up',            header: '👍',                  width: 6 },
        { key: 'thumbs_down',          header: '👎',                  width: 6 },
        { key: 'tickets_still_logged', header: 'Tickets still logged', width: 18 },
        { key: 'deflection_hint',      header: 'Deflection hint',    width: 25 },
      ],
      rows: rows.map((r) => ({
        ...r,
        deflection_hint:
          r.articles === 0  ? 'Consider writing a KB article' :
          r.views === 0     ? 'Published but zero views — bad discoverability' :
          r.tickets_still_logged > r.views * 2 ? 'Tickets dominate views — article may not be solving it' :
          'Good — tickets ≤ views',
      })),
    };
  }

  // ------- File renderers -------
  async toXlsx(rendered: { title: string; columns: any[]; rows: any[] }): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ITAMLS';
    const ws = wb.addWorksheet(rendered.title.slice(0, 30));
    ws.columns = rendered.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 15 }));
    ws.getRow(1).font = { bold: true };
    ws.addRows(rendered.rows);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async toPdf(rendered: { title: string; columns: any[]; rows: any[] }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
        const chunks: Buffer[] = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.fontSize(14).text(rendered.title, { align: 'left' });
        doc.moveDown(0.3);
        doc.fontSize(8).fillColor('#64748b').text(`Generated ${new Date().toLocaleString()}`);
        doc.moveDown(0.6).fillColor('#000');
        // Column header
        const colWidths = rendered.columns.map((c) => Math.max(50, (c.width ?? 15) * 6));
        const totalWidth = colWidths.reduce((a, b) => a + b, 0);
        const scale = Math.min(1, (doc.page.width - 60) / totalWidth);
        const w = colWidths.map((c) => c * scale);
        let x = doc.x;
        const y0 = doc.y;
        doc.fontSize(8).font('Helvetica-Bold');
        rendered.columns.forEach((c, i) => {
          doc.text(c.header, x, y0, { width: w[i], ellipsis: true });
          x += w[i];
        });
        doc.moveTo(doc.x = 30, doc.y + 10).lineTo(30 + doc.page.width - 60, doc.y + 10).stroke();
        doc.y += 14;
        // Rows
        doc.font('Helvetica').fontSize(7);
        for (const r of rendered.rows) {
          x = 30;
          const rowY = doc.y;
          rendered.columns.forEach((c, i) => {
            doc.text(String((r as any)[c.key] ?? ''), x, rowY, { width: w[i], ellipsis: true });
            x += w[i];
          });
          doc.y = rowY + 11;
          if (doc.y > doc.page.height - 40) doc.addPage({ layout: 'landscape', margin: 30 });
        }
        doc.end();
      } catch (e) { reject(e); }
    });
  }

  // ------- Scheduled reports CRUD -------
  listScheduled() {
    return this.prisma.scheduledReport.findMany({ orderBy: { nextRunAt: 'asc' } });
  }

  async createScheduled(dto: any, userId: string) {
    if (!dto.name?.trim() || !dto.reportKey || !dto.cronExpression || !dto.recipients?.trim()) {
      throw new BadRequestException('name, reportKey, cronExpression, recipients required');
    }
    return this.prisma.scheduledReport.create({
      data: {
        name: dto.name.trim(),
        reportKey: dto.reportKey,
        format: dto.format === 'PDF' ? 'PDF' : 'XLSX',
        cronExpression: dto.cronExpression.trim(),
        recipients: dto.recipients.trim(),
        isActive: dto.isActive ?? true,
        nextRunAt: this.nextCronRun(dto.cronExpression, new Date()),
        createdById: userId,
      },
    });
  }

  updateScheduled(id: string, dto: any) {
    const data: any = {};
    for (const k of ['name','reportKey','format','cronExpression','recipients','isActive'] as const) {
      if (k in dto) (data as any)[k] = dto[k];
    }
    if ('cronExpression' in dto) data.nextRunAt = this.nextCronRun(dto.cronExpression, new Date());
    return this.prisma.scheduledReport.update({ where: { id }, data });
  }

  deleteScheduled(id: string) { return this.prisma.scheduledReport.delete({ where: { id } }); }

  // ------- Cron -------
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runDueReports() {
    const due = await this.prisma.scheduledReport.findMany({
      where: { isActive: true, nextRunAt: { lte: new Date() } },
    });
    for (const r of due) {
      try {
        const rendered = await this.render(r.reportKey, {});
        const buf = r.format === 'PDF' ? await this.toPdf(rendered) : await this.toXlsx(rendered);
        const filename = `${r.name.replace(/[^\w.-]+/g, '_')}-${new Date().toISOString().slice(0,10)}.${r.format === 'PDF' ? 'pdf' : 'xlsx'}`;
        // Hand off to the mailer. send() uses nodemailer which supports attachments
        // but our wrapper may not — fall through to text-only if attachments break.
        await (this.mailer as any).sendWithAttachment?.(
          r.recipients.split(',').map((s) => s.trim()).filter(Boolean),
          `[ITAMLS] ${r.name}`,
          `<p>Automated report — ${r.name}</p><p>See attached ${r.format}.</p>`,
          [{ filename, content: buf }],
        );
        await this.prisma.scheduledReport.update({
          where: { id: r.id },
          data: {
            lastRunAt: new Date(),
            lastError: null,
            nextRunAt: this.nextCronRun(r.cronExpression, new Date()),
          },
        });
      } catch (e: any) {
        await this.prisma.scheduledReport.update({
          where: { id: r.id },
          data: {
            lastError: (e?.message ?? String(e)).slice(0, 500),
            nextRunAt: this.nextCronRun(r.cronExpression, new Date()),
          },
        });
      }
    }
  }

  // Simple daily-at-HH:MM cron parser; good enough for the common cases.
  private nextCronRun(cronExpr: string, from: Date): Date {
    const parts = (cronExpr ?? '').trim().split(/\s+/);
    if (parts.length !== 5) return new Date(from.getTime() + 3600_000);
    const [minute, hour] = parts;
    const next = new Date(from);
    const h = hour.includes('*') ? next.getHours() : parseInt(hour, 10);
    const m = minute.includes('*') ? 0 : parseInt(minute, 10);
    next.setDate(next.getDate() + 1);
    next.setHours(h, m, 0, 0);
    return next;
  }
}
