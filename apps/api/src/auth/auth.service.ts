import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(email: string, password: string, totpToken?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        store: true,
        permissionOverrides: { include: { permission: true } },
      },
    });
    if (!user || !user.isActive || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // 2FA gate (only required if the user enabled it)
    if (user.totpEnabled) {
      if (!totpToken) {
        throw new UnauthorizedException({ message: '2FA required', requires2fa: true });
      }
      if (!authenticator.check(totpToken, user.totpSecret ?? '')) {
        throw new UnauthorizedException('Invalid 2FA code');
      }
    }

    const permSet = new Set(user.role.permissions.map((rp) => rp.permission.code));
    for (const o of user.permissionOverrides) {
      if (o.effect === 'GRANT') permSet.add(o.permission.code);
      if (o.effect === 'DENY') permSet.delete(o.permission.code);
    }
    const permissions = [...permSet];
    const token = await this.jwt.signAsync({
      sub: user.id, email: user.email, role: user.role.code,
      storeId: user.storeId, permissions,
    });
    return {
      accessToken: token,
      user: {
        id: user.id, email: user.email, fullName: user.fullName,
        role: user.role.code, storeId: user.storeId,
        permissions, totpEnabled: user.totpEnabled,
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        store: true,
        permissionOverrides: { include: { permission: true } },
      },
    });
    if (!user) throw new UnauthorizedException();
    const permSet = new Set(user.role.permissions.map((rp) => rp.permission.code));
    for (const o of user.permissionOverrides) {
      if (o.effect === 'GRANT') permSet.add(o.permission.code);
      if (o.effect === 'DENY') permSet.delete(o.permission.code);
    }
    return {
      id: user.id, email: user.email, fullName: user.fullName,
      role: user.role.code, storeId: user.storeId,
      permissions: [...permSet], totpEnabled: user.totpEnabled,
    };
  }
}
