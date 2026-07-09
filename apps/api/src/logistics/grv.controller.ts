import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateGrvDto, GrvService } from './grv.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('grv')
export class GrvController {
  constructor(private svc: GrvService) {}

  @Get() list() { return this.svc.list(); }
  @Get(':id') byId(@Param('id') id: string) { return this.svc.byId(id); }

  @Post()
  @RequirePermissions(Permissions.GrvCreate)
  create(@Body() dto: CreateGrvDto, @CurrentUser('sub') uid: string) {
    return this.svc.create(dto, uid);
  }

  @Post(':id/confirm')
  @RequirePermissions(Permissions.GrvConfirm)
  confirm(@Param('id') id: string, @Body('receivingLocationId') receivingLocationId: string,
          @CurrentUser('sub') uid: string) {
    return this.svc.confirm(id, receivingLocationId, uid);
  }
}
