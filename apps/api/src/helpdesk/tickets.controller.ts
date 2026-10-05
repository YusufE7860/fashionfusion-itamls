import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CreateTicketDto, ListTicketsQuery, TicketsService, UpdateTicketDto } from './tickets.service';
import { CategoryDto, HelpdeskAdminService, SlaPolicyDto } from './categories.service';
import { EmailIngestService } from './email-ingest.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

const ctxFor = (req: any) => ({ userId: req.user?.sub, permissions: req.user?.permissions ?? [] });

@Controller('helpdesk')
export class TicketsController {
  constructor(
    private svc: TicketsService,
    private admin: HelpdeskAdminService,
    private emailIngest: EmailIngestService,
  ) {}

  // ---- Email ingest ----
  @Post('email/poll-now')
  @RequirePermissions(Permissions.TicketsManageCategories)
  pollEmailNow() { return this.emailIngest.pollNow(); }

  @Get('email/status')
  @RequirePermissions(Permissions.TicketsManageCategories)
  emailStatus() {
    const cfg = {
      configured: !!(process.env.HELPDESK_POP3_HOST && process.env.HELPDESK_POP3_USER && process.env.HELPDESK_POP3_PASS),
      host: process.env.HELPDESK_POP3_HOST ?? null,
      user: process.env.HELPDESK_POP3_USER ?? null,
      port: Number(process.env.HELPDESK_POP3_PORT ?? 995),
      security: process.env.HELPDESK_POP3_SECURITY ?? 'ssl',
      deleteAfter: (process.env.HELPDESK_POP3_DELETE_AFTER ?? 'true') === 'true',
    };
    return cfg;
  }

  // ---- Tickets ----
  @Get('tickets')
  @RequirePermissions(Permissions.TicketsRead)
  list(@Query() q: ListTicketsQuery, @Req() req: any) { return this.svc.list(q, ctxFor(req)); }

  @Post('tickets')
  @RequirePermissions(Permissions.TicketsWrite)
  create(@Body() dto: CreateTicketDto, @Req() req: any) { return this.svc.create(dto, ctxFor(req)); }

  @Get('tickets/:id')
  @RequirePermissions(Permissions.TicketsRead)
  get(@Param('id') id: string, @Req() req: any) { return this.svc.get(id, ctxFor(req)); }

  @Patch('tickets/:id')
  @RequirePermissions(Permissions.TicketsWrite)
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto, @Req() req: any) {
    return this.svc.update(id, dto, ctxFor(req));
  }

  @Post('tickets/:id/comments')
  @RequirePermissions(Permissions.TicketsWrite)
  comment(@Param('id') id: string, @Body() body: { body: string; isInternal?: boolean }, @Req() req: any) {
    return this.svc.addComment(id, body.body, !!body.isInternal, ctxFor(req));
  }

  @Post('tickets/:id/rate')
  @RequirePermissions(Permissions.TicketsWrite)
  rate(@Param('id') id: string, @Body() dto: { rating: number; comment?: string }, @Req() req: any) {
    return this.svc.rateSatisfaction(id, dto.rating, dto.comment, ctxFor(req));
  }

  @Post('tickets/bulk-assign')
  @RequirePermissions(Permissions.TicketsAssign)
  bulkAssign(@Body() dto: { ticketIds: string[]; assignedToId: string | null }, @Req() req: any) {
    return this.svc.bulkAssign(dto.ticketIds ?? [], dto.assignedToId ?? null, ctxFor(req));
  }

  // ---- Attachments ----
  @Post('tickets/:id/attachments')
  @RequirePermissions(Permissions.TicketsWrite)
  @UseInterceptors(FileInterceptor('file'))
  upload(@Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: any) {
    if (!file) throw new Error('file is required (multipart field name: "file")');
    return this.svc.addAttachment(id, file as any, ctxFor(req));
  }

  @Get('attachments/:id/download')
  @RequirePermissions(Permissions.TicketsRead)
  async download(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    const url = await this.svc.getAttachmentDownloadUrl(id, ctxFor(req));
    res.redirect(url);
  }

  @Delete('attachments/:id')
  @RequirePermissions(Permissions.TicketsWrite)
  deleteAttachment(@Param('id') id: string, @Req() req: any) {
    return this.svc.deleteAttachment(id, ctxFor(req));
  }

  // ---- Reports ----
  @Get('reports')
  @RequirePermissions(Permissions.TicketsReports)
  reports(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.reports(from, to);
  }

  @Get('reports/export.csv')
  @RequirePermissions(Permissions.TicketsReports)
  async exportCsv(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @Res() res: Response) {
    const r = await this.svc.reports(from, to);
    const rows: string[] = ['Metric,Bucket,Value'];
    const push = (metric: string, bucket: string, value: number | string) => rows.push([metric, bucket, value].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    r.byStatus.forEach((s) => push('By status', s.status, s.count));
    r.byPriority.forEach((s) => push('By priority', s.priority, s.count));
    r.byCategory.forEach((s) => push('By category', s.name ?? s.categoryId, s.count));
    r.byStore.forEach((s) => push('By store', s.name ?? '—', s.count));
    r.byAssignee.forEach((s) => push('By assignee', s.name ?? '—', s.count));
    for (const p of ['P1','P2','P3','P4']) {
      push('MTTR minutes', p, (r.mttrByPriority as any)[p].avg);
      push('MTTFR minutes', p, (r.mttfrByPriority as any)[p].avg);
    }
    push('SLA %', 'Response', r.sla.responsePercent);
    push('SLA %', 'Resolve', r.sla.resolvePercent);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="helpdesk-report-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(rows.join('\n'));
  }

  // ---- Admin: categories ----
  @Get('categories')
  @RequirePermissions(Permissions.TicketsRead)
  listCategories(@Query('includeInactive') inc?: string) { return this.admin.listCategories(inc === 'true'); }

  @Post('categories')
  @RequirePermissions(Permissions.TicketsManageCategories)
  createCategory(@Body() dto: CategoryDto) { return this.admin.createCategory(dto); }

  @Patch('categories/:id')
  @RequirePermissions(Permissions.TicketsManageCategories)
  updateCategory(@Param('id') id: string, @Body() dto: CategoryDto) { return this.admin.updateCategory(id, dto); }

  @Delete('categories/:id')
  @RequirePermissions(Permissions.TicketsManageCategories)
  deleteCategory(@Param('id') id: string) { return this.admin.deleteCategory(id); }

  // ---- Admin: SLA policies ----
  @Get('sla-policies')
  @RequirePermissions(Permissions.TicketsRead)
  listSlas() { return this.admin.listSlaPolicies(); }

  @Post('sla-policies')
  @RequirePermissions(Permissions.TicketsManageCategories)
  createSla(@Body() dto: SlaPolicyDto) { return this.admin.createSlaPolicy(dto); }

  @Patch('sla-policies/:id')
  @RequirePermissions(Permissions.TicketsManageCategories)
  updateSla(@Param('id') id: string, @Body() dto: SlaPolicyDto) { return this.admin.updateSlaPolicy(id, dto); }
}
