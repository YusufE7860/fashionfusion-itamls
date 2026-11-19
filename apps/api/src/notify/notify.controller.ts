import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt.guard';
import { PrismaService } from '../prisma/prisma.service';
import { NotifyService } from './notify.service';

/**
 * Push subscription management for the logged-in user.
 *
 * Browser flow:
 *   1. GET  /notify/vapid-public-key  - fetch key to pass to pushManager.subscribe
 *   2. POST /notify/subscribe         - save the resulting PushSubscription
 *   3. DELETE /notify/subscribe       - un-register on logout / toggle off
 */
@UseGuards(JwtAuthGuard)
@Controller('notify')
export class NotifyController {
  constructor(private prisma: PrismaService, private notify: NotifyService) {}

  @Get('vapid-public-key')
  getKey() { return { publicKey: this.notify.getPublicKey() }; }

  @Post('subscribe')
  async subscribe(
    @Req() req: any,
    @Body() body: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      userAgent?: string;
    },
  ) {
    const userId = req.user?.sub as string;
    if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return { ok: false, reason: 'missing subscription fields' };
    }
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: {
        userId, endpoint: body.endpoint,
        p256dh: body.keys.p256dh, auth: body.keys.auth,
        userAgent: body.userAgent?.slice(0, 500),
      },
      update: {
        userId,  // move subscription to current user if they logged in from a shared device
        p256dh: body.keys.p256dh, auth: body.keys.auth,
        userAgent: body.userAgent?.slice(0, 500),
      },
    });
    return { ok: true };
  }

  @Delete('subscribe')
  async unsubscribe(@Req() req: any, @Body() body: { endpoint: string }) {
    const userId = req.user?.sub as string;
    if (!body?.endpoint) return { ok: false };
    await this.prisma.pushSubscription.deleteMany({
      where: { endpoint: body.endpoint, userId },
    });
    return { ok: true };
  }

  /** Send a test notification to the caller's own devices. Lets techs
   *  verify the pipe works without waiting for a real ticket. */
  @Post('test')
  async test(@Req() req: any) {
    const userId = req.user?.sub as string;
    return this.notify.sendToUser(userId, {
      title: 'ITAMLS test notification',
      body:  'If you see this, push is working. Nice.',
      tag:   'test',
      url:   '/',
      sound: 'standard',
    });
  }
}
