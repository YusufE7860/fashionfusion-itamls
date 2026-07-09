import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateStoreDto, StoresService } from './stores.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('stores')
export class StoresController {
  constructor(private svc: StoresService) {}

  @Get() @RequirePermissions(Permissions.StoresRead) list() { return this.svc.list(); }
  @Get(':id') @RequirePermissions(Permissions.StoresRead) byId(@Param('id') id: string) { return this.svc.byId(id); }

  @Post()
  @RequirePermissions(Permissions.StoresWrite)
  create(@Body() dto: CreateStoreDto) { return this.svc.create(dto); }
}
