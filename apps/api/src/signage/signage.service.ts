import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const OFFLINE_THRESHOLD_MS = 3 * 60 * 1000;
const KEY_PREFIX = 'signage/';

/**
 * Pick a performance profile based on the hardware the agent reported.
 * This is called when the device is left on AUTO (the default).
 */
function pickProfile(d: { hwCpuModel?: string | null; hwArch?: string | null;
                         hwMemMB?: number | null; hwGpuDrm?: boolean | null }): string {
  const cpu = (d.hwCpuModel ?? '').toLowerCase();
  const arch = (d.hwArch ?? '').toLowerCase();
  const mem = d.hwMemMB ?? 0;

  // Raspberry Pi detection — the model string varies by OS; look for signals
  if (cpu.includes('bcm2837') || cpu.includes('cortex-a53')) return 'PI3';
  if (cpu.includes('bcm2711') || cpu.includes('cortex-a72')) return 'PI4';
  if (cpu.includes('bcm2712') || cpu.includes('cortex-a76')) return 'PI5';
  if (arch.startsWith('armv7') || arch === 'armv6l') return 'PI3';   // old ARM = treat as low-end Pi
  if (arch === 'aarch64' && mem < 2048) return 'PI3';

  // x86 — Intel/AMD with DRM render node → VAAPI candidate
  if ((arch === 'x86_64' || arch === 'amd64') && d.hwGpuDrm) return 'X86_VAAPI';
  if (arch === 'x86_64' || arch === 'amd64') return 'X86_SW';

  // Unknown or very low-memory devices fall back to the safe profile
  if (mem > 0 && mem < 1024) return 'LOW_END';
  return 'X86_SW';
}

/**
 * mpv flags per profile. The agent appends these to its base mpv args so
 * each box gets the right decoder + output path + cache sizing.
 */
function flagsForProfile(profile: string): string[] {
  switch (profile) {
    case 'PI3':
      return [
        '--hwdec=v4l2m2m-copy',       // VideoCore IV HW decode via V4L2
        '--vo=gpu',
        '--gpu-context=drm',          // Console/kiosk default; mpv ignores on X
        '--cache=yes', '--cache-secs=5',
        '--vd-lavc-threads=4',
      ];
    case 'PI4':
      return [
        '--hwdec=v4l2m2m-copy',
        '--vo=gpu',
        '--gpu-context=drm',
        '--cache=yes', '--cache-secs=10',
      ];
    case 'PI5':
      return [
        '--hwdec=drm',                // Pi 5 has first-class DRM/KMS decode
        '--vo=gpu-next',
        '--gpu-context=drm',
        '--cache=yes', '--cache-secs=15',
      ];
    case 'X86_VAAPI':
      return [
        '--hwdec=vaapi',
        '--vo=gpu-next',
        '--cache=yes', '--cache-secs=15',
      ];
    case 'X86_SW':
      return [
        '--hwdec=no',
        '--vo=gpu',
        '--cache=yes', '--cache-secs=10',
      ];
    case 'LOW_END':
      return [
        '--hwdec=no',
        '--vo=gpu',
        '--cache=yes', '--cache-secs=3',
        '--demuxer-max-bytes=10M',
        '--vf=scale=-2:720',           // Downscale anything above 720p
      ];
    case 'CUSTOM':
      // Nothing added — the agent config file provides its own mpv args
      return [];
    default:
      return [];
  }
}

export interface UserCtx { userId: string; permissions: string[] }

@Injectable()
export class SignageService {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  // ---------- Device-facing (agent protocol — DO NOT break shape) ----------

