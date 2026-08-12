import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GenerateDto, MikrotikService } from './mikrotik.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('mikrotik')
export class MikrotikController {
  constructor(private svc: MikrotikService) {}

  // ---- Pools ----
  @Get('pools')
  @RequirePermissions(Permissions.MikrotikRead)
  listPools() { return this.svc.listPools(); }

  @Patch('pools/:brand')
  @RequirePermissions(Permissions.MikrotikManage)
  updatePool(
    @Param('brand') brand: string,
    @Body() body: { lastThirdOctet?: number; ipPrefix?: string; identityPrefix?: string },
  ) { return this.svc.updatePool(brand, body); }

  @Get('preview')
  @RequirePermissions(Permissions.MikrotikRead)
  preview(@Query('brand') brand: string) { return this.svc.previewNext(brand); }

  // ---- Configs ----
  @Get('configs')
  @RequirePermissions(Permissions.MikrotikRead)
  listConfigs() { return this.svc.listConfigs(); }

  @Get('configs/:id')
  @RequirePermissions(Permissions.MikrotikRead)
  getConfig(@Param('id') id: string) { return this.svc.getConfig(id); }

  @Get('configs/:id/download')
  @RequirePermissions(Permissions.MikrotikRead)
  async download(@Param('id') id: string, @Res() res: Response) {
    const c = await this.svc.getConfig(id);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${c.identity}.rsc"`);
    res.send(c.configText);
  }

  @Post('generate')
  @RequirePermissions(Permissions.MikrotikGenerate)
  generate(@Body() dto: GenerateDto, @Req() req: any) {
    return this.svc.generate({ ...dto, createdById: req.user?.sub });
  }
}
