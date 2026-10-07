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
  register(@Body() body: { hardwareId: string; name?: string; provisioningSecret: string }) {
    return this.svc.registerDevice(body);
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
}
