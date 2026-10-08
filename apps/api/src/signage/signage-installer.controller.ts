import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Public } from '../common/decorators/permissions.decorator';

/**
 * Serves tailored bash installers for the signage device agent.
 *
 * Flow:
 *   1. Admin opens /signage/install → picks platform + device name.
 *   2. UI shows a one-liner curl command.
 *   3. The target Pi/Ubuntu box runs it. The returned script embeds the
 *      server URL and provisioning secret, downloads the agent tarball from
 *      /api/v1/signage/agent.tar.gz, extracts, runs install.sh, then
 *      pre-writes the config so the agent self-enrols on first start.
 *
 * The agent tarball is produced by `tar czf` against the standalone
 * signage-platform/device-agent folder — build it once and drop at
 *   apps/api/public/signage/agent.tar.gz
 * (or override SIGNAGE_AGENT_TARBALL_PATH env var).
 */
@Controller('signage')
export class SignageInstallerController {
  @Public() @Get('installer.sh')
  async installer(
    @Query('platform') platform: 'pi' | 'ubuntu-desktop' | 'ubuntu-console' = 'ubuntu-desktop',
    @Query('entity')   entity:   'FASHION_FUSION' | 'EVLV' = 'FASHION_FUSION',
    @Query('name')     name:     string | undefined,
    @Query('storeCode') storeCode: string | undefined,
    @Res() res: Response,
  ) {
    const serverUrl = process.env.PUBLIC_API_URL ?? 'https://it.ffgsa.co.za:41235/api/v1';
    const provisioningSecret = process.env.DEVICE_PROVISIONING_SECRET ?? '';
    const safeEntity = entity === 'EVLV' ? 'EVLV' : 'FASHION_FUSION';
    const safeName = (name ?? '').replace(/[^\w\s\-\.]/g, '').trim();
    const safeStore = (storeCode ?? '').replace(/[^\w\-]/g, '').trim();

    const script = buildInstallerScript({ platform, serverUrl, provisioningSecret, safeName, safeStore, safeEntity });
    res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="install-signage.sh"');
    res.send(script);
  }

  @Public() @Get('agent.tar.gz')
  async tarball(@Res() res: Response) {
    const p = process.env.SIGNAGE_AGENT_TARBALL_PATH
      ?? path.join(process.cwd(), 'public', 'signage', 'agent.tar.gz');
    if (!fs.existsSync(p)) {
      res.status(404).type('text/plain').send(
        `Agent tarball not found at ${p}.\n\n` +
        `Build it from the signage-platform repo:\n` +
        `  cd signage-platform/device-agent && tar czf agent.tar.gz --exclude node_modules --exclude __pycache__ .\n` +
        `Then copy to: ${p}\n`,
      );
      return;
    }
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="agent.tar.gz"');
    fs.createReadStream(p).pipe(res);
  }
}

