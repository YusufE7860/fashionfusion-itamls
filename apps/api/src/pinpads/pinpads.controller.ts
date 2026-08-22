import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PinPadsService } from './pinpads.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('pinpads')
export class PinPadsController {
  constructor(private svc: PinPadsService) {}

  @Get()
  @RequirePermissions(Permissions.PinPadsRead)
  list(@Query() q: { storeId?: string; status?: string; q?: string }) {
    return this.svc.list({ storeId: q.storeId, status: q.status, q: q.q });
  }

  @Get('summary')
  @RequirePermissions(Permissions.PinPadsRead)
  summary() { return this.svc.summary(); }

  @Get('export.csv')
  @RequirePermissions(Permissions.PinPadsRead)
  async exportCsv(@Query() q: { storeId?: string; status?: string; q?: string }, @Res() res: Response) {
    const csv = await this.svc.exportCsv({ storeId: q.storeId, status: q.status, q: q.q });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pinpads-${stamp}.csv"`);
    res.send(csv);
  }

  @Get(':id')
  @RequirePermissions(Permissions.PinPadsRead)
  byId(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @RequirePermissions(Permissions.PinPadsWrite)
  create(@Body() dto: any, @Req() req: any) {
    return this.svc.manualCreate(dto, req.user?.sub);
  }

  @Post(':id/confirm')
  @RequirePermissions(Permissions.PinPadsWrite)
  confirm(@Param('id') id: string, @Req() req: any) {
    return this.svc.confirm(id, req.user?.sub);
  }

  @Post(':id/return')
  @RequirePermissions(Permissions.PinPadsWrite)
  markReturned(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.svc.markReturned(id, dto, req.user?.sub);
  }

  @Post(':id/received')
  @RequirePermissions(Permissions.PinPadsWrite)
  setReceived(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.svc.setReceived(id, dto, req.user?.sub);
  }

  @Patch(':id/notes')
  @RequirePermissions(Permissions.PinPadsWrite)
  updateNotes(@Param('id') id: string, @Body() dto: { notes: string }) {
    return this.svc.updateNotes(id, dto.notes ?? '');
  }
}
