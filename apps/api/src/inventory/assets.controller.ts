import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AssetsService, CreateAssetDto, MoveAssetDto, ListAssetsQuery } from './assets.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('assets')
export class AssetsController {
  constructor(private svc: AssetsService) {}

  @Get()
  @RequirePermissions(Permissions.AssetsRead)
  list(@Query() q: ListAssetsQuery) {
    return this.svc.list(q);
  }

  @Get(':id')
  @RequirePermissions(Permissions.AssetsRead)
  byId(@Param('id') id: string) {
    return this.svc.byId(id);
  }

  @Post()
  @RequirePermissions(Permissions.AssetsWrite)
  create(@Body() dto: CreateAssetDto, @CurrentUser('sub') uid: string) {
    return this.svc.create(dto, uid);
  }

  @Post(':id/move')
  @RequirePermissions(Permissions.AssetsMove)
  move(@Param('id') id: string, @Body() dto: MoveAssetDto, @CurrentUser('sub') uid: string) {
    return this.svc.move(id, dto, uid);
  }
}
