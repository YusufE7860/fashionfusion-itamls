import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('api-keys')
export class ApiKeysController {
  constructor(private svc: ApiKeysService) {}

  @Get()
  @RequirePermissions(Permissions.UsersManage)
  list() { return this.svc.list(); }

  @Post()
  @RequirePermissions(Permissions.UsersManage)
  create(@Body() body: { label: string; scope?: string }, @CurrentUser('sub') uid: string) {
    return this.svc.create(body.label, body.scope ?? 'DISCOVERY', uid);
  }

  @Delete(':id')
  @RequirePermissions(Permissions.UsersManage)
  revoke(@Param('id') id: string) {
    return this.svc.revoke(id);
  }
}
