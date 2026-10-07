import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { SignageService } from './signage.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

const ctxFor = (req: any) => ({ userId: req.user?.sub, permissions: req.user?.permissions ?? [] });

@Controller('signage')
export class SignageAdminController {
  constructor(private svc: SignageService) {}

  // Devices
  @Get('devices')
  @RequirePermissions(Permissions.StoresRead ?? 'stores:read')
  listDevices() { return this.svc.listDevices(); }

  @Get('devices/:id')
  @RequirePermissions(Permissions.StoresRead ?? 'stores:read')
  getDevice(@Param('id') id: string) { return this.svc.getDevice(id); }

  @Patch('devices/:id')
  @RequirePermissions(Permissions.StoresWrite ?? 'stores:write')
  updateDevice(@Param('id') id: string, @Body() dto: any) { return this.svc.updateDevice(id, dto); }

  @Delete('devices/:id')
  @RequirePermissions(Permissions.StoresWrite ?? 'stores:write')
  deleteDevice(@Param('id') id: string) { return this.svc.deleteDevice(id); }

  @Post('devices/:id/resync')
  @RequirePermissions(Permissions.StoresWrite ?? 'stores:write')
  resync(@Param('id') id: string) { return this.svc.forceResync(id); }

  @Post('devices/:id/snapshot')
  @RequirePermissions(Permissions.StoresRead ?? 'stores:read')
  requestSnapshot(@Param('id') id: string) { return this.svc.requestSnapshot(id); }

  @Get('devices/:id/snapshot')
  @RequirePermissions(Permissions.StoresRead ?? 'stores:read')
  getSnapshot(@Param('id') id: string) { return this.svc.getSnapshotUrl(id); }

  // ---------- Troubleshooting ----------
  @Get('devices/:id/trace')
  @RequirePermissions(Permissions.StoresRead ?? 'stores:read')
  trace(@Param('id') id: string) { return this.svc.resolutionTrace(id); }

  @Get('devices/:id/events')
  @RequirePermissions(Permissions.StoresRead ?? 'stores:read')
  events(@Param('id') id: string) { return this.svc.listEvents(id); }

  @Get('devices/:id/commands')
  @RequirePermissions(Permissions.StoresRead ?? 'stores:read')
  listCommands(@Param('id') id: string) { return this.svc.listCommands(id); }

  @Post('devices/:id/commands')
  @RequirePermissions(Permissions.StoresWrite ?? 'stores:write')
  queueCommand(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.svc.queueCommand(id, dto, ctxFor(req));
  }

  @Get('devices/:id/commands/:cmdId/result')
  @RequirePermissions(Permissions.StoresRead ?? 'stores:read')
  getCommandResult(@Param('id') id: string, @Param('cmdId') cmdId: string) {
    return this.svc.getCommandResultUrl(id, cmdId);
  }

  // Videos
  @Get('videos')
  @RequirePermissions(Permissions.StoresRead ?? 'stores:read')
  listVideos() { return this.svc.listVideos(); }

  @Post('videos/upload-url')
  @RequirePermissions(Permissions.StoresWrite ?? 'stores:write')
  uploadUrl(@Body() dto: { filename: string }, @Req() req: any) {
    return this.svc.requestUploadUrl(dto, ctxFor(req));
  }

  @Post('videos')
  @RequirePermissions(Permissions.StoresWrite ?? 'stores:write')
  createVideo(@Body() dto: any, @Req() req: any) { return this.svc.createVideo(dto, ctxFor(req)); }

  @Patch('videos/:id')
  @RequirePermissions(Permissions.StoresWrite ?? 'stores:write')
  updateVideo(@Param('id') id: string, @Body() dto: any) { return this.svc.updateVideo(id, dto); }

  @Delete('videos/:id')
  @RequirePermissions(Permissions.StoresWrite ?? 'stores:write')
  deleteVideo(@Param('id') id: string) { return this.svc.deleteVideo(id); }

  // Playlists
  @Get('playlists')
  @RequirePermissions(Permissions.StoresRead ?? 'stores:read')
  listPlaylists() { return this.svc.listPlaylists(); }

  @Post('playlists')
  @RequirePermissions(Permissions.StoresWrite ?? 'stores:write')
  createPlaylist(@Body() dto: any) { return this.svc.createPlaylist(dto); }

  @Patch('playlists/:id/items')
  @RequirePermissions(Permissions.StoresWrite ?? 'stores:write')
  setItems(@Param('id') id: string, @Body() body: { items: any[] }) {
    return this.svc.updatePlaylistItems(id, body.items ?? []);
  }

  @Delete('playlists/:id')
  @RequirePermissions(Permissions.StoresWrite ?? 'stores:write')
  deletePlaylist(@Param('id') id: string) { return this.svc.deletePlaylist(id); }

  // Assignments
  @Get('assignments')
  @RequirePermissions(Permissions.StoresRead ?? 'stores:read')
  listAssignments() { return this.svc.listAssignments(); }

  @Post('assignments')
  @RequirePermissions(Permissions.StoresWrite ?? 'stores:write')
  setAssignment(@Body() dto: any) { return this.svc.setAssignment(dto); }

  @Delete('assignments/:id')
  @RequirePermissions(Permissions.StoresWrite ?? 'stores:write')
  deleteAssignment(@Param('id') id: string) { return this.svc.deleteAssignment(id); }
}
