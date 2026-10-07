import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { RmmService } from './rmm.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

const ctxFor = (req: any) => ({ userId: req.user?.sub, permissions: req.user?.permissions ?? [] });

@Controller('rmm')
export class RmmController {
  constructor(private svc: RmmService) {}

  @Get('connections')
  @RequirePermissions(Permissions.AgentsRead ?? 'agents:read')
  list() { return this.svc.listConnections(); }

  @Get('pcs/:agentPcId')
  @RequirePermissions(Permissions.AgentsRead ?? 'agents:read')
  one(@Param('agentPcId') id: string) { return this.svc.connectionFor(id); }

  @Get('pcs/:agentPcId/metrics')
  @RequirePermissions(Permissions.AgentsRead ?? 'agents:read')
  metrics(@Param('agentPcId') id: string, @Query('limit') limit?: string) {
    return this.svc.recentMetrics(id, Number(limit) || 60);
  }

  @Post('pcs/:agentPcId/shell')
  @RequirePermissions(Permissions.AgentsWrite ?? 'agents:write')
  shell(@Param('agentPcId') id: string, @Body() body: { script: string; interpreter?: string; timeoutMs?: number }, @Req() req: any) {
    return this.svc.queueCommand(id, {
      kind: 'SHELL',
      payload: { script: body.script, interpreter: body.interpreter ?? 'POWERSHELL', timeoutMs: body.timeoutMs ?? 60_000 },
    }, ctxFor(req));
  }

  @Post('pcs/:agentPcId/restart')
  @RequirePermissions(Permissions.AgentsWrite ?? 'agents:write')
  restart(@Param('agentPcId') id: string, @Body() body: { delaySeconds?: number }, @Req() req: any) {
    return this.svc.queueCommand(id, { kind: 'RESTART', payload: { delaySeconds: body.delaySeconds ?? 10 } }, ctxFor(req));
  }

  @Get('pcs/:agentPcId/commands')
  @RequirePermissions(Permissions.AgentsRead ?? 'agents:read')
  history(@Param('agentPcId') id: string, @Query('limit') limit?: string) {
    return this.svc.commandHistory(id, Number(limit) || 50);
  }

  // ---------- Scripts ----------
  @Get('scripts')
  @RequirePermissions(Permissions.AgentsRead ?? 'agents:read')
  listScripts() { return this.svc.listScripts(); }

  @Post('scripts')
  @RequirePermissions(Permissions.AgentsWrite ?? 'agents:write')
  createScript(@Body() dto: any, @Req() req: any) { return this.svc.createScript(dto, ctxFor(req)); }

  @Post('scripts/:id/run')
  @RequirePermissions(Permissions.AgentsWrite ?? 'agents:write')
  runScript(@Param('id') id: string, @Body() body: { agentPcIds: string[] }, @Req() req: any) {
    return this.svc.runScript(id, body.agentPcIds ?? [], ctxFor(req));
  }
}
