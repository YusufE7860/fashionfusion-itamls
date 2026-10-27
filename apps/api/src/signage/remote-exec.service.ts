import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Remote command executor for signage / RMM devices.
 *
 * Design principles:
 *   1. Allowlisted actions. No raw shell by default. Each KIND maps to a tight
 *      payload schema; anything else is rejected server-side before it ever
 *      hits the device.
 *   2. HMAC-signed envelopes. The agent verifies the server's signature on
 *      every command before executing. A leaked device token alone cannot
 *      make the agent run shell — the attacker would need the server's
 *      HMAC secret too, which lives in server env.
 *   3. Scoped per-user. Technicians can only target devices in stores they
 *      have access to; admins target anything. Scoping mirrors helpdesk.
 *   4. SHELL_EXEC is behind its own permission (agents:remote-shell) AND
 *      requires a human reason string. Both are logged.
 *   5. Fleet-wide freeze. One admin button halts all queueing + execution.
 *   6. Full audit trail. SignagePlayerCommand already stores issuedBy,
 *      kind, payload, result; we add exitCode + reason + hmac for forensics.
 */

export type Ctx = { userId: string; permissions: string[] };

export const COMMAND_KINDS = [
  'RESTART_AGENT',
  'RESTART_MPV',
  'RESTART_SERVICE',
  'REBOOT',
  'UPLOAD_LOGS',
  'TAIL_LOG',
  'APT_INSTALL',
  'UPLOAD_FILE',
  'RUN_PREDEFINED',
  'ROTATE_SCREEN',
  'TEST_PATTERN',
  'TEST_AUDIO',
  'PLAY_NOW',
  'SHELL_EXEC',
] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

// Binaries the agent is allowed to invoke. SHELL_EXEC still runs via bash -c
// but the agent itself refuses to execute if the first token isn't on the
// list. Keeps a lid on blast radius.
export const ALLOWED_BINARIES = [
  'systemctl',
  'journalctl',
  'apt',
  'apt-get',
  'cat',
  'tail',
  'head',
  'ls',
  'df',
  'free',
  'uptime',
  'ps',
  'ping',
  'mpv',
  'signage-agent',
  'echo',
  'date',
  'hostname',
  'ip',
  'netstat',
  'ss',
];

// Server-side registry of canned scripts. Each has a stable key, a short
// description, and the exact command the agent will run. New scripts are
// added here in code (reviewed via PR), never user-uploaded, so there's no
// risk of an admin accidentally saving `rm -rf /` into a script named
// "cleanup".
export const PREDEFINED_SCRIPTS: Record<string, { description: string; cmd: string }> = {
  'apt-update': {
    description: 'Refresh apt indexes and upgrade installed packages',
    cmd: 'apt-get update -y && apt-get upgrade -y',
  },
  'signage-reinstall': {
    description: 'Re-download the signage agent tarball and reinstall',
    cmd: 'cd /tmp && rm -rf agent-reinstall && mkdir agent-reinstall && cd agent-reinstall && curl -fsSL "$ITAMLS_URL/signage/agent.tar.gz" -o agent.tar.gz && tar xzf agent.tar.gz && bash install.sh && systemctl restart signage-agent',
  },
  'drain-cache': {
    description: 'Delete the local signage video cache (forces re-download)',
    cmd: 'rm -rf /var/lib/signage-agent/cache/* && systemctl restart signage-agent',
  },
  'disk-report': {
    description: 'Report disk usage of signage-agent + system partitions',
    cmd: 'df -h / && du -sh /var/lib/signage-agent/cache 2>/dev/null || true',
  },
  'health-check': {
    description: 'Agent + mpv + network sanity check',
    cmd: 'systemctl status signage-agent --no-pager -l | head -30 && pgrep -af mpv && ping -c 2 -W 3 1.1.1.1',
  },
};

@Injectable()
export class RemoteExecService {
  constructor(private prisma: PrismaService) {}

  // ---------- Fleet-wide freeze (kill switch) ----------

  async getFreeze() {
    const row = await this.prisma.fleetFreeze.upsert({
      where: { id: 1 }, update: {}, create: { id: 1 },
    });
    return row;
  }

  async setFreeze(frozen: boolean, reason: string | null, ctx: Ctx) {
    if (!ctx.permissions.includes('agents:remote-manage')) {
      throw new ForbiddenException('agents:remote-manage required to freeze/unfreeze the fleet');
    }
    if (frozen && !reason?.trim()) {
      throw new BadRequestException('reason required when freezing — audit trail');
    }
    return this.prisma.fleetFreeze.upsert({
      where: { id: 1 },
      update: { frozen, reason: reason?.trim() ?? null, frozenById: ctx.userId, frozenAt: new Date() },
      create: { id: 1, frozen, reason: reason?.trim() ?? null, frozenById: ctx.userId, frozenAt: new Date() },
    });
  }

