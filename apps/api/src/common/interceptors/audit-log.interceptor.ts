import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

const SKIP_PATHS = [/^\/api\/v1\/auth\/me$/, /^\/api\/v1\/tools\//, /^\/api\/v1\/discovery\/report$/];

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    const method = req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next.handle();
    const url: string = req.originalUrl ?? req.url ?? '';
    if (SKIP_PATHS.some((re) => re.test(url))) return next.handle();

    const actorId = req.user?.sub as string | undefined;

    return next.handle().pipe(
      tap({
        next: () => this.write(actorId, method, url, req.body, 'OK'),
        error: (e) => this.write(actorId, method, url, req.body, `ERR:${e?.status ?? 500}`),
      }),
    );
  }

  private async write(actorId: string | undefined, method: string, path: string, body: any, action: string) {
    try {
      const target = path.split('/').filter(Boolean).slice(2, 4).join('/'); // e.g. assets/123
      const safeBody = body ? JSON.stringify(body).slice(0, 2000) : undefined;
      await this.prisma.auditEvent.create({
        data: { actorId, action, method, path, targetType: target, payload: safeBody },
      });
    } catch {
      // never block the request on audit-log failure
    }
  }
}