function buildInstallerScript(opts: {
  platform: string;
  serverUrl: string;
  provisioningSecret: string;
  safeName: string;
  safeStore: string;
  safeEntity: string;
}) {
  const { platform, serverUrl, provisioningSecret, safeName, safeStore, safeEntity } = opts;
  const tarballUrl = `${serverUrl}/signage/agent.tar.gz`;

  // Platform-specific display/service tweaks.
  //   pi            — Raspberry Pi (desktop OS). Uses the pi user + X11 by default.
  //   ubuntu-desktop — any apt-based desktop machine. Uses $SUDO_USER + X11.
  //   ubuntu-console — console-only (no X). mpv draws straight to DRM/KMS.
  const platformNotes =
    platform === 'pi'            ? 'Raspberry Pi OS (desktop)'
    : platform === 'ubuntu-console' ? 'Ubuntu console (no X — KMS/DRM)'
    :                               'Ubuntu desktop';

  const playerUserCmd =
    platform === 'pi'
      ? `PLAYER_USER="\${SUDO_USER:-pi}"`
      : platform === 'ubuntu-console'
      ? `PLAYER_USER=root`
      : `PLAYER_USER="\${SUDO_USER:-$(id -nu 1000 2>/dev/null || echo root)}"`;

  const mpvExtra =
    platform === 'ubuntu-console'
      ? `"mpv_extra_args": ["--vo=gpu", "--gpu-context=drm", "--hwdec=auto"],`
      : '';

  return `#!/usr/bin/env bash
# ITAMLS Digital Signage Agent installer — ${platformNotes}
# Server: ${serverUrl}
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)

set -euo pipefail

if [[ \$EUID -ne 0 ]]; then
  echo "Please run as root:  curl -fsSL ... | sudo bash" >&2
  exit 1
fi

echo "============================================================"
echo " ITAMLS Signage — Agent installer"
echo " Brand    : ${safeEntity === 'EVLV' ? 'Evolve' : 'Fashion Fusion'}"
echo " Platform : ${platformNotes}"
echo " Server   : ${serverUrl}"
${safeName ? `echo " Device   : ${safeName}"` : 'echo " Device   : (auto-named from hostname)"'}
${safeStore ? `echo " Store    : ${safeStore} (store assignment is done later in the admin app)"` : ''}
echo "============================================================"

${playerUserCmd}
echo ">> Player will run as: \$PLAYER_USER"

echo ">> Installing system packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y mpv python3 python3-venv python3-pip curl tar

TMPDIR="\$(mktemp -d)"
trap 'rm -rf "\$TMPDIR"' EXIT

echo ">> Downloading agent tarball…"
curl -fsSL -o "\$TMPDIR/agent.tar.gz" "${tarballUrl}"

echo ">> Extracting…"
mkdir -p "\$TMPDIR/agent"
tar xzf "\$TMPDIR/agent.tar.gz" -C "\$TMPDIR/agent"

echo ">> Running agent install.sh…"
cd "\$TMPDIR/agent"
chmod +x install.sh
PLAYER_USER="\$PLAYER_USER" ./install.sh

CONFIG_DIR=/etc/signage-agent
mkdir -p "\$CONFIG_DIR"

# Compute a hardware id for enrolment (MAC-based; stable across reboots).
HWID="$(cat /sys/class/net/*/address 2>/dev/null | grep -v 00:00:00:00:00:00 | head -1 | tr -d ':' || true)"
if [[ -z "\$HWID" ]]; then
  HWID="\$(cat /etc/machine-id 2>/dev/null || hostname)"
fi
NAME="${safeName || ''}"
if [[ -z "\$NAME" ]]; then
  NAME="\$(hostname)"
fi

echo ">> Pre-writing /etc/signage-agent/config.json…"
cat > "\$CONFIG_DIR/config.json" <<CONFIG
{
  "server_url": "${serverUrl}",
  "provisioning_secret": "${provisioningSecret}",
  "hardware_id": "\$HWID",
  "device_name": "\$NAME",
  "entity": "${safeEntity}",
  ${mpvExtra}
  "heartbeat_interval_seconds": 60
}
CONFIG
chmod 600 "\$CONFIG_DIR/config.json"
chown "\$PLAYER_USER":"\$PLAYER_USER" "\$CONFIG_DIR/config.json" || true

echo ">> Enrolling device…"
sudo -u "\$PLAYER_USER" signage-agent provision --unattended || {
  echo "!! Auto-provision failed. Run manually: sudo -u \$PLAYER_USER signage-agent provision"
}

echo ">> Starting service…"
systemctl daemon-reload
systemctl enable signage-agent.service >/dev/null 2>&1 || true
systemctl restart signage-agent.service

echo ""
echo "✅ Done. Watch logs with:"
echo "     journalctl -u signage-agent -f"
echo ""
echo "In the ITAMLS admin app → Signage → Media Players, approve the device"
echo "and assign it to a store to start playback."
`;
}
