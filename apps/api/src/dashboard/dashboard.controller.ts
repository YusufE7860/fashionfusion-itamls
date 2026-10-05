import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { AddWidgetDto, DashboardService, UpdateWidgetDto } from './dashboard.service';

const ctxFor = (req: any) => ({ userId: req.user?.sub, permissions: req.user?.permissions ?? [] });

@Controller('dashboard')
export class DashboardController {
  constructor(private svc: DashboardService) {}

  @Get('catalog')
  catalog(@Req() req: any) { return this.svc.catalog(ctxFor(req)); }

  @Get('widgets')
  async list(@Req() req: any) {
    const ctx = ctxFor(req);
    await this.svc.seedDefaultsIfEmpty(ctx);
    return this.svc.list(ctx);
  }

  @Post('widgets')
  add(@Body() dto: AddWidgetDto, @Req() req: any) { return this.svc.add(dto, ctxFor(req)); }

  @Patch('widgets/:id')
  update(@Param('id') id: string, @Body() dto: UpdateWidgetDto, @Req() req: any) {
    return this.svc.update(id, dto, ctxFor(req));
  }

  @Delete('widgets/:id')
  remove(@Param('id') id: string, @Req() req: any) { return this.svc.remove(id, ctxFor(req)); }

  @Post('widgets/reorder')
  reorder(@Body() dto: { ids: string[] }, @Req() req: any) {
    return this.svc.reorder(dto.ids ?? [], ctxFor(req));
  }

  @Get('widgets/:id/data')
  data(@Param('id') id: string, @Req() req: any) { return this.svc.data(id, ctxFor(req)); }
}
