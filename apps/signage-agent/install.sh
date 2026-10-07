#!/usr/bin/env bash
#
# Installs the signage player agent on a Raspberry Pi OS or Ubuntu device.
# Run it from this directory as root:  sudo ./install.sh
#
# It installs mpv + a self-contained Python venv, registers a systemd service,
# and leaves the device ready to be provisioned.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root:  sudo ./install.sh" >&2
  exit 1
fi

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX=/opt/signage-agent
VENV="$PREFIX/venv"
BIN=/usr/local/bin/signage-agent
CONFIG_DIR=/etc/signage-agent
CACHE_DIR=/var/lib/signage-agent/cache

# The user whose graphical session mpv will draw into. Defaults to the user who
# invoked sudo, then 'pi', then root. Override with:  PLAYER_USER=kiosk ./install.sh
PLAYER_USER="${PLAYER_USER:-${SUDO_USER:-}}"
if [[ -z "$PLAYER_USER" || "$PLAYER_USER" == "root" ]]; then
  if id pi >/dev/null 2>&1; then PLAYER_USER=pi; else PLAYER_USER=root; fi
fi
echo ">> Player will run as user: $PLAYER_USER"

echo ">> Installing system packages (mpv, python venv)…"
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y mpv python3 python3-venv python3-pip
else
  echo "!! apt-get not found. Install 'mpv' and 'python3-venv' manually, then re-run." >&2
  exit 1
fi

echo ">> Creating Python environment at $VENV…"
mkdir -p "$PREFIX"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip >/dev/null
"$VENV/bin/pip" install "$SRC_DIR"
ln -sf "$VENV/bin/signage-agent" "$BIN"

echo ">> Creating directories…"
mkdir -p "$CONFIG_DIR" "$CACHE_DIR"
chown -R "$PLAYER_USER" "$CONFIG_DIR" /var/lib/signage-agent

echo ">> Installing systemd service…"
sed -e "s|__PLAYER_USER__|$PLAYER_USER|g" -e "s|__BIN__|$BIN|g" \
  "$SRC_DIR/signage-agent.service" > /etc/systemd/system/signage-agent.service
systemctl daemon-reload
systemctl enable signage-agent.service >/dev/null 2>&1 || true

cat <<EOF

✅ Installed.

Next steps:
  1. Provision this device (enrol it with the server):
       sudo -u $PLAYER_USER signage-agent provision
  2. Start it:
       sudo systemctl start signage-agent
  3. Watch logs:
       journalctl -u signage-agent -f

Then, in the admin dashboard, assign this device to a store to start playback.
EOF
