import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserPayload {
  sub: string;
  email: string;
  role: string;
  storeId?: string | null;
  permissions: string[];
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserPayload | undefined, ctx: ExecutionContext): any => {
    const req = ctx.switchToHttp().getRequest();
    return data ? req.user?.[data] : req.user;
  },
);
