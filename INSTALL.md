# Production install — Ubuntu Server

## One-command install (from GitHub)

Once the repo is on GitHub, this is the shortest path from a fresh Ubuntu VM to a running system:

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR-USER/fashionfusion-itamls/main/bootstrap.sh | sudo bash
```

It asks two questions — **IP address / DNS name** and **web port** (default `80`) — then does everything: installs git and Docker, clones the repo to `/opt/itamls`, builds the API + web images, starts the stack, runs Prisma migrations, seeds demo data, and prints the URL to hit.

> Before the very first run, edit line 15 of `bootstrap.sh` in the repo and set `REPO_URL` to your own GitHub URL, then push. After that the one-liner works forever.

---

This walks through the **installer** that puts the entire ITAMLS stack on a fresh Ubuntu 22.04 or 24.04 VM. After it finishes you'll have:

- Postgres 16, MinIO, Redis, the NestJS API and the React web app — all in Docker containers, restart-on-reboot.
- nginx baked into the web container, serving the SPA and proxying `/api/*` to the API on the internal docker network.
- A `.env.prod` with strong randomly-generated secrets (chmod 600).
- Migrations applied and demo data seeded.

## What you need

- A fresh Ubuntu **22.04 LTS** or **24.04 LTS** VM (4 vCPU / 8 GB RAM is comfortable for ~50 stores).
- Root access (or a sudo-capable user).
- The project files copied to the VM (e.g. via `scp -r`, `rsync`, a `tar.gz`, or `git clone`).

## Install (offline / manual — if you don't want to use GitHub)

```bash
# 1. Copy the project to the VM. Example with scp from your laptop:
scp -r "D:\IT ASSET AND LOGISTICS PROGRAM\IT ASSET MANAGEMENT AND LOGISTICS SYSTEM" \
       ubuntu@your-server:/opt/itamls

# 2. SSH in
ssh ubuntu@your-server

# 3. Run the installer (prompts for IP + port)
cd /opt/itamls
sudo bash install.sh
```

Either path — one-liner or manual copy — the installer takes 5–10 minutes the first run. When it's done it prints:

```
  Web app:        http://192.168.x.x
  API:            http://192.168.x.x/api/v1
  MinIO console:  http://192.168.x.x:9001
  Demo accounts:  admin@fashionfusion.local / password   …
```

Open the web URL in your browser, sign in as `admin@fashionfusion.local`, **change the password immediately**, and enable 2FA from **Admin → My Security**.

## Day-2 operations

| Task | Command |
| --- | --- |
| Status | `sudo docker compose --env-file .env.prod -f docker-compose.prod.yml ps` |
| Tail logs | `sudo docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f` |
| Restart everything | `sudo docker compose --env-file .env.prod -f docker-compose.prod.yml restart` |
| Stop | `sudo docker compose --env-file .env.prod -f docker-compose.prod.yml down` |
| Update code & rebuild | `git pull && sudo bash install.sh` |

## Backups

Snapshot the named volumes — that's everything stateful:

```bash
# Postgres data
sudo docker run --rm -v itamlsitassetmanagementandlogisticssystem_postgres_data:/data \
  -v $(pwd):/backup alpine \
  tar czf /backup/postgres-$(date +%F).tgz -C /data .

# Invoice + signature blobs
sudo docker run --rm -v itamlsitassetmanagementandlogisticssystem_minio_data:/data \
  -v $(pwd):/backup alpine \
  tar czf /backup/minio-$(date +%F).tgz -C /data .
```

(Exact volume names depend on the project folder name — check with `sudo docker volume ls`.)

Add these to a daily cron and ship the tarballs off-box.

## DNS and HTTPS

For production you almost certainly want a real domain and TLS:

1. Point an A record at the VM (e.g. `itamls.fashionfusion.local` → the VM's IP).
2. Edit `.env.prod` → set `WEB_BASE_URL=https://itamls.fashionfusion.local`.
3. Put **Caddy** in front (easiest path to auto-HTTPS) — or nginx with certbot. Caddy `Caddyfile`:

   ```
   itamls.fashionfusion.local {
       reverse_proxy 127.0.0.1:80
   }
   ```

4. Set `WEB_PORT=8080` in `.env.prod` so the container listens on a higher port and Caddy takes 80/443.
5. `sudo docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --force-recreate web`

## SMTP for alerts

The alerts engine sends a nightly digest to all administrators and IT managers when there are active alerts. To switch from dry-run / log-only to real emails, edit `.env.prod`:

```env
SMTP_HOST=smtp.gmail.com           # or your SMTP relay
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=alerts@fashionfusion.com
SMTP_PASS=app-specific-password
SMTP_FROM=ITAMLS <alerts@fashionfusion.com>
```

Then `sudo docker compose --env-file .env.prod -f docker-compose.prod.yml restart api`.

## Discovery agent (Kaseya VSA)

After install, the discovery script is automatically served from your API at:

```
http://your-server/api/v1/tools/discover.ps1
```

Push that URL into your Kaseya VSA procedure (one-liner). See `tools/README.md` for the full walkthrough.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Cannot connect to the Docker daemon` | `sudo systemctl start docker` |
| `port is already allocated` on 80 | Set `WEB_PORT=8080` in `.env.prod` and re-run installer |
| Web shows white page | Tail logs: `…logs -f web` — most often a build error on first run |
| `prisma migrate deploy` reports an error | Check `…logs api` — usually means Postgres isn't ready yet; the installer waits up to ~2 minutes, but a slow disk can need longer |
| 401 on every API call after IP change | Update `WEB_BASE_URL` in `.env.prod` then `restart api` (CORS check) |
