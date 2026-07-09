import { Controller, Get, Post } from '@nestjs/common';
import { DepreciationService } from './depreciation.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('depreciation')
export class DepreciationController {
  constructor(private svc: DepreciationService) {}

  @Get('history')
  @RequirePermissions(Permissions.ReportsRead)
  history() { return this.svc.history(); }

  @Get('forecast')
  @RequirePermissions(Permissions.ReportsRead)
  forecast() { return this.svc.forecast(); }

  @Post('run')
  @RequirePermissions(Permissions.UsersManage)
  run() { return this.svc.run(); }
}
