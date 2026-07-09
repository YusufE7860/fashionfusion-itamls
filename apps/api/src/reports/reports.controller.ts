import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

const REPORTS = new Set([
  'assets-by-category',
  'assets-by-store',
  'warranty-expiring-90',
  'repair-cost',
  'store-equipment-value',
]);

@Controller('reports')
export class ReportsController {
  constructor(private svc: ReportsService) {}

  @Get(':name')
  @RequirePermissions(Permissions.ReportsRead)
  async get(@Param('name') name: string, @Query('format') format = 'json', @Res() res: Response) {
    if (!REPORTS.has(name)) throw new BadRequestException('Unknown report');
    if (format === 'xlsx') {
      const buf = await this.svc.xlsx(name as any);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
      return res.send(buf);
    }
    if (format === 'pdf') {
      const buf = await this.svc.pdf(name as any);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
      return res.send(buf);
    }
    const data = await this.svc.data(name as any);
    return res.json(data);
  }

  @Get()
  @RequirePermissions(Permissions.ReportsRead)
  list() {
    return [
      { name: 'assets-by-category',     title: 'Assets by Category' },
      { name: 'assets-by-store',         title: 'Assets by Store' },
      { name: 'warranty-expiring-90',    title: 'Warranty expiring (90 days)' },
      { name: 'repair-cost',             title: 'Repair cost' },
      { name: 'store-equipment-value',   title: 'Store equipment value' },
    ];
  }
}
