import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AreaManagersService, AreaManagerDto, RegionsService, RegionDto } from './org.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('regions')
export class RegionsController {
  constructor(private svc: RegionsService) {}

  @Get()
  @RequirePermissions(Permissions.StoresRead)
  list() { return this.svc.list(); }

  @Post()
  @RequirePermissions(Permissions.StoresWrite)
  create(@Body() dto: RegionDto) { return this.svc.create(dto); }

  @Patch(':id')
  @RequirePermissions(Permissions.StoresWrite)
  update(@Param('id') id: string, @Body() dto: RegionDto) { return this.svc.update(id, dto); }

  @Delete(':id')
  @RequirePermissions(Permissions.StoresWrite)
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}

@Controller('area-managers')
export class AreaManagersController {
  constructor(private svc: AreaManagersService) {}

  @Get()
  @RequirePermissions(Permissions.StoresRead)
  list(@Query('includeInactive') inc?: string) { return this.svc.list(inc === 'true'); }

  @Get(':id')
  @RequirePermissions(Permissions.StoresRead)
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @RequirePermissions(Permissions.StoresWrite)
  create(@Body() dto: AreaManagerDto) { return this.svc.create(dto); }

  @Patch(':id')
  @RequirePermissions(Permissions.StoresWrite)
  update(@Param('id') id: string, @Body() dto: AreaManagerDto) { return this.svc.update(id, dto); }

  @Delete(':id')
  @RequirePermissions(Permissions.StoresWrite)
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  @Post(':id/stores')
  @RequirePermissions(Permissions.StoresWrite)
  setStores(@Param('id') id: string, @Body() body: { storeIds: string[] }) {
    return this.svc.setStores(id, body.storeIds ?? []);
  }
}
