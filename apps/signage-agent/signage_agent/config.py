"""Agent configuration: on-disk settings plus a stable per-machine hardware id.

The config file holds both the operator-supplied settings (server URL, the
fleet provisioning secret, a friendly name) and the credentials the agent earns
at enrolment (device id + per-device token). It's written back after enrolment,
so a device provisions once and comes up unattended on every boot after that.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import uuid
from dataclasses import dataclass, asdict, field
from pathlib import Path

DEFAULT_CONFIG_PATH = os.environ.get("SIGNAGE_AGENT_CONFIG", "/etc/signage-agent/config.json")
DEFAULT_CACHE_DIR = "/var/lib/signage-agent/cache"
DEFAULT_RUNTIME_DIR = os.environ.get("SIGNAGE_AGENT_RUNTIME", "/run/signage-agent")


@dataclass
class AgentConfig:
    # --- operator supplied (set during provisioning) ---
    server_url: str = ""
    provisioning_secret: str = ""
    device_name: str = ""

    # --- earned at enrolment, written back to the config file ---
    device_id: str = ""
    device_token: str = ""
    hardware_id: str = ""

    # --- behaviour ---
    poll_interval_seconds: int = 60
    cache_dir: str = DEFAULT_CACHE_DIR
    runtime_dir: str = DEFAULT_RUNTIME_DIR
    muted: bool = True
    # Extra args passed straight to mpv, e.g. ["--vo=gpu", "--gpu-context=drm"]
    # for a console (no-X) Raspberry Pi, or ["--screen=1"] to pick a monitor.
    mpv_extra_args: list[str] = field(default_factory=list)
    log_level: str = "INFO"

    @property
    def path(self) -> str:
        return self._path

    _path: str = field(default=DEFAULT_CONFIG_PATH, repr=False)


def load_config(path: str = DEFAULT_CONFIG_PATH) -> AgentConfig:
    """Load config from disk, filling defaults for anything absent."""
    data: dict = {}
    p = Path(path)
    if p.exists():
        data = json.loads(p.read_text() or "{}")
    # Only accept known fields so a stray key in the file can't blow up the ctor.
    known = {f for f in AgentConfig.__dataclass_fields__ if not f.startswith("_")}
    cfg = AgentConfig(**{k: v for k, v in data.items() if k in known})
    cfg._path = path
    return cfg


def save_config(cfg: AgentConfig) -> None:
    """Write config back atomically (temp file + rename) so a crash mid-write
    can't leave a half-written, unparseable config."""
    p = Path(cfg.path)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = {k: v for k, v in asdict(cfg).items() if not k.startswith("_")}
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2))
    os.replace(tmp, p)
    try:
        os.chmod(p, 0o600)  # contains the device token + provisioning secret
    except OSError:
        pass


def compute_hardware_id() -> str:
    """A stable identifier for this machine, tried in order of reliability:
    systemd machine-id, then the DMI product UUID, then a MAC address. The result
    is what the server keys the device on, so it must survive reboots and agent
    reinstalls (it does — all three sources are hardware/OS-stable)."""
    for candidate in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            val = Path(candidate).read_text().strip()
            if val:
                return f"mid-{val}"
        except OSError:
            pass
    try:
        val = Path("/sys/class/dmi/id/product_uuid").read_text().strip()
        if val:
            return f"dmi-{val}"
    except OSError:
        pass
    # Fall back to a MAC address (uuid.getnode is stable when it reads a real NIC).
    node = uuid.getnode()
    mac = ":".join(re.findall("..", f"{node:012x}"))
    return f"mac-{mac}"
