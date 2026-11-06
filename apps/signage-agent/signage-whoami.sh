#!/usr/bin/env bash
# signage-whoami — one-liner for an SSH'd technician: "which app entry is
# this box?". Reads /etc/signage-agent/config.json for creds, calls the
# server's /signage/devices/:id/config endpoint, prints the display name,
# brand, store, and currently assigned playlist.
#
# Usage:  sudo /usr/local/bin/signage-whoami
set -euo pipefail
CFG=/etc/signage-agent/config.json
if [[ ! -r "$CFG" ]]; then
  echo "cannot read $CFG — run as root (sudo)" >&2
  exit 1
fi
read_cfg() { python3 -c "import json,sys;print(json.load(open('$CFG')).get('$1',''))"; }
URL=$(read_cfg server_url)
DEV=$(read_cfg device_id)
TOK=$(read_cfg device_token)
if [[ -z "$DEV" || -z "$TOK" ]]; then
  echo "device not yet enrolled with the server (no device_id/token)" >&2
  exit 2
fi
JSON=$(curl -sSf -H "x-device-token: $TOK" "$URL/signage/devices/$DEV/config" || true)
if [[ -z "$JSON" ]]; then
  echo "could not reach $URL — check network / server status" >&2
  exit 3
fi
python3 - <<PY
import json, sys
j = json.loads('''$JSON''')
name  = j.get("deviceName")  or "(unnamed)"
brand = j.get("deviceEntity") or "?"
sc    = j.get("storeCode") or "(no store)"
sn    = j.get("storeName") or ""
pl    = (j.get("playlist") or {}).get("name") or "(no playlist assigned)"
items = len(j.get("items") or [])
ori   = j.get("deviceOrientation") or "?"
rot   = j.get("rotation") or 0
print(f"\nDevice name   : {name}")
print(f"Brand         : {brand}")
print(f"Store         : {sc} — {sn}")
print(f"Orientation   : {ori}   Rotation: {rot}°")
print(f"Playlist      : {pl}   ({items} item(s))")
print(f"Device ID     : {j.get('deviceName','')!s}  (search in the UI if needed)\n")
PY
