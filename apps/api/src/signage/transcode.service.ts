import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Signage video transcode worker.
 *
 * For each uploaded video, produce 3 universally-decodable H.264 Baseline
 * (SD) + Main (HD/FHD) renditions optimised for playback on low-end signage
 * boxes. These variants are what we actually hand out to devices — the
 * original upload is kept only as source material.
 *
 * Why variants matter: marketing uploads 4K ProRes files sometimes. A Pi 3
 * tries to software-decode that → stutters forever. SD/HD/FHD variants
 * mean every device gets a stream it can actually play.
 *
 * Executes one transcode at a time, driven by a cron that polls for
 * PENDING jobs every 30 seconds. ffmpeg must be in PATH (the Dockerfile
 * installs it).
 */
export const VARIANTS = [
  { quality: 'SD',  w: 854,  h: 480,  bitrate: '1000k', maxrate: '1200k', bufsize: '2000k', profile: 'baseline', level: '3.1' },
  { quality: 'HD',  w: 1280, h: 720,  bitrate: '2500k', maxrate: '3000k', bufsize: '5000k', profile: 'main',     level: '4.0' },
  { quality: 'FHD', w: 1920, h: 1080, bitrate: '5000k', maxrate: '6000k', bufsize: '10000k',profile: 'main',     level: '4.1' },
] as const;

@Injectable()
export class SignageTranscodeService {
  private readonly log = new Logger(SignageTranscodeService.name);
  private running = false;

  constructor(private prisma: PrismaService, private storage: StorageService) {}

  // Cron picks up a pending video every 30s. We also mark RUNNING to prevent
  // overlap in multi-replica deployments.
  @Cron('*/30 * * * * *')
  async pickNext() {
    if (this.running) return;
    this.running = true;
    try {
      const job = await this.prisma.signageVideo.findFirst({
        where: { transcodeStatus: 'PENDING' },
        orderBy: { createdAt: 'asc' },
      });
      if (!job) return;
      await this.transcode(job.id);
    } catch (e) {
      this.log.error('Transcode cron error:', e);
    } finally {
      this.running = false;
    }
  }

  /** Admin-triggered re-transcode for a single video. */
  async retranscode(id: string) {
    await this.prisma.signageVideo.update({
      where: { id }, data: { transcodeStatus: 'PENDING', transcodeError: null },
    });
    await this.prisma.signageVideoVariant.deleteMany({ where: { videoId: id } });
    return { ok: true, queued: true };
  }

