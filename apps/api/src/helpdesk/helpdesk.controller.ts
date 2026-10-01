import { Controller, Get, Post, Query } from '@nestjs/common';
import { HelpdeskService } from './helpdesk.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

/**
 * LEGACY: external-helpdesk integration (Kaseya / Freshdesk sync).
 * The native ticket system lives at HelpdeskController in ./tickets.controller.
 * This lives under /helpdesk/external to avoid path collisions.
 */
@Controller('helpdesk/external')
export class HelpdeskExternalController {
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
