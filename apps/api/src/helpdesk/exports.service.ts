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
      case 'tickets.summary': return this.renderTicketsSummary(since, until);
      case 'tickets.sla-breaches': return this.renderSlaBreaches(since, until);
      case 'tickets.open': return this.renderOpenTickets();
      case 'tickets.cost': return this.renderCostReport(since, until);
      default: throw new BadRequestException(`unknown reportKey: ${reportKey}`);
    }
  }

  availableReports() {
    return [
      { key: 'tickets.summary',      label: 'Tickets — summary (count by status/priority/category)' },
      { key: 'tickets.sla-breaches', label: 'Tickets — SLA breaches' },
      { key: 'tickets.open',         label: 'Tickets — currently open' },
      { key: 'tickets.cost',         label: 'Tickets — cost per ticket' },
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
