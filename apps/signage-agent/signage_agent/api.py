"""Thin HTTP client for the signage backend's device-facing API.

Three calls, matching the backend routes:
  POST /signage/devices/register           (fleet provisioning secret) -> id + token
  POST /signage/devices/:id/heartbeat      (per-device token)
  GET  /signage/devices/:id/config         (per-device token)
"""

from __future__ import annotations

from typing import Any, Optional

import requests


class ApiError(Exception):
    pass


class SignageApiClient:
    def __init__(self, server_url: str, timeout: float = 20.0):
        self.base = server_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()

    def register(
        self,
        *,
        hardware_id: str,
        provisioning_secret: str,
        name: str,
        agent_version: str,
        store_code: str = "",
        entity: str = "",
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "hardwareId": hardware_id, "name": name, "agentVersion": agent_version,
        }
        if store_code: payload["storeCode"] = store_code
        if entity:     payload["entity"]    = entity
        r = self.session.post(
            f"{self.base}/signage/devices/register",
            headers={"x-device-secret": provisioning_secret},
            json=payload,
            timeout=self.timeout,
        )
        if r.status_code == 401:
            raise ApiError("Registration rejected — check the provisioning secret.")
        if not r.ok:
            raise ApiError(f"Registration failed ({r.status_code}): {r.text}")
        return r.json()

    def get_config(self, *, device_id: str, token: str) -> dict[str, Any]:
        r = self.session.get(
            f"{self.base}/signage/devices/{device_id}/config",
            headers={"x-device-token": token},
            timeout=self.timeout,
        )
        if r.status_code == 401:
            raise ApiError("Config rejected — device token invalid. Re-provisioning may be required.")
        if not r.ok:
            raise ApiError(f"Config fetch failed ({r.status_code}): {r.text}")
        return r.json()

    def heartbeat(
        self,
        *,
        device_id: str,
        token: str,
        agent_version: str,
        disk_free_pct: Optional[int] = None,
        uptime_seconds: Optional[int] = None,
        currently_playing_id: Optional[str] = None,
    ) -> None:
        payload: dict[str, Any] = {"agentVersion": agent_version}
        if disk_free_pct is not None:
            payload["diskFreePct"] = disk_free_pct
        if uptime_seconds is not None:
            payload["uptimeSeconds"] = uptime_seconds
        if currently_playing_id:
            payload["currentlyPlayingId"] = currently_playing_id
        r = self.session.post(
            f"{self.base}/signage/devices/{device_id}/heartbeat",
            headers={"x-device-token": token},
            json=payload,
            timeout=self.timeout,
        )
        if not r.ok:
            raise ApiError(f"Heartbeat failed ({r.status_code}): {r.text}")

    def complete_command(self, *, device_id: str, token: str, command_id: str,
                         status: str, result_text: str = "",
                         exit_code: Optional[int] = None,
                         result_key: Optional[str] = None) -> None:
        body: dict[str, Any] = {"status": status, "resultText": result_text}
        if exit_code is not None: body["exitCode"] = exit_code
        if result_key is not None: body["resultKey"] = result_key
        r = self.session.post(
            f"{self.base}/signage/devices/{device_id}/commands/{command_id}/complete",
            headers={"x-device-token": token},
            json=body,
            timeout=self.timeout,
        )
        if not r.ok:
            raise ApiError(f"Complete-command failed ({r.status_code}): {r.text}")
