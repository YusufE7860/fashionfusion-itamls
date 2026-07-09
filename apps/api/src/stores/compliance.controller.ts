import { Controller, Get, Param } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller()
export class ComplianceController {
  constructor(private svc: ComplianceService) {}

  @Get('stores/:id/compliance')
  @RequirePermissions(Permissions.StoresRead)
  forStore(@Param('id') id: string) { return this.svc.forStore(id); }

  @Get('compliance/summary')
  @RequirePermissions(Permissions.StoresRead)
  summary() { return this.svc.summary(); }
}
