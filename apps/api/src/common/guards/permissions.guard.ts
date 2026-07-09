import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { permissions?: string[] } | undefined;
    if (!user?.permissions) throw new ForbiddenException('No permissions on token');
    const has = required.every((p) => user.permissions!.includes(p));
    if (!has) throw new ForbiddenException(`Missing permission: ${required.join(', ')}`);
    return true;
  }
}
