"""Unit tests for the agent's core logic.

Runs with plain stdlib (no pytest required):  python3 tests/test_core.py
Covers config round-tripping, checksum-verified caching, pruning/purge, the
now-playing path parser, and a full sync cycle against a fake API + NullPlayer.
"""

from __future__ import annotations

import hashlib
import os
import sys
import tempfile
import threading
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from signage_agent.agent import Agent, video_id_from_path  # noqa: E402
from signage_agent.cache import CacheManager, md5_of_file  # noqa: E402
from signage_agent.config import AgentConfig, load_config, save_config, compute_hardware_id  # noqa: E402
from signage_agent.player import NullPlayer  # noqa: E402


def _serve(directory: str):
    handler = partial(SimpleHTTPRequestHandler, directory=directory)
    httpd = HTTPServer(("127.0.0.1", 0), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


class FakeApi:
    """Stands in for SignageApiClient. `config_response` can be swapped between calls."""

    def __init__(self, config_response):
        self.config_response = config_response
        self.heartbeats = []
        self.registered = False

    def register(self, **kwargs):
        self.registered = True
        return {"deviceId": "dev-1", "token": "tok-1", "status": "PENDING"}

    def get_config(self, **kwargs):
        return self.config_response

    def heartbeat(self, **kwargs):
        self.heartbeats.append(kwargs)


def test_config_roundtrip():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "config.json")
        cfg = AgentConfig(server_url="http://x", provisioning_secret="s", device_name="Front")
        cfg._path = path
        save_config(cfg)
        loaded = load_config(path)
        assert loaded.server_url == "http://x"
        assert loaded.device_name == "Front"
        assert loaded.muted is True
        assert oct(os.stat(path).st_mode)[-3:] == "600"


def test_hardware_id():
    hid = compute_hardware_id()
    assert hid and hid.split("-", 1)[0] in {"mid", "dmi", "mac"}


def test_video_id_parser():
    assert video_id_from_path("/cache/videos/abc-123__ad.mp4") == "abc-123"
    assert video_id_from_path("/cache/videos/plainname.mp4") is None
    assert video_id_from_path(None) is None


def test_cache_download_verify_prune():
    with tempfile.TemporaryDirectory() as srv_dir, tempfile.TemporaryDirectory() as cache_dir:
        # Two "videos" served over HTTP.
        (Path(srv_dir) / "a.mp4").write_bytes(b"AAAA" * 100)
        (Path(srv_dir) / "b.mp4").write_bytes(b"BBBB" * 50)
        httpd, base = _serve(srv_dir)
        try:
            md5_a = md5_of_file(Path(srv_dir) / "a.mp4")
            cache = CacheManager(cache_dir)
            item_a = {"videoId": "v-a", "filename": "a.mp4", "checksum": md5_a,
                      "sizeBytes": 400, "downloadUrl": f"{base}/a.mp4"}
            item_b = {"videoId": "v-b", "filename": "b.mp4", "downloadUrl": f"{base}/b.mp4"}

            # First pass: not cached, downloads and verifies.
            assert cache.is_valid(item_a) is False
            p = cache.ensure(item_a)
            assert Path(p).exists()
            assert cache.is_valid(item_a) is True

            # Wrong checksum must raise and leave nothing behind.
            bad = dict(item_a, videoId="v-bad", checksum="deadbeef" * 4)
            try:
                cache.download(bad)
                assert False, "expected checksum mismatch"
            except ValueError:
                pass
            assert not cache.local_path(bad).exists()

            # Item with no checksum caches on existence.
            cache.ensure(item_b)
            assert cache.is_valid(item_b) is True

            # Prune keeps only referenced ids.
            removed = cache.prune(keep_video_ids=["v-a"])
            assert any("v-b" in r for r in removed)
            assert cache.is_valid(item_a) is True
            assert cache.local_path(item_b).exists() is False

            # Purge clears everything.
            cache.purge()
            assert cache.is_valid(item_a) is False
        finally:
            httpd.shutdown()


def test_agent_full_sync_cycle():
    with tempfile.TemporaryDirectory() as srv_dir, tempfile.TemporaryDirectory() as cache_dir:
        (Path(srv_dir) / "one.mp4").write_bytes(b"1" * 300)
        (Path(srv_dir) / "two.mp4").write_bytes(b"2" * 300)
        httpd, base = _serve(srv_dir)
        try:
            cfg = AgentConfig(server_url=base, device_id="dev-1", device_token="tok-1", cache_dir=cache_dir)
            config_resp = {
                "status": "ACTIVE",
                "resyncToken": None,
                "playlist": {
                    "id": "pl-1",
                    "name": "Store loop",
                    "items": [
                        {"videoId": "v2", "filename": "two.mp4", "order": 1, "downloadUrl": f"{base}/two.mp4"},
                        {"videoId": "v1", "filename": "one.mp4", "order": 0, "downloadUrl": f"{base}/one.mp4"},
                    ],
                },
            }
            api = FakeApi(config_resp)
            player = NullPlayer()
            agent = Agent(cfg, api, CacheManager(cache_dir), player)

            agent.tick()
            # Player should be playing both, in playlist order (v1 then v2).
            assert len(player._current) == 2
            assert Path(player._current[0]).name.startswith("v1__")
            assert Path(player._current[1]).name.startswith("v2__")
            # Heartbeat sent with a now-playing id parsed from the current path.
            assert api.heartbeats and api.heartbeats[-1]["currently_playing_id"] == "v1"

            # Empty playlist -> playback stops.
            api.config_response = {"status": "PENDING", "resyncToken": None, "playlist": None}
            agent.tick()
            assert player.is_alive() is False

            # Force resync token change purges cache on the following sync.
            api.config_response = config_resp
            agent.tick()  # sets last_resync_token from None baseline, plays again
            assert player.is_alive() is True
        finally:
            httpd.shutdown()


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception as e:
            failed += 1
            import traceback
            print(f"FAIL {t.__name__}: {e}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
