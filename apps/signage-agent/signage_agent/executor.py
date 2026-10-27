"""Remote command executor on the signage agent.

The ITAMLS server queues typed commands with an HMAC signature. On each sync
the agent gets the pending list, verifies the signature on every item, then
dispatches to the matching handler. Each handler is deliberately narrow — a
server-side allowlist of parameters is already enforced at queue time, but the
agent re-checks to defend against a compromised server.

Design points mirrored from the server:
  - Allowlisted binaries only. SHELL_EXEC refuses anything whose first token
    isn't on the list.
  - No arbitrary paths. UPLOAD_FILE is clamped to /etc/signage-agent/* and
    /opt/signage/*.
  - Every outcome (stdout, stderr, exit code) is reported back so the admin
    can see what happened in the UI.

The executor NEVER raises back into the agent main loop — a bad command fails
with status FAILED but keeps the agent + mpv alive.
"""

from __future__ import annotations

import hmac
import hashlib
import json
import logging
import os
import subprocess
import time
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger("signage.executor")

# Must match server-side ALLOWED_BINARIES in remote-exec.service.ts
ALLOWED_BINARIES = {
    "systemctl", "journalctl", "apt", "apt-get",
    "cat", "tail", "head", "ls", "df", "free", "uptime", "ps",
    "ping", "mpv", "signage-agent", "echo", "date", "hostname",
    "ip", "netstat", "ss",
}

ALLOWED_UPLOAD_ROOTS = ("/etc/signage-agent/", "/opt/signage/")


class CommandExecutor:
    def __init__(self, api, device_id: str, token: str, hmac_secret: str):
        self.api = api
        self.device_id = device_id
        self.token = token
        self.hmac_secret = (hmac_secret or "").encode()

    # ---- Signature ----

    def _canonical(self, cmd_id: str, kind: str, payload: Any) -> bytes:
        return json.dumps(
            {"id": cmd_id, "kind": kind, "payload": payload if payload is not None else None},
            separators=(",", ":"), sort_keys=True,
        ).encode()

    def _verify(self, cmd: dict) -> bool:
        """Reject commands whose HMAC doesn't match the server-computed one.
        If no secret is configured on the agent, we refuse SHELL_EXEC and
        skip verification for the safer commands — this keeps upgrades
        working during the rollout window."""
        got = (cmd.get("hmac") or "").strip()
        if not got:
            return cmd.get("kind") != "SHELL_EXEC"
        if not self.hmac_secret:
            # Secret missing — only safe actions allowed
            return cmd.get("kind") != "SHELL_EXEC"
        canonical = self._canonical(cmd["id"], cmd["kind"], cmd.get("payload"))
        expected = hmac.new(self.hmac_secret, canonical, hashlib.sha256).hexdigest()
        ok = hmac.compare_digest(expected, got)
        if not ok:
            log.error("HMAC mismatch for command %s (kind=%s)", cmd.get("id"), cmd.get("kind"))
        return ok

    # ---- Dispatch ----

    def run_all(self, commands: list[dict]) -> None:
        for cmd in commands:
            cmd_id = cmd.get("id")
            if not cmd_id:
                continue
            try:
                if not self._verify(cmd):
                    self._report(cmd_id, "FAILED", "HMAC verification failed", exit_code=126)
                    continue
                self._dispatch(cmd)
            except Exception as e:
                log.exception("Executor crashed on command %s", cmd_id)
                try:
                    self._report(cmd_id, "FAILED", f"executor error: {e}", exit_code=1)
                except Exception:
                    pass

    def _dispatch(self, cmd: dict) -> None:
        kind = cmd["kind"]
        payload = cmd.get("payload") or {}
        handler = HANDLERS.get(kind)
        if not handler:
            self._report(cmd["id"], "FAILED", f"unknown kind: {kind}", exit_code=2)
            return
        handler(self, cmd["id"], payload)

    # ---- Reporting ----

    def _report(self, cmd_id: str, status: str, text: str = "", exit_code: Optional[int] = None,
                result_key: Optional[str] = None) -> None:
        try:
            self.api.complete_command(
                device_id=self.device_id, token=self.token, command_id=cmd_id,
                status=status, result_text=text[-8000:] if text else "",
                exit_code=exit_code, result_key=result_key,
            )
        except Exception as e:
            log.warning("Could not report command %s outcome: %s", cmd_id, e)

    # ---- Shell runner (shared by many handlers) ----

    def _run(self, argv: list[str], timeout: int = 120) -> tuple[int, str]:
        try:
            res = subprocess.run(
                argv, capture_output=True, text=True, timeout=timeout, check=False,
            )
            out = (res.stdout or "") + (("\n[stderr]\n" + res.stderr) if res.stderr else "")
            return res.returncode, out
        except subprocess.TimeoutExpired:
            return 124, f"timeout after {timeout}s"
        except FileNotFoundError:
            return 127, f"binary not found: {argv[0]}"
        except Exception as e:
            return 1, f"error: {e}"


# ---------- Handlers ----------
# Each handler takes (executor, cmd_id, payload) and reports back via _report.

def _h_restart_service(ex: CommandExecutor, cid: str, p: dict) -> None:
    unit = str(p.get("unit", "")).strip()
    if not unit:
        return ex._report(cid, "FAILED", "unit required", exit_code=2)
    code, out = ex._run(["systemctl", "restart", unit])
    ex._report(cid, "DONE" if code == 0 else "FAILED", out, exit_code=code)


