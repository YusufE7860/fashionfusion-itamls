import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { CreatePoDto, PoService } from './po.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('purchase-orders')
export class PoController {
  constructor(private svc: PoService) {}
  @Get() list() { return this.svc.list(); }

  @Get(':id')
  detail(@Param('id') id: string) { return this.svc.detail(id); }

  @Post()
  @RequirePermissions(Permissions.ProcurementApproveFinance)
  create(@Body() dto: CreatePoDto) { return this.svc.create(dto); }

  /** Downloadable PDF that matches the printed Fashion Fusion PO book. */
  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const { buf, filename } = await this.svc.pdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  }
}
