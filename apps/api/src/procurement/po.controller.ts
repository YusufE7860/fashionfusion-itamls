import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreatePoDto, PoService } from './po.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('purchase-orders')
export class PoController {
  constructor(private svc: PoService) {}
  @Get() list() { return this.svc.list(); }

  @Post()
  @RequirePermissions(Permissions.ProcurementApproveFinance)
  create(@Body() dto: CreatePoDto) { return this.svc.create(dto); }
}
