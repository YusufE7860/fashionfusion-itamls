import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { RemoteExecService, PREDEFINED_SCRIPTS, COMMAND_KINDS } from './remote-exec.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

const ctxFor = (req: any) => ({
  userId: req.user?.sub,
  permissions: req.user?.permissions ?? [],
});

@Controller('signage/exec')
export class RemoteExecController {
  constructor(private svc: RemoteExecService) {}

  /** Static reference data — the UI uses this to populate action pickers. */
  @Get('actions')
  @RequirePermissions(Permissions.SignageDevicesRead)
  actions() {
    return {
      kinds: COMMAND_KINDS,
      predefinedScripts: Object.entries(PREDEFINED_SCRIPTS).map(([key, s]) => ({
        key, description: s.description,
      })),
    };
  }

  /** Fleet freeze — read + toggle. Toggling needs manage perm. */
  @Get('freeze')
  @RequirePermissions(Permissions.SignageDevicesRead)
  getFreeze() { return this.svc.getFreeze(); }

  @Post('freeze')
  @RequirePermissions(Permissions.AgentsRemoteManage)
  setFreeze(@Body() body: { frozen: boolean; reason?: string }, @Req() req: any) {
    return this.svc.setFreeze(!!body.frozen, body.reason ?? null, ctxFor(req));
  }

  /** HMAC bypass window — one-off recovery for a fleet whose agents are on
   *  an older command-canonicalizer. See RemoteExecService for the long story. */
  @Get('hmac-bypass')
  @RequirePermissions(Permissions.SignageDevicesRead)
  getHmacBypass() { return { until: this.svc.getHmacBypassUntil() }; }

  @Post('hmac-bypass')
  @RequirePermissions(Permissions.AgentsRemoteManage)
  setHmacBypass(@Body() body: { minutes: number }, @Req() req: any) {
    return this.svc.setHmacBypass(Number(body.minutes || 0), ctxFor(req));
  }

  /** Sync every device in a store — all restart mpv at the same clock time. */
  @Post('sync-store/:storeId')
  @RequirePermissions(Permissions.AgentsRemoteExec)
  syncStore(
    @Param('storeId') storeId: string,
    @Body() body: { leadSeconds?: number } = {},
    @Req() req: any,
  ) {
    return this.svc.syncStore(storeId, ctxFor(req), { leadSeconds: body.leadSeconds });
  }

  /** Queue signage-reinstall on every device in a store (one-click upgrade). */
  @Post('reinstall-store/:storeId')
  @RequirePermissions(Permissions.AgentsRemoteManage)
  reinstallStore(@Param('storeId') storeId: string, @Req() req: any) {
    return this.svc.reinstallStore(storeId, ctxFor(req));
  }

  /** Queue a command for one device. Scoped + validated + signed. */
  @Post('devices/:id/queue')
  @RequirePermissions(Permissions.AgentsRemoteExec)
  queue(
    @Param('id') id: string,
    @Body() body: { kind: any; payload?: any; reason?: string },
    @Req() req: any,
  ) {
    return this.svc.queue(id, body, ctxFor(req));
  }

  /**
   * Fleet-wide queue. Admin only, requires exact confirmation phrase in the
   * body ("I CONFIRM FLEET ALL" / "I CONFIRM FLEET FASHION_FUSION" / etc.).
   * Rate-limited per issuer.
   */
  @Post('bulk')
  @RequirePermissions(Permissions.AgentsRemoteManage)
  bulk(
    @Body() body: {
      kind: any; payload?: any; reason?: string;
      scope: 'ALL' | 'FASHION_FUSION' | 'EVLV';
      confirmPhrase: string;
    },
    @Req() req: any,
  ) {
    return this.svc.queueBulk(body, ctxFor(req));
  }
}
