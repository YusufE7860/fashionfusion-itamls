"""Hardware + runtime diagnostics for the signage agent.

Called by the agent on heartbeat so the admin UI's "Hardware & performance
tuning" panel actually has data. All reads are Linux-safe (/proc, sysfs,
platform module) with every operation wrapped in try/except so a weird kernel
or minimal container never crashes the agent.
"""

from __future__ import annotations

import os
import platform
import re
import subprocess
from typing import Any


def collect_hw() -> dict[str, Any]:
    """Return a dict matching the SignageDevice hw* fields on the server.
    Any field that can't be determined is simply omitted (server keeps its
    previous value, or null if never known)."""
    out: dict[str, Any] = {}
    try:
        out["hwArch"] = platform.machine()
    except Exception:
        pass
    try:
        if hasattr(platform, "freedesktop_os_release"):
            rel = platform.freedesktop_os_release()
            pretty = rel.get("PRETTY_NAME") or rel.get("NAME") or ""
            out["hwOsName"] = str(pretty)[:120]
        else:
            out["hwOsName"] = f"{platform.system()} {platform.release()}"[:120]
    except Exception:
        pass
    try:
        out["hwCpuCores"] = os.cpu_count()
    except Exception:
        pass
    # DRM GPU: presence of /dev/dri/renderD128 is the usual signal that mpv
    # can hit hardware decode. Covers Pi 4+, Intel/AMD x86, most ARM SoCs.
    try:
        out["hwGpuDrm"] = any(
            os.path.exists(p) for p in ("/dev/dri/renderD128", "/dev/dri/renderD129")
        )
    except Exception:
        out["hwGpuDrm"] = False
    # CPU model — /proc/cpuinfo. On Pi, "Hardware" and "Model" lines are
    # more descriptive than "model name".
    try:
        with open("/proc/cpuinfo") as f:
            text = f.read()
        for pat in (r"^model name\s*:\s*(.+)$", r"^Model\s*:\s*(.+)$", r"^Hardware\s*:\s*(.+)$"):
            m = re.search(pat, text, re.MULTILINE)
            if m:
                out["hwCpuModel"] = m.group(1).strip()[:120]
                break
    except Exception:
        pass
    # Memory — /proc/meminfo
    try:
        with open("/proc/meminfo") as f:
            text = f.read()
        m = re.search(r"MemTotal:\s+(\d+)\s+kB", text)
        if m:
            out["hwMemMB"] = int(int(m.group(1)) / 1024)
    except Exception:
        pass
    return out


def collect_display() -> dict[str, Any]:
    """Query the current DRM/KMS display resolution. Best-effort; empty if we
    can't figure it out (e.g. headless container).

    Returns {screenWidth, screenHeight} on success. (mpv diagnostics also
    report these when playback is active — this fills in before anything
    plays.)
    """
    # Try modetest first — ships with libdrm-tests on most distros.
    for cmd in (["modetest", "-c"],):
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
            if res.returncode == 0:
                m = re.search(r"\s(\d{3,4})x(\d{3,4})\s+\d", res.stdout)
                if m:
                    return {
                        "screenWidth":  int(m.group(1)),
                        "screenHeight": int(m.group(2)),
                    }
        except Exception:
            pass
    # Fallback — read /sys/class/drm/card*/modes
    try:
        import glob
        for mode_file in glob.glob("/sys/class/drm/card*/modes"):
            with open(mode_file) as f:
                first = f.readline().strip()
            m = re.match(r"(\d{3,4})x(\d{3,4})", first)
            if m:
                return {
                    "screenWidth":  int(m.group(1)),
                    "screenHeight": int(m.group(2)),
                }
    except Exception:
        pass
    return {}
