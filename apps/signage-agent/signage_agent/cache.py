"""Local video cache with checksum-verified downloads.

The cache is keyed by video id, so two videos that happen to share a filename
never collide, and a file is re-downloaded only when it's missing or fails
verification. This is what lets a device keep playing through a network outage:
whatever is already cached and valid stays playable.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Iterable, Optional

import requests

log = logging.getLogger("signage.cache")

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")

# How a device's `rotation` field maps to an ffmpeg transpose chain. We do
# the work in VAAPI space so the Video/VideoEnhance engines carry the load
# instead of CPU — on Gemini Lake these engines idle while the Render/3D
# engine (used by mpv's shader rotation) sits at 100%, so this is where
# we want the rotation to live.
_VAAPI_TRANSPOSE = {
    90:  "transpose_vaapi=dir=clock",
    180: "transpose_vaapi=dir=reversal",
    270: "transpose_vaapi=dir=cclock",
}
# Software fallback (used if VAAPI probe fails) — one or two CPU-side
# transpose passes, encoded with libx264. Slower but zero-dependency.
_SW_TRANSPOSE = {
    90:  "transpose=1",
    180: "transpose=2,transpose=2",
    270: "transpose=2",
}


def _safe_name(filename: str) -> str:
    return _SAFE.sub("_", filename).strip("_") or "video"


def md5_of_file(path: str | os.PathLike, chunk: int = 1024 * 1024) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


class CacheManager:
    def __init__(self, cache_dir: str, session: Optional[requests.Session] = None):
        self.cache_dir = Path(cache_dir)
        self.videos_dir = self.cache_dir / "videos"
        self.videos_dir.mkdir(parents=True, exist_ok=True)
        self.session = session or requests.Session()

    # ---- path helpers ----

    def local_name(self, item: dict[str, Any]) -> str:
        return f"{item['videoId']}__{_safe_name(item['filename'])}"

    def local_path(self, item: dict[str, Any]) -> Path:
        return self.videos_dir / self.local_name(item)

    # ---- validation ----

    def is_valid(self, item: dict[str, Any]) -> bool:
        """A cached file is valid if it exists and matches whatever integrity
        info the server gave us. Prefer checksum; fall back to size; if the
        server supplied neither, mere existence has to do."""
        path = self.local_path(item)
        if not path.exists():
            return False
        size = item.get("sizeBytes")
        if size is not None and path.stat().st_size != size:
            return False
        checksum = item.get("checksum")
        if checksum:
            return md5_of_file(path).lower() == str(checksum).lower()
        return True

    # ---- downloading ----

    def download(self, item: dict[str, Any]) -> Path:
        """Download one item to a temp file, verify it, then atomically move it
        into place. A failed checksum raises and leaves the cache untouched."""
        dest = self.local_path(item)
        tmp = dest.with_suffix(dest.suffix + ".part")
        url = item["downloadUrl"]
        with self.session.get(url, stream=True, timeout=60) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        f.write(chunk)

        checksum = item.get("checksum")
        if checksum:
            actual = md5_of_file(tmp).lower()
            if actual != str(checksum).lower():
                tmp.unlink(missing_ok=True)
                raise ValueError(
                    f"Checksum mismatch for {item.get('filename')} "
                    f"(expected {checksum}, got {actual})"
                )
        size = item.get("sizeBytes")
        if size is not None and tmp.stat().st_size != size:
            tmp.unlink(missing_ok=True)
            raise ValueError(f"Size mismatch for {item.get('filename')}")

        os.replace(tmp, dest)
        return dest

    def ensure(self, item: dict[str, Any], rotation: int = 0) -> Path:
        """Return the local path for an item, downloading if not already valid.
        If ``rotation`` is non-zero (90/180/270), additionally ensure a
        pre-rotated sibling exists and return THAT path — playback then uses
        no runtime rotation at all."""
        if not self.is_valid(item):
            self.download(item)
        base = self.local_path(item)
        if rotation in (90, 180, 270):
            return self._ensure_rotated(base, rotation)
        return base

    # ---- pre-rotation ---------------------------------------------------
    #
    # Runtime --video-rotate goes through mpv's shader stack, which pegs the
    # tiny iGPUs on the thin-client media players we deploy to. So when the
    # device's physical mount angle requires rotation we do it ONCE, at cache
    # time, into a sibling file. Playback is then zero-overhead.
    #
    # The sibling file is named `<original>.rot<deg>.mp4`; it's recreated if
    # the original changes (size check) and pruned together with the original.

    def rotated_path(self, base: Path, rotation: int) -> Path:
        return base.with_name(f"{base.name}.rot{rotation}.mp4")

    def _ensure_rotated(self, base: Path, rotation: int) -> Path:
        rot_path = self.rotated_path(base, rotation)
        # Re-rotate if missing or stale (base was re-downloaded after last rotate).
        if rot_path.exists() and rot_path.stat().st_mtime >= base.stat().st_mtime:
            return rot_path
        try:
            self._run_transpose(base, rot_path, rotation)
            return rot_path
        except Exception as e:
            log.warning("Pre-rotate failed for %s (rotation=%d): %s — falling back to original",
                        base.name, rotation, e)
            # Playback will go sideways, but better than a blank screen.
            return base

    def _run_transpose(self, src: Path, dst: Path, rotation: int) -> None:
        """Produce ``dst`` as the ``rotation`` version of ``src``. Tries
        VAAPI first (fast, uses idle video engines); falls back to CPU."""
        tmp = dst.with_suffix(dst.suffix + ".part")
        tmp.unlink(missing_ok=True)

        vaapi_filter = _VAAPI_TRANSPOSE[rotation]
        vaapi_cmd = [
            "ffmpeg", "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-hwaccel", "vaapi", "-hwaccel_device", "/dev/dri/renderD128",
            "-hwaccel_output_format", "vaapi",
            "-i", str(src),
            "-vf", f"{vaapi_filter},scale_vaapi=format=nv12",
            "-c:v", "h264_vaapi", "-qp", "23",
            "-c:a", "copy",
            "-movflags", "+faststart",
            str(tmp),
        ]
        try:
            log.info("Pre-rotating %s → rot%d via VAAPI", src.name, rotation)
            subprocess.run(vaapi_cmd, check=True, capture_output=True, timeout=600)
            os.replace(tmp, dst)
            return
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
            stderr = getattr(e, "stderr", b"") or b""
            log.warning("VAAPI transpose failed (%s); falling back to CPU", stderr.decode(errors="replace")[:300].strip())
            tmp.unlink(missing_ok=True)

        sw_cmd = [
            "ffmpeg", "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-i", str(src),
            "-vf", _SW_TRANSPOSE[rotation],
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "copy",
            "-movflags", "+faststart",
            str(tmp),
        ]
        log.info("Pre-rotating %s → rot%d via libx264", src.name, rotation)
        subprocess.run(sw_cmd, check=True, timeout=1800)
        os.replace(tmp, dst)

    # ---- housekeeping ----

    def prune(self, keep_video_ids: Iterable[str]) -> list[str]:
        """Delete cached videos (and stray .part files) not in the keep set,
        so a device that drops a video from its playlist reclaims the space."""
        keep = set(keep_video_ids)
        removed: list[str] = []
        for f in self.videos_dir.iterdir():
            if f.name.endswith(".part"):
                f.unlink(missing_ok=True)
                continue
            # Both `<id>__name.mp4` and `<id>__name.mp4.rot270.mp4` start with
            # the same id prefix — splitting on `__` handles both.
            vid = f.name.split("__", 1)[0]
            if vid not in keep:
                f.unlink(missing_ok=True)
                removed.append(f.name)
        return removed

    def prune_stale_rotations(self, current_rotation: int) -> int:
        """Drop pre-rotated siblings for rotations other than the current one.
        Called when the server tells us the device rotation has changed, so
        we don't waste disk on orientations we no longer need."""
        wanted_suffix = f".rot{current_rotation}.mp4" if current_rotation else None
        removed = 0
        for f in self.videos_dir.iterdir():
            if ".rot" not in f.name:
                continue
            if wanted_suffix and f.name.endswith(wanted_suffix):
                continue
            f.unlink(missing_ok=True)
            removed += 1
        return removed

    def purge(self) -> None:
        """Wipe the whole cache (used on an admin-triggered force resync)."""
        shutil.rmtree(self.videos_dir, ignore_errors=True)
        self.videos_dir.mkdir(parents=True, exist_ok=True)

    def disk_free_pct(self) -> int:
        usage = shutil.disk_usage(self.cache_dir)
        return int(round(usage.free * 100 / usage.total))
