import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Web Push notifications to techs.
 *
 * Config via env:
 *   VAPID_PUBLIC_KEY   - share with the browser (safe to expose)
 *   VAPID_PRIVATE_KEY  - server secret
 *   VAPID_SUBJECT      - "mailto:you@fashionfusion.local"
 *
 * Generate once:  npx web-push generate-vapid-keys
 */
@Injectable()
export class NotifyService implements OnModuleInit {
  private readonly log = new Logger(NotifyService.name);
  private configured = false;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    const pub  = process.env.VAPID_PUBLIC_KEY;
    const prv  = process.env.VAPID_PRIVATE_KEY;
    const subj = process.env.VAPID_SUBJECT ?? 'mailto:admin@fashionfusion.local';
    if (!pub || !prv) {
      this.log.warn('VAPID keys not set - push notifications will be disabled. '
        + 'Run `npx web-push generate-vapid-keys` and add to .env.');
      return;
    }
    webpush.setVapidDetails(subj, pub, prv);
    this.configured = true;
    this.log.log('Web Push configured');
  }

  getPublicKey(): string | null {
    return this.configured ? (process.env.VAPID_PUBLIC_KEY ?? null) : null;
  }

  /** Send a notification payload to every registered device of this user.
   *  410 Gone + 404 responses mean the subscription is dead - we delete it. */
  async sendToUser(userId: string, payload: NotifyPayload) {
    if (!this.configured) return { skipped: true, reason: 'not configured' };
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    const body = JSON.stringify(payload);
    let sent = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: 60 * 5 },  // 5 min - these are time-sensitive
        );
        await this.prisma.pushSubscription.update({
          where: { id: s.id }, data: { lastUsedAt: new Date() },
        }).catch(() => {});
        sent++;
      } catch (e: any) {
        const status = e?.statusCode ?? 0;
        if (status === 404 || status === 410) {
          await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          this.log.debug(`Pruned dead subscription ${s.endpoint.slice(-20)}`);
        } else {
          this.log.warn(`Push to ${s.endpoint.slice(-20)} failed: ${e?.message ?? e}`);
        }
      }
    }
    return { sent, total: subs.length };
  }

  /** Entry point called by /portal/tickets POST. Resolves the technician
   *  who will handle this ticket (assigned if set, else the on-call tech
   *  for the ticket's area), then pushes a notification to all their
   *  devices with the title, store, priority and a link to open the ticket. */
  async notifyNewTicket(ticketId: string) {
    if (!this.configured) return;
    const t = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true, code: true, subject: true, priority: true,
        assignedToId: true,
        store:    { select: { code: true, name: true } },
        category: { select: { name: true } },
      },
    });
    if (!t) return;

    // Who gets the notification?
    //  1. Explicit assignee if routing already picked one
    //  2. Otherwise: fall back to all techs tagged as on-call right now
    //  3. If nothing: all active technicians (so a ticket never goes silent)
    const recipients = new Set<string>();
    if (t.assignedToId) {
      recipients.add(t.assignedToId);
    } else {
      // Current on-call shifts (any state)
      const now = new Date();
      const shifts = await this.prisma.onCallShift.findMany({
        where: { startAt: { lte: now }, endAt: { gt: now } },
        select: { technicianId: true },
      });
      for (const s of shifts) recipients.add(s.technicianId);
      // Still nothing? Broadcast to every active technician.
      if (!recipients.size) {
        const techs = await this.prisma.user.findMany({
          where: {
            isActive: true,
            role: { code: { in: ['TECHNICIAN', 'IT_MANAGER', 'ADMINISTRATOR'] } },
          },
          select: { id: true },
        });
        for (const u of techs) recipients.add(u.id);
      }
    }

    const priorityLabel: Record<string, string> = { P1: 'CRITICAL', P2: 'HIGH', P3: 'MEDIUM', P4: 'LOW' };
    const payload: NotifyPayload = {
      title: `[${priorityLabel[t.priority] ?? t.priority}] New call: ${t.store?.code ?? 'HQ'}`,
      body:  `${t.subject}`,
      tag:   `ticket-${t.id}`,
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      url:   `/helpdesk/${t.id}`,
      sound: t.priority === 'P1' ? 'critical' : 'standard',
      vibrate: t.priority === 'P1' ? [300, 100, 300, 100, 300] : [200, 100, 200],
      requireInteraction: t.priority === 'P1',
    };
    for (const uid of recipients) {
      await this.sendToUser(uid, payload).catch(() => {});
    }
  }
}

export interface NotifyPayload {
  title:   string;
  body:    string;
  tag?:    string;
  icon?:   string;
  badge?:  string;
  url?:    string;
  sound?:  'standard' | 'critical';
  vibrate?: number[];
  requireInteraction?: boolean;
}
