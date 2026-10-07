import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RmmGateway } from './rmm.gateway';

export interface UserCtx { userId: string; permissions: string[] }

@Injectable()
export class RmmService {
  constructor(private prisma: PrismaService, private gateway: RmmGateway) {}

  // ---------- Connection / PC listing ----------
  async listConnections() {
    return this.prisma.rmmConnection.findMany({
      orderBy: [{ isOnline: 'desc' }, { lastSeenAt: 'desc' }],
      take: 500,
    });
  }

  async connectionFor(agentPcId: string) {
    const c = await this.prisma.rmmConnection.findUnique({ where: { agentPcId } });
    if (!c) throw new NotFoundException('No RMM connection record for this PC yet');
    return { ...c, live: this.gateway.isOnline(agentPcId) };
  }

  // ---------- Metrics ----------
  async recentMetrics(agentPcId: string, limit = 60) {
    const conn = await this.prisma.rmmConnection.findUnique({ where: { agentPcId }, select: { id: true } });
    if (!conn) return [];
    return this.prisma.rmmMetric.findMany({
      where: { connectionId: conn.id },
      orderBy: { recordedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  // ---------- Commands ----------
  async queueCommand(agentPcId: string, dto: {
    kind: 'SHELL' | 'SCRIPT' | 'FILE_PUSH' | 'FILE_PULL' | 'WAKE' | 'RESTART';
    payload: any;
    sessionId?: string;
  }, ctx: UserCtx) {
    const conn = await this.prisma.rmmConnection.findUnique({ where: { agentPcId } });
    if (!conn) throw new NotFoundException('No RMM connection — PC has never connected');
    if (dto.kind === 'SHELL' && !dto.payload?.script) throw new BadRequestException('payload.script required for SHELL');

    const id = `cmd_${randomBytes(8).toString('hex')}`;
    const cmd = await this.prisma.rmmCommand.create({
      data: {
        id, connectionId: conn.id, sessionId: dto.sessionId,
        issuedById: ctx.userId, kind: dto.kind, payload: dto.payload, status: 'QUEUED',
      },
    });

    const res = await this.gateway.dispatch(agentPcId, { id, kind: dto.kind, payload: dto.payload });
    return { ...cmd, dispatched: res.sent, reason: res.sent ? null : res.reason };
  }

  async commandHistory(agentPcId: string, limit = 50) {
    const conn = await this.prisma.rmmConnection.findUnique({ where: { agentPcId }, select: { id: true } });
    if (!conn) return [];
    return this.prisma.rmmCommand.findMany({
      where: { connectionId: conn.id },
      orderBy: { queuedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: { issuedBy: { select: { fullName: true, email: true } } },
    });
  }

  // ---------- Sessions ----------
  async startSession(agentPcId: string, dto: { kind: 'SHELL' | 'DESKTOP' | 'FILES'; reason?: string }, ctx: UserCtx) {
    const conn = await this.prisma.rmmConnection.findUnique({ where: { agentPcId } });
    if (!conn) throw new NotFoundException();
    return this.prisma.rmmSession.create({
      data: {
        connectionId: conn.id, kind: dto.kind, initiatedById: ctx.userId,
        reason: dto.reason ?? null, consentState: 'AUTO',   // phase 4 flips to PENDING + user consent
      },
    });
  }

  async endSession(sessionId: string) {
    return this.prisma.rmmSession.update({ where: { id: sessionId }, data: { endedAt: new Date() } });
  }

  // ---------- Scripts ----------
  listScripts() {
    return this.prisma.rmmScript.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: { createdBy: { select: { fullName: true } } },
    });
  }
  async createScript(dto: {
    name: string; description?: string; interpreter?: 'POWERSHELL' | 'CMD' | 'BASH';
    body: string; tags?: string;
  }, ctx: UserCtx) {
    if (!dto.name?.trim() || !dto.body?.trim()) throw new BadRequestException('name and body required');
    return this.prisma.rmmScript.create({
      data: {
        name: dto.name.trim(), description: dto.description ?? null,
        interpreter: dto.interpreter ?? 'POWERSHELL',
        body: dto.body, tags: dto.tags ?? null,
        createdById: ctx.userId,
      },
    });
  }

  async runScript(scriptId: string, agentPcIds: string[], ctx: UserCtx) {
    const script = await this.prisma.rmmScript.findUnique({ where: { id: scriptId } });
    if (!script || !script.isActive) throw new NotFoundException('Script not found');

    const results: any[] = [];
    for (const pcId of agentPcIds) {
      try {
        const cmd = await this.queueCommand(pcId, {
          kind: 'SCRIPT',
          payload: { interpreter: script.interpreter, script: script.body, timeoutMs: 300_000 },
        }, ctx);
        await this.prisma.rmmScriptRun.create({
          data: { scriptId, connectionId: cmd.connectionId, commandId: cmd.id, status: cmd.status ?? 'QUEUED' },
        });
        results.push({ agentPcId: pcId, commandId: cmd.id, dispatched: cmd.dispatched });
      } catch (e: any) {
        results.push({ agentPcId: pcId, error: e.message });
      }
    }
    return { ok: true, results };
  }
}
