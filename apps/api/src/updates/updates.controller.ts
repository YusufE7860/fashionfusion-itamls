import { Controller, Get, Post, Query } from '@nestjs/common';
import { UpdatesService } from './updates.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('admin/updates')
export class UpdatesController {
  constructor(private svc: UpdatesService) {}

  @Get('status')
  @RequirePermissions(Permissions.UsersManage)
  status() { return this.svc.status(); }

  @Post('install')
  @RequirePermissions(Permissions.UsersManage)
  install() { return this.svc.install(); }

  @Get('log')
  @RequirePermissions(Permissions.UsersManage)
  log(@Query('lines') lines = '200') { return this.svc.log(Number(lines) || 200); }
}
