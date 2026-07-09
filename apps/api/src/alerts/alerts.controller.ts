import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('alerts')
export class AlertsController {
  constructor(private svc: AlertsService) {}

  @Get()
  @RequirePermissions(Permissions.AssetsRead)
  list(@Query('active') active?: string) {
    return this.svc.list({ onlyActive: active !== 'false' });
  }

  @Get('summary')
  @RequirePermissions(Permissions.AssetsRead)
  summary() { return this.svc.summary(); }

  @Post(':id/dismiss')
  @RequirePermissions(Permissions.AssetsRead)
  dismiss(@Param('id') id: string) { return this.svc.dismiss(id); }

  @Post('run')
  @RequirePermissions(Permissions.UsersManage)
  run() { return this.svc.runAll(); }
}