  // ----- Core transcode -----
  async transcode(videoId: string) {
    const video = await this.prisma.signageVideo.findUnique({ where: { id: videoId } });
    if (!video) return;

    await this.prisma.signageVideo.update({
      where: { id: videoId },
      data: { transcodeStatus: 'RUNNING', transcodeError: null },
    });

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signage-transcode-'));
    try {
      // 1. Pull the original from MinIO to a local temp file
      const localSrc = path.join(workDir, 'source');
      await this.downloadToFile(video.storageKey, localSrc);

      // 2. Inspect — skip transcode entirely if the source is already H.264
      //    at <= 1080p30 and <= 6 Mbps. No point re-encoding something that
      //    plays perfectly as-is.
      const probe = await this.ffprobe(localSrc);
      const alreadyGood = probe.codec === 'h264'
        && probe.height <= 1080
        && probe.bitrateKbps <= 6000;
      if (alreadyGood) {
        this.log.log(`Video ${videoId} already H.264 ${probe.width}x${probe.height} @ ${probe.bitrateKbps}k — skipping transcode, using original as all variants`);
        for (const v of VARIANTS) {
          // Point every variant at the original key so the config endpoint
          // can resolve a URL without actually re-encoding.
          if (v.h > probe.height) continue;
          await this.prisma.signageVideoVariant.upsert({
            where: { videoId_quality: { videoId, quality: v.quality } },
            update: { storageKey: video.storageKey, width: probe.width, height: probe.height,
                      bitrateKbps: probe.bitrateKbps, codec: probe.codec, sizeBytes: BigInt(probe.sizeBytes) },
            create: { videoId, quality: v.quality, storageKey: video.storageKey,
                      width: probe.width, height: probe.height, bitrateKbps: probe.bitrateKbps,
                      codec: probe.codec, sizeBytes: BigInt(probe.sizeBytes) },
          });
        }
        await this.prisma.signageVideo.update({
          where: { id: videoId },
          data: { transcodeStatus: 'SKIPPED', transcodeAt: new Date(), durationSeconds: probe.durationSeconds },
        });
        return;
      }

      // 3. Transcode each applicable variant. Dimensions swap for portrait
      //    sources so a 1080x1920 vertical ad doesn't get crammed into a
      //    854x480 landscape box with huge letterbox bars — the result would
      //    look like a stamp in the middle of the TV. Portrait → portrait,
      //    landscape → landscape, each at its native orientation.
      const isPortrait = probe.height > probe.width;
      const shortSide  = Math.min(probe.width, probe.height);
      for (const variant of VARIANTS) {
        const targetShort = Math.min(variant.w, variant.h);  // SD=480, HD=720, FHD=1080
        if (targetShort > shortSide) {
          this.log.log(`Skipping ${variant.quality} — source short-side ${shortSide}px < ${targetShort}px`);
          continue;
        }
        // Swap target width/height for portrait sources.
        const outW = isPortrait ? Math.min(variant.w, variant.h) : variant.w;
        const outH = isPortrait ? Math.max(variant.w, variant.h) : variant.h;
        const outPath = path.join(workDir, `${variant.quality}.mp4`);
        this.log.log(`Transcoding ${videoId} → ${variant.quality} (${outW}x${outH} @ ${variant.bitrate}, ${isPortrait ? 'portrait' : 'landscape'})`);
        await this.runFfmpeg(localSrc, outPath, { ...variant, w: outW, h: outH });

        const stat = await fs.stat(outPath);
        const checksum = await this.md5(outPath);
        const storageKey = `signage/videos/${videoId}/${variant.quality.toLowerCase()}.mp4`;
        await this.storage.putFile(storageKey, outPath, 'video/mp4');

        await this.prisma.signageVideoVariant.upsert({
          where: { videoId_quality: { videoId, quality: variant.quality } },
          update: {
            storageKey, sizeBytes: BigInt(stat.size),
            width: outW, height: outH,
            bitrateKbps: parseInt(variant.bitrate, 10),
            codec: 'h264', checksum,
          },
          create: {
            videoId, quality: variant.quality, storageKey,
            sizeBytes: BigInt(stat.size),
            width: outW, height: outH,
            bitrateKbps: parseInt(variant.bitrate, 10),
            codec: 'h264', checksum,
          },
        });
      }

      await this.prisma.signageVideo.update({
        where: { id: videoId },
        data: { transcodeStatus: 'DONE', transcodeAt: new Date(), durationSeconds: probe.durationSeconds },
      });
      this.log.log(`Transcode complete for ${videoId}`);
    } catch (e: any) {
      this.log.error(`Transcode failed for ${videoId}: ${e?.message}`);
      await this.prisma.signageVideo.update({
        where: { id: videoId },
        data: { transcodeStatus: 'FAILED', transcodeError: (e?.message ?? String(e)).slice(0, 500) },
      });
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ----- ffmpeg + ffprobe wrappers -----
  private async runFfmpeg(input: string, output: string, v: {
    quality: string; w: number; h: number;
    bitrate: string; maxrate: string; bufsize: string;
    profile: string; level: string;
  }): Promise<void> {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-y',
      '-i', input,
      // Video — H.264, pad/scale to the right box keeping aspect ratio.
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-profile:v', v.profile,
      '-level', v.level,
      '-pix_fmt', 'yuv420p',
      '-vf', `scale=w=${v.w}:h=${v.h}:force_original_aspect_ratio=decrease,pad=${v.w}:${v.h}:(ow-iw)/2:(oh-ih)/2:black`,
      '-b:v', v.bitrate,
      '-maxrate', v.maxrate,
      '-bufsize', v.bufsize,
      // Keyframe every 2 seconds — faster seek, better buffer behaviour on mpv.
      '-g', '60',
      // Audio — AAC 128k stereo.
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      // Faststart so mpv can start playing before downloading finishes.
      '-movflags', '+faststart',
      output,
    ];
    return new Promise((resolve, reject) => {
      const p = spawn('ffmpeg', args);
      let stderr = '';
      p.stderr.on('data', (c) => { stderr += c.toString(); });
      p.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
      });
      p.on('error', reject);
    });
  }

  private ffprobe(input: string): Promise<{
    codec: string; width: number; height: number;
    durationSeconds: number; bitrateKbps: number; sizeBytes: number;
  }> {
    return new Promise(async (resolve, reject) => {
      const stat = await fs.stat(input).catch(() => ({ size: 0 } as any));
      const args = [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name,width,height:format=duration,bit_rate',
        '-of', 'json', input,
      ];
      const p = spawn('ffprobe', args);
      let out = '';
      p.stdout.on('data', (c) => { out += c.toString(); });
      p.on('close', (code) => {
        if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
        try {
          const j = JSON.parse(out);
          const s = (j.streams ?? [])[0] ?? {};
          const f = j.format ?? {};
          resolve({
            codec:   s.codec_name ?? 'unknown',
            width:   Number(s.width ?? 0),
            height:  Number(s.height ?? 0),
            durationSeconds: Math.round(Number(f.duration ?? 0)),
            bitrateKbps: Math.round(Number(f.bit_rate ?? 0) / 1000),
            sizeBytes:   stat.size,
          });
        } catch (e) { reject(e); }
      });
      p.on('error', reject);
    });
  }

  private async downloadToFile(storageKey: string, dest: string) {
    const url = await this.storage.presignedGet(storageKey, 3600);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download ${storageKey} failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(dest, buf);
  }

  /**
   * MD5 (NOT sha256!) because the Python agent's cache.py uses hashlib.md5 to
   * verify downloaded files. If this returned sha256 the agent would reject
   * every variant as "corrupt" on download and the signage would never play.
   */
  private async md5(file: string): Promise<string> {
    const h = crypto.createHash('md5');
    h.update(await fs.readFile(file));
    return h.digest('hex');
  }
}
