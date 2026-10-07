import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const OFFLINE_THRESHOLD_MS = 3 * 60 * 1000;
const KEY_PREFIX = 'signage/';

export interface UserCtx { userId: string; permissions: string[] }

@Injectable()
export class SignageService {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  // ---------- Device-facing (agent protocol — DO NOT break shape) ----------

  async registerDevice(dto: { hardwareId: string; name?: string; provisioningSecret: string }) {
    const expected = process.env.DEVICE_PROVISIONING_SECRET;
    if (!expected || dto.provisioningSecret !== expected) throw new UnauthorizedException('Bad provisioning secret');
    if (!dto.hardwareId) throw new BadRequestException('hardwareId required');

    const existing = await this.prisma.signageDevice.findUnique({ where: { hardwareId: dto.hardwareId } });
    if (existing) {
      // Already enrolled — return its stored token (idempotent, so a re-enrol
      // after a reinstall gets the SAME device identity).
      return { deviceId: existing.id, token: existing.token, status: existing.status };
    }
    const token = randomBytes(24).toString('hex');
    const d = await this.prisma.signageDevice.create({
      data: {
        hardwareId: dto.hardwareId,
        name: dto.name ?? dto.hardwareId.slice(0, 12),
        token, status: 'PENDING',
      },
    });
    return { deviceId: d.id, token: d.token, status: d.status };
  }

  async authDevice(deviceId: string, token: string) {
    const d = await this.prisma.signageDevice.findUnique({ where: { id: deviceId } });
    if (!d || d.token !== token) throw new UnauthorizedException();
    if (d.status === 'DISABLED') throw new UnauthorizedException('Device disabled');
    return d;
  }

  // Agent polls this to find out what to play. We resolve device > store > region.
  async getConfig(deviceId: string, token: string) {
    const device = await this.authDevice(deviceId, token);
    const assignment = await this.resolveAssignment(device);
    const allItems = assignment
      ? await this.prisma.signagePlaylistItem.findMany({
          where: { playlistId: assignment.playlistId },
          orderBy: { order: 'asc' },
          include: { video: true },
        })
      : [];

    // Orientation filter: a PORTRAIT device plays PORTRAIT + ANY items;
    // a LANDSCAPE device plays LANDSCAPE + ANY items. The non-matching
    // items in the shared playlist are silently skipped on this device.
    const items = allItems.filter((it) =>
      !it.video.orientation
      || it.video.orientation === 'ANY'
      || it.video.orientation === device.orientation,
    );

    const resolvedItems = await Promise.all(items.map(async (it) => ({
      videoId: it.videoId,
      filename: it.video.filename,
      checksum: it.video.checksum,
      sizeBytes: it.video.sizeBytes ? Number(it.video.sizeBytes) : null,
      durationSeconds: it.durationOverrideSeconds ?? it.video.durationSeconds,
      orientation: it.video.orientation ?? 'ANY',
      // Short-lived download URL — the agent uses this to pull the file
      downloadUrl: await this.storage.presignedGet(it.video.storageKey, 3600).catch(() => null),
    })));

    // Emergency rotate: when the TV is physically mounted sideways and no
    // orientation-matched content exists, the agent passes --video-rotate=90
    // to mpv so landscape content renders readable on a portrait screen
    // (ugly but better than sideways text).
    const mpvExtraArgs = device.forceRotate90 ? ['--video-rotate=90'] : [];

    return {
      deviceStatus: device.status,
      deviceOrientation: device.orientation,
      playlist: assignment ? { id: assignment.playlistId, name: assignment.name } : null,
      items: resolvedItems,
      mpvExtraArgs,
      // Agent compares this; when it changes, it purges cache and re-downloads.
      resyncToken: device.forceResyncAt ? device.forceResyncAt.toISOString() : null,
    };
  }

