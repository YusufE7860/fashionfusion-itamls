import { Module } from '@nestjs/common';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { WizardController } from './wizard.controller';
import { WizardService } from './wizard.service';

@Module({
  controllers: [StoresController, TemplatesController, ComplianceController, WizardController],
  providers: [StoresService, TemplatesService, ComplianceService, WizardService],
})
export class StoresModule {}
