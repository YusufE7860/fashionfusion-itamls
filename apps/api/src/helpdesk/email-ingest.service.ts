import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TicketsService } from './tickets.service';
import { pop3FetchAll, Pop3Config } from './pop3-client';

/**
 * Poll the helpdesk POP3 mailbox and turn each new email into either:
 *   - a comment on an existing ticket (if subject contains [FF-YYMM-NNNN])
 *   - a brand-new ticket assigned to the "MISC" category
 *
 * Enable via env vars:
 *   HELPDESK_POP3_HOST=pop.gmail.com
 *   HELPDESK_POP3_PORT=995
 *   HELPDESK_POP3_USER=helpdesk@ffgsa.co.za
 *   HELPDESK_POP3_PASS=<app-password>
 *   HELPDESK_POP3_SECURITY=ssl        # ssl | starttls | plain
 *   HELPDESK_POP3_DELETE_AFTER=true   # true (default) = DELE processed messages
 *   HELPDESK_POP3_MAX_PER_RUN=25      # safety cap per poll
 *
 * Runs every 2 minutes when the config is present; silent no-op otherwise.
 */
@Injectable()
export class EmailIngestService {
  private readonly logger = new Logger(EmailIngestService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private tickets: TicketsService,
  ) {}

  private cfg(): Pop3Config | null {
    const host = process.env.HELPDESK_POP3_HOST;
    const user = process.env.HELPDESK_POP3_USER;
    const pass = process.env.HELPDESK_POP3_PASS;
    if (!host || !user || !pass) return null;
    return {
      host,
      port: Number(process.env.HELPDESK_POP3_PORT ?? 995),
      user, pass,
      security: (process.env.HELPDESK_POP3_SECURITY as any) ?? 'ssl',
      connectTimeoutMs: 20_000,
      commandTimeoutMs: 60_000,
    };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async pollTick() {
    const config = this.cfg();
    if (!config) return;
    try {
      const result = await this.pollNow();
      if (result.processed > 0) {
        this.logger.log(`Email poll: ${result.processed} processed (${result.newTickets} new tickets, ${result.newComments} comments)`);
      }
    } catch (e: any) {
      this.logger.warn(`POP3 poll failed: ${e.message ?? e}`);
    }
  }

  /** Public entry point that returns metrics — used by /helpdesk/email/poll-now for admin testing. */
  async pollNow() {
    const config = this.cfg();
    if (!config) return { processed: 0, newTickets: 0, newComments: 0, skipped: 0, error: 'Email ingest not configured (set HELPDESK_POP3_HOST/USER/PASS env vars)' };

    const maxPerRun = Number(process.env.HELPDESK_POP3_MAX_PER_RUN ?? 25);
    const deleteAfter = (process.env.HELPDESK_POP3_DELETE_AFTER ?? 'true') === 'true';

    const conn = await pop3FetchAll(config);
    const toProcess = conn.messages.slice(0, maxPerRun);
    const successfullyProcessed: number[] = [];
    let newTickets = 0, newComments = 0, skipped = 0;

    for (const m of toProcess) {
      try {
        // Dedupe by UID — skip if we already ingested this one
        const already = await this.prisma.ticketEvent.findFirst({
          where: { eventType: 'CREATED', notes: `email uid=${m.uid}` },
          select: { id: true },
        });
        if (already) { successfullyProcessed.push(m.messageNumber); skipped++; continue; }

        const parsed = await simpleParser(m.raw);
        const outcome = await this.ingestOne(parsed, m.uid);
        if (outcome === 'ticket') newTickets++;
        else if (outcome === 'comment') newComments++;
        else skipped++;
        successfullyProcessed.push(m.messageNumber);
      } catch (e: any) {
        this.logger.warn(`Failed to ingest email uid=${m.uid}: ${e.message ?? e}`);
        // Don't add to successfullyProcessed — leave on server for next poll
      }
    }

    if (deleteAfter && successfullyProcessed.length) {
      await conn.deleteAll(successfullyProcessed).catch(() => {});
    }
    await conn.close();

    return {
      processed: successfullyProcessed.length,
      newTickets, newComments, skipped,
      totalOnServer: conn.messages.length,
    };
  }

  // ============================================================
  //  Single-email ingest logic
  // ============================================================
  private async ingestOne(m: ParsedMail, uid: string): Promise<'ticket' | 'comment' | 'skipped'> {
    const from  = (m.from?.value?.[0]?.address ?? '').toLowerCase().trim();
    const name  = m.from?.value?.[0]?.name ?? from;
    const subj  = (m.subject ?? '').trim();
    const body  = (m.text ?? m.html?.toString() ?? '').trim();
    if (!from || !subj) return 'skipped';

    // Match sender to a user (case-insensitive)
    const reporter = await this.prisma.user.findFirst({
      where: { email: { equals: from, mode: 'insensitive' } },
    });

    // Reply detection — subject like "[FF-2610-0042] Re: ..."
    const codeMatch = subj.match(/\[?FF-\d{4}-\d{4}\]?/i);
    let ticket = codeMatch
      ? await this.prisma.ticket.findUnique({ where: { code: codeMatch[0].replace(/[[\]]/g, '').toUpperCase() } })
      : null;

    // Ctx for the ticket service. If the sender is a known user, use their identity;
    // otherwise use the "system" role by falling back to the first Administrator so
    // permission checks pass. The event trail still records the actual email address.
    const actorId = reporter?.id ?? (await this.systemUserId());
    const ctx = { userId: actorId, permissions: ['tickets:read','tickets:read:all','tickets:write','tickets:assign'] };

    if (ticket) {
      // Add as comment on existing ticket
      const commentBody = `From: ${name} <${from}>\n\n${body}`;
      await this.tickets.addComment(ticket.id, commentBody, false, ctx);
      // Attach any files
      await this.saveAttachments(m, ticket.id, ctx);
      // Tag the ingest event with UID for dedupe
      await this.prisma.ticketEvent.create({
        data: { ticketId: ticket.id, actorId: reporter?.id, eventType: 'COMMENT_ADDED', notes: `email uid=${uid} from=${from}` },
      });
      return 'comment';
    }

    // Brand new ticket — assign to MISC (or "REQ" if it looks like a request)
    const isRequest = /request|please add|access|create account/i.test(subj);
    const category = await this.prisma.ticketCategory.findUnique({
      where: { code: isRequest ? 'REQ' : 'MISC' },
    });
    if (!category) return 'skipped'; // seed hasn't run yet

    const created = await this.tickets.create({
      subject: subj.slice(0, 200),
      description: `From: ${name} <${from}>\n\n${body}`,
      categoryId: category.id,
      priority: category.defaultPriority as any,
      storeId: reporter?.storeId ?? undefined,
      source: 'EMAIL',
    }, ctx);

    // Attachments
    await this.saveAttachments(m, created.id, ctx);

    // Tag the created event with UID for dedupe
    await this.prisma.ticketEvent.create({
      data: { ticketId: created.id, actorId: reporter?.id, eventType: 'CREATED', notes: `email uid=${uid}` },
    });
    return 'ticket';
  }

  // ============================================================
  //  Attachments — store to MinIO + link as TicketAttachment
  // ============================================================
  private async saveAttachments(m: ParsedMail, ticketId: string, ctx: any) {
    const attachments: Attachment[] = m.attachments ?? [];
    for (const a of attachments) {
      if (!a.content || !(a.content instanceof Buffer)) continue;
      const filename = (a.filename ?? `email-attach-${randomBytes(3).toString('hex')}`).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
      try {
        await this.tickets.addAttachment(ticketId, {
          originalname: filename,
          buffer: a.content,
          mimetype: a.contentType ?? 'application/octet-stream',
          size: a.size ?? a.content.length,
        }, ctx);
      } catch (e: any) {
        this.logger.warn(`Failed to save email attachment ${filename}: ${e.message ?? e}`);
      }
    }
  }

  private cachedSystemUserId: string | null = null;
  private async systemUserId(): Promise<string> {
    if (this.cachedSystemUserId) return this.cachedSystemUserId;
    const admin = await this.prisma.user.findFirst({
      where: { role: { code: 'ADMINISTRATOR' } },
      select: { id: true },
    });
    if (!admin) throw new Error('No Administrator user found for email ingest system actor');
    this.cachedSystemUserId = admin.id;
    return admin.id;
  }
}
