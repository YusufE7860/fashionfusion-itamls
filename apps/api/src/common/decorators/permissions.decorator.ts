import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../../shared';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...perms: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, perms);

export const PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(PUBLIC_KEY, true);