  // ---------- Scoping (matches helpdesk + signage listDevices) ----------

  /**
   * Which devices can the operator target? Admin-level perms see all; everyone
   * else is scoped to devices whose storeId is in their accessible set.
   */
  private async canTargetDevice(ctx: Ctx, deviceId: string): Promise<boolean> {
    if (ctx.permissions.includes('tickets:read:all')
        || ctx.permissions.includes('signage:assignments:manage')) {
      return true;
    }
    const [user, device] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: ctx.userId }, select: { storeId: true, areaManagerId: true },
      }),
      this.prisma.signageDevice.findUnique({
        where: { id: deviceId }, select: { storeId: true },
      }),
    ]);
    if (!device) return false;
    if (!device.storeId) return false;  // unassigned devices only visible to admins

    const grants = await this.prisma.userStoreAccess.findMany({
      where: { userId: ctx.userId }, select: { storeId: true },
    });
    const ids = new Set<string>(grants.map((g) => g.storeId));
    if (user?.storeId) ids.add(user.storeId);
    if (user?.areaManagerId) {
      const amStores = await this.prisma.store.findMany({
        where: { areaManagerId: user.areaManagerId }, select: { id: true },
      });
      for (const s of amStores) ids.add(s.id);
    }
    return ids.has(device.storeId);
  }

  // ---------- Payload validators ----------

  private validate(kind: CommandKind, payload: any) {
    switch (kind) {
      case 'RESTART_AGENT':
      case 'RESTART_MPV':
      case 'REBOOT':
      case 'UPLOAD_LOGS':
      case 'TEST_PATTERN':
      case 'TEST_AUDIO':
        return {}; // no payload needed
      case 'RESTART_SERVICE': {
        const unit = String(payload?.unit ?? '').trim();
        if (!/^[a-z0-9@._\-]+$/i.test(unit)) throw new BadRequestException('unit name invalid');
        return { unit };
      }
      case 'TAIL_LOG': {
        const unit = String(payload?.unit ?? 'signage-agent').trim();
        const lines = Math.max(10, Math.min(2000, Number(payload?.lines ?? 200)));
        if (!/^[a-z0-9@._\-]+$/i.test(unit)) throw new BadRequestException('unit name invalid');
        return { unit, lines };
      }
      case 'APT_INSTALL': {
        const pkgs = Array.isArray(payload?.packages) ? payload.packages : [];
        if (!pkgs.length) throw new BadRequestException('packages required');
        for (const p of pkgs) {
          if (!/^[a-z0-9._+\-]+$/i.test(String(p))) throw new BadRequestException(`invalid package name: ${p}`);
        }
        return { packages: pkgs };
      }
      case 'UPLOAD_FILE': {
        const path = String(payload?.path ?? '').trim();
        const content = String(payload?.content ?? '');
        if (!path.startsWith('/etc/signage-agent/') && !path.startsWith('/opt/signage/')) {
          throw new BadRequestException('path must be under /etc/signage-agent/ or /opt/signage/');
        }
        if (path.includes('..')) throw new BadRequestException('path cannot traverse');
        if (content.length > 128 * 1024) throw new BadRequestException('content too large (>128KB)');
        return { path, content };
      }
      case 'RUN_PREDEFINED': {
        const key = String(payload?.key ?? '').trim();
        if (!PREDEFINED_SCRIPTS[key]) throw new BadRequestException(`unknown script: ${key}`);
        return { key, cmd: PREDEFINED_SCRIPTS[key].cmd };
      }
      case 'ROTATE_SCREEN': {
        const deg = Number(payload?.rotation ?? 0);
        if (![0, 90, 180, 270].includes(deg)) throw new BadRequestException('rotation must be 0/90/180/270');
        return { rotation: deg };
      }
      case 'PLAY_NOW': {
        const videoId = String(payload?.videoId ?? '').trim();
        if (!videoId) throw new BadRequestException('videoId required');
        return { videoId };
      }
      case 'SHELL_EXEC': {
        const cmd = String(payload?.cmd ?? '').trim();
        if (!cmd) throw new BadRequestException('cmd required');
        if (cmd.length > 4000) throw new BadRequestException('cmd too long');
        // Server-side allowlist check — first non-whitespace token must be a
        // binary name on the list. Prevents trivial "rm -rf /" even by typo.
        const firstTok = cmd.split(/\s+/)[0];
        if (!ALLOWED_BINARIES.includes(firstTok)) {
          throw new BadRequestException(
            `SHELL_EXEC first token must be one of: ${ALLOWED_BINARIES.join(', ')}`,
          );
        }
        return { cmd };
      }
      default:
        throw new BadRequestException(`unsupported kind: ${kind}`);
    }
  }

  // ---------- HMAC signing ----------

  private hmacSecret(): string {
    const s = process.env.REMOTE_EXEC_HMAC_SECRET || process.env.JWT_SECRET || '';
    if (!s) throw new Error('REMOTE_EXEC_HMAC_SECRET not set');
    return s;
  }

  /** Deterministic signature over the fields the agent will see on the wire. */
  signCommand(id: string, kind: string, payload: any) {
    const canonical = JSON.stringify({ id, kind, payload: payload ?? null });
    return crypto.createHmac('sha256', this.hmacSecret()).update(canonical).digest('hex');
  }

  // ---------- Queue ----------

  async queue(deviceId: string, dto: { kind: CommandKind; payload?: any; reason?: string }, ctx: Ctx) {
    const freeze = await this.getFreeze();
    if (freeze.frozen) {
      throw new ForbiddenException(
        `Fleet is frozen: "${freeze.reason ?? '(no reason given)'}". Unfreeze before queueing new commands.`,
      );
    }
    if (!COMMAND_KINDS.includes(dto.kind)) {
      throw new BadRequestException(`unknown kind: ${dto.kind}`);
    }
    // Permission gate: SHELL_EXEC needs the admin perm; everything else needs
    // the regular remote-exec perm.
    const needsShell = dto.kind === 'SHELL_EXEC';
    const needed = needsShell ? 'agents:remote-shell' : 'agents:remote-exec';
    if (!ctx.permissions.includes(needed)) {
      throw new ForbiddenException(`${needed} required for ${dto.kind}`);
    }
    if (needsShell && !dto.reason?.trim()) {
      throw new BadRequestException('reason required for SHELL_EXEC — audit trail');
    }

    if (!(await this.canTargetDevice(ctx, deviceId))) {
      throw new ForbiddenException('Device is outside your store scope');
    }

    const payload = this.validate(dto.kind, dto.payload);

    const cmd = await this.prisma.signagePlayerCommand.create({
      data: {
        deviceId, kind: dto.kind, payload,
        issuedById: ctx.userId, status: 'QUEUED',
        reason: dto.reason?.trim() || null,
      },
    });
    // Attach HMAC now that we know the id
    const hmac = this.signCommand(cmd.id, cmd.kind, cmd.payload);
    return this.prisma.signagePlayerCommand.update({
      where: { id: cmd.id }, data: { hmac },
    });
  }

  /**
   * Fleet-wide queue. Admin picks "all devices", "all FF stores", or
   * "all Evolve stores"; service enumerates, confirmation phrase must match
   * exactly, and we rate-limit to one bulk op every 30s per issuer so a stuck
   * finger doesn't double-fire.
   */
  async queueBulk(dto: {
    kind: CommandKind;
    payload?: any;
    reason?: string;
    scope: 'ALL' | 'FASHION_FUSION' | 'EVLV';
    confirmPhrase: string;    // must match "I CONFIRM FLEET <scope>"
  }, ctx: Ctx) {
    const expected = `I CONFIRM FLEET ${dto.scope}`;
    if (dto.confirmPhrase !== expected) {
      throw new BadRequestException(`Confirmation phrase must be exactly: "${expected}"`);
    }
    if (!ctx.permissions.includes('agents:remote-manage')) {
      throw new ForbiddenException('agents:remote-manage required for fleet-wide commands');
    }
    // Per-user rate limit — one bulk op every 30s
    const recent = await this.prisma.signagePlayerCommand.findFirst({
      where: {
        issuedById: ctx.userId,
        queuedAt: { gt: new Date(Date.now() - 30_000) },
        // marker: bulk ops always carry reason starting with "FLEET:"
        reason: { startsWith: 'FLEET:' },
      },
    });
    if (recent) throw new BadRequestException('Rate-limited — wait 30s between fleet-wide commands');

    const whereDev = dto.scope === 'ALL' ? { status: { not: 'DISABLED' } } :
      { entity: dto.scope, status: { not: 'DISABLED' } };
    const devices = await this.prisma.signageDevice.findMany({
      where: whereDev as any, select: { id: true },
    });

    const results: Array<{ deviceId: string; ok: boolean; error?: string }> = [];
    for (const d of devices) {
      try {
        await this.queue(d.id,
          { kind: dto.kind, payload: dto.payload, reason: `FLEET:${dto.scope} ${dto.reason ?? ''}`.trim() },
          ctx,
        );
        results.push({ deviceId: d.id, ok: true });
      } catch (e: any) {
        results.push({ deviceId: d.id, ok: false, error: e?.message ?? String(e) });
      }
    }
    return {
      total: devices.length,
      queued: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }
}
