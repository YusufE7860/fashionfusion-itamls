import { Body, Controller, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { WizardDto, WizardService } from './wizard.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('stores/wizard')
export class WizardController {
  constructor(private svc: WizardService) {}

  @Post()
  @RequirePermissions(Permissions.StoreWizard)
  run(@Body() dto: WizardDto) { return this.svc.run(dto); }

  /**
   * Returns a printable PDF of the proposal (equipment checklist + costs).
   * Not committing anything — the operator can run this any number of
   * times while tweaking inputs before deciding to create the store.
   */
  @Post('pdf')
  @RequirePermissions(Permissions.StoreWizard)
  async pdf(@Body() dto: WizardDto, @Res() res: Response) {
    const buf = await this.svc.pdf(dto);
    const safeName = (dto.name ?? 'store').replace(/[^A-Za-z0-9_-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="proposal-${safeName}.pdf"`);
    res.send(buf);
  }
}
