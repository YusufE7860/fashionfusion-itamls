import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { SignageService } from './signage.service';
import { Public } from '../common/decorators/permissions.decorator';

/**
 * PUBLIC endpoints for the Python signage agent. Matches the standalone
 * signage platform's shape so existing agents work after a URL change only.
 *
 *   POST /signage/devices/register    (fleet provisioning secret)
 *   GET  /signage/devices/:id/config  (per-device token)
 *   POST /signage/devices/:id/heartbeat
 */
@Controller('signage/devices')
export class SignageAgentController {
  constructor(private svc: SignageService) {}

  @Public() @Post('register')
  register(
    @Headers('x-device-secret') headerSecret: string | undefined,
    @Body() body: { hardwareId?: string; hardware_id?: string; name?: string; provisioningSecret?: string },
  ) {
    // Python agent sends snake_case + the secret in a header.
    // Also accept camelCase + body-field style for anything else.
    return this.svc.registerDevice({
      hardwareId: body.hardwareId ?? body.hardware_id ?? '',
      name: body.name,
      provisioningSecret: headerSecret ?? body.provisioningSecret ?? '',
    });
  }

  @Public() @Get(':id/config')
  config(@Param('id') id: string, @Headers('x-device-token') token: string) {
    return this.svc.getConfig(id, token);
  }

  @Public() @Post(':id/heartbeat')
  heartbeat(
    @Param('id') id: string,
    @Headers('x-device-token') token: string,
    @Body() body: { currentlyPlayingId?: string | null; agentVersion?: string; diskFreePct?: number; uptimeSeconds?: number },
  ) {
    return this.svc.heartbeat(id, token, body);
  }

  // Agent requests a presigned PUT URL for the snapshot it just captured.
  @Public() @Post(':id/snapshot-upload-url')
  snapshotUploadUrl(@Param('id') id: string, @Headers('x-device-token') token: string) {
    return this.svc.snapshotUploadUrl(id, token);
  }

  // Agent reports the snapshot has been uploaded (storageKey from above).
  @Public() @Post(':id/snapshot-complete')
  snapshotComplete(
    @Param('id') id: string,
    @Headers('x-device-token') token: string,
    @Body() body: { storageKey: string },
  ) {
    return this.svc.snapshotComplete(id, token, body);
  }

  // Agent logs a playback / error / system event
  @Public() @Post(':id/events')
  logEvent(
    @Param('id') id: string,
    @Headers('x-device-token') token: string,
    @Body() body: { kind: string; severity?: string; message?: string; videoId?: string; metadata?: any },
  ) {
    return this.svc.logEvent(id, token, body);
  }

  // Agent reports completion of a queued command
  @Public() @Post(':id/commands/:cmdId/complete')
  completeCommand(
    @Param('id') id: string,
    @Param('cmdId') cmdId: string,
    @Headers('x-device-token') token: string,
    @Body() body: { status?: 'DONE' | 'FAILED'; resultText?: string; resultKey?: string },
  ) {
    return this.svc.completeCommand(id, token, cmdId, body);
  }

  // Presigned PUT URL for log upload (used by UPLOAD_LOGS command result)
  @Public() @Post(':id/log-upload-url')
  logUploadUrl(@Param('id') id: string, @Headers('x-device-token') token: string) {
    return this.svc.logUploadUrl(id, token);
  }
}
