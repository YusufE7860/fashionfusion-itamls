import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateSupplierDto, SuppliersService } from './suppliers.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('suppliers')
export class SuppliersController {
  constructor(private svc: SuppliersService) {}
  @Get() list() { return this.svc.list(); }
  @Post() @RequirePermissions(Permissions.SuppliersManage) create(@Body() dto: CreateSupplierDto) { return this.svc.create(dto); }
}
