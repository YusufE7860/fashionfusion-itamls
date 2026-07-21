import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateUserDto {
  email: string;
  fullName: string;
  password: string;
  roleId: string;
  storeId?: string | null;
  isActive?: boolean;
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      include: { role: true, store: true, permissionOverrides: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async create(dto: CreateUserDto) {
    if (!dto.email || !dto.fullName || !dto.password || !dto.roleId) {
      throw new BadRequestException('email, fullName, password and roleId are required');
    }
    if (dto.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException(`A user with email ${email} already exists`);
    const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
    if (!role) throw new BadRequestException('Role not found');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        email,
        fullName: dto.fullName.trim(),
        passwordHash,
        roleId: dto.roleId,
        storeId: dto.storeId || null,
        isActive: dto.isActive ?? true,
      },
      include: { role: true, store: true },
    });
  }

  async setActive(id: string, isActive: boolean) {
    return this.prisma.user.update({ where: { id }, data: { isActive } });
  }

  async resetPassword(id: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    return this.prisma.user.update({ where: { id }, data: { passwordHash } });
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
