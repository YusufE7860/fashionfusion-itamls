import { Controller, Get, Query } from '@nestjs/common';
import { TonerDashboardService } from './toner-dashboard.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('toner/dashboard')
export class TonerDashboardController {
  constructor(private svc: TonerDashboardService) {}

  @Get()
  @RequirePermissions(Permissions.TonerOrderCreate)
  get(@Query('year') year = String(new Date().getFullYear())) {
    return this.svc.overview(Number(year));
  }
}
