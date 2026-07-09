import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LabelsService } from './labels.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('assets')
export class LabelsController {
  constructor(private svc: LabelsService) {}

  @Get(':id/qr.png')
  @RequirePermissions(Permissions.AssetsRead)
  async qr(@Param('id') id: string, @Res() res: Response) {
    const buf = await this.svc.qrPng(id);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(buf);
  }

  @Get(':id/label.pdf')
  @RequirePermissions(Permissions.AssetsRead)
  async label(@Param('id') id: string, @Res() res: Response) {
    const buf = await this.svc.labelPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="label-${id}.pdf"`);
    res.send(buf);
  }
}
