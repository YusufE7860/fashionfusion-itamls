import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { authenticator } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TwofaService {
  private issuer = process.env.TOTP_ISSUER ?? 'ITAMLS';
  constructor(private prisma: PrismaService) {}

  /** Generate a fresh secret + QR for the user. Doesn't enable 2FA yet — verify required. */
  async setup(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: secret, totpEnabled: false } });
    const otpauth = authenticator.keyuri(user.email, this.issuer, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    return { secret, otpauth, qrDataUrl };
  }

  /** Verify a token and enable 2FA for the user. */
  async verifyAndEnable(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret) throw new BadRequestException('Call setup first');
    if (!authenticator.check(token, user.totpSecret)) {
      throw new BadRequestException('Invalid code');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
    return { enabled: true };
  }

  /** Verify a token at login. */
  verify(secret: string | null | undefined, token: string) {
    if (!secret) return false;
    return authenticator.check(token, secret);
  }

  async disable(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null },
    });
  }
}
