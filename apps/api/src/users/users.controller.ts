import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller()
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('users')
  @RequirePermissions(Permissions.UsersManage)
  list() { return this.users.list(); }

  @Get('users/:id')
  @RequirePermissions(Permissions.UsersManage)
  byId(@Param('id') id: string) { return this.users.byId(id); }

  @Patch('users/:id/role')
  @RequirePermissions(Permissions.UsersManage)
  updateRole(@Param('id') id: string, @Body() body: { roleId: string }) {
    return this.users.updateRole(id, body.roleId);
  }

  @Post('users/:id/permissions')
  @RequirePermissions(Permissions.UsersManage)
  setOverride(@Param('id') id: string, @Body() body: { permissionCode: string; effect: 'GRANT' | 'DENY' | 'INHERIT' }) {
    return this.users.setOverride(id, body.permissionCode, body.effect);
  }

  @Get('roles')
  @RequirePermissions(Permissions.UsersManage)
  roles() { return this.users.listRoles(); }

  @Get('permissions')
  @RequirePermissions(Permissions.UsersManage)
  perms() { return this.users.listPermissions(); }
}
