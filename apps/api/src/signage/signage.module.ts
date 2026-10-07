import { Module } from '@nestjs/common';
import { SignageService } from './signage.service';
import { SignageAgentController } from './signage-agent.controller';
import { SignageAdminController } from './signage-admin.controller';
import { SignageInstallerController } from './signage-installer.controller';

/**
 * Signage module.
 *
 *   /api/v1/signage/devices/*     — agent endpoints (public, device-token auth)
 *   /api/v1/signage/*             — admin endpoints (JWT auth)
 */
@Module({
  controllers: [SignageAgentController, SignageAdminController, SignageInstallerController],
  providers: [SignageService],
  exports: [SignageService],
})
export class SignageModule {}