  async heartbeat(deviceId: string, token: string, dto: {
    currentlyPlayingId?: string | null;
    agentVersion?: string;
    diskFreePct?: number;
    uptimeSeconds?: number;
  }) {
    const device = await this.authDevice(deviceId, token);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.signageDevice.update({
        where: { id: device.id },
        data: {
          lastSeenAt: now,
          lastPlayingVideoId: dto.currentlyPlayingId ?? null,
          agentVersion: dto.agentVersion ?? device.agentVersion,
          diskFreePct: dto.diskFreePct ?? device.diskFreePct,
          uptimeSeconds: dto.uptimeSeconds ?? device.uptimeSeconds,
          // Clear offline-alert flag so next outage will trigger a fresh alert
          offlineAlertedAt: null,
        },
      }),
      this.prisma.signageHeartbeat.create({
        data: {
          deviceId: device.id,
          currentlyPlayingId: dto.currentlyPlayingId ?? null,
          agentVersion: dto.agentVersion,
          diskFreePct: dto.diskFreePct,
          uptimeSeconds: dto.uptimeSeconds,
        },
      }),
    ]);
    return { ok: true };
  }

  // ---------- Admin: devices ----------

  async listDevices() {
    const rows = await this.prisma.signageDevice.findMany({
      orderBy: { name: 'asc' },
      include: { store: { select: { id: true, code: true, name: true } } },
    });
    return rows.map((d) => this.withStatus(d));
  }

  async getDevice(id: string) {
    const d = await this.prisma.signageDevice.findUnique({
      where: { id },
      include: { store: true },
    });
    if (!d) throw new NotFoundException();
    const beats = await this.prisma.signageHeartbeat.findMany({
      where: { deviceId: id }, orderBy: { createdAt: 'desc' }, take: 50,
    });
    const assignment = await this.resolveAssignment(d);
    return { ...this.withStatus(d), heartbeats: beats.reverse(), assignedPlaylist: assignment };
  }

  async updateDevice(id: string, dto: {
    name?: string; storeId?: string | null; status?: string; notes?: string | null;
    orientation?: 'LANDSCAPE' | 'PORTRAIT'; forceRotate90?: boolean;
  }) {
    const d = await this.prisma.signageDevice.findUnique({ where: { id } });
    if (!d) throw new NotFoundException();
    const next = await this.prisma.signageDevice.update({
      where: { id },
      data: {
        name: dto.name ?? d.name,
        storeId: dto.storeId === undefined ? d.storeId : (dto.storeId || null),
        status: dto.status ?? d.status,
        notes: dto.notes === undefined ? d.notes : (dto.notes || null),
        orientation: dto.orientation ?? d.orientation,
        forceRotate90: dto.forceRotate90 ?? d.forceRotate90,
      },
    });
    // Orientation change usually means a different content set — bump
    // forceResyncAt so the agent purges and re-downloads.
    if (dto.orientation && dto.orientation !== d.orientation) {
      await this.prisma.signageDevice.update({ where: { id }, data: { forceResyncAt: new Date() } });
    }
    return next;
  }

  async deleteDevice(id: string) {
    await this.prisma.signageAssignment.deleteMany({ where: { deviceId: id } });
    await this.prisma.signageDevice.delete({ where: { id } });
    return { ok: true };
  }

  async forceResync(id: string) {
    const d = await this.prisma.signageDevice.update({ where: { id }, data: { forceResyncAt: new Date() } });
    return { ok: true, forceResyncAt: d.forceResyncAt };
  }

  // ---------- Admin: videos ----------

  listVideos() {
    return this.prisma.signageVideo.findMany({
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { fullName: true } } },
    });
  }

  async requestUploadUrl(dto: { filename: string }, ctx: UserCtx) {
    if (!dto.filename) throw new BadRequestException('filename required');
    const storageKey = `${KEY_PREFIX}${randomBytes(8).toString('hex')}-${dto.filename.replace(/[^\w.\-]/g, '_')}`;
    const uploadUrl = await this.storage.presignedPut(storageKey, 3600);
    return { uploadUrl, storageKey };
  }

  async createVideo(dto: {
    filename: string; storageKey: string; sizeBytes?: number; checksum?: string;
    durationSeconds?: number; tags?: string;
    orientation?: 'LANDSCAPE' | 'PORTRAIT' | 'ANY';
  }, ctx: UserCtx) {
    return this.prisma.signageVideo.create({
      data: {
        filename: dto.filename,
        storageKey: dto.storageKey,
        sizeBytes: dto.sizeBytes ? BigInt(dto.sizeBytes) : null,
        durationSeconds: dto.durationSeconds ?? null,
        checksum: dto.checksum ?? null,
        orientation: dto.orientation ?? 'ANY',
        tags: dto.tags ?? null,
        uploadedById: ctx.userId,
      },
    });
  }

  async updateVideo(id: string, dto: { orientation?: 'LANDSCAPE' | 'PORTRAIT' | 'ANY'; tags?: string | null }) {
    const v = await this.prisma.signageVideo.findUnique({ where: { id } });
    if (!v) throw new NotFoundException();
    return this.prisma.signageVideo.update({
      where: { id },
      data: {
        orientation: dto.orientation ?? v.orientation,
        tags: dto.tags === undefined ? v.tags : dto.tags,
      },
    });
  }

  async deleteVideo(id: string) {
    const v = await this.prisma.signageVideo.findUnique({ where: { id } });
    if (!v) throw new NotFoundException();
    // Best-effort cleanup — if StorageService exposes a delete, call it;
    // otherwise the object stays in MinIO orphaned until a reaper handles it.
    await (this.storage as any).deleteObject?.(v.storageKey).catch(() => {});
    await this.prisma.signageVideo.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- Admin: playlists ----------

  listPlaylists() {
    return this.prisma.signagePlaylist.findMany({
      orderBy: { name: 'asc' },
      include: { items: { include: { video: true }, orderBy: { order: 'asc' } } },
    });
  }

  async createPlaylist(dto: { name: string; startsAt?: string | null; endsAt?: string | null }) {
    return this.prisma.signagePlaylist.create({
      data: { name: dto.name, startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
              endsAt: dto.endsAt ? new Date(dto.endsAt) : null },
    });
  }

  async updatePlaylistItems(playlistId: string, items: Array<{ videoId: string; order: number; durationOverrideSeconds?: number }>) {
    await this.prisma.$transaction([
      this.prisma.signagePlaylistItem.deleteMany({ where: { playlistId } }),
      ...items.map((it) => this.prisma.signagePlaylistItem.create({
        data: { playlistId, videoId: it.videoId, order: it.order, durationOverrideSeconds: it.durationOverrideSeconds },
      })),
    ]);
    return { ok: true, count: items.length };
  }

  async deletePlaylist(id: string) {
    await this.prisma.signageAssignment.deleteMany({ where: { playlistId: id } });
    await this.prisma.signagePlaylist.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- Admin: assignments ----------

  async setAssignment(dto: { playlistId: string; deviceId?: string; storeId?: string; regionId?: string }) {
    const { playlistId, deviceId, storeId, regionId } = dto;
    if (!deviceId && !storeId && !regionId) throw new BadRequestException('Must target device, store, or region');
    if (deviceId) await this.prisma.signageAssignment.deleteMany({ where: { deviceId } });
    else if (storeId) await this.prisma.signageAssignment.deleteMany({ where: { storeId } });
    else if (regionId) await this.prisma.signageAssignment.deleteMany({ where: { regionId } });
    return this.prisma.signageAssignment.create({ data: { playlistId, deviceId, storeId, regionId } });
  }

  listAssignments() {
    return this.prisma.signageAssignment.findMany({
      include: {
        playlist: { select: { id: true, name: true } },
        device:   { select: { id: true, name: true } },
        store:    { select: { id: true, code: true, name: true } },
        region:   { select: { id: true, code: true, name: true } },
      },
    });
  }

  async deleteAssignment(id: string) {
    await this.prisma.signageAssignment.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- Resolution ----------

  /** device > store > region assignment resolution. */
  private async resolveAssignment(device: { id: string; storeId: string | null }): Promise<{ playlistId: string; name: string } | null> {
    const direct = await this.prisma.signageAssignment.findFirst({
      where: { deviceId: device.id },
      include: { playlist: true },
    });
    if (direct) return { playlistId: direct.playlistId, name: direct.playlist.name };

    if (device.storeId) {
      const perStore = await this.prisma.signageAssignment.findFirst({
        where: { storeId: device.storeId },
        include: { playlist: true },
      });
      if (perStore) return { playlistId: perStore.playlistId, name: perStore.playlist.name };

      const store = await this.prisma.store.findUnique({ where: { id: device.storeId }, select: { regionId: true } });
      if (store?.regionId) {
        const perRegion = await this.prisma.signageAssignment.findFirst({
          where: { regionId: store.regionId },
          include: { playlist: true },
        });
        if (perRegion) return { playlistId: perRegion.playlistId, name: perRegion.playlist.name };
      }
    }
    return null;
  }

  private withStatus<T extends { lastSeenAt: Date | null }>(d: T) {
    const online = !!d.lastSeenAt && (Date.now() - d.lastSeenAt.getTime() < OFFLINE_THRESHOLD_MS);
    const { token, ...safe } = d as any;
    return { ...safe, online };
  }
}
