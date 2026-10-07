"""Video playback via mpv.

We drive mpv with a plain m3u playlist and let it loop forever. mpv is only
(re)started when the resolved playlist actually changes, so a heartbeat or an
unchanged config poll never interrupts what's on screen. A JSON IPC socket lets
us ask mpv which file it's currently showing, which becomes the "now playing"
field in heartbeats.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import subprocess
from pathlib import Path
from typing import Optional

log = logging.getLogger("signage.player")


class MpvPlayer:
    def __init__(
        self,
        runtime_dir: str,
        muted: bool = True,
        extra_args: Optional[list[str]] = None,
        mpv_bin: str = "mpv",
    ):
        self.runtime_dir = Path(runtime_dir)
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self.muted = muted
        self.extra_args = extra_args or []
        self.mpv_bin = mpv_bin
        self.ipc_path = str(self.runtime_dir / "mpv.sock")
        self.playlist_path = self.runtime_dir / "playlist.m3u"
        self._proc: Optional[subprocess.Popen] = None
        self._current: list[str] = []

    def _build_command(self) -> list[str]:
        args = [
            self.mpv_bin,
            "--fullscreen",
            "--loop-playlist=inf",
            "--no-terminal",
            "--really-quiet",
            "--no-osc",
            "--no-input-default-bindings",
            "--cursor-autohide=always",
            "--idle=yes",  # stay alive at end of playlist instead of exiting
            f"--input-ipc-server={self.ipc_path}",
        ]
        if self.muted:
            args.append("--mute=yes")
        args.extend(self.extra_args)
        args.append(f"--playlist={self.playlist_path}")
        return args

    def _write_playlist(self, paths: list[str]) -> None:
        self.playlist_path.write_text("\n".join(paths) + "\n")

    def play(self, paths: list[str]) -> None:
        """Ensure mpv is looping exactly `paths`. No-op if that's already what's
        playing and mpv is alive."""
        if paths == self._current and self.is_alive():
            return
        if not paths:
            self.stop()
            return
        self._write_playlist(paths)
        self.stop()
        log.info("Starting mpv with %d item(s)", len(paths))
        self._proc = subprocess.Popen(self._build_command())
        self._current = list(paths)

    def is_alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def ensure_alive(self) -> None:
        """Restart mpv if it has died but we still have a playlist to show."""
        if self._current and not self.is_alive():
            log.warning("mpv exited unexpectedly; restarting")
            self._proc = subprocess.Popen(self._build_command())

    def stop(self) -> None:
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        self._proc = None

    def current_path(self) -> Optional[str]:
        """Ask mpv (over IPC) for the path of the file currently on screen."""
        if not self.is_alive() or not os.path.exists(self.ipc_path):
            return None
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                s.settimeout(2)
                s.connect(self.ipc_path)
                s.sendall(json.dumps({"command": ["get_property", "path"]}).encode() + b"\n")
                buf = b""
                while b"\n" not in buf:
                    chunk = s.recv(4096)
                    if not chunk:
                        break
                    buf += chunk
            for line in buf.split(b"\n"):
                if not line.strip():
                    continue
                msg = json.loads(line)
                if msg.get("error") == "success" and "data" in msg:
                    return msg["data"]
        except (OSError, ValueError):
            return None
        return None


class NullPlayer:
    """A player that does nothing but record state — used for `--no-player`
    dry runs and in tests, so the whole agent loop can be exercised headlessly.
    """

    def __init__(self) -> None:
        self._current: list[str] = []

    def play(self, paths: list[str]) -> None:
        self._current = list(paths)
        log.info("[no-player] would play %d item(s): %s", len(paths), [Path(p).name for p in paths])

    def is_alive(self) -> bool:
        return bool(self._current)

    def ensure_alive(self) -> None:
        pass

    def stop(self) -> None:
        self._current = []

    def current_path(self) -> Optional[str]:
        return self._current[0] if self._current else None
