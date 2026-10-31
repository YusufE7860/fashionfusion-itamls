import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { HelpdeskV3Service } from './helpdesk-v3.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

const ctx = (req: any) => ({ userId: req.user?.sub, permissions: req.user?.permissions ?? [] });

/**
 * All helpdesk v3 endpoints live under /api/v1/helpdesk/* alongside the base
 * tickets routes. Grouped by feature so the UI knows where to look.
 */
@Controller('helpdesk')
export class HelpdeskV3Controller {
  constructor(private svc: HelpdeskV3Service) {}

  // ---------- Watchers ----------
  @Get('tickets/:id/watchers')
  @RequirePermissions(Permissions.TicketsRead)
  listWatchers(@Param('id') id: string) { return this.svc.listWatchers(id); }

  @Post('tickets/:id/watchers')
  @RequirePermissions(Permissions.TicketsWrite)
  addWatcher(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.addWatcher(id, body, ctx(req));
  }

  @Delete('tickets/:id/watchers/:watcherId')
  @RequirePermissions(Permissions.TicketsWrite)
  removeWatcher(@Param('id') id: string, @Param('watcherId') wid: string) {
    return this.svc.removeWatcher(id, wid);
  }

  // ---------- Links / merge ----------
  @Get('tickets/:id/links')
  @RequirePermissions(Permissions.TicketsRead)
  listLinks(@Param('id') id: string) { return this.svc.listLinks(id); }

  @Post('tickets/links')
  @RequirePermissions(Permissions.TicketsMerge)
  linkTickets(@Body() body: any, @Req() req: any) { return this.svc.linkTickets(body, ctx(req)); }

  @Delete('tickets/links/:linkId')
  @RequirePermissions(Permissions.TicketsMerge)
  unlinkTickets(@Param('linkId') lid: string) { return this.svc.unlinkTickets(lid); }

  // ---------- Approvals ----------
  @Get('tickets/:id/approvals')
  @RequirePermissions(Permissions.TicketsRead)
  listApprovals(@Param('id') id: string) { return this.svc.listApprovals(id); }

  @Post('tickets/:id/approvals')
  @RequirePermissions(Permissions.TicketsWrite)
  requestApproval(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.requestApproval(id, body, ctx(req));
  }

  @Patch('approvals/:approvalId')
  @RequirePermissions(Permissions.TicketsRead)
  decideApproval(@Param('approvalId') aid: string, @Body() body: any, @Req() req: any) {
    return this.svc.decideApproval(aid, body, ctx(req));
  }

  // ---------- Knowledge base ----------
  @Get('kb')
  @RequirePermissions(Permissions.KbRead)
  listArticles(@Query('q') q?: string, @Query('categoryId') categoryId?: string) {
    return this.svc.listArticles({ q, categoryId });
  }

  @Get('kb/:slug')
  @RequirePermissions(Permissions.KbRead)
  getArticle(@Param('slug') slug: string) { return this.svc.getArticleBySlug(slug); }

  @Post('kb')
  @RequirePermissions(Permissions.KbWrite)
  createArticle(@Body() body: any, @Req() req: any) { return this.svc.createArticle(body, ctx(req)); }

  @Patch('kb/:id')
  @RequirePermissions(Permissions.KbWrite)
  updateArticle(@Param('id') id: string, @Body() body: any) { return this.svc.updateArticle(id, body); }

  @Delete('kb/:id')
  @RequirePermissions(Permissions.KbWrite)
  deleteArticle(@Param('id') id: string) { return this.svc.deleteArticle(id); }

  @Post('kb/:id/helpful')
  @RequirePermissions(Permissions.KbRead)
  markHelpful(@Param('id') id: string, @Body() body: { helpful: boolean }) {
    return this.svc.markHelpful(id, !!body.helpful);
  }

