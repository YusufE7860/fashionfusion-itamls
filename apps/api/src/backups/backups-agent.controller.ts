import {
  BadRequestException, Body, Controller, Get, Headers, Ip, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ApiKeysService } from '../discovery/api-keys.service';
import { Public } from '../common/decorators/permissions.decorator';

/**
 * Endpoints called by the PowerShell backup agent running on each till / back-office PC.
 * Authenticated with the same X-Api-Key mechanism as the discovery agent.
 */
@Controller('backups')
export class BackupsAgentController {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private apiKeys: ApiKeysService,
  ) {}

  private async requireKey(key: string) {
    const k = await this.apiKeys.validate(key);
    if (!k || (k.scope !== 'BACKUP' && k.scope !== 'DISCOVERY' && k.scope !== 'FULL')) {
      throw new UnauthorizedException('Invalid API key');
    }
    return k;
  }

  /**
   * Agent calls this on start-up to fetch its config.
   * If the (storeCode, pcName) combination isn't registered yet, we auto-create it
   * as an inactive/empty PC so the admin can configure it later from the UI.
   */
  @Public()
  @Get('config')
  async config(
    @Headers('x-api-key') key: string,
    @Query('storeCode') storeCode: string,
    @Query('pcName') pcName: string,
    @Ip() ip: string,
  ) {
    await this.requireKey(key);
    if (!storeCode || !pcName) throw new BadRequestException('storeCode and pcName required');
    const store = await this.prisma.store.findUnique({ where: { code: storeCode } });
    if (!store) throw new BadRequestException(`Unknown store code ${storeCode}`);
    const job = await this.prisma.backupJob.upsert({
      where: { storeId: store.id },
      create: { storeId: store.id },
      update: {},
    });
    const pc = await this.prisma.storePc.upsert({
      where: { storeId_name: { storeId: store.id, name: pcName } },
      create: { storeId: store.id, name: pcName },
      update: { lastSeenAt: new Date() },
    });
    let paths: string[] = [];
    try { paths = JSON.parse(pc.backupPaths); } catch {}
    return {
      pcId: pc.id,
      storeCode: store.code,
      pcName: pc.name,
      isActive: pc.isActive && job.isActive,
      backupPaths: paths,
      scheduleCron: job.scheduleCron,
    };
  }

  /**
   * Agent asks to start a new backup — returns a pre-signed PUT URL for MinIO.
   * The agent then PUTs the zip directly to that URL. When it's done, it calls /complete.
   */
  @Public()
  @Post('start')
  async start(@Headers('x-api-key') key: string, @Body() body: { pcId: string; sizeBytes?: number }, @Ip() ip: string) {
    await this.requireKey(key);
    const pc = await this.prisma.storePc.findUnique({
      where: { id: body.pcId }, include: { store: true },
    });
    if (!pc) throw new BadRequestException('Unknown pcId');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const key_ = `backups/${pc.store.code}/${pc.name}/${stamp}.zip`;
    const run = await this.prisma.backupRun.create({
      data: { pcId: pc.id, status: 'RUNNING', storagePath: key_, sourceIp: ip },
    });
    const uploadUrl = await this.storage.presignedPut(key_, 60 * 60);
    return { runId: run.id, objectKey: key_, uploadUrl };
  }

  @Public()
  @Post(':id/complete')
  async complete(
    @Headers('x-api-key') key: string,
    @Body() body: { sizeBytes: number },
    @Req() req: Request,
  ) {
    await this.requireKey(key);
    const id = req.params.id;
    const run = await this.prisma.backupRun.findUnique({ where: { id } });
    if (!run) throw new BadRequestException('Unknown run');
    const size = BigInt(body.sizeBytes ?? 0);
    await this.prisma.$transaction([
      this.prisma.backupRun.update({
        where: { id },
        data: { status: 'SUCCESS', completedAt: new Date(), sizeBytes: size },
      }),
      this.prisma.storePc.update({
        where: { id: run.pcId },
        data: { lastBackupAt: new Date(), lastSeenAt: new Date() },
      }),
    ]);
    return { ok: true };
  }

  @Public()
  @Post(':id/fail')
  async fail(
    @Headers('x-api-key') key: string,
    @Body() body: { error: string },
    @Req() req: Request,
  ) {
    await this.requireKey(key);
    return this.prisma.backupRun.update({
      where: { id: req.params.id },
      data: { status: 'FAILED', completedAt: new Date(), error: (body.error ?? '').slice(0, 2000) },
    });
  }
}
