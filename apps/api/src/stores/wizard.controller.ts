import { Body, Controller, Post } from '@nestjs/common';
import { WizardDto, WizardService } from './wizard.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

@Controller('stores/wizard')
export class WizardController {
  constructor(private svc: WizardService) {}

  @Post()
  @RequirePermissions(Permissions.StoreWizard)
  run(@Body() dto: WizardDto) { return this.svc.run(dto); }
}
