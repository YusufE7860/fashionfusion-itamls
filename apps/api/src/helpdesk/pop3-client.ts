import * as net from 'node:net';
import * as tls from 'node:tls';

/**
 * Minimal RFC 1939 POP3 client — just enough for our email-to-ticket
 * poller: USER/PASS auth, STAT, LIST, RETR, DELE, QUIT. No PIPELINING,
 * no APOP, no SASL. Handles STARTTLS via `starttls` option too.
 *
 * Chosen over a third-party lib because POP3 is 6 commands and we want
 * zero surprises from an unmaintained npm package (all the popular POP3
 * libs are 8+ years old).
 */

export interface Pop3Config {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** 'ssl' = TLS on connect (995); 'starttls' = plain then STLS (110);
   *  'plain' = totally cleartext (110, dev only). */
  security?: 'ssl' | 'starttls' | 'plain';
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
}

export interface Pop3Message {
  messageNumber: number;
  size: number;
  /** UIDL (server-assigned unique ID) so we can skip already-processed ones. */
  uid: string;
  raw: Buffer;
}

/** Connect, auth, fetch every message, and QUIT. Returns messages + a
 *  callback the caller invokes to DELETE the successfully-processed ones. */
export async function pop3FetchAll(cfg: Pop3Config): Promise<{ messages: Pop3Message[]; deleteAll: (nums: number[]) => Promise<void>; close: () => Promise<void> }> {
  const socket = await connect(cfg);
  const write = (cmd: string) => new Promise<void>((resolve) => socket.write(cmd + '\r\n', () => resolve()));
  const readReply = () => readSingleLineReply(socket, cfg.commandTimeoutMs ?? 15_000);
  const readMulti = () => readMultiLineReply(socket, cfg.commandTimeoutMs ?? 30_000);

  // Server greeting
  await readReply();

  await write(`USER ${cfg.user}`); await readReply();
  await write(`PASS ${cfg.pass}`); await readReply();

  // How many messages?
  await write(`STAT`); const statLine = await readReply();
  // "+OK <count> <total-bytes>"
  const [, countStr] = statLine.split(/\s+/);
  const count = parseInt(countStr, 10) || 0;

  // Fetch UIDLs (so caller can dedupe)
  const uidlMap = new Map<number, string>();
  if (count > 0) {
    await write(`UIDL`);
    const uidlBody = await readMulti();
    for (const line of uidlBody.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+)\s+(\S+)$/);
      if (m) uidlMap.set(parseInt(m[1], 10), m[2]);
    }
  }

  // Retrieve each message
  const messages: Pop3Message[] = [];
  for (let i = 1; i <= count; i++) {
    await write(`RETR ${i}`);
    const raw = await readMultiLineReplyBinary(socket, cfg.commandTimeoutMs ?? 60_000);
    messages.push({
      messageNumber: i,
      size: raw.length,
      uid: uidlMap.get(i) ?? String(i),
      raw,
    });
  }

  return {
    messages,
    async deleteAll(nums: number[]) {
      for (const n of nums) { await write(`DELE ${n}`); await readReply(); }
    },
    async close() {
      try { await write('QUIT'); await readReply(); } catch {}
      socket.end(); socket.destroy();
    },
  };
}

// ---------------- internals ----------------
async function connect(cfg: Pop3Config): Promise<net.Socket> {
  const security = cfg.security ?? 'ssl';
  const connectTimeout = cfg.connectTimeoutMs ?? 15_000;

  if (security === 'ssl') {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('POP3 TLS connect timeout')), connectTimeout);
      const s = tls.connect({ host: cfg.host, port: cfg.port, rejectUnauthorized: false }, () => {
        clearTimeout(t); resolve(s);
      });
      s.once('error', (e) => { clearTimeout(t); reject(e); });
    });
  }

  const plainSocket = await new Promise<net.Socket>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('POP3 connect timeout')), connectTimeout);
    const s = net.createConnection({ host: cfg.host, port: cfg.port }, () => {
      clearTimeout(t); resolve(s);
    });
    s.once('error', (e) => { clearTimeout(t); reject(e); });
  });

  if (security === 'plain') return plainSocket;

  // STARTTLS: read greeting, send STLS, upgrade
  await readSingleLineReply(plainSocket, connectTimeout);
  await new Promise<void>((res) => plainSocket.write('STLS\r\n', () => res()));
  await readSingleLineReply(plainSocket, connectTimeout, true);
  return new Promise((resolve, reject) => {
    const s = tls.connect({ socket: plainSocket, servername: cfg.host, rejectUnauthorized: false }, () => resolve(s));
    s.once('error', reject);
  });
}

