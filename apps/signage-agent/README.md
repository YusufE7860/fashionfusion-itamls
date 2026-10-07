# Signage Device Agent

The program that runs on each in-store player (Raspberry Pi OS **or** an Ubuntu
thin client — both are Linux, so the same agent covers both). It replaces the
old "FTP client on every box" job: it enrols with the server, downloads its
assigned playlist to a local cache with **checksum verification**, plays it on a
loop with **mpv**, sends **heartbeats**, and — crucially — **keeps playing the
last cached playlist when the network drops**.

Agent version: `0.2.0`.

## How it works

```
                 ┌──────────── every ~60s ────────────┐
  register  ──▶  GET /config  ──▶  download new/changed videos (verify md5)
   (once)        (per-device        ──▶  prune dropped videos
                  token)            ──▶  (re)start mpv only if the playlist changed
                                    ──▶  POST /heartbeat (disk, uptime, now-playing)
                 └────────────────────────────────────┘
```

- **Enrolment** uses the fleet-wide provisioning secret once; the server hands
  back a **per-device token** used for every call after that, so one device
  can't read another's config.
- **Caching** is keyed by video id and verified against the server's checksum
  (the MD5 the server reads back from object storage). A file is only
  re-downloaded when it's missing or fails verification.
- **Offline-tolerant**: if a config poll fails, whatever is validly cached keeps
  looping. mpv is restarted automatically if it ever exits.
- **Force resync**: an admin button in the dashboard bumps a token the agent
  notices on its next poll, purging and re-downloading the cache.

## Requirements

- Raspberry Pi OS (Bullseye/Bookworm) or Ubuntu 20.04+
- A working display/graphical session, or a console (KMS/DRM) setup — see below
- `mpv`, `python3` (installed automatically by `install.sh`)

## Install

Copy this `device-agent` folder onto the device, then:

```bash
sudo ./install.sh
```

This installs `mpv` + a self-contained Python environment, registers a systemd
service, and creates the config and cache directories. By default the player
runs as the user who ran `sudo` (falling back to `pi`). To pick a different
user:

```bash
sudo PLAYER_USER=kiosk ./install.sh
```

## Provision (enrol the device)

```bash
sudo -u pi signage-agent provision
```

You'll be asked for:

- **Server URL** — e.g. `http://signage.head-office.local:4000`
- **Provisioning secret** — the `DEVICE_PROVISIONING_SECRET` from the server `.env`
- **Device name** — e.g. `Sandton — Front Window`

Non-interactive (for imaging/automation):

```bash
sudo -u pi signage-agent provision \
  --server http://signage.head-office.local:4000 \
  --secret 'your-provisioning-secret' \
  --name 'Sandton — Front Window' --non-interactive
```

After provisioning, the device shows up in the admin dashboard as **Unassigned**.
Assign it to a store and it starts playing.

## Run

```bash
sudo systemctl start signage-agent      # start now
sudo systemctl enable signage-agent     # start on boot (install.sh already does this)
journalctl -u signage-agent -f          # watch logs
```

Handy manual commands:

```bash
signage-agent run --once             # one sync + heartbeat cycle, then exit
signage-agent run --once --no-player # same, but don't launch mpv (headless test)
signage-agent --version
```

## Display modes

The default systemd unit assumes a **graphical session** is running and mpv
draws into it (the common desktop-kiosk case). It runs as the player user with
`DISPLAY=:0`.

For a **console-only device with no X** (mpv drawing straight to the screen via
KMS/DRM), edit `/etc/signage-agent/config.json`:

```json
{ "mpv_extra_args": ["--vo=gpu", "--gpu-context=drm"] }
```

…and change `User=` in `/etc/systemd/system/signage-agent.service` to a user in
the `video` and `render` groups (or `root`), removing the `DISPLAY` line. Then
`sudo systemctl daemon-reload && sudo systemctl restart signage-agent`.

Other useful `config.json` knobs: `muted` (default `true`),
`poll_interval_seconds` (default `60`), `cache_dir`, `log_level`.

## Files

```
device-agent/
├── signage_agent/          # the Python package
│   ├── agent.py            # main loop: enrol, sync, play, heartbeat
│   ├── api.py              # backend HTTP client
│   ├── cache.py            # checksum-verified video cache
│   ├── player.py           # mpv wrapper (+ headless NullPlayer)
│   ├── config.py           # config file + stable hardware id
│   └── cli.py              # `signage-agent` entrypoint
├── tests/test_core.py      # unit tests (run: python3 tests/test_core.py)
├── install.sh / uninstall.sh
├── signage-agent.service   # systemd unit template
├── pyproject.toml
└── requirements.txt
```

## Uninstall

```bash
sudo ./uninstall.sh          # keep config + cache
sudo ./uninstall.sh --purge  # remove everything
```
