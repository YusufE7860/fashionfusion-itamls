import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Bumps User.lastActiveAt on every authenticated request, throttled to one
 * DB write per 60 seconds per user. Powers the presence dots shown in the
 * Store Portal.
 *
 * Why throttle: with 5+ techs actively using the app, naively writing on
 * every API call turns into ~1 write/sec per tech. The 60s window gives us
 * sub-minute presence accuracy while keeping the write cost negligible.
 *
 * Why in-memory (not a cache table): it's per-process and resets on deploy
 * which is fine - worst case we write once per user right after deploy, then
 * settle into the normal throttle.
 */
@Injectable()
export class ActivityTrackerInterceptor implements NestInterceptor {
  private lastWrite = new Map<string, number>();

  constructor(private prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.sub as string | undefined;
    if (userId) {
      const now = Date.now();
      const prev = this.lastWrite.get(userId) ?? 0;
      if (now - prev > 60_000) {
        this.lastWrite.set(userId, now);
        // Fire-and-forget; never block the request on a presence write.
        this.prisma.user.update({
          where: { id: userId },
          data: { lastActiveAt: new Date() },
        }).catch(() => { /* silent: non-critical */ });
      }
    }
    return next.handle();
  }
}
