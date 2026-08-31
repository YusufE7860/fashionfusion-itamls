import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { DvrsService, UpsertDvrDto } from './dvrs.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

function ctxFor(req: any) {
  return { userId: req.user?.sub, permissions: req.user?.permissions ?? [] };
}

@Controller()
export class DvrsController {
  constructor(private svc: DvrsService) {}

  // ---- Cross-store views ----
  @Get('dvrs')
  @RequirePermissions(Permissions.DvrsRead)
  listAll(@Req() req: any) { return this.svc.listAll(ctxFor(req)); }

  // ---- Per-store CRUD ----
  @Get('stores/:storeId/dvrs')
  @RequirePermissions(Permissions.DvrsRead)
  listForStore(@Param('storeId') storeId: string, @Req() req: any) {
    return this.svc.listForStore(storeId, ctxFor(req));
  }

  @Post('stores/:storeId/dvrs')
  @RequirePermissions(Permissions.DvrsWrite)
  create(@Param('storeId') storeId: string, @Body() dto: UpsertDvrDto) {
    return this.svc.create(storeId, dto);
  }

  @Get('dvrs/:id')
  @RequirePermissions(Permissions.DvrsRead)
  get(@Param('id') id: string, @Req() req: any) { return this.svc.get(id, ctxFor(req)); }

  @Patch('dvrs/:id')
  @RequirePermissions(Permissions.DvrsWrite)
  update(@Param('id') id: string, @Body() dto: Partial<UpsertDvrDto>) { return this.svc.update(id, dto); }

  @Delete('dvrs/:id')
  @RequirePermissions(Permissions.DvrsWrite)
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  @Get('dvrs/:id/endpoints')
  @RequirePermissions(Permissions.DvrsRead)
  endpoints(@Param('id') id: string, @Req() req: any) { return this.svc.endpoints(id, ctxFor(req)); }

  /** Live snapshot -- returns a JPEG. */
  @Get('dvrs/:id/snapshot')
  @RequirePermissions(Permissions.DvrsRead)
  async snapshot(
    @Param('id') id: string,
    @Query('channel') channelStr = '1',
    @Req() req: any,
    @Res() res: Response,
  ) {
    const channel = Math.max(1, Number(channelStr) || 1);
    try {
      const buf = await this.svc.snapshot(id, channel, ctxFor(req));
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store');
      res.send(buf);
    } catch (e: any) {
      res.status(502).json({ message: e?.message ?? 'DVR unreachable' });
    }
  }
}
