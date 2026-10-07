"""Local video cache with checksum-verified downloads.

The cache is keyed by video id, so two videos that happen to share a filename
never collide, and a file is re-downloaded only when it's missing or fails
verification. This is what lets a device keep playing through a network outage:
whatever is already cached and valid stays playable.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
from pathlib import Path
from typing import Any, Iterable, Optional

import requests

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


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

    def ensure(self, item: dict[str, Any]) -> Path:
        """Return the local path for an item, downloading it if not already valid."""
        if self.is_valid(item):
            return self.local_path(item)
        return self.download(item)

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
            vid = f.name.split("__", 1)[0]
            if vid not in keep:
                f.unlink(missing_ok=True)
                removed.append(f.name)
        return removed

    def purge(self) -> None:
        """Wipe the whole cache (used on an admin-triggered force resync)."""
        shutil.rmtree(self.videos_dir, ignore_errors=True)
        self.videos_dir.mkdir(parents=True, exist_ok=True)

    def disk_free_pct(self) -> int:
        usage = shutil.disk_usage(self.cache_dir)
        return int(round(usage.free * 100 / usage.total))
