import { Controller, Get, Query } from '@nestjs/common';
import { WarrantyService } from './warranty.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('warranties')
export class WarrantyController {
  constructor(private svc: WarrantyService) {}

  @Get('expiring')
  @RequirePermissions(Permissions.WarrantiesRead)
  expiring(@Query('in') inDays = '90') {
    return this.svc.expiring(Number(inDays) || 90);
  }

  @Get('dashboard')
  @RequirePermissions(Permissions.WarrantiesRead)
  dashboard() { return this.svc.dashboard(); }
}
