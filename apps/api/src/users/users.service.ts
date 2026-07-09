import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      include: { role: true, store: true, permissionOverrides: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async byId(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        store: true,
        permissionOverrides: { include: { permission: true } },
      },
    });
    if (!u) throw new NotFoundException();
    return u;
  }

  async updateRole(id: string, roleId: string) {
    return this.prisma.user.update({ where: { id }, data: { roleId } });
  }

  async setOverride(userId: string, permissionCode: string, effect: 'GRANT' | 'DENY' | 'INHERIT') {
    const perm = await this.prisma.permission.findUnique({ where: { code: permissionCode } });
    if (!perm) throw new NotFoundException('Permission not found');
    if (effect === 'INHERIT') {
      await this.prisma.userPermissionOverride.deleteMany({
        where: { userId, permissionId: perm.id },
      });
      return { effect: 'INHERIT' };
    }
    if (effect !== 'GRANT' && effect !== 'DENY') {
      throw new BadRequestException('effect must be GRANT, DENY or INHERIT');
    }
    await this.prisma.userPermissionOverride.upsert({
      where: { userId_permissionId: { userId, permissionId: perm.id } },
      create: { userId, permissionId: perm.id, effect },
      update: { effect },
    });
    return { effect };
  }

  /**
   * Effective permission codes for a user = role permissions ∪ GRANT overrides \ DENY overrides.
   */
  async effectivePermissions(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        permissionOverrides: { include: { permission: true } },
      },
    });
    if (!u) return [];
    const role = new Set(u.role.permissions.map((rp) => rp.permission.code));
    for (const o of u.permissionOverrides) {
      if (o.effect === 'GRANT') role.add(o.permission.code);
      if (o.effect === 'DENY') role.delete(o.permission.code);
    }
    return [...role];
  }

  listRoles() { return this.prisma.role.findMany({ orderBy: { code: 'asc' } }); }
  listPermissions() { return this.prisma.permission.findMany({ orderBy: { code: 'asc' } }); }
}