/** Consume until we see a line ending. POP3 single-line replies start with
 *  +OK or -ERR. If `throwOnErr`, reject when we see -ERR. */
function readSingleLineReply(sock: net.Socket | tls.TLSSocket, timeoutMs: number, throwOnErr = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('POP3 reply timeout')); }, timeoutMs);
    let buf = '';
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf-8');
      const idx = buf.indexOf('\r\n');
      if (idx >= 0) {
        cleanup();
        const line = buf.slice(0, idx);
        // Push any leftover bytes back onto the socket (rare — POP3 is line-oriented for single-line)
        if (buf.length > idx + 2) sock.unshift(Buffer.from(buf.slice(idx + 2), 'utf-8'));
        if (line.startsWith('-ERR')) {
          if (throwOnErr) return reject(new Error('POP3: ' + line));
        }
        resolve(line);
      }
    };
    const onErr = (e: any) => { cleanup(); reject(e); };
    const cleanup = () => { clearTimeout(timer); sock.off('data', onData); sock.off('error', onErr); };
    sock.on('data', onData); sock.on('error', onErr);
  });
}

/** Multi-line reply: reads first line (+OK), then reads lines until a line
 *  containing only '.'. Used for UIDL where the payload is text. */
function readMultiLineReply(sock: net.Socket | tls.TLSSocket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('POP3 multi-line timeout')); }, timeoutMs);
    let buf = ''; let sawFirstLine = false; const body: string[] = [];
    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf-8');
      // Process lines
      while (true) {
        const idx = buf.indexOf('\r\n');
        if (idx < 0) break;
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!sawFirstLine) { sawFirstLine = true; continue; }
        // dot-stuffed line terminator
        if (line === '.') { cleanup(); return resolve(body.join('\n')); }
        // Un-dot-stuff (RFC 1939 §3): a leading '.' is escaped as '..'
        body.push(line.startsWith('..') ? line.slice(1) : line);
      }
    };
    const onErr = (e: any) => { cleanup(); reject(e); };
    const cleanup = () => { clearTimeout(timer); sock.off('data', onData); sock.off('error', onErr); };
    sock.on('data', onData); sock.on('error', onErr);
  });
}

/** Multi-line reply that returns raw bytes (for RETR — the message may contain
 *  8-bit binary encoded content). Same delimiter rules, but we preserve bytes. */
function readMultiLineReplyBinary(sock: net.Socket | tls.TLSSocket, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('POP3 RETR timeout')); }, timeoutMs);
    let buffer = Buffer.alloc(0);
    let sawFirstLine = false;
    const bodyChunks: Buffer[] = [];
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const idx = buffer.indexOf('\r\n');
        if (idx < 0) break;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!sawFirstLine) { sawFirstLine = true; continue; }
        if (line.length === 1 && line[0] === 0x2e /* '.' */) {
          cleanup(); return resolve(Buffer.concat(bodyChunks));
        }
        // Un-dot-stuff
        const lineOut = line[0] === 0x2e && line[1] === 0x2e ? line.slice(1) : line;
        bodyChunks.push(lineOut, Buffer.from('\r\n'));
      }
    };
    const onErr = (e: any) => { cleanup(); reject(e); };
    const cleanup = () => { clearTimeout(timer); sock.off('data', onData); sock.off('error', onErr); };
    sock.on('data', onData); sock.on('error', onErr);
  });
}
