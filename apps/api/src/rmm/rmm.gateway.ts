import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { PrismaService } from '../prisma/prisma.service';

interface AgentSocket extends WebSocket {
  agentPcId?: string;
  connectionId?: string;
  isAlive?: boolean;
}

/**
 * Low-level WebSocket relay between enrolled PC agents and the API.
 *
 * - Agents connect with Authorization: Bearer <agent-token> and send a `hello`.
 * - Server tracks live sockets by agentPcId so REST endpoints can dispatch
 *   commands (`dispatch(agentPcId, cmd)`).
 * - Metrics / cmd_result messages are persisted to Postgres.
 *
 * This gateway attaches to the existing Nest HTTP server instance; it does
 * NOT use NestWebsocketsModule because we want full control over the auth
 * handshake and framing.
 */
@Injectable()
export class RmmGateway implements OnModuleInit {
  private readonly logger = new Logger(RmmGateway.name);
  private wss: WebSocketServer | null = null;
  private sockets = new Map<string, AgentSocket>();    // agentPcId → socket
  // Browser-side listeners for live tailing (session consoles)
  private listeners = new Map<string, Set<(evt: any) => void>>(); // agentPcId → listeners

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    // No-op; attach() is called from main.ts with the Nest HTTP server.
  }

  attach(server: HttpServer) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', async (req, socket, head) => {
      if (!req.url?.startsWith('/api/v1/rmm/ws')) return;
      try {
        const authHdr = req.headers['authorization'] ?? '';
        const token = typeof authHdr === 'string' && authHdr.startsWith('Bearer ')
          ? authHdr.slice(7) : null;
        if (!token) { socket.destroy(); return; }

        const agentPc = await this.resolveAgent(token);
        if (!agentPc) { socket.destroy(); return; }

        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.wss!.emit('connection', ws, req, agentPc);
        });
      } catch (e) {
        this.logger.error('WS upgrade failed', e as any);
        socket.destroy();
      }
    });

    this.wss.on('connection', async (ws: AgentSocket, _req, agentPc: any) => {
      ws.agentPcId = agentPc.id;
      ws.isAlive = true;

      const conn = await this.prisma.rmmConnection.upsert({
        where: { agentPcId: agentPc.id },
        create: {
          agentPcId: agentPc.id,
          isOnline: true,
          connectedAt: new Date(),
          lastSeenAt: new Date(),
        },
        update: {
          isOnline: true,
          connectedAt: new Date(),
          lastSeenAt: new Date(),
        },
      });
      ws.connectionId = conn.id;
      this.sockets.set(agentPc.id, ws);
      this.logger.log(`RMM connected: ${agentPc.id}`);

      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', async (buf) => {
        let msg: any; try { msg = JSON.parse(buf.toString()); } catch { return; }
        await this.handleAgentMessage(ws, msg).catch((e) => this.logger.error('msg handler', e));
      });

      ws.on('close', async () => {
        this.sockets.delete(agentPc.id);
        await this.prisma.rmmConnection.update({
          where: { id: conn.id },
          data: { isOnline: false, lastSeenAt: new Date() },
        }).catch(() => {});
        this.logger.log(`RMM disconnected: ${agentPc.id}`);
      });

      // Flush any queued commands for this agent now that it's online
      this.flushQueued(conn.id, ws).catch((e) => this.logger.error('flush', e));
    });

    // Heartbeat sweep
    setInterval(() => {
      this.wss?.clients.forEach((c: AgentSocket) => {
        if (!c.isAlive) return c.terminate();
        c.isAlive = false;
        try { c.ping(); } catch { /* ignore */ }
      });
    }, 30_000);
  }

  private async resolveAgent(token: string) {
    const p = this.prisma as any;
    const model = p.agentPc ?? p.pc ?? p.enrolledPc;
    if (!model) return null;
    try {
      return await model.findFirst({
        where: {
          OR: [
            { authToken: token },
            { token },
            { apiKey: token },
          ],
          isActive: true,
        } as any,
      });
    } catch {
      return null;
    }
  }

  private async handleAgentMessage(ws: AgentSocket, msg: any) {
    if (!ws.connectionId) return;
    switch (msg.type) {
      case 'hello':
        await this.prisma.rmmConnection.update({
          where: { id: ws.connectionId },
          data: {
            agentVersion: msg.agentVersion, osName: msg.osName, osVersion: msg.osVersion,
            publicIp: msg.publicIp, localIp: msg.localIp,
          },
        });
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'metrics':
        await this.prisma.rmmMetric.create({
          data: {
            connectionId: ws.connectionId,
            cpuPct: msg.cpuPct, memUsedBytes: msg.memUsedBytes, memTotalBytes: msg.memTotalBytes,
            diskUsedBytes: msg.diskUsedBytes, diskTotalBytes: msg.diskTotalBytes,
            netRxBytesPerS: msg.netRxBytesPerS, netTxBytesPerS: msg.netTxBytesPerS,
            loggedInUser: msg.loggedInUser,
          },
        });
        await this.prisma.rmmConnection.update({
          where: { id: ws.connectionId }, data: { lastSeenAt: new Date() },
        });
        // notify browser listeners
        this.emit(ws.agentPcId!, { type: 'metrics', data: msg });
        break;
      case 'cmd_output':
        this.emit(ws.agentPcId!, { type: 'cmd_output', id: msg.id, stream: msg.stream, chunk: msg.chunk });
        break;
      case 'cmd_result':
        await this.prisma.rmmCommand.update({
          where: { id: msg.id },
          data: {
            status: msg.status ?? (msg.exitCode === 0 ? 'DONE' : 'FAILED'),
            stdout: (msg.stdout ?? '').slice(0, 100_000),
            stderr: (msg.stderr ?? '').slice(0, 100_000),
            exitCode: msg.exitCode ?? null,
            completedAt: new Date(),
          },
        }).catch(() => {});
        this.emit(ws.agentPcId!, { type: 'cmd_result', data: msg });
        break;
      case 'session_state':
        this.emit(ws.agentPcId!, { type: 'session_state', data: msg });
        break;
      default:
        this.logger.warn(`Unknown agent msg: ${msg.type}`);
    }
  }

  // Public helpers used by REST controllers
  isOnline(agentPcId: string) { return this.sockets.has(agentPcId); }

  async dispatch(agentPcId: string, cmd: {
    id: string; kind: string; payload: any;
  }) {
    const ws = this.sockets.get(agentPcId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return { sent: false, reason: 'Agent is offline' };
    }
    ws.send(JSON.stringify({ type: 'cmd', ...cmd }));
    await this.prisma.rmmCommand.update({ where: { id: cmd.id }, data: { status: 'SENT', sentAt: new Date() } }).catch(() => {});
    return { sent: true };
  }

  private async flushQueued(connectionId: string, ws: AgentSocket) {
    const queued = await this.prisma.rmmCommand.findMany({
      where: { connectionId, status: 'QUEUED' },
      orderBy: { queuedAt: 'asc' },
    });
    for (const c of queued) {
      ws.send(JSON.stringify({ type: 'cmd', id: c.id, kind: c.kind, payload: c.payload }));
      await this.prisma.rmmCommand.update({ where: { id: c.id }, data: { status: 'SENT', sentAt: new Date() } });
    }
  }

  // Browser listeners (for live metrics / shell tail)
  on(agentPcId: string, cb: (evt: any) => void) {
    if (!this.listeners.has(agentPcId)) this.listeners.set(agentPcId, new Set());
    this.listeners.get(agentPcId)!.add(cb);
    return () => this.listeners.get(agentPcId)?.delete(cb);
  }
  private emit(agentPcId: string, evt: any) {
    this.listeners.get(agentPcId)?.forEach((cb) => { try { cb(evt); } catch { /* ignore */ } });
  }
}
