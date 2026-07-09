import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { HelpdeskService } from './helpdesk.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('helpdesk')
export class HelpdeskController {
  constructor(private svc: HelpdeskService) {}

  @Get('tickets')
  @RequirePermissions(Permissions.RepairsRead)
  list(@Query('assetId') assetId?: string) {
    return assetId ? this.svc.byAsset(assetId) : this.svc.recent();
  }

  @Post('sync')
  @RequirePermissions(Permissions.UsersManage)
  sync() { return this.svc.sync(); }
}
