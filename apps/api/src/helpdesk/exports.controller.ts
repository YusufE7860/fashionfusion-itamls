import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HelpdeskExportsService } from './exports.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('helpdesk/exports')
export class HelpdeskExportsController {
  constructor(private svc: HelpdeskExportsService) {}

  @Get('reports')
  @RequirePermissions(Permissions.TicketsReports)
  reports() { return this.svc.availableReports(); }

  /** On-demand file download — ?reportKey=...&format=XLSX|PDF&since=...&until=... */
  @Get('download')
  @RequirePermissions(Permissions.ReportsExport)
  async download(
    @Query('reportKey') reportKey: string,
    @Query('format') format: 'XLSX' | 'PDF',
    @Query('since') since: string | undefined,
    @Query('until') until: string | undefined,
    @Res() res: Response,
  ) {
    const rendered = await this.svc.render(reportKey, {
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
    });
    const buf = format === 'PDF'
      ? await this.svc.toPdf(rendered)
      : await this.svc.toXlsx(rendered);
    const ext  = format === 'PDF' ? 'pdf' : 'xlsx';
    const mime = format === 'PDF' ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition',
      `attachment; filename="${reportKey.replace(/[^\w.-]+/g, '_')}-${new Date().toISOString().slice(0,10)}.${ext}"`);
    res.send(buf);
  }

  // ---------- Scheduled reports ----------
  @Get('scheduled')
  @RequirePermissions(Permissions.ReportsExport)
  listScheduled() { return this.svc.listScheduled(); }

  @Post('scheduled')
  @RequirePermissions(Permissions.ReportsExport)
  createScheduled(@Body() body: any, @Req() req: any) { return this.svc.createScheduled(body, req.user?.sub); }

  @Patch('scheduled/:id')
  @RequirePermissions(Permissions.ReportsExport)
  updateScheduled(@Param('id') id: string, @Body() body: any) { return this.svc.updateScheduled(id, body); }

  @Delete('scheduled/:id')
  @RequirePermissions(Permissions.ReportsExport)
  deleteScheduled(@Param('id') id: string) { return this.svc.deleteScheduled(id); }
}
