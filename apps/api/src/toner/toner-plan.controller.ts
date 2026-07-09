import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { TonerPlanService, UpsertPlanDto } from './toner-plan.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('toner/plan')
export class TonerPlanController {
  constructor(private svc: TonerPlanService) {}

  @Get()
  @RequirePermissions(Permissions.TonerManage)
  list(@Query('year') year = String(new Date().getFullYear())) {
    return this.svc.list(Number(year));
  }

  @Get('summary')
  @RequirePermissions(Permissions.TonerManage)
  summary(@Query('year') year = String(new Date().getFullYear())) {
    return this.svc.annualSummary(Number(year));
  }

  @Post()
  @RequirePermissions(Permissions.TonerManage)
  upsert(@Body() dto: UpsertPlanDto) { return this.svc.upsert(dto); }

  @Delete(':id')
  @RequirePermissions(Permissions.TonerManage)
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