  async registerDevice(dto: { hardwareId: string; name?: string; provisioningSecret: string; entity?: 'FASHION_FUSION' | 'EVLV' }) {
    const expected = process.env.DEVICE_PROVISIONING_SECRET;
    if (!expected || dto.provisioningSecret !== expected) throw new UnauthorizedException('Bad provisioning secret');
    if (!dto.hardwareId) throw new BadRequestException('hardwareId required');

    const existing = await this.prisma.signageDevice.findUnique({ where: { hardwareId: dto.hardwareId } });
    if (existing) {
      // Already enrolled — return its stored token (idempotent, so a re-enrol
      // after a reinstall gets the SAME device identity).
      return { deviceId: existing.id, token: existing.token, status: existing.status, entity: existing.entity };
    }
    const token = randomBytes(24).toString('hex');
    const d = await this.prisma.signageDevice.create({
      data: {
        hardwareId: dto.hardwareId,
        name: dto.name ?? dto.hardwareId.slice(0, 12),
        token, status: 'PENDING',
        entity: dto.entity ?? 'FASHION_FUSION',
      },
    });
    return { deviceId: d.id, token: d.token, status: d.status, entity: d.entity };
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

    // Entity filter: a Fashion Fusion player never shows Evolve content, and
    // vice versa. Videos tagged BOTH play on either. This keeps the two
    // brands separated even if a mixed playlist is accidentally assigned.
    const entityMatches = (v: any) =>
      !v.entity || v.entity === 'BOTH' || v.entity === device.entity;

    // Orientation filter: a PORTRAIT device plays PORTRAIT + ANY items;
    // a LANDSCAPE device plays LANDSCAPE + ANY items.
    const items = allItems.filter((it) =>
      entityMatches(it.video)
      && (!it.video.orientation
          || it.video.orientation === 'ANY'
          || it.video.orientation === device.orientation),
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

    // Build mpv flags based on the device's performance profile. AUTO picks
    // one from the hardware the agent reported; explicit profiles override.
    const resolvedProfile = device.perfProfile === 'AUTO' ? pickProfile(device) : device.perfProfile;
    const mpvExtraArgs = [
      ...flagsForProfile(resolvedProfile),
      ...(device.forceRotate90 ? ['--video-rotate=90'] : []),
    ];

    // Pending agent action — right now only SNAPSHOT. Agent screenshots mpv,
    // uploads via snapshot-upload-url + snapshot-complete endpoints.
    const pendingAction = device.pendingSnapshotAt ? 'SNAPSHOT' : null;

    // Pending higher-level commands (RESTART_MPV, UPLOAD_LOGS, etc.) — agent
    // acts on each and POSTs to /commands/:id/complete when done.
    const pendingCommands = await this.prisma.signagePlayerCommand.findMany({
      where: { deviceId: device.id, status: 'QUEUED' },
      orderBy: { queuedAt: 'asc' },
    });

    return {
      deviceStatus: device.status,
      deviceOrientation: device.orientation,
      playlist: assignment ? { id: assignment.playlistId, name: assignment.name } : null,
      items: resolvedItems,
      mpvExtraArgs,
      perfProfile: resolvedProfile,
      pendingAction,
      pendingCommands: pendingCommands.map((c) => ({ id: c.id, kind: c.kind, payload: c.payload })),
      // Agent compares this; when it changes, it purges cache and re-downloads.
      resyncToken: device.forceResyncAt ? device.forceResyncAt.toISOString() : null,
    };
  }

  // ---------- Snapshot flow ----------

  /** Admin triggers a snapshot. Agent sees pendingAction=SNAPSHOT on next poll. */
  async requestSnapshot(deviceId: string) {
    const d = await this.prisma.signageDevice.findUnique({ where: { id: deviceId } });
    if (!d) throw new NotFoundException();
    await this.prisma.signageDevice.update({
      where: { id: deviceId }, data: { pendingSnapshotAt: new Date() },
    });
    return { ok: true, requestedAt: new Date().toISOString() };
  }

  /** Agent asks where to upload the screenshot to. */
  async snapshotUploadUrl(deviceId: string, token: string) {
    const device = await this.authDevice(deviceId, token);
    const storageKey = `${KEY_PREFIX}snapshots/${device.id}/${Date.now()}.jpg`;
    const uploadUrl = await this.storage.presignedPut(storageKey, 600);
    return { uploadUrl, storageKey };
  }

  /** Agent reports completion: records storage key, clears pending flag. */
  async snapshotComplete(deviceId: string, token: string, body: { storageKey: string }) {
    const device = await this.authDevice(deviceId, token);
    if (!body.storageKey) throw new BadRequestException('storageKey required');
    await this.prisma.signageDevice.update({
      where: { id: device.id },
      data: {
        latestSnapshotKey: body.storageKey,
        latestSnapshotAt: new Date(),
        pendingSnapshotAt: null,
      },
    });
    return { ok: true };
  }

  /** Admin fetches a short-lived URL to view the latest snapshot. */
  async getSnapshotUrl(deviceId: string) {
    const d = await this.prisma.signageDevice.findUnique({
      where: { id: deviceId },
      select: { latestSnapshotKey: true, latestSnapshotAt: true, pendingSnapshotAt: true },
    });
    if (!d) throw new NotFoundException();
    if (!d.latestSnapshotKey) {
      return { url: null, snapshotAt: null, pending: !!d.pendingSnapshotAt };
    }
    const url = await this.storage.presignedGet(d.latestSnapshotKey, 300);
    return { url, snapshotAt: d.latestSnapshotAt, pending: !!d.pendingSnapshotAt };
  }

  async heartbeat(deviceId: string, token: string, dto: {
    currentlyPlayingId?: string | null;
    agentVersion?: string;
    diskFreePct?: number;
    uptimeSeconds?: number;
    // Extended diagnostics (optional)
    cpuPct?: number;
    memUsedPct?: number;
    screenWidth?: number;
    screenHeight?: number;
    mpvVersion?: string;
    decoder?: string;
    audioSink?: string;
    droppedFrames?: number;
    playerAlive?: boolean;
    // Hardware info — reported on first heartbeat after enrol / agent restart
    hwCpuModel?: string;
    hwCpuCores?: number;
    hwMemMB?: number;
    hwGpuDrm?: boolean;
    hwArch?: string;
    hwOsName?: string;
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
          // HW info — only overwrites when the agent reports it this heartbeat
          hwCpuModel: dto.hwCpuModel ?? device.hwCpuModel,
          hwCpuCores: dto.hwCpuCores ?? device.hwCpuCores,
          hwMemMB:    dto.hwMemMB    ?? device.hwMemMB,
          hwGpuDrm:   dto.hwGpuDrm   ?? device.hwGpuDrm,
          hwArch:     dto.hwArch     ?? device.hwArch,
          hwOsName:   dto.hwOsName   ?? device.hwOsName,
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
          cpuPct: dto.cpuPct ?? null,
          memUsedPct: dto.memUsedPct ?? null,
          screenWidth: dto.screenWidth ?? null,
          screenHeight: dto.screenHeight ?? null,
          mpvVersion: dto.mpvVersion ?? null,
          decoder: dto.decoder ?? null,
          audioSink: dto.audioSink ?? null,
          droppedFrames: dto.droppedFrames ?? null,
          playerAlive: dto.playerAlive ?? null,
        },
      }),
    ]);
    return { ok: true };
  }

  // ---------- Events ----------

  // Agent-side: logs a playback / error / system event
  async logEvent(deviceId: string, token: string, dto: {
    kind: string; severity?: string; message?: string; videoId?: string; metadata?: any;
  }) {
    const device = await this.authDevice(deviceId, token);
    return this.prisma.signageEvent.create({
      data: {
        deviceId: device.id,
        kind: dto.kind,
        severity: dto.severity ?? 'INFO',
        message: dto.message ?? null,
        videoId: dto.videoId ?? null,
        metadata: dto.metadata ?? null,
      },
    });
  }

  async listEvents(deviceId: string, limit = 100) {
    return this.prisma.signageEvent.findMany({
      where: { deviceId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  // ---------- Commands ----------

  async queueCommand(deviceId: string, dto: {
    kind: string; payload?: any;
  }, ctx: UserCtx) {
    const d = await this.prisma.signageDevice.findUnique({ where: { id: deviceId } });
    if (!d) throw new NotFoundException();
    return this.prisma.signagePlayerCommand.create({
      data: {
        deviceId, kind: dto.kind, payload: dto.payload ?? null,
        issuedById: ctx.userId, status: 'QUEUED',
      },
    });
  }

  async listCommands(deviceId: string, limit = 50) {
    return this.prisma.signagePlayerCommand.findMany({
      where: { deviceId },
      orderBy: { queuedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: { issuedBy: { select: { fullName: true, email: true } } },
    });
  }

  async pendingCommandsForAgent(deviceId: string, token: string) {
    const device = await this.authDevice(deviceId, token);
    const pending = await this.prisma.signagePlayerCommand.findMany({
      where: { deviceId: device.id, status: { in: ['QUEUED', 'SENT'] } },
      orderBy: { queuedAt: 'asc' },
    });
    // Mark as SENT so agent doesn't execute them twice if it polls while
    // still processing a previous one.
    if (pending.length) {
      await this.prisma.signagePlayerCommand.updateMany({
        where: { id: { in: pending.map((p) => p.id) }, status: 'QUEUED' },
        data: { status: 'SENT', sentAt: new Date() },
      });
    }
    return pending.map((p) => ({ id: p.id, kind: p.kind, payload: p.payload }));
  }

  async completeCommand(deviceId: string, token: string, commandId: string, body: {
    status?: 'DONE' | 'FAILED'; resultText?: string; resultKey?: string;
  }) {
    await this.authDevice(deviceId, token);
    return this.prisma.signagePlayerCommand.update({
      where: { id: commandId },
      data: {
        status: body.status ?? 'DONE',
        resultText: body.resultText ?? null,
        resultKey: body.resultKey ?? null,
        completedAt: new Date(),
      },
    });
  }

  // Agent asks for a presigned PUT URL to upload a log bundle (journalctl, etc.)
  async logUploadUrl(deviceId: string, token: string) {
    const device = await this.authDevice(deviceId, token);
    const storageKey = `${KEY_PREFIX}logs/${device.id}/${Date.now()}.txt`;
    const uploadUrl = await this.storage.presignedPut(storageKey, 600);
    return { uploadUrl, storageKey };
  }

  // Admin fetches a presigned GET URL for a result file (log bundle)
  async getCommandResultUrl(deviceId: string, commandId: string) {
    const cmd = await this.prisma.signagePlayerCommand.findUnique({ where: { id: commandId } });
    if (!cmd || cmd.deviceId !== deviceId || !cmd.resultKey) {
      return { url: null };
    }
    const url = await this.storage.presignedGet(cmd.resultKey, 600);
    return { url };
  }

  // ---------- Resolution trace ----------
  // Explain in human-readable form what SHOULD play on this device + why.
  async resolutionTrace(deviceId: string) {
    const device = await this.prisma.signageDevice.findUnique({
      where: { id: deviceId }, include: { store: true },
    });
    if (!device) throw new NotFoundException();

    const steps: Array<{ step: string; result: string; detail?: string }> = [];

    // 1. Device-level assignment
    const direct = await this.prisma.signageAssignment.findFirst({
      where: { deviceId }, include: { playlist: true },
    });
    if (direct) {
      steps.push({
        step: '1. Device assignment',
        result: `Playlist "${direct.playlist.name}"`,
        detail: 'Direct device assignment wins — this takes precedence over store or region.',
      });
    } else {
      steps.push({ step: '1. Device assignment', result: 'None — fall through to store' });
    }

    // 2. Store-level
    let storeAssign: any = null;
    if (!direct && device.storeId) {
      storeAssign = await this.prisma.signageAssignment.findFirst({
        where: { storeId: device.storeId }, include: { playlist: true },
      });
      steps.push({
        step: '2. Store assignment',
        result: storeAssign ? `Playlist "${storeAssign.playlist.name}"` : 'None — fall through to region',
        detail: device.store ? `For store ${device.store.code} — ${device.store.name}` : 'Device has no store attached',
      });
    } else if (!direct) {
      steps.push({ step: '2. Store assignment', result: 'Skipped — device has no store set' });
    }

    // 3. Region-level
    let regionAssign: any = null;
    if (!direct && !storeAssign && device.storeId) {
      const store = await this.prisma.store.findUnique({ where: { id: device.storeId }, select: { regionId: true, region: true } });
      if (store?.regionId) {
        regionAssign = await this.prisma.signageAssignment.findFirst({
          where: { regionId: store.regionId }, include: { playlist: true },
        });
        steps.push({
          step: '3. Region assignment',
          result: regionAssign ? `Playlist "${regionAssign.playlist.name}"` : 'None',
        });
      } else {
        steps.push({ step: '3. Region assignment', result: 'Skipped — store has no region entity attached' });
      }
    }

    const effective = direct ?? storeAssign ?? regionAssign;
    if (!effective) {
      return {
        device: { id: device.id, name: device.name, orientation: device.orientation, store: device.store },
        steps,
        resolved: null,
        items: [],
      };
    }

    // 4. Orientation filtering
    const items = await this.prisma.signagePlaylistItem.findMany({
      where: { playlistId: effective.playlistId },
      orderBy: { order: 'asc' },
      include: { video: true },
    });
    const played = items.filter((it) => !it.video.orientation || it.video.orientation === 'ANY' || it.video.orientation === device.orientation);
    steps.push({
      step: '4. Orientation filter',
      result: `${played.length} of ${items.length} items match ${device.orientation}`,
      detail: `Device orientation is ${device.orientation}; items tagged ${device.orientation} or ANY will play.`,
    });

    return {
      device: { id: device.id, name: device.name, orientation: device.orientation, store: device.store },
      steps,
      resolved: { playlistId: effective.playlistId, name: effective.playlist.name },
      items: played.map((it, i) => ({
        order: i + 1, videoId: it.videoId, filename: it.video.filename,
        orientation: it.video.orientation, durationSeconds: it.durationOverrideSeconds ?? it.video.durationSeconds,
      })),
      skipped: items.filter((it) => !played.includes(it)).map((it) => ({
        videoId: it.videoId, filename: it.video.filename,
        reason: `Orientation ${it.video.orientation} doesn't match device ${device.orientation}`,
      })),
    };
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
    entity?: 'FASHION_FUSION' | 'EVLV';
    perfProfile?: 'AUTO' | 'PI3' | 'PI4' | 'PI5' | 'X86_VAAPI' | 'X86_SW' | 'LOW_END' | 'CUSTOM';
  }) {
    const d = await this.prisma.signageDevice.findUnique({ where: { id } });
    if (!d) throw new NotFoundException();

    // When a store is attached, inherit its entity if the device doesn't have
    // one set explicitly — keeps brands aligned with where the device lives.
    let nextEntity = dto.entity ?? d.entity;
    if (dto.storeId && !dto.entity) {
      const s = await this.prisma.store.findUnique({ where: { id: dto.storeId }, select: { entity: true } });
      if (s?.entity) nextEntity = s.entity;
    }

    const next = await this.prisma.signageDevice.update({
      where: { id },
      data: {
        name: dto.name ?? d.name,
        storeId: dto.storeId === undefined ? d.storeId : (dto.storeId || null),
        status: dto.status ?? d.status,
        notes: dto.notes === undefined ? d.notes : (dto.notes || null),
        orientation: dto.orientation ?? d.orientation,
        forceRotate90: dto.forceRotate90 ?? d.forceRotate90,
        entity: nextEntity,
        perfProfile: dto.perfProfile ?? d.perfProfile,
      },
    });
    // Orientation OR entity change usually means a different content set —
    // bump forceResyncAt so the agent purges and re-downloads.
    if ((dto.orientation && dto.orientation !== d.orientation)
      || (nextEntity !== d.entity)) {
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
    entity?: 'FASHION_FUSION' | 'EVLV' | 'BOTH';
  }, ctx: UserCtx) {
    return this.prisma.signageVideo.create({
      data: {
        filename: dto.filename,
        storageKey: dto.storageKey,
        sizeBytes: dto.sizeBytes ? BigInt(dto.sizeBytes) : null,
        durationSeconds: dto.durationSeconds ?? null,
        checksum: dto.checksum ?? null,
        orientation: dto.orientation ?? 'ANY',
        entity: dto.entity ?? 'BOTH',
        tags: dto.tags ?? null,
        uploadedById: ctx.userId,
      },
    });
  }

  async updateVideo(id: string, dto: {
    orientation?: 'LANDSCAPE' | 'PORTRAIT' | 'ANY';
    entity?: 'FASHION_FUSION' | 'EVLV' | 'BOTH';
    tags?: string | null;
  }) {
    const v = await this.prisma.signageVideo.findUnique({ where: { id } });
    if (!v) throw new NotFoundException();
    return this.prisma.signageVideo.update({
      where: { id },
      data: {
        orientation: dto.orientation ?? v.orientation,
        entity: dto.entity ?? v.entity,
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

  async createPlaylist(dto: { name: string; entity?: 'FASHION_FUSION' | 'EVLV' | 'BOTH'; startsAt?: string | null; endsAt?: string | null }) {
    return this.prisma.signagePlaylist.create({
      data: {
        name: dto.name,
        entity: dto.entity ?? 'FASHION_FUSION',
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      },
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
