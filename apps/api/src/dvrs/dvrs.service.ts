import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as http from 'node:http';
import * as https from 'node:https';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * DVR inventory + live snapshots.
 *
 * Supported brands: DAHUA (CGI) and HIKVISION (ISAPI). Both offer HTTP
 * digest-auth snapshot endpoints that return JPEG bytes. We proxy those
 * so:
 *   1. The browser never sees the DVR password
 *   2. The store's DVR only needs to be reachable from the ITAMLS server
 *      (which is on the DC end of the WireGuard/SSTP tunnels), not from
 *      every operator's browser
 *
 * Live video: browsers can't play RTSP natively. The DVR web UIs mostly
 * require ActiveX. For a real "video wall in the app" we'd need a media
 * server (go2rtc / MediaMTX) transcoding RTSP -> HLS/WebRTC -- separate
 * follow-up. For now: snapshot cards + copy-to-clipboard RTSP URL + a
 * "Open web UI" button that opens the DVR's own login page.
 */

export interface UpsertDvrDto {
  name: string;
  brand: 'DAHUA' | 'HIKVISION' | 'OTHER';
  model?: string;
  serialNo?: string;
  ipAddress: string;
  httpPort?: number;
  rtspPort?: number;
  channels?: number;
  username?: string;
  password: string;
  notes?: string;
}

@Injectable()
export class DvrsService {
  constructor(private prisma: PrismaService) {}

  // ---------- Access helpers ----------
  /**
   * Resolve which stores the given user is allowed to see DVRs for.
   *  - Users with the DvrsReadAll permission (via their role or override) see everything
   *  - Otherwise, filter by their UserStoreAccess entries
   */
  private async allowedStoreIds(userId: string, permissions: string[]): Promise<string[] | null> {
    if (permissions?.includes('dvrs:read:all')) return null; // null = no filter
    const rows = await this.prisma.userStoreAccess.findMany({
      where: { userId }, select: { storeId: true },
    });
    return rows.map((r) => r.storeId);
  }

  // ---------- CRUD ----------
  async listForStore(storeId: string, ctx: { userId: string; permissions: string[] }) {
    const allowed = await this.allowedStoreIds(ctx.userId, ctx.permissions);
    if (allowed !== null && !allowed.includes(storeId)) {
      throw new NotFoundException();  // don't leak existence
    }
    return this.prisma.dvr.findMany({
      where: { storeId }, orderBy: { name: 'asc' },
    });
  }

  async listAll(ctx: { userId: string; permissions: string[] }) {
    const allowed = await this.allowedStoreIds(ctx.userId, ctx.permissions);
    return this.prisma.dvr.findMany({
      where: allowed === null ? undefined : { storeId: { in: allowed } },
      orderBy: [{ store: { code: 'asc' } }, { name: 'asc' }],
      include: { store: { select: { id: true, code: true, name: true } } },
    });
  }

  async get(id: string, ctx?: { userId: string; permissions: string[] }) {
    const d = await this.prisma.dvr.findUnique({
      where: { id },
      include: { store: { select: { id: true, code: true, name: true } } },
    });
    if (!d) throw new NotFoundException();
    if (ctx) {
      const allowed = await this.allowedStoreIds(ctx.userId, ctx.permissions);
      if (allowed !== null && !allowed.includes(d.storeId)) throw new NotFoundException();
    }
    return d;
  }

