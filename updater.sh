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
log "Building images"
$COMPOSE build --pull api web >> "$LOG" 2>&1

log "Restarting containers"
$COMPOSE up -d api web >> "$LOG" 2>&1

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
$COMPOSE exec -T api sh -c "cd /app/apps/api && pnpm exec prisma migrate deploy" >> "$LOG" 2>&1 || {
  log "Migration failed — check .update.log"
  exit 1
}

log "Update complete"
