"""The agent loop: enrol, sync, play, heartbeat — repeat.

Designed to fail soft. A network blip, a bad download, or a server hiccup never
takes the screen down: whatever is validly cached keeps looping until the next
successful sync replaces it.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any, Optional

from . import __version__
from .api import ApiError, SignageApiClient
from .cache import CacheManager
from .config import AgentConfig, save_config

log = logging.getLogger("signage.agent")


def video_id_from_path(path: Optional[str]) -> Optional[str]:
    """Cache files are named '<videoId>__<filename>', so the id is recoverable
    from whatever mpv reports it's playing."""
    if not path:
        return None
    name = Path(path).name
    return name.split("__", 1)[0] if "__" in name else None


def read_uptime_seconds(fallback_start: float) -> int:
    try:
        with open("/proc/uptime") as f:
            return int(float(f.read().split()[0]))
    except (OSError, ValueError):
        return int(time.time() - fallback_start)


class Agent:
    def __init__(self, cfg: AgentConfig, api: SignageApiClient, cache: CacheManager, player: Any):
        self.cfg = cfg
        self.api = api
        self.cache = cache
        self.player = player
        self.last_resync_token: Optional[str] = None
        self._started = time.time()

    # ---- enrolment ----

    def ensure_registered(self) -> bool:
        """Enrol with the server if we don't yet have a device id + token.
        Returns True once the device is registered."""
        if self.cfg.device_id and self.cfg.device_token:
            return True
        log.info("Enrolling device '%s' with %s", self.cfg.device_name or self.cfg.hardware_id, self.cfg.server_url)
        res = self.api.register(
            hardware_id=self.cfg.hardware_id,
            provisioning_secret=self.cfg.provisioning_secret,
            name=self.cfg.device_name,
            agent_version=__version__,
        )
        self.cfg.device_id = res["deviceId"]
        self.cfg.device_token = res["token"]
        save_config(self.cfg)
        log.info("Enrolled as device %s (status: %s)", self.cfg.device_id, res.get("status"))
        return True

    # ---- one sync cycle ----

    def sync(self) -> None:
        """Fetch config and reconcile the cache + player to match it. Raises
        ApiError on network/server failure so the caller can take the offline
        path (leave the current playlist running)."""
        cfg = self.api.get_config(device_id=self.cfg.device_id, token=self.cfg.device_token)

        # Force-resync: the admin bumped the token, so purge and re-download.
        resync = cfg.get("resyncToken")
        if resync and resync != self.last_resync_token:
            if self.last_resync_token is not None:
                log.info("Force-resync requested; purging cache")
                self.cache.purge()
                self.player.stop()
            self.last_resync_token = resync

        playlist = cfg.get("playlist")
        items: list[dict[str, Any]] = cfg.get("items") or (playlist or {}).get("items", []) or []

        if not items:
            # Not active, unassigned, or campaign outside its window → blank screen.
            if self.player.is_alive():
                log.info("No active playlist (status=%s); stopping playback", cfg.get("status"))
            self.player.stop()
            self.cache.prune(keep_video_ids=[])
            return

        items = sorted(items, key=lambda i: i.get("order", 0))
        paths: list[str] = []
        for item in items:
            try:
                local = self.cache.ensure(item)
                paths.append(str(local))
            except Exception as e:  # one bad item shouldn't blank the whole screen
                log.error("Skipping '%s': %s", item.get("filename"), e)

        if not paths:
            log.error("No playable items after download; leaving current playback untouched")
            return

        self.cache.prune(keep_video_ids=[i["videoId"] for i in items])
        self.player.play(paths)

    # ---- heartbeat ----

    def heartbeat(self) -> None:
        try:
            self.player.ensure_alive()
            playing = video_id_from_path(self.player.current_path())
            self.api.heartbeat(
                device_id=self.cfg.device_id,
                token=self.cfg.device_token,
                agent_version=__version__,
                disk_free_pct=self.cache.disk_free_pct(),
                uptime_seconds=read_uptime_seconds(self._started),
                currently_playing_id=playing,
            )
        except ApiError as e:
            log.warning("Heartbeat failed (offline?): %s", e)
        except Exception as e:
            log.warning("Heartbeat error: %s", e)

    # ---- main loop ----

    def tick(self) -> None:
        """One full cycle. Never raises — offline is a normal state."""
        try:
            self.sync()
        except ApiError as e:
            log.warning("Sync failed (offline?); keeping cached playlist: %s", e)
            self.player.ensure_alive()
        except Exception as e:
            log.exception("Unexpected sync error: %s", e)
            self.player.ensure_alive()
        self.heartbeat()

    def run_forever(self) -> None:
        log.info("Signage agent v%s starting (server=%s)", __version__, self.cfg.server_url)
        # Keep trying to enrol until it succeeds — the server may not be reachable
        # at first boot.
        while not (self.cfg.device_id and self.cfg.device_token):
            try:
                self.ensure_registered()
            except ApiError as e:
                log.warning("Enrolment failed, retrying in %ss: %s", self.cfg.poll_interval_seconds, e)
                time.sleep(self.cfg.poll_interval_seconds)
        while True:
            self.tick()
            time.sleep(self.cfg.poll_interval_seconds)