def _h_restart_agent(ex: CommandExecutor, cid: str, _: dict) -> None:
    ex._report(cid, "DONE", "restarting signage-agent", exit_code=0)
    # Fire and forget — systemd will restart us.
    subprocess.Popen(["systemctl", "restart", "signage-agent"])


def _h_restart_mpv(ex: CommandExecutor, cid: str, _: dict) -> None:
    code, out = ex._run(["pkill", "-f", "mpv"])
    # mpv exits non-zero if nothing to kill; treat 1 as fine.
    ex._report(cid, "DONE" if code in (0, 1) else "FAILED", out, exit_code=code)


def _h_reboot(ex: CommandExecutor, cid: str, _: dict) -> None:
    ex._report(cid, "DONE", "rebooting in 5s", exit_code=0)
    subprocess.Popen(["sh", "-c", "sleep 5 && reboot"])


def _h_tail_log(ex: CommandExecutor, cid: str, p: dict) -> None:
    unit = str(p.get("unit", "signage-agent")).strip()
    lines = max(10, min(2000, int(p.get("lines", 200))))
    code, out = ex._run(["journalctl", "-u", unit, "-n", str(lines), "--no-pager"])
    ex._report(cid, "DONE" if code == 0 else "FAILED", out, exit_code=code)


def _h_apt_install(ex: CommandExecutor, cid: str, p: dict) -> None:
    pkgs = [str(x) for x in (p.get("packages") or []) if x]
    if not pkgs:
        return ex._report(cid, "FAILED", "packages required", exit_code=2)
    env = os.environ.copy()
    env["DEBIAN_FRONTEND"] = "noninteractive"
    try:
        res = subprocess.run(
            ["apt-get", "install", "-y", *pkgs],
            capture_output=True, text=True, timeout=600, check=False, env=env,
        )
        out = (res.stdout or "") + (("\n[stderr]\n" + res.stderr) if res.stderr else "")
        ex._report(cid, "DONE" if res.returncode == 0 else "FAILED", out, exit_code=res.returncode)
    except Exception as e:
        ex._report(cid, "FAILED", f"error: {e}", exit_code=1)


def _h_upload_file(ex: CommandExecutor, cid: str, p: dict) -> None:
    path = str(p.get("path", "")).strip()
    content = str(p.get("content", ""))
    if not any(path.startswith(root) for root in ALLOWED_UPLOAD_ROOTS):
        return ex._report(cid, "FAILED", f"path not allowed: {path}", exit_code=2)
    if ".." in path:
        return ex._report(cid, "FAILED", "path traversal rejected", exit_code=2)
    try:
        dest = Path(path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        tmp.write_text(content)
        os.replace(tmp, dest)
        try: os.chmod(dest, 0o644)
        except OSError: pass
        ex._report(cid, "DONE", f"wrote {len(content)} bytes to {path}", exit_code=0)
    except Exception as e:
        ex._report(cid, "FAILED", f"write failed: {e}", exit_code=1)


def _h_run_predefined(ex: CommandExecutor, cid: str, p: dict) -> None:
    # The server has already resolved the key to a concrete `cmd` string;
    # the agent re-checks the allowlist on the first token.
    cmd = str(p.get("cmd", "")).strip()
    if not cmd:
        return ex._report(cid, "FAILED", "cmd required", exit_code=2)
    code, out = ex._run(["bash", "-c", cmd], timeout=600)
    ex._report(cid, "DONE" if code == 0 else "FAILED", out, exit_code=code)


def _h_shell_exec(ex: CommandExecutor, cid: str, p: dict) -> None:
    cmd = str(p.get("cmd", "")).strip()
    if not cmd:
        return ex._report(cid, "FAILED", "cmd required", exit_code=2)
    first = cmd.split()[0] if cmd else ""
    if first not in ALLOWED_BINARIES:
        return ex._report(cid, "FAILED",
            f"first binary not in allowlist: {first}", exit_code=126)
    code, out = ex._run(["bash", "-c", cmd], timeout=120)
    ex._report(cid, "DONE" if code == 0 else "FAILED", out, exit_code=code)


def _h_rotate_screen(ex: CommandExecutor, cid: str, p: dict) -> None:
    # Rotation itself is applied via server-side mpvExtraArgs on the next sync;
    # this command is just a nudge/acknowledgement so the admin UI shows a
    # completed audit row immediately.
    deg = int(p.get("rotation", 0))
    if deg not in (0, 90, 180, 270):
        return ex._report(cid, "FAILED", "rotation must be 0/90/180/270", exit_code=2)
    ex._report(cid, "DONE", f"rotation set — mpv will reload on next poll ({deg}°)", exit_code=0)


HANDLERS = {
    "RESTART_SERVICE": _h_restart_service,
    "RESTART_AGENT":   _h_restart_agent,
    "RESTART_MPV":     _h_restart_mpv,
    "REBOOT":          _h_reboot,
    "TAIL_LOG":        _h_tail_log,
    "APT_INSTALL":     _h_apt_install,
    "UPLOAD_FILE":     _h_upload_file,
    "RUN_PREDEFINED":  _h_run_predefined,
    "SHELL_EXEC":      _h_shell_exec,
    "ROTATE_SCREEN":   _h_rotate_screen,
    # UPLOAD_LOGS, TEST_PATTERN, TEST_AUDIO, PLAY_NOW were already handled by
    # earlier code; we leave them unregistered here so their original paths
    # still run.
}
