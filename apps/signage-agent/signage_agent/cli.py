"""Command-line entrypoint: `signage-agent provision` and `signage-agent run`."""

from __future__ import annotations

import argparse
import logging
import sys

from . import __version__
from .agent import Agent
from .api import ApiError, SignageApiClient
from .cache import CacheManager
from .config import AgentConfig, compute_hardware_id, load_config, save_config
from .player import MpvPlayer, NullPlayer


def _setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )


def cmd_provision(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)

    def ask(prompt: str, current: str) -> str:
        if args.non_interactive:
            return current
        suffix = f" [{current}]" if current else ""
        val = input(f"{prompt}{suffix}: ").strip()
        return val or current

    cfg.server_url = (args.server or ask("Server URL (e.g. http://signage.head-office.local:4000)", cfg.server_url)).rstrip("/")
    cfg.provisioning_secret = args.secret or ask("Fleet provisioning secret", cfg.provisioning_secret)
    cfg.device_name = args.name or ask("Device name (e.g. Sandton — Front Window)", cfg.device_name)
    if not cfg.hardware_id:
        cfg.hardware_id = compute_hardware_id()

    if not cfg.server_url or not cfg.provisioning_secret:
        print("Server URL and provisioning secret are required.", file=sys.stderr)
        return 2

    print(f"\nHardware ID: {cfg.hardware_id}")
    print(f"Enrolling with {cfg.server_url} ...")

    # Fresh enrolment: drop any stale credentials so register() runs.
    cfg.device_id = ""
    cfg.device_token = ""
    save_config(cfg)

    api = SignageApiClient(cfg.server_url)
    agent = Agent(cfg, api, CacheManager(cfg.cache_dir), NullPlayer())
    try:
        agent.ensure_registered()
    except ApiError as e:
        print(f"\nEnrolment failed: {e}", file=sys.stderr)
        return 1

    print(f"\n✅ Enrolled as device {cfg.device_id}")
    print("   Status is PENDING — open the admin dashboard, find this device under")
    print("   'Stores & Devices', assign it to a store, and it will start playing.")
    print(f"\n   Config saved to {cfg.path}")
    print("   Start playback now with:  signage-agent run   (or: systemctl start signage-agent)")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    _setup_logging(cfg.log_level)
    if not cfg.server_url:
        print("Not provisioned yet. Run 'signage-agent provision' first.", file=sys.stderr)
        return 2

    api = SignageApiClient(cfg.server_url)
    cache = CacheManager(cfg.cache_dir)
    player = NullPlayer() if args.no_player else MpvPlayer(
        runtime_dir=cfg.runtime_dir, muted=cfg.muted, extra_args=cfg.mpv_extra_args
    )
    agent = Agent(cfg, api, cache, player)

    if args.once:
        if not agent.ensure_registered():
            return 1
        agent.tick()
        return 0
    try:
        agent.run_forever()
    except KeyboardInterrupt:
        player.stop()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="signage-agent", description="In-store signage player agent")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("--config", default=None, help="Path to config file (default: /etc/signage-agent/config.json)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("provision", help="Enrol this device with the server")
    p.add_argument("--server", help="Server base URL")
    p.add_argument("--secret", help="Fleet provisioning secret")
    p.add_argument("--name", help="Friendly device name")
    p.add_argument("--non-interactive", action="store_true", help="Don't prompt; use flags/existing config only")
    p.set_defaults(func=cmd_provision)

    r = sub.add_parser("run", help="Run the sync + playback loop")
    r.add_argument("--once", action="store_true", help="Run a single sync/heartbeat cycle and exit")
    r.add_argument("--no-player", action="store_true", help="Don't launch mpv (headless/testing)")
    r.set_defaults(func=cmd_run)

    args = parser.parse_args(argv)
    # Let --config default flow through to load_config's own default.
    if args.config is None:
        from .config import DEFAULT_CONFIG_PATH
        args.config = DEFAULT_CONFIG_PATH
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
