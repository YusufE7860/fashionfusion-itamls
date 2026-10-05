import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import { PrismaService } from '../prisma/prisma.service';

export type WebhookEvent =
  | 'ticket.created'
  | 'ticket.status_changed'
  | 'ticket.priority_changed'
  | 'ticket.assigned'
  | 'ticket.comment_added'
  | 'ticket.resolved'
  | 'ticket.closed'
  | 'ticket.reopened'
  | 'ticket.sla_breached';

interface WebhookPayload {
  event: WebhookEvent;
  deliveredAt: string;
  ticket: any;
  changedFields?: Record<string, { from: any; to: any }>;
  comment?: { id: string; body: string; author: string; isInternal: boolean };
  actor?: { id: string; name: string } | null;
}

/**
 * Outbound webhook delivery. Fires asynchronously (no await back to the
 * caller — avoids slowing the API). Each attempt is logged in WebhookDelivery
 * with status + response for debugging.
 *
 * The receiver verifies the payload with HMAC-SHA256:
 *     const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
 *     if (expected !== req.headers['x-itamls-signature']) reject();
 */
@Injectable()
export class HelpdeskWebhooksService {
  private readonly logger = new Logger(HelpdeskWebhooksService.name);
  constructor(private prisma: PrismaService) {}

  // -------- Admin CRUD --------
  list() {
    return this.prisma.webhook.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(dto: { name: string; url: string; events?: string; secret?: string }) {
    const secret = dto.secret && dto.secret.length >= 16 ? dto.secret : randomBytes(32).toString('hex');
    return this.prisma.webhook.create({
      data: {
        name: dto.name, url: dto.url, secret,
        events: dto.events?.trim() || 'ticket.*',
      },
    });
  }

  async update(id: string, dto: { name?: string; url?: string; events?: string; isActive?: boolean; secret?: string }) {
    return this.prisma.webhook.update({ where: { id }, data: dto });
  }

  remove(id: string) {
    return this.prisma.webhook.delete({ where: { id } });
  }

  async recentDeliveries(webhookId: string, limit = 25) {
    return this.prisma.webhookDelivery.findMany({
      where: { webhookId }, orderBy: { deliveredAt: 'desc' }, take: limit,
    });
  }

  async testDelivery(id: string) {
    const hook = await this.prisma.webhook.findUnique({ where: { id } });
    if (!hook) return { ok: false, error: 'Webhook not found' };
    const payload: any = {
      event: 'ticket.created',
      deliveredAt: new Date().toISOString(),
      ticket: { id: 'test', code: 'FF-TEST-0000', subject: 'Test delivery', status: 'NEW', priority: 'P3' },
    };
    return this.deliverOne(hook, 'ticket.created', payload);
  }

  // -------- Fire from service layer --------
  /** Fan out an event to every active, matching webhook. Non-blocking. */
  async emit(event: WebhookEvent, payload: Omit<WebhookPayload, 'event' | 'deliveredAt'>) {
    const hooks = await this.prisma.webhook.findMany({ where: { isActive: true } });
    const matches = hooks.filter((h) => this.matchesEvent(h.events, event));
    const full: WebhookPayload = { event, deliveredAt: new Date().toISOString(), ...payload };
    // Fire-and-forget
    for (const h of matches) this.deliverOne(h, event, full).catch(() => {});
  }

  private matchesEvent(pattern: string, event: WebhookEvent): boolean {
    const parts = pattern.split(',').map((p) => p.trim()).filter(Boolean);
    for (const p of parts) {
      if (p === event) return true;
      if (p.endsWith('.*') && event.startsWith(p.slice(0, -1))) return true;
      if (p === '*') return true;
    }
    return false;
  }

  private async deliverOne(hook: { id: string; url: string; secret: string }, event: string, payload: any) {
    const body = JSON.stringify(payload);
    const sig = createHmac('sha256', hook.secret).update(body).digest('hex');
    let status: number | null = null;
    let response = '';
    try {
      const result = await this.post(hook.url, body, {
        'Content-Type': 'application/json',
        'X-ITAMLS-Event': event,
        'X-ITAMLS-Signature': sig,
        'X-ITAMLS-Delivery': randomBytes(8).toString('hex'),
        'User-Agent': 'ITAMLS-Webhooks/1.0',
      });
      status = result.status;
      response = result.body.slice(0, 2000);
    } catch (e: any) {
      response = e?.message ?? String(e);
    }
    const succeeded = !!status && status >= 200 && status < 300;

    await this.prisma.$transaction([
      this.prisma.webhookDelivery.create({
        data: { webhookId: hook.id, event, payload: body, status, response, succeeded },
      }),
      this.prisma.webhook.update({
        where: { id: hook.id },
        data: {
          lastSentAt: new Date(), lastStatus: status, lastError: succeeded ? null : response,
          totalSent: { increment: 1 },
          totalFail: succeeded ? undefined : { increment: 1 },
        },
      }),
    ]);
    return { ok: succeeded, status, body: response.slice(0, 500) };
  }

  private post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        timeout: 10_000,
      }, (res) => {
        let data = '';
        res.setEncoding('utf-8');
        res.on('data', (c) => data += c);
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Webhook timeout after 10s')));
      req.end(body);
    });
  }
}
