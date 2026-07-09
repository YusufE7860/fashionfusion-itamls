import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateRepairDto, RepairsService, TransitionRepairDto } from './repairs.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('repairs')
export class RepairsController {
  constructor(private svc: RepairsService) {}

  @Get()
  @RequirePermissions(Permissions.RepairsRead)
  list(@Query('assetId') assetId?: string) {
    return assetId ? this.svc.byAsset(assetId) : this.svc.list();
  }

  @Post()
  @RequirePermissions(Permissions.RepairsWrite)
  create(@Body() dto: CreateRepairDto, @CurrentUser('sub') uid: string) {
    return this.svc.create(dto, uid);
  }

  @Post(':id/transition')
  @RequirePermissions(Permissions.RepairsWrite)
  transition(@Param('id') id: string, @Body() dto: TransitionRepairDto, @CurrentUser('sub') uid: string) {
    return this.svc.transition(id, dto, uid);
  }
}
