#!/usr/bin/env bash
# Removes the signage agent. Keeps /etc/signage-agent/config.json and the video
# cache unless you pass --purge.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root:  sudo ./uninstall.sh [--purge]" >&2
  exit 1
fi

systemctl stop signage-agent.service 2>/dev/null || true
systemctl disable signage-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/signage-agent.service
systemctl daemon-reload
rm -f /usr/local/bin/signage-agent
rm -rf /opt/signage-agent

if [[ "${1:-}" == "--purge" ]]; then
  rm -rf /etc/signage-agent /var/lib/signage-agent
  echo "Purged config and cache."
else
  echo "Left /etc/signage-agent and /var/lib/signage-agent in place (use --purge to remove)."
fi
echo "Uninstalled."
