# ITAMLS RMM — Agent Protocol v1

This document specifies the wire protocol between the PC agent and the
ITAMLS API. Implement this once on the agent side (any language) and the
server treats every agent uniformly.

## Transport

- **WebSocket** over TLS. Endpoint: `wss://it.ffgsa.co.za:41235/api/v1/rmm/ws`
- Authenticated at connect time via `Authorization: Bearer <AGENT_TOKEN>` header
  (the same token issued during enrolment).
- The connection is **persistent**. Reconnect with exponential backoff
  (starting 1s, max 60s) on any disconnect.
- Heartbeat: client sends `{"type":"ping"}` every 30 seconds. Server replies `{"type":"pong"}`.
  If no pong received in 60s, close and reconnect.

## Message framing

All messages are **JSON** text frames. Each has:

```json
{ "type": "<message type>", "id": "<optional correlation id>", ... }
```

The `id` field correlates requests and responses. Server-initiated commands
include an `id`; agents MUST echo it in their reply.

## Agent → Server messages

### `hello` (sent immediately after connect)

```json
{
  "type": "hello",
  "agentVersion": "1.4.2",
  "osName": "Windows 11",
  "osVersion": "10.0.26100",
  "publicIp": null,
  "localIp": "10.0.1.42"
}
```

### `metrics` (every 10 seconds)

```json
{
  "type": "metrics",
  "cpuPct": 23.5,
  "memUsedBytes": 8300000000,
  "memTotalBytes": 17179869184,
  "diskUsedBytes": 320000000000,
  "diskTotalBytes": 512000000000,
  "netRxBytesPerS": 123456,
  "netTxBytesPerS": 7890,
  "loggedInUser": "DESKTOP-5\\jdoe"
}
```

### `cmd_result` (reply to a server command)

```json
{
  "type": "cmd_result",
  "id": "<command id from server>",
  "exitCode": 0,
  "stdout": "...",
  "stderr": "",
  "status": "DONE"
}
```

Streaming output: send multiple `cmd_output` frames before the final `cmd_result`:

```json
{ "type": "cmd_output", "id": "<id>", "stream": "stdout", "chunk": "line of text\n" }
```

### `session_state` (desktop/shell session lifecycle)

```json
{ "type": "session_state", "id": "<session id>", "state": "ACTIVE" | "ENDED" | "DENIED" }
```

## Server → Agent messages

### `cmd` (execute a command)

```json
{
  "type": "cmd",
  "id": "cmd_abc123",
  "kind": "SHELL",
  "payload": {
    "interpreter": "POWERSHELL",
    "script": "Get-Service Spooler | Format-List",
    "timeoutMs": 60000
  }
}
```

Supported `kind` values:

| Kind | Payload |
| --- | --- |
| `SHELL` | `{ interpreter, script, timeoutMs }` |
| `SCRIPT` | same as SHELL but the server-side `RmmScript` is logged against this run |
| `FILE_PUSH` | `{ url, destPath, sha256? }` — agent downloads from presigned URL to destPath |
| `FILE_PULL` | `{ srcPath, uploadUrl }` — agent uploads file to presigned URL |
| `WAKE` | `{ macAddress }` — send WOL magic packet on LAN (if LAN peer) |
| `RESTART` | `{ delaySeconds? }` — `shutdown /r /t <n>` |
| `SESSION_START` | `{ sessionId, kind: "DESKTOP"\|"SHELL", webrtcOffer? }` |
| `SESSION_END` | `{ sessionId }` |

### `ping` / `pong`

Keep-alive. Either side can send `ping`; the receiver replies `pong`.

## Reconnection semantics

- On reconnect, the agent sends `hello` again. The server marks the old `RmmConnection`
  closed and reuses the row (keyed by `agentPcId`).
- The server may re-dispatch commands that were QUEUED but not yet SENT.
- Commands in SENT or RUNNING state when connection drops are marked FAILED after
  60 seconds without a `cmd_result`.

## Security (Phase 1 → Phase 4)

Phase 1 (now):
- TLS to the relay (Caddy terminates).
- Bearer token auth at the WebSocket upgrade.
- Audit log of every command issued, by whom, when, with what args.

Phase 4 (hardening):
- End-to-end encryption between tech browser and agent (relay sees ciphertext).
- Per-tech RMM permission scoping (view-only vs full control).
- User-side consent prompt on remote desktop sessions.
- Kill switch for the end user to drop an active session.

## Agent implementation checklist

- [ ] Connect WS, auth with token, send `hello`.
- [ ] Reconnect loop with backoff.
- [ ] Heartbeat (ping/pong).
- [ ] Metrics collector (10s cadence).
- [ ] Shell command executor with stdout/stderr capture + timeout.
- [ ] File transfer handler (push/pull via presigned MinIO URLs).
- [ ] Script runner (`SCRIPT` kind = `SHELL` kind + logging).
- [ ] Restart handler.
- [ ] (Phase 3) Screen capture + WebRTC offer/answer.
