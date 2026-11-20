import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';

/**
 * "Forgot password" email flow.
 *
 * Request flow:
 *   1. User hits /auth/forgot-password with their email.
 *   2. We ALWAYS respond 200 + a generic message (never say "no such user")
 *      so we don't leak which emails are registered.
 *   3. If the email matches an active user we mint a random 32-byte token,
 *      store its sha256 hash, and email them a link:
 *        https://{WEB_BASE_URL}/reset-password?token=<raw>
 *   4. Previous unused tokens for that user are invalidated so they can't
 *      be reused after a new request.
 *
 * Consume flow:
 *   5. User opens the link, picks a new password.
 *   6. /auth/reset-password validates (token exists, not expired, not used),
 *      sets the new passwordHash, marks the token used, clears
 *      mustChangePassword so they aren't forced through another change.
 *
 * Token lifetime: 30 minutes.
 */
@Injectable()
export class ForgotPasswordService {
  private readonly log = new Logger(ForgotPasswordService.name);
  private readonly TOKEN_TTL_MIN = 30;

  constructor(private prisma: PrismaService, private mailer: MailerService) {}

  async requestReset(email: string, ip?: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      // Still a generic response to avoid revealing validation shape.
      return this.genericOk();
    }

    const user = await this.prisma.user.findFirst({
      where: { email: normalized, isActive: true },
      select: { id: true, email: true, fullName: true },
    });
    if (!user) {
      this.log.log(`Password reset requested for unknown/inactive email: ${normalized}`);
      return this.genericOk();
    }

    // Invalidate any outstanding unused tokens for this user - only one
    // active reset link at a time.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data:  { usedAt: new Date() },
    });

    // Generate URL-safe random token. 32 bytes = 256 bits of entropy.
    const raw = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + this.TOKEN_TTL_MIN * 60 * 1000);

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt, requesterIp: ip ?? null },
    });

    // Email the link. WEB_BASE_URL must be set (already present in env).
    const base = (process.env.WEB_BASE_URL ?? '').replace(/\/$/, '');
    const link = `${base || 'https://it.ffgsa.co.za:41235'}/reset-password?token=${encodeURIComponent(raw)}`;
    const html = this.mailer.wrap(
      'Reset your ITAMLS password',
      `<p>Hi ${escapeHtml(user.fullName)},</p>
       <p>Someone (hopefully you) asked to reset the password on your ITAMLS account.
          Click the button below to pick a new password. The link expires in ${this.TOKEN_TTL_MIN} minutes.</p>
       <p style="text-align:center;margin:28px 0;">
         <a href="${link}" style="background:#f59e0b;color:#fff;padding:12px 24px;text-decoration:none;
            border-radius:6px;font-weight:600;display:inline-block;">Reset password</a>
       </p>
       <p style="font-size:12px;color:#666;">
         Or copy and paste this link into your browser:<br/>
         <code style="word-break:break-all;">${link}</code>
       </p>
       <p style="font-size:12px;color:#666;">
         If you didn't request this, you can ignore this email - your password won't change.
       </p>`,
    );
    await this.mailer.send(user.email, 'Reset your ITAMLS password', html);
    this.log.log(`Password reset email sent to ${user.email}`);

    return this.genericOk();
  }

  async consumeReset(token: string, newPassword: string) {
    if (!token || typeof token !== 'string') throw new BadRequestException('token required');
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('password must be at least 8 characters');
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
    if (!row || row.usedAt) throw new BadRequestException('reset link is invalid or has already been used');
    if (row.expiresAt < new Date()) throw new BadRequestException('reset link has expired - request a new one');

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash, mustChangePassword: false },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
    ]);
    this.log.log(`Password reset completed for user ${row.userId}`);
    return { ok: true };
  }

  private genericOk() {
    return {
      ok: true,
      message: 'If an account exists for that email, a reset link has been sent. Check your inbox (and spam).',
    };
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
