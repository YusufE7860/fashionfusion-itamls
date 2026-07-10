import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BackupsService, UpdateJobDto, UpsertPcDto } from './backups.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller()
export class BackupsController {
  constructor(private svc: BackupsService) {}

  @Get('stores/:id/backups')
  @RequirePermissions(Permissions.BackupsRead)
  forStore(@Param('id') id: string) { return this.svc.forStore(id); }

  @Patch('stores/:id/backup-job')
  @RequirePermissions(Permissions.BackupsManage)
  updateJob(@Param('id') id: string, @Body() dto: UpdateJobDto) {
    return this.svc.updateJob(id, dto);
  }

  @Post('stores/:id/pcs')
  @RequirePermissions(Permissions.BackupsManage)
  addPc(@Param('id') id: string, @Body() body: { name: string } & UpsertPcDto) {
    const { name, ...rest } = body;
    return this.svc.upsertPc(id, name, rest);
  }

  @Patch('stores/:id/pcs/:name')
  @RequirePermissions(Permissions.BackupsManage)
  updatePc(@Param('id') id: string, @Param('name') name: string, @Body() dto: UpsertPcDto) {
    return this.svc.upsertPc(id, name, dto);
  }

  @Delete('store-pcs/:id')
  @RequirePermissions(Permissions.BackupsManage)
  removePc(@Param('id') id: string) { return this.svc.removePc(id); }

  @Get('backups/runs')
  @RequirePermissions(Permissions.BackupsRead)
  recent(@Query('limit') limit = '100') {
    return this.svc.recent(Number(limit) || 100);
  }

  @Get('backups/:id/download')
  @RequirePermissions(Permissions.BackupsRead)
  async download(@Param('id') id: string, @Res() res: Response) {
    const url = await this.svc.downloadUrl(id);
    // Redirect the browser to the pre-signed MinIO URL for the actual bytes
    res.redirect(url);
  }
}
