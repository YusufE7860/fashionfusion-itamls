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
        // Force a password change on first login — admin's initial password
        // is a temporary handoff, not the real credential.
        mustChangePassword: true,
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
    // Admin-driven reset: same principle as create — user must change on next login.
    return this.prisma.user.update({
      where: { id }, data: { passwordHash, mustChangePassword: true },
    });
  }

  /** Self-service password change (used to satisfy the mustChangePassword flag). */
  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !u.passwordHash) throw new BadRequestException('User has no password set');
    const ok = await bcrypt.compare(currentPassword ?? '', u.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    if (await bcrypt.compare(newPassword, u.passwordHash)) {
      throw new BadRequestException('New password must be different from current');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
    return { ok: true };
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

  // ---------- Per-user store access ----------
  async listStoreAccess(userId: string) {
    const rows = await this.prisma.userStoreAccess.findMany({
      where: { userId },
      include: { store: { select: { id: true, code: true, name: true, region: true } } },
    });
    return rows.map((r) => ({ ...r.store, grantedAt: r.grantedAt, grantedBy: r.grantedBy }));
  }

  async setStoreAccess(userId: string, storeIds: string[], grantedBy?: string) {
    // Replace-all semantics: whatever list you pass is now the definitive set.
    const wanted = new Set(storeIds ?? []);
    const existing = await this.prisma.userStoreAccess.findMany({
      where: { userId }, select: { storeId: true },
    });
    const existingSet = new Set(existing.map((e) => e.storeId));
    const toAdd = [...wanted].filter((s) => !existingSet.has(s));
    const toRemove = [...existingSet].filter((s) => !wanted.has(s));

    await this.prisma.$transaction([
      ...(toRemove.length
        ? [this.prisma.userStoreAccess.deleteMany({ where: { userId, storeId: { in: toRemove } } })]
        : []),
      ...(toAdd.length
        ? [this.prisma.userStoreAccess.createMany({
            data: toAdd.map((storeId) => ({ userId, storeId, grantedBy })),
            skipDuplicates: true,
          })]
        : []),
    ]);
    return this.listStoreAccess(userId);
  }
}
