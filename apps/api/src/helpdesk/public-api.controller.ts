import {
  BadRequestException, Body, Controller, Get, Headers, Param, Post, UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/permissions.decorator';
import { ApiKeysService } from '../discovery/api-keys.service';
import { TicketsService } from './tickets.service';

/**
 * Public helpdesk API for the Ops app (or any other integration).
 *
 * Authentication: X-Api-Key header with an ApiKey of scope OPS or FULL.
 * Create one in Admin > API Keys. Rate limit is per-key via lastUsedAt
 * tracking (basic throttle; add proper rate-limit middleware if abuse starts).
 *
 * All endpoints require the key to resolve a reporter identity. Options:
 *   1. Pass X-ITAMLS-Reporter-Email header (preferred) — matches an ITAMLS user
 *   2. Fall back to the key's createdBy (every call appears from the same user)
 *
 * This lets your Ops app forward the store manager's identity through, so
 * the ticket's reporter + store scope is accurate without creating a user
 * account for every store assistant.
 */
@Controller('public/helpdesk')
export class PublicHelpdeskController {
  constructor(
    private prisma: PrismaService,
    private apiKeys: ApiKeysService,
    private tickets: TicketsService,
  ) {}

  private async authAndResolveReporter(apiKey: string, reporterEmail?: string, storeCode?: string) {
    const k = await this.apiKeys.validate(apiKey);
    if (!k || k.revokedAt) throw new UnauthorizedException('Invalid API key');
    if (!['OPS', 'FULL'].includes(k.scope)) throw new UnauthorizedException('Key not authorized for the helpdesk API');

    // Reporter: match by email, fall back to the key creator
    let reporter = reporterEmail
      ? await this.prisma.user.findFirst({ where: { email: { equals: reporterEmail, mode: 'insensitive' } } })
      : null;
    if (!reporter && k.createdById) reporter = await this.prisma.user.findUnique({ where: { id: k.createdById } });
    if (!reporter) throw new UnauthorizedException('Cannot resolve reporter; pass X-ITAMLS-Reporter-Email that matches an ITAMLS user, or set a createdBy on the API key');

    // Store: look up by code if provided (store codes are what the Ops app likely has)
    let storeId: string | undefined;
    if (storeCode) {
      const s = await this.prisma.store.findUnique({ where: { code: storeCode.toUpperCase() } });
      if (!s) throw new BadRequestException(`Unknown store code ${storeCode}`);
      storeId = s.id;
    } else if (reporter.storeId) {
      storeId = reporter.storeId;
    }

    return { reporter, storeId };
  }

  // ---------- Metadata ----------
  @Public() @Get('categories')
  async categories(@Headers('x-api-key') apiKey: string) {
    const k = await this.apiKeys.validate(apiKey);
    if (!k || k.revokedAt || !['OPS', 'FULL'].includes(k.scope)) throw new UnauthorizedException();
    return this.prisma.ticketCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true, code: true, name: true, description: true,
        defaultPriority: true, issueTemplate: true,
      },
    });
  }

  // ---------- Create a ticket ----------
  @Public() @Post('tickets')
  async create(
    @Headers('x-api-key') apiKey: string,
    @Headers('x-itamls-reporter-email') reporterEmail: string | undefined,
    @Headers('x-itamls-store-code')     storeCode: string | undefined,
    @Body() body: {
      subject: string;
      description: string;
      categoryCode: string;              // POS / NET / etc — easier for Ops app than cuid
      priority?: 'P1'|'P2'|'P3'|'P4';
      storeCode?: string;                // overrides header if present
      assetTag?: string;                 // optional asset link by tag
    },
  ) {
    const effectiveStoreCode = body.storeCode ?? storeCode;
    const { reporter, storeId } = await this.authAndResolveReporter(apiKey, reporterEmail, effectiveStoreCode);
    if (!body.categoryCode) throw new BadRequestException('categoryCode required');
    const cat = await this.prisma.ticketCategory.findUnique({ where: { code: body.categoryCode.toUpperCase() } });
    if (!cat || !cat.isActive) throw new BadRequestException(`Unknown or inactive category ${body.categoryCode}`);

    let assetId: string | undefined;
    if (body.assetTag) {
      const a = await this.prisma.asset.findUnique({ where: { assetTag: body.assetTag.toUpperCase() } });
      if (a) assetId = a.id;
    }

    const created = await this.tickets.create({
      subject: body.subject,
      description: body.description,
      categoryId: cat.id,
      priority: body.priority,
      storeId,
      assetId,
      source: 'OPS_APP' as any,
    }, {
      userId: reporter.id,
      permissions: ['tickets:read', 'tickets:read:all', 'tickets:write'],
    });

    return this.publicTicketShape(created);
  }

  // ---------- Fetch status ----------
  @Public() @Get('tickets/:code')
  async getByCode(@Headers('x-api-key') apiKey: string, @Param('code') code: string) {
    const k = await this.apiKeys.validate(apiKey);
    if (!k || k.revokedAt || !['OPS', 'FULL'].includes(k.scope)) throw new UnauthorizedException();
    const t = await this.prisma.ticket.findUnique({
      where: { code: code.toUpperCase() },
      include: {
        reporter:   { select: { fullName: true, email: true } },
        assignedTo: { select: { fullName: true, email: true } },
        store:      { select: { code: true, name: true } },
        category:   { select: { code: true, name: true } },
        comments:   { where: { isInternal: false }, include: { author: { select: { fullName: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!t) throw new BadRequestException('Ticket not found');
    return this.publicTicketShape(t);
  }

  // ---------- Add a comment ----------
  @Public() @Post('tickets/:code/comments')
  async comment(
    @Headers('x-api-key') apiKey: string,
    @Headers('x-itamls-reporter-email') reporterEmail: string | undefined,
    @Param('code') code: string,
    @Body() body: { body: string },
  ) {
    const { reporter } = await this.authAndResolveReporter(apiKey, reporterEmail);
    const t = await this.prisma.ticket.findUnique({ where: { code: code.toUpperCase() } });
    if (!t) throw new BadRequestException('Ticket not found');
    await this.tickets.addComment(t.id, body.body, false, {
      userId: reporter.id,
      permissions: ['tickets:read', 'tickets:read:all', 'tickets:write'],
    });
    return { ok: true };
  }

  // Public-shape (hide internals, flatten relations)
  private publicTicketShape(t: any) {
    return {
      code: t.code,
      subject: t.subject,
      description: t.description,
      status: t.status,
      priority: t.priority,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      resolvedAt: t.resolvedAt,
      closedAt: t.closedAt,
      category: t.category ? { code: t.category.code, name: t.category.name } : null,
      store:    t.store    ? { code: t.store.code,    name: t.store.name } : null,
      reporter: t.reporter ? { name: t.reporter.fullName, email: t.reporter.email } : null,
      assignedTo: t.assignedTo ? { name: t.assignedTo.fullName, email: t.assignedTo.email } : null,
      comments: (t.comments ?? []).map((c: any) => ({
        body: c.body, author: c.author?.fullName, at: c.createdAt,
      })),
      slaBreached: !!(t.slaBreachedResponse || t.slaBreachedResolve),
    };
  }
}
