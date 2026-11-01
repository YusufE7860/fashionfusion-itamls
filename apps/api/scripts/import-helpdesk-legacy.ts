/**
 * One-shot import of legacy ManageEngine helpdesk tickets from an .xlsx export.
 *
 *   Usage:
 *     npx ts-node /app/apps/api/scripts/import-helpdesk-legacy.ts <path-to-xlsx>
 *
 * The ME export has a non-trivial header: the first 7 rows are metadata; the
 * real header row is at index 7 with columns:
 *   Request ID | Subject | Description | Requester | Technician | Created Time | Request Status
 *
 * Behaviour:
 *   - Codes are rewritten as "LEG-<Request ID>" so they NEVER collide with the
 *     live FF-YYMM-NNNN sequence.
 *   - Idempotent: if a ticket with that code already exists we skip it. Re-run
 *     is safe.
 *   - Requester (lowercased store slug like "capetowncbd") is matched against
 *     Store.code (case-insensitive). Unknown requesters are left as HQ tickets
 *     (storeId = null) so the ticket still lands in the database rather than
 *     being lost.
 *   - Technician full-names are matched against User.fullName (case-insensitive,
 *     whitespace-collapsed). Unknown techs leave assignedToId null — they land
 *     in the unassigned queue.
 *   - Status is normalised: Closed → CLOSED, Resolved → RESOLVED, Open → NEW,
 *     Cancelled → CLOSED (with notes).
 *   - Category: all legacy tickets are assigned to a dedicated LEGACY-ME
 *     category so they don't skew the new categorisation reports.
 *   - HTML / newline-heavy ME descriptions are cleaned to plain text.
 */
import { PrismaClient } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import * as path from 'node:path';
import * as fs from 'node:fs';

const prisma = new PrismaClient();

interface LegacyRow {
  requestId: string;
  subject: string;
  description: string;
  requester: string;    // store slug or user name
  technician: string;   // tech full-name or "Not Assigned"
  createdTime: Date;
  status: string;       // Open / Closed / Resolved / Cancelled
}

function stripHtml(s: string): string {
  // ME descriptions are HTML-escaped with lots of blank lines. Collapse down.
  return String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normName(s: string): string {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normStatus(me: string): string {
  const s = normName(me);
  if (s === 'closed')    return 'CLOSED';
  if (s === 'resolved')  return 'RESOLVED';
  if (s === 'open')      return 'NEW';
  if (s === 'cancelled') return 'CLOSED';
  return 'CLOSED';
}

async function readRows(xlsxPath: string): Promise<LegacyRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.worksheets[0];
  const rows: LegacyRow[] = [];
  let headerRow = -1;
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    const vals = row.values as any[];
    const flat = vals.map((v) => String(v ?? '').trim());
    if (headerRow < 0) {
      if (flat.includes('Request ID') && flat.includes('Subject')) {
        headerRow = idx;
      }
      return;
    }
    // Data rows
    const [, requestId, subject, description, requester, technician, createdTime, status] = flat;
    if (!requestId || !subject) return;
    let d: Date;
    const parsed = Date.parse(createdTime);
    if (!Number.isNaN(parsed)) d = new Date(parsed);
    else d = new Date();
    rows.push({
      requestId: String(requestId),
      subject: String(subject).slice(0, 300),
      description: stripHtml(description),
      requester: String(requester ?? ''),
      technician: String(technician ?? ''),
      createdTime: d,
      status: String(status ?? ''),
    });
  });
  return rows;
}

async function main() {
  const xlsx = process.argv[2];
  if (!xlsx) {
    console.error('Usage: ts-node import-helpdesk-legacy.ts <path-to-xlsx>');
    process.exit(1);
  }
  if (!fs.existsSync(xlsx)) {
    console.error(`File not found: ${xlsx}`);
    process.exit(1);
  }

  console.log(`Reading ${path.basename(xlsx)}…`);
  const rows = await readRows(xlsx);
  console.log(`Found ${rows.length} ticket rows.`);

  // ------- lookup tables for fast matching -------
  const stores = await prisma.store.findMany({ select: { id: true, code: true, name: true } });
  const storeByKey = new Map<string, string>();
  for (const s of stores) {
    storeByKey.set(normName(s.code), s.id);
    storeByKey.set(normName(s.name), s.id);
    // Also match on common slug variants (strip "store")
    storeByKey.set(normName(s.name.replace(/\bstore\b/g, '')), s.id);
  }

  const users = await prisma.user.findMany({ select: { id: true, fullName: true, email: true } });
  const userByName = new Map<string, string>();
  for (const u of users) {
    userByName.set(normName(u.fullName), u.id);
    userByName.set(normName(u.email.split('@')[0]), u.id);
  }

  // Legacy category — one single catch-all so historical tickets don't skew
  // the new category reports.
  const legacyCat = await prisma.ticketCategory.upsert({
    where: { code: 'LEGACY-ME' },
    update: { name: 'Legacy — imported from ManageEngine', isActive: false },
    create: {
      code: 'LEGACY-ME',
      name: 'Legacy — imported from ManageEngine',
      description: 'Catch-all for historical tickets imported from the old helpdesk. Excluded from live routing + reports.',
      defaultPriority: 'P3',
      isActive: false,
      sortOrder: 9999,
    },
  });

  // ------- import loop -------
  let created = 0, skipped = 0, orphanStore = 0, orphanTech = 0;
  const unknownStores = new Map<string, number>();
  const unknownTechs  = new Map<string, number>();

  for (const r of rows) {
    const code = `LEG-${r.requestId}`;
    const existing = await prisma.ticket.findUnique({ where: { code }, select: { id: true } });
    if (existing) { skipped++; continue; }

    const storeKey = normName(r.requester);
    const storeId = storeByKey.get(storeKey) ?? null;
    if (!storeId && r.requester) {
      orphanStore++;
      unknownStores.set(r.requester, (unknownStores.get(r.requester) ?? 0) + 1);
    }

    const techKey = normName(r.technician);
    const assignedToId = techKey && techKey !== 'not assigned'
      ? userByName.get(techKey) ?? null
      : null;
    if (!assignedToId && techKey && techKey !== 'not assigned') {
      orphanTech++;
      unknownTechs.set(r.technician, (unknownTechs.get(r.technician) ?? 0) + 1);
    }

    const status = normStatus(r.status);

    try {
      await prisma.ticket.create({
        data: {
          code,
          subject: r.subject,
          description: r.description || '(no description provided in legacy export)',
          categoryId: legacyCat.id,
          priority: 'P3',
          status,
          source: 'EMAIL',
          storeId,
          assignedToId,
          createdAt: r.createdTime,
          updatedAt: r.createdTime,
          resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? r.createdTime : null,
          closedAt:   status === 'CLOSED' ? r.createdTime : null,
          externalReporterName: !storeId ? r.requester : null,
        },
      });
      created++;
      if (created % 500 === 0) console.log(`  …${created} imported`);
    } catch (e: any) {
      console.error(`  ✗ ${code}: ${e?.message ?? e}`);
    }
  }

  console.log(`\n✓ Created ${created} tickets, skipped ${skipped} already-imported.`);
  console.log(`  ${orphanStore} tickets have no store match (saved as HQ with the slug in externalReporterName).`);
  console.log(`  ${orphanTech}  tickets have no technician match (left unassigned).`);

  if (unknownStores.size) {
    console.log(`\nTop unmatched store slugs (first 15):`);
    [...unknownStores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
      .forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
  }
  if (unknownTechs.size) {
    console.log(`\nTop unmatched technician names (first 10):`);
    [...unknownTechs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
