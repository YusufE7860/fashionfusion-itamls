"""Remote peek — ask mpv for a JPEG of the current frame and upload it.

Called by the agent when the server config returns pendingAction == "SNAPSHOT".
Uses mpv's JSON IPC socket (same one the heartbeat uses to find out what's
playing) to issue a `screenshot-to-file` command, then presigns an upload URL
from the server and PUTs the file to MinIO.

Failures are logged and swallowed — a missed snapshot never takes the player
offline. The admin UI shows a stale thumbnail until the next successful capture.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import time
from pathlib import Path

import requests

log = logging.getLogger("signage.snapshot")

DEFAULT_MPV_SOCK = "/run/signage-agent/mpv.sock"


def capture_frame(dest_path: str, mpv_sock: str = DEFAULT_MPV_SOCK, timeout: float = 5.0) -> bool:
    """Ask mpv (over Unix socket) to write a JPEG of the current frame.

    Reliability notes:
      - Delete any pre-existing file at dest_path first so we can prove the
        capture actually produced a new one.
      - Tag the IPC request with a unique request_id and filter replies by
        it, so events emitted mid-flight (playback-restart, audio-reconfig,
        file-loaded) can't impersonate a success response.
      - After sending, poll the filesystem for the file to appear + stop
        growing. mpv writes asynchronously; trusting the IPC round-trip gave
        false positives.
    """
    if not os.path.exists(mpv_sock):
        log.warning("mpv IPC socket missing at %s — is mpv running?", mpv_sock)
        return False

    try: os.remove(dest_path)
    except FileNotFoundError: pass

    req_id = int(time.time() * 1000) & 0x7FFFFFFF
    cmd = {"command": ["screenshot-to-file", dest_path, "video"], "request_id": req_id}
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(2.0)
            s.connect(mpv_sock)
            s.sendall((json.dumps(cmd) + "\n").encode())
            buf = b""
            end = time.time() + 2.0
            saw_error = None
            while time.time() < end:
                try:
                    chunk = s.recv(16384)
                    if not chunk:
                        break
                    buf += chunk
                except socket.timeout:
                    break
                lines = buf.split(b"\n")
                buf = lines[-1]
                for line in lines[:-1]:
                    if not line.strip():
                        continue
                    try:
                        msg = json.loads(line.decode())
                    except Exception:
                        continue
                    if msg.get("request_id") == req_id:
                        if msg.get("error") != "success":
                            saw_error = msg.get("error")
                        end = 0  # exit outer loop
                        break
            if saw_error:
                log.warning("mpv screenshot replied error=%s", saw_error)
                return False
    except Exception as e:
        log.warning("mpv IPC screenshot send failed: %s", e)
        return False

    # Poll filesystem — file appears + stops growing = done.
    deadline = time.time() + timeout
    last_size = -1
    while time.time() < deadline:
        try:
            size = os.path.getsize(dest_path)
            if size > 1024 and size == last_size:
                return True
            last_size = size
        except FileNotFoundError:
            pass
        time.sleep(0.15)
    ok = os.path.exists(dest_path) and os.path.getsize(dest_path) > 1024
    if not ok:
        log.warning("screenshot file missing or empty: %s", dest_path)
    return ok


def run_snapshot(api, server_url: str, device_id: str, token: str,
                 mpv_sock: str = DEFAULT_MPV_SOCK) -> bool:
    """End-to-end: capture → presigned PUT → complete.

    Returns True on success. All failures are logged and swallowed — the caller
    uses the return value only to decide whether to log success.
    """
    tmp = f"/tmp/signage-snapshot-{int(time.time())}.jpg"
    if not capture_frame(tmp, mpv_sock=mpv_sock):
        return False

    try:
        # 1. Ask for an upload URL
        r = requests.post(
            f"{server_url.rstrip('/')}/signage/devices/{device_id}/snapshot-upload-url",
            headers={"x-device-token": token},
            timeout=10,
        )
        r.raise_for_status()
        pre = r.json()
        upload_url = pre["uploadUrl"]
        storage_key = pre["storageKey"]
    except Exception as e:
        log.warning("snapshot-upload-url failed: %s", e)
        _cleanup(tmp)
        return False

    try:
        # 2. PUT the JPEG. Big timeout — MinIO sometimes takes a moment through
        # Caddy, especially on slow upstream links.
        with open(tmp, "rb") as f:
            up = requests.put(
                upload_url, data=f,
                headers={"Content-Type": "image/jpeg"},
                timeout=60,
            )
        up.raise_for_status()
    except Exception as e:
        log.warning("snapshot PUT failed: %s", e)
        _cleanup(tmp)
        return False

    try:
        # 3. Tell the API we're done so it can update the device's
        # latestSnapshotKey + clear pendingSnapshotAt.
        requests.post(
            f"{server_url.rstrip('/')}/signage/devices/{device_id}/snapshot-complete",
            headers={"x-device-token": token},
            json={"storageKey": storage_key},
            timeout=10,
        ).raise_for_status()
    except Exception as e:
        log.warning("snapshot-complete failed: %s", e)
        _cleanup(tmp)
        return False

    _cleanup(tmp)
    log.info("Snapshot uploaded (key=%s)", storage_key)
    return True


def _cleanup(path: str) -> None:
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass
