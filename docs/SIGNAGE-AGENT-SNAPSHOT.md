# Signage Agent — Remote Peek (Snapshot) Protocol

Adds a lightweight "what's on screen right now?" capability to the signage
device agent. No persistent connection or WebRTC needed — the agent captures
a single frame from mpv via its IPC socket, uploads it to MinIO, and the
browser displays the resulting image.

## Flow

1. Admin clicks **View** in ITAMLS → ITAMLS sets `pendingSnapshotAt` on the
   device row.
2. Agent is already polling `GET /signage/devices/:id/config` on its normal
   cadence (every 30s by default). The response now includes
   `"pendingAction": "SNAPSHOT"` when a snapshot is wanted.
3. Agent captures the current frame via mpv's IPC socket:
   ```
   { "command": ["screenshot-to-file", "/tmp/signage-snapshot.jpg", "video"] }
   ```
4. Agent asks the API for an upload URL:
   ```
   POST /signage/devices/:id/snapshot-upload-url
   X-Device-Token: <per-device token>
   ```
   Response: `{ "uploadUrl": "...", "storageKey": "..." }`
5. Agent uploads the JPEG with HTTP PUT to `uploadUrl`.
6. Agent reports completion:
   ```
   POST /signage/devices/:id/snapshot-complete
   X-Device-Token: <per-device token>
   { "storageKey": "<the storageKey from step 4>" }
   ```
7. API stores `latestSnapshotKey` + `latestSnapshotAt`, clears
   `pendingSnapshotAt`.
8. Browser poll (every 2s) picks up the new snapshot URL and renders it.

## Rough Python snippet

```python
# agent/snapshot.py
import os
import socket
import json
import time
import requests

MPV_SOCK = "/run/signage-agent/mpv.sock"

def capture_frame(dest_path: str) -> bool:
    """Ask mpv to write a JPEG of the current frame."""
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.connect(MPV_SOCK)
        cmd = {"command": ["screenshot-to-file", dest_path, "video"]}
        s.sendall((json.dumps(cmd) + "\n").encode())
        s.settimeout(2.0)
        s.recv(4096)
        s.close()
        return os.path.exists(dest_path) and os.path.getsize(dest_path) > 0
    except Exception:
        return False

def handle_pending_snapshot(cfg, server_url: str, device_id: str, token: str):
    if cfg.get("pendingAction") != "SNAPSHOT":
        return
    tmp = f"/tmp/signage-snapshot-{int(time.time())}.jpg"
    if not capture_frame(tmp):
        return
    # 1. Ask for upload URL
    r = requests.post(
        f"{server_url}/signage/devices/{device_id}/snapshot-upload-url",
        headers={"X-Device-Token": token}, timeout=10,
    )
    r.raise_for_status()
    pre = r.json()
    # 2. PUT the JPEG
    with open(tmp, "rb") as f:
        up = requests.put(pre["uploadUrl"], data=f, timeout=30)
        up.raise_for_status()
    # 3. Tell the API we're done
    requests.post(
        f"{server_url}/signage/devices/{device_id}/snapshot-complete",
        headers={"X-Device-Token": token},
        json={"storageKey": pre["storageKey"]}, timeout=10,
    ).raise_for_status()
    os.remove(tmp)
```

Wire this in the agent's main sync loop right after it fetches the config
and before it decides whether to resync the playlist.

## Reporting hardware (for auto-tune)

On the **first heartbeat after enrol or agent restart**, the agent SHOULD also
POST these optional fields in the heartbeat body so the server can pick the
right mpv flags per device:

```json
{
  "hwCpuModel": "ARMv8 Processor rev 3 (v8l)",
  "hwCpuCores": 4,
  "hwMemMB":    7850,
  "hwGpuDrm":   true,
  "hwArch":     "aarch64",
  "hwOsName":   "Ubuntu 24.04"
}
```

How the agent collects them (Linux-safe):

```python
import os, platform, re

def collect_hw():
    hw = {
        "hwArch":  platform.machine(),
        "hwOsName": " ".join(x for x in platform.freedesktop_os_release().values()
                             if isinstance(x, str))[:120] if hasattr(platform, "freedesktop_os_release") else platform.system(),
        "hwCpuCores": os.cpu_count(),
        "hwGpuDrm": os.path.exists("/dev/dri/renderD128"),
    }
    try:
        with open("/proc/cpuinfo") as f:
            text = f.read()
        m = re.search(r"model name\s*:\s*(.+)", text) or re.search(r"Hardware\s*:\s*(.+)", text)
        if m: hw["hwCpuModel"] = m.group(1).strip()
    except Exception: pass
    try:
        with open("/proc/meminfo") as f:
            text = f.read()
        m = re.search(r"MemTotal:\s+(\d+)\s+kB", text)
        if m: hw["hwMemMB"] = int(int(m.group(1)) / 1024)
    except Exception: pass
    return hw
```

Then merge `collect_hw()` into the first heartbeat payload. On later
heartbeats, the fields can be omitted — the server keeps the last reported
values and won't overwrite them with blanks.

## Applying mpv flags from the server

The server's `/config` response now includes:

```json
{
  "mpvExtraArgs": ["--hwdec=v4l2m2m-copy", "--vo=gpu", "--gpu-context=drm", "--cache=yes", "--cache-secs=5"],
  "perfProfile":  "PI3"
}
```

The agent passes `mpvExtraArgs` to its mpv process. When these change, the
agent should restart mpv so the new flags take effect.

## Operational notes

- **Latency.** Default poll is 30s, so the first snapshot can take up to that
  long to appear. If you need near-live, lower the poll to 5–10s on devices
  being viewed (see `heartbeat_interval_seconds` in the config.json).
- **File size.** JPEG at mpv's native screenshot settings (~90% quality) runs
  200–600 KB for 1080p. Fine for a shop LAN; wasteful over 3G. Downsample on
  the agent side if bandwidth matters.
- **Permissions.** Snapshot capture requires `stores:read` on the admin side.
  No new permission for the agent — it uses its existing device token.
