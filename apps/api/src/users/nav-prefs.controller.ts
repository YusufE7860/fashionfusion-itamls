import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface NavPrefDto {
  itemId: string;
  position: number;
  isHidden: boolean;
}

/**
 * Per-user sidebar ordering + hide/show. The frontend owns the catalog of
 * item ids (NAV); the server just stores the user's chosen order + hidden set.
 */
@Controller('me/nav-preferences')
export class NavPrefsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Req() req: any) {
    return this.prisma.userNavPreference.findMany({
      where: { userId: req.user?.sub },
      orderBy: { position: 'asc' },
    });
  }

  @Post()
  async save(@Req() req: any, @Body() body: { items: NavPrefDto[] }) {
    const userId = req.user?.sub;
    if (!userId) return { ok: false };
    const items = body.items ?? [];
    await this.prisma.$transaction([
      this.prisma.userNavPreference.deleteMany({ where: { userId } }),
      ...(items.length
        ? [this.prisma.userNavPreference.createMany({
            data: items.map((it) => ({
              userId, itemId: it.itemId, position: it.position, isHidden: !!it.isHidden,
            })),
          })]
        : []),
    ]);
    return { ok: true, count: items.length };
  }

  @Post('reset')
  async reset(@Req() req: any) {
    const userId = req.user?.sub;
    if (!userId) return { ok: false };
    await this.prisma.userNavPreference.deleteMany({ where: { userId } });
    return { ok: true };
  }
}
