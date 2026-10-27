import { Module } from '@nestjs/common';
import { SignageService } from './signage.service';
import { SignageAgentController } from './signage-agent.controller';
import { SignageAdminController } from './signage-admin.controller';
import { SignageInstallerController } from './signage-installer.controller';
import { RemoteExecService } from './remote-exec.service';
import { RemoteExecController } from './remote-exec.controller';

/**
 * Signage module.
 *
 *   /api/v1/signage/devices/*     — agent endpoints (public, device-token auth)
 *   /api/v1/signage/*             — admin endpoints (JWT auth)
 *   /api/v1/signage/exec/*        — remote command executor (JWT auth, scoped)
 */
@Module({
  controllers: [
    SignageAgentController, SignageAdminController, SignageInstallerController,
    RemoteExecController,
  ],
  providers: [SignageService, RemoteExecService],
  exports: [SignageService],
})
export class SignageModule {}
