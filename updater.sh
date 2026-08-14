#!/bin/sh
#
# Run inside a short-lived alpine+docker+git container, spawned by the API's
# "Install update" endpoint. Pulls latest from GitHub, rebuilds the API and
# web images, restarts them, then runs Prisma migrations.
#
# Runs OUTSIDE the ITAMLS docker network so it survives when api / web are
# recreated during the update.
#
set -eu

REPO_DIR="${REPO_DIR:-/repo}"
COMPOSE="docker compose --env-file .env.prod -f docker-compose.prod.yml"
LOG="/repo/.update.log"

log() {
  echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"
}

cd "$REPO_DIR"

# The updater container is short-lived and runs as root but the repo is owned
# by whatever host UID cloned it. Trust it explicitly.
git config --global --add safe.directory "$REPO_DIR" 2>/dev/null || true

log "Starting update"
log "Current commit: $(git rev-parse --short HEAD)"

# ---------- pull latest ----------
git fetch --all --prune
BEFORE=$(git rev-parse HEAD)
git reset --hard "origin/$(git rev-parse --abbrev-ref HEAD)"
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  log "Already up to date — nothing to do"
  exit 0
fi
log "Pulled: $BEFORE -> $AFTER"

# ---------- rebuild ----------
# --no-cache is important: Docker's layer cache sometimes fails to invalidate
# on changes to files pulled from git (especially on Windows-hosted docker
# via WSL). Force a clean build so users always get the latest code.
log "Building images (no-cache)"
$COMPOSE build --pull --no-cache api web >> "$LOG" 2>&1

log "Recreating containers"
# --force-recreate ensures the new image is used even if the tag looks unchanged.
$COMPOSE up -d --force-recreate --no-deps api web >> "$LOG" 2>&1

# ---------- wait for api ----------
log "Waiting for API to come back"
for i in $(seq 1 60); do
  if $COMPOSE exec -T api node -e 'require("http").get("http://127.0.0.1:4000/api/v1/auth/me", r => process.exit(r.statusCode < 500 ? 0 : 1))' 2>/dev/null; then
    break
  fi
  sleep 2
done

# ---------- migrations ----------
log "Running database migrations"
$COMPOSE exec -T api sh -c "cd /app/apps/api && node_modules/.bin/prisma migrate deploy" >> "$LOG" 2>&1 || {
  log "migrate deploy failed — falling back to db push (schema-only sync)"
  $COMPOSE exec -T api sh -c "cd /app/apps/api && node_modules/.bin/prisma db push --skip-generate --accept-data-loss" >> "$LOG" 2>&1 || {
    log "Schema sync failed — check .update.log"; exit 1;
  }
}

# ---------- seed (safe to re-run; all seeders are upsert-based) ----------
# Any new roles, permissions, network pools, toner types, template rows added
# in this update need to land in the running DB — the initial install writes
# a .seeded marker that the install script skips on, but updates MUST re-seed.
log "Re-running seed (idempotent upserts)"
$COMPOSE exec -T api sh -c "cd /app/apps/api && node_modules/.bin/ts-node prisma/seed.ts" >> "$LOG" 2>&1 || {
  log "Seed failed (non-fatal — new lookup rows may be missing until you re-run manually)"
}

log "Update complete"
