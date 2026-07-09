import { Module } from '@nestjs/common';
import { TonerTypesController } from './toner-types.controller';
import { TonerTypesService } from './toner-types.service';
import { TonerPlanController } from './toner-plan.controller';
import { TonerPlanService } from './toner-plan.service';
import { TonerOrdersController } from './toner-orders.controller';
import { TonerOrdersService } from './toner-orders.service';
import { TonerDashboardController } from './toner-dashboard.controller';
import { TonerDashboardService } from './toner-dashboard.service';

@Module({
  controllers: [TonerTypesController, TonerPlanController, TonerOrdersController, TonerDashboardController],
  providers: [TonerTypesService, TonerPlanService, TonerOrdersService, TonerDashboardService],
})
export class TonerModule {}
