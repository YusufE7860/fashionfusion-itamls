import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { SignageService } from './signage.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Permissions } from '../shared';

const ctxFor = (req: any) => ({ userId: req.user?.sub, permissions: req.user?.permissions ?? [] });

@Controller('signage')
export class SignageAdminController {
  constructor(private svc: SignageService) {}

  // ---------- Devices ----------
  // Read: visible to IT (devices:read) and store/AM users (same perm — the
  // service filters by their accessible stores). Marketing also has read so
  // they can see where their playlists are landing.
  @Get('devices')
  @RequirePermissions(Permissions.SignageDevicesRead)
  listDevices(@Req() req: any) { return this.svc.listDevices(ctxFor(req)); }

  @Get('devices/:id')
  @RequirePermissions(Permissions.SignageDevicesRead)
  getDevice(@Param('id') id: string) { return this.svc.getDevice(id); }

  @Patch('devices/:id')
  @RequirePermissions(Permissions.SignageDevicesWrite)
  updateDevice(@Param('id') id: string, @Body() dto: any) { return this.svc.updateDevice(id, dto); }

  @Delete('devices/:id')
  @RequirePermissions(Permissions.SignageDevicesWrite)
  deleteDevice(@Param('id') id: string) { return this.svc.deleteDevice(id); }

  @Post('devices/:id/resync')
  @RequirePermissions(Permissions.SignageDevicesWrite)
  resync(@Param('id') id: string) { return this.svc.forceResync(id); }

  @Post('devices/:id/snapshot')
  @RequirePermissions(Permissions.SignageDevicesRead)
  requestSnapshot(@Param('id') id: string) { return this.svc.requestSnapshot(id); }

  @Get('devices/:id/snapshot')
  @RequirePermissions(Permissions.SignageDevicesRead)
  getSnapshot(@Param('id') id: string) { return this.svc.getSnapshotUrl(id); }

  // ---------- Troubleshooting ----------
  @Get('devices/:id/trace')
  @RequirePermissions(Permissions.SignageDevicesRead)
  trace(@Param('id') id: string) { return this.svc.resolutionTrace(id); }

  @Get('devices/:id/events')
  @RequirePermissions(Permissions.SignageDevicesRead)
  events(@Param('id') id: string) { return this.svc.listEvents(id); }

  @Get('devices/:id/commands')
  @RequirePermissions(Permissions.SignageDevicesRead)
  listCommands(@Param('id') id: string) { return this.svc.listCommands(id); }

  @Post('devices/:id/commands')
  @RequirePermissions(Permissions.SignageDevicesWrite)
  queueCommand(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.svc.queueCommand(id, dto, ctxFor(req));
  }

  @Get('devices/:id/commands/:cmdId/result')
  @RequirePermissions(Permissions.SignageDevicesRead)
  getCommandResult(@Param('id') id: string, @Param('cmdId') cmdId: string) {
    return this.svc.getCommandResultUrl(id, cmdId);
  }

  // ---------- Videos (Marketing lives here) ----------
  @Get('videos')
  @RequirePermissions(Permissions.SignageVideosRead)
  listVideos() { return this.svc.listVideos(); }

  @Post('videos/upload-url')
  @RequirePermissions(Permissions.SignageVideosWrite)
  uploadUrl(@Body() dto: { filename: string }, @Req() req: any) {
    return this.svc.requestUploadUrl(dto, ctxFor(req));
  }

  @Post('videos')
  @RequirePermissions(Permissions.SignageVideosWrite)
  createVideo(@Body() dto: any, @Req() req: any) { return this.svc.createVideo(dto, ctxFor(req)); }

  @Patch('videos/:id')
  @RequirePermissions(Permissions.SignageVideosWrite)
  updateVideo(@Param('id') id: string, @Body() dto: any) { return this.svc.updateVideo(id, dto); }

  @Delete('videos/:id')
  @RequirePermissions(Permissions.SignageVideosWrite)
  deleteVideo(@Param('id') id: string) { return this.svc.deleteVideo(id); }

  // ---------- Playlists ----------
  @Get('playlists')
  @RequirePermissions(Permissions.SignagePlaylistsRead)
  listPlaylists() { return this.svc.listPlaylists(); }

  @Post('playlists')
  @RequirePermissions(Permissions.SignagePlaylistsWrite)
  createPlaylist(@Body() dto: any) { return this.svc.createPlaylist(dto); }

  @Patch('playlists/:id/items')
  @RequirePermissions(Permissions.SignagePlaylistsWrite)
  setItems(@Param('id') id: string, @Body() body: { items: any[] }) {
    return this.svc.updatePlaylistItems(id, body.items ?? []);
  }

  @Delete('playlists/:id')
  @RequirePermissions(Permissions.SignagePlaylistsWrite)
  deletePlaylist(@Param('id') id: string) { return this.svc.deletePlaylist(id); }

  // ---------- Assignments (which playlist plays where) ----------
  @Get('assignments')
  @RequirePermissions(Permissions.SignagePlaylistsRead)
  listAssignments() { return this.svc.listAssignments(); }

  @Post('assignments')
  @RequirePermissions(Permissions.SignageAssignmentsManage)
  setAssignment(@Body() dto: any) { return this.svc.setAssignment(dto); }

  // Bulk "assign to every Fashion Fusion store" / "every Evolve store" / "all".
  @Post('assignments/bulk')
  @RequirePermissions(Permissions.SignageAssignmentsManage)
  bulkAssign(@Body() dto: { playlistId: string; entity: 'FASHION_FUSION' | 'EVLV' | 'ALL' }) {
    return this.svc.bulkAssignToEntity(dto);
  }

  @Delete('assignments/:id')
  @RequirePermissions(Permissions.SignageAssignmentsManage)
  deleteAssignment(@Param('id') id: string) { return this.svc.deleteAssignment(id); }
}
