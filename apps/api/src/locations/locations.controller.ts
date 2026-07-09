import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { LocationsService, CreateLocationDto } from './locations.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('locations')
export class LocationsController {
  constructor(private locations: LocationsService) {}

  @Get()
  list() {
    return this.locations.list();
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.locations.byId(id);
  }

  @Post()
  @RequirePermissions(Permissions.StoresWrite)
  create(@Body() dto: CreateLocationDto) {
    return this.locations.create(dto);
  }
}
