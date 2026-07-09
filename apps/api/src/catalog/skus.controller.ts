import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateSkuDto, SkusService, UpdateSkuDto } from './skus.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('skus')
export class SkusController {
  constructor(private svc: SkusService) {}

  @Get() list() { return this.svc.list(); }

  @Post()
  @RequirePermissions(Permissions.CatalogWrite)
  create(@Body() dto: CreateSkuDto) { return this.svc.create(dto); }

  @Patch(':id')
  @RequirePermissions(Permissions.CatalogWrite)
  update(@Param('id') id: string, @Body() dto: UpdateSkuDto) { return this.svc.update(id, dto); }
}