  async create(storeId: string, dto: UpsertDvrDto) {
    if (!dto.name?.trim())      throw new BadRequestException('name required');
    if (!dto.ipAddress?.trim()) throw new BadRequestException('ipAddress required');
    if (!dto.password?.trim())  throw new BadRequestException('password required');
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true } });
    if (!store) throw new NotFoundException('Unknown store');
    return this.prisma.dvr.create({
      data: {
        storeId,
        name: dto.name.trim(),
        brand: dto.brand,
        model: dto.model,
        serialNo: dto.serialNo,
        ipAddress: dto.ipAddress.trim(),
        httpPort: dto.httpPort ?? 80,
        rtspPort: dto.rtspPort ?? 554,
        channels: dto.channels ?? 4,
        username: dto.username?.trim() || 'admin',
        password: dto.password,
        notes: dto.notes,
      },
    });
  }

  async update(id: string, dto: Partial<UpsertDvrDto>) {
    const d = await this.prisma.dvr.findUnique({ where: { id } });
    if (!d) throw new NotFoundException();
    return this.prisma.dvr.update({
      where: { id },
      data: {
        ...(dto.name       != null && { name: dto.name.trim() }),
        ...(dto.brand      != null && { brand: dto.brand }),
        ...(dto.model      != null && { model: dto.model }),
        ...(dto.serialNo   != null && { serialNo: dto.serialNo }),
        ...(dto.ipAddress  != null && { ipAddress: dto.ipAddress.trim() }),
        ...(dto.httpPort   != null && { httpPort: dto.httpPort }),
        ...(dto.rtspPort   != null && { rtspPort: dto.rtspPort }),
        ...(dto.channels   != null && { channels: dto.channels }),
        ...(dto.username   != null && { username: dto.username.trim() || 'admin' }),
        ...(dto.password   != null && dto.password.trim() && { password: dto.password }),
        ...(dto.notes      != null && { notes: dto.notes }),
      },
    });
  }

  remove(id: string) {
    return this.prisma.dvr.delete({ where: { id } });
  }

  // ---------- URLs (RTSP + web launch) ----------
  /**
   * Returns the connection endpoints for the operator. RTSP URL includes
   * credentials so the operator can paste into VLC / iOS RTSP Player / etc.
   * The webUrl doesn't embed credentials (browsers no longer honour
   * user:pass@host and it leaks in history).
   */
  async endpoints(id: string, ctx?: { userId: string; permissions: string[] }) {
    const d = await this.get(id, ctx);
    return {
      dvrId: d.id,
      brand: d.brand,
      webUrl: `http://${d.ipAddress}${d.httpPort !== 80 ? ':' + d.httpPort : ''}`,
      rtspByChannel: Array.from({ length: d.channels }, (_, i) => ({
        channel: i + 1,
        url: this.buildRtspUrl(d, i + 1),
      })),
    };
  }

  private buildRtspUrl(
    d: { brand: string; username: string; password: string; ipAddress: string; rtspPort: number },
    channel: number,
  ): string {
    const auth = `${encodeURIComponent(d.username)}:${encodeURIComponent(d.password)}`;
    if (d.brand === 'HIKVISION') {
      // Channels are 1-indexed as N01 (main) / N02 (sub): 101, 201, 301, ...
      return `rtsp://${auth}@${d.ipAddress}:${d.rtspPort}/Streaming/Channels/${channel}01`;
    }
    // DAHUA + OTHER default
    return `rtsp://${auth}@${d.ipAddress}:${d.rtspPort}/cam/realmonitor?channel=${channel}&subtype=0`;
  }

  // ---------- Snapshot proxy ----------
  async snapshot(id: string, channel: number, ctx?: { userId: string; permissions: string[] }): Promise<Buffer> {
    const d = await this.prisma.dvr.findUnique({ where: { id } });
    if (!d) throw new NotFoundException();
    if (ctx) {
      const allowed = await this.allowedStoreIds(ctx.userId, ctx.permissions);
      if (allowed !== null && !allowed.includes(d.storeId)) throw new NotFoundException();
    }
    if (channel < 1 || channel > (d.channels ?? 4)) {
      throw new BadRequestException(`channel out of range (1..${d.channels})`);
    }
    const buf = await this.fetchWithDigest(d, this.snapshotPath(d.brand, channel));
    // Best-effort liveness marker
    await this.prisma.dvr.update({ where: { id }, data: { lastSeenAt: new Date() } }).catch(() => {});
    return buf;
  }

  private snapshotPath(brand: string, channel: number): string {
    if (brand === 'HIKVISION') {
      return `/ISAPI/Streaming/channels/${channel}01/picture`;
    }
    // DAHUA + OTHER
    return `/cgi-bin/snapshot.cgi?channel=${channel}`;
  }

  /**
   * DVRs authenticate with HTTP Digest. Node has no built-in digest client,
   * so we do it by hand: first request gets 401 with a WWW-Authenticate
   * challenge, we compute the digest response, retry with Authorization.
   */
  private fetchWithDigest(
    d: { ipAddress: string; httpPort: number; username: string; password: string },
    path: string,
  ): Promise<Buffer> {
    const isHttps = d.httpPort === 443;
    const opts = (extraHeaders: Record<string, string> = {}): http.RequestOptions => ({
      host: d.ipAddress, port: d.httpPort, method: 'GET', path,
      timeout: 8000, headers: { 'User-Agent': 'ITAMLS/1.0', ...extraHeaders },
      // Accept self-signed on the rare HTTPS DVR
      rejectUnauthorized: false,
    } as any);

    const requestor = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const req1 = requestor.request(opts(), (res) => {
        if (res.statusCode === 200) {
          this.collectBody(res).then(resolve, reject); return;
        }
        if (res.statusCode !== 401 || !res.headers['www-authenticate']) {
          res.resume();
          reject(new Error(`DVR returned ${res.statusCode ?? '??'} without a digest challenge`));
          return;
        }
        // Digest challenge -> compute response
        const chall = this.parseDigestChallenge(String(res.headers['www-authenticate']));
        if (!chall.realm || !chall.nonce) {
          res.resume();
          reject(new Error('Malformed digest challenge from DVR'));
          return;
        }
        res.resume();

        const cnonce = createHash('md5').update(Math.random().toString()).digest('hex').slice(0, 16);
        const nc = '00000001';
        const ha1 = createHash('md5').update(`${d.username}:${chall.realm}:${d.password}`).digest('hex');
        const ha2 = createHash('md5').update(`GET:${path}`).digest('hex');
        const response = chall.qop
          ? createHash('md5').update(`${ha1}:${chall.nonce}:${nc}:${cnonce}:${chall.qop}:${ha2}`).digest('hex')
          : createHash('md5').update(`${ha1}:${chall.nonce}:${ha2}`).digest('hex');

        const authHeader =
          `Digest username="${d.username}", realm="${chall.realm}", nonce="${chall.nonce}", ` +
          `uri="${path}", response="${response}"` +
          (chall.opaque ? `, opaque="${chall.opaque}"` : '') +
          (chall.qop    ? `, qop=${chall.qop}, nc=${nc}, cnonce="${cnonce}"` : '') +
          `, algorithm=MD5`;

        const req2 = requestor.request(opts({ Authorization: authHeader }), (res2) => {
          if (res2.statusCode !== 200) {
            res2.resume();
            reject(new Error(`DVR returned ${res2.statusCode} after auth`));
            return;
          }
          this.collectBody(res2).then(resolve, reject);
        });
        req2.on('error', reject);
        req2.on('timeout', () => req2.destroy(new Error('DVR request timed out')));
        req2.end();
      });
      req1.on('error', reject);
      req1.on('timeout', () => req1.destroy(new Error('DVR request timed out')));
      req1.end();
    });
  }

  private collectBody(res: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end',   () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
  }

  private parseDigestChallenge(header: string): Record<string, string> {
    const out: Record<string, string> = {};
    const body = header.replace(/^Digest\s+/i, '');
    // key=value or key="value" pairs, comma-separated
    const re = /(\w+)\s*=\s*(?:"([^"]*)"|([^,]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? '').trim();
    return out;
  }
}