  @Get('kb/deflection/suggest')
  @RequirePermissions(Permissions.TicketsWrite)
  deflect(@Query('subject') subject = '', @Query('categoryId') categoryId?: string) {
    return this.svc.deflectionSuggestions({ subject, categoryId });
  }

  // ---------- Scheduled tickets ----------
  @Get('scheduled')
  @RequirePermissions(Permissions.TicketsManageSchedules)
  listScheduled() { return this.svc.listScheduled(); }

  @Post('scheduled')
  @RequirePermissions(Permissions.TicketsManageSchedules)
  createScheduled(@Body() body: any, @Req() req: any) { return this.svc.createScheduled(body, ctx(req)); }

  @Patch('scheduled/:id')
  @RequirePermissions(Permissions.TicketsManageSchedules)
  updateScheduled(@Param('id') id: string, @Body() body: any) { return this.svc.updateScheduled(id, body); }

  @Delete('scheduled/:id')
  @RequirePermissions(Permissions.TicketsManageSchedules)
  deleteScheduled(@Param('id') id: string) { return this.svc.deleteScheduled(id); }

  // ---------- Metrics ----------
  @Get('metrics/sla-burn-down/:ticketId')
  @RequirePermissions(Permissions.TicketsReports)
  slaBurn(@Param('ticketId') tid: string) { return this.svc.slaBurnDown(tid); }

  @Get('metrics/trends-90d')
  @RequirePermissions(Permissions.TicketsReports)
  trends() { return this.svc.trendsLast90Days(); }

  @Get('metrics/fcr-csat')
  @RequirePermissions(Permissions.TicketsReports)
  fcrCsat() { return this.svc.fcrAndCsat(); }

  @Get('metrics/cost')
  @RequirePermissions(Permissions.TicketsReports)
  cost() { return this.svc.costPerTicket(); }

  @Get('metrics/repeat-offenders')
  @RequirePermissions(Permissions.TicketsReports)
  repeatOffenders() { return this.svc.repeatOffenders(); }

  // ---------- Audit log viewer ----------
  @Get('audit')
  @RequirePermissions(Permissions.AuditLogRead)
  audit(@Query('ticketId') ticketId?: string, @Query('actorId') actorId?: string, @Query('limit') limit?: string) {
    return this.svc.auditEvents({ ticketId, actorId, limit: limit ? Number(limit) : undefined });
  }

  // ---------- Asset prefill ----------
  @Get('asset-prefill/:assetId')
  @RequirePermissions(Permissions.TicketsWrite)
  assetPrefill(@Param('assetId') aid: string) { return this.svc.assetPrefill(aid); }

  // ---------- Business hours + holidays ----------
  @Get('business-hours')
  @RequirePermissions(Permissions.TicketsRead)
  getBH() { return this.svc.getBusinessHours(); }

  @Patch('business-hours')
  @RequirePermissions(Permissions.TicketsManageBusinessHours)
  updateBH(@Body() body: any) { return this.svc.updateBusinessHours(body); }

  @Get('holidays')
  @RequirePermissions(Permissions.TicketsRead)
  listH() { return this.svc.listHolidays(); }

  @Post('holidays')
  @RequirePermissions(Permissions.TicketsManageBusinessHours)
  addH(@Body() body: any) { return this.svc.addHoliday(body); }

  @Delete('holidays/:id')
  @RequirePermissions(Permissions.TicketsManageBusinessHours)
  rmH(@Param('id') id: string) { return this.svc.removeHoliday(id); }

  // ---------- Skills ----------
  @Get('users/:userId/skills')
  @RequirePermissions(Permissions.TicketsManageSkills)
  listSkills(@Param('userId') uid: string) { return this.svc.listSkills(uid); }

  @Post('users/:userId/skills')
  @RequirePermissions(Permissions.TicketsManageSkills)
  setSkills(@Param('userId') uid: string, @Body() body: { skills: any[] }) {
    return this.svc.setSkills(uid, body.skills ?? []);
  }
}
