import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Legacy helpdesk importer — same logic as the one-shot script, exposed
 * through an in-app endpoint so admins can upload xlsx files from the UI.
 *
 * Supports the ManageEngine XLSX export shape (what you've just imported
 * from). Columns: Request ID | Subject | Description | Requester | Technician
 * | Created Time | Request Status.
 */
export interface ImportSummary {
  total: number;
  created: number;
  skipped: number;
  orphanStore: number;
  orphanTech: number;
  unmatchedStores: Array<{ slug: string; count: number }>;
  unmatchedTechnicians: Array<{ name: string; count: number }>;
}

@Injectable()
export class LegacyImportService {
  constructor(private prisma: PrismaService) {}

  async importManageEngineXlsx(buffer: Buffer): Promise<ImportSummary> {
    const rows = await this.readRows(buffer);
    return this.importRows(rows);
  }

  private async readRows(buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    const rows: any[] = [];

    // ME exports have 7 rows of header metadata before the real header. We
    // search the first 30 rows for a row containing both "Request ID" and
    // "Subject", then build a column-name → index map from THAT row so we
    // tolerate any column order and any extra meta rows.
    const cellText = (c: any): string => {
      // Normalise every cell shape ExcelJS can return
      if (c == null) return '';
      if (c instanceof Date) return c.toISOString();
      if (typeof c === 'object') {
        // hyperlink { text, hyperlink }  OR  rich-text { richText: [...] }  OR  formula { result }
        if ('text' in c)      return String(c.text ?? '').trim();
        if ('result' in c)    return String(c.result ?? '').trim();
        if ('richText' in c)  return (c.richText as any[]).map((r) => r.text).join('').trim();
        return '';
      }
      return String(c).trim();
    };

    // Walk ALL rows (empty rows retained so idx matches the sheet) to find
    // the header, then map the data rows after it.
    let headerIdx = -1;
    let colMap: Record<string, number> = {};

    const totalRows = ws.rowCount;
    for (let r = 1; r <= Math.min(totalRows, 30); r++) {
      const row = ws.getRow(r);
      const texts: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        texts[col] = cellText(cell.value);
      });
      if (texts.some((t) => t === 'Request ID') && texts.some((t) => t === 'Subject')) {
        headerIdx = r;
        texts.forEach((t, i) => { if (t) colMap[t] = i; });
        break;
      }
    }

    if (headerIdx < 0) {
      throw new Error(
        'Could not find a row containing "Request ID" + "Subject" in the first 30 rows. ' +
        'Is this a ManageEngine Request Framework export?',
      );
    }

    const colOf = (name: string): number => colMap[name] ?? -1;
    const C_ID        = colOf('Request ID');
    const C_SUBJECT   = colOf('Subject');
    const C_DESC      = colOf('Description');
    const C_REQUESTER = colOf('Requester');
    const C_TECH      = colOf('Technician');
    const C_CREATED   = colOf('Created Time');
    const C_STATUS    = colOf('Request Status');

    for (let r = headerIdx + 1; r <= totalRows; r++) {
      const row = ws.getRow(r);
      const requestId   = cellText(row.getCell(C_ID).value);
      const subject     = cellText(row.getCell(C_SUBJECT).value);
      if (!requestId || !subject) continue;
      const description = cellText(row.getCell(C_DESC).value);
      const requester   = cellText(row.getCell(C_REQUESTER).value);
      const technician  = cellText(row.getCell(C_TECH).value);
      const createdRaw  = row.getCell(C_CREATED).value;
      const status      = cellText(row.getCell(C_STATUS).value);

      let createdTime: Date;
      if (createdRaw instanceof Date) createdTime = createdRaw;
      else {
        const parsed = Date.parse(cellText(createdRaw));
        createdTime = Number.isNaN(parsed) ? new Date() : new Date(parsed);
      }

      rows.push({
        requestId: String(requestId),
        subject: subject.slice(0, 300),
        description: this.stripHtml(description),
        requester, technician, createdTime, status,
      });
    }
    return rows;
  }

  private async importRows(rows: any[]): Promise<ImportSummary> {
    const stores = await this.prisma.store.findMany({ select: { id: true, code: true, name: true } });
    const storeByKey = new Map<string, string>();
    for (const s of stores) {
      storeByKey.set(this.normName(s.code), s.id);
      storeByKey.set(this.normName(s.name), s.id);
      storeByKey.set(this.normName(s.name.replace(/\bstore\b/g, '')), s.id);
    }

    const users = await this.prisma.user.findMany({ select: { id: true, fullName: true, email: true } });
    const userByName = new Map<string, string>();
    for (const u of users) {
      userByName.set(this.normName(u.fullName), u.id);
      userByName.set(this.normName(u.email.split('@')[0]), u.id);
    }

    const legacyCat = await this.prisma.ticketCategory.upsert({
      where: { code: 'LEGACY-ME' },
      update: { name: 'Legacy — imported from ManageEngine', isActive: false },
      create: {
        code: 'LEGACY-ME',
        name: 'Legacy — imported from ManageEngine',
        description: 'Catch-all for historical tickets imported from the old helpdesk. Excluded from live routing + reports.',
        defaultPriority: 'P3', isActive: false, sortOrder: 9999,
      },
    });

    let created = 0, skipped = 0, orphanStore = 0, orphanTech = 0;
    const unknownStores = new Map<string, number>();
    const unknownTechs  = new Map<string, number>();

    for (const r of rows) {
      const code = `LEG-${r.requestId}`;
      const existing = await this.prisma.ticket.findUnique({ where: { code }, select: { id: true } });
      if (existing) { skipped++; continue; }

      const storeId = storeByKey.get(this.normName(r.requester)) ?? null;
      if (!storeId && r.requester) {
        orphanStore++;
        unknownStores.set(r.requester, (unknownStores.get(r.requester) ?? 0) + 1);
      }

      const techKey = this.normName(r.technician);
      const assignedToId = techKey && techKey !== 'not assigned'
        ? userByName.get(techKey) ?? null
        : null;
      if (!assignedToId && techKey && techKey !== 'not assigned') {
        orphanTech++;
        unknownTechs.set(r.technician, (unknownTechs.get(r.technician) ?? 0) + 1);
      }

      const status = this.normStatus(r.status);
      try {
        await this.prisma.ticket.create({
          data: {
            code, subject: r.subject,
            description: r.description || '(no description provided in legacy export)',
            categoryId: legacyCat.id,
            priority: 'P3', status, source: 'EMAIL',
            storeId, assignedToId,
            createdAt: r.createdTime, updatedAt: r.createdTime,
            resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? r.createdTime : null,
            closedAt:   status === 'CLOSED' ? r.createdTime : null,
            externalReporterName: !storeId ? r.requester : null,
          },
        });
        created++;
      } catch { /* one bad row shouldn't halt the batch */ }
    }

    return {
      total: rows.length, created, skipped, orphanStore, orphanTech,
      unmatchedStores: [...unknownStores.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 20)
        .map(([slug, count]) => ({ slug, count })),
      unmatchedTechnicians: [...unknownTechs.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 20)
        .map(([name, count]) => ({ name, count })),
    };
  }

  private stripHtml(s: string): string {
    return String(s ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/\r/g, '').replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  private normName(s: string): string {
    return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  private normStatus(me: string): string {
    const s = this.normName(me);
    if (s === 'closed')    return 'CLOSED';
    if (s === 'resolved')  return 'RESOLVED';
    if (s === 'open')      return 'NEW';
    if (s === 'cancelled') return 'CLOSED';
    return 'CLOSED';
  }
}
