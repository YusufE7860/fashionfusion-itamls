#!/bin/sh
#
# Run inside a short-lived alpine+docker+git container, spawned by the API's
# "Install update" endpoint. Pulls latest from GitHub, rebuilds the API and
# web images, restarts them, then runs Prisma migrations.
#
# Runs OUTSIDE the ITAMLS docker network so it survives when api / web are
# recreated during the update.
#
set -euo pipefail

REPO_DIR="${REPO_DIR:-/repo}"
COMPOSE="docker compose --env-file .env.prod -f docker-compose.prod.yml"
LOG="/repo/.update.log"

log() {
  echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"
}

# Run a command, tee its output to the log, and preserve its real exit code
# (piping through tee normally masks the error). Without this, any docker
# error was silently swallowed and the updater would report "success" while
# nothing actually got recreated.
run() {
  log "$ $*"
  set +e
  ( "$@" ) 2>&1 | tee -a "$LOG"
  local rc=${PIPESTATUS[0]}
  set -e
  return $rc
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
if ! run $COMPOSE build --pull --no-cache api web; then
  log "BUILD FAILED — aborting update"; exit 1
fi

# --- explicitly stop + remove the named containers first ---
# With container_name: set in the compose file (which ours does), docker
# compose sometimes fails to remove the old container during --force-recreate
# and dies with "container name /itamls_api is already in use". Doing an
# explicit rm -sf up front avoids the race entirely.
log "Stopping + removing existing api/web containers"
run $COMPOSE stop api web || true
run $COMPOSE rm -f api web || true
# Belt-and-braces: kill any orphan by literal name (survives a broken compose state)
for name in itamls_api itamls_web; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    log "  removing orphan container $name"
    docker rm -f "$name" >> "$LOG" 2>&1 || true
  fi
done

log "Recreating containers"
if ! run $COMPOSE up -d --force-recreate --no-deps api web; then
  log "UP FAILED — aborting update"; exit 1
fi

# --- verify the api container is actually running ---
log "Verifying api container is running"
sleep 3
if ! docker ps --format '{{.Names}}' | grep -qx 'itamls_api'; then
  log "itamls_api container did NOT start — inspect: docker logs itamls_api"
  docker logs --tail 100 itamls_api >> "$LOG" 2>&1 || true
  exit 1
fi

# ---------- wait for api to answer ----------
log "Waiting for API to answer HTTP"
API_READY=0
for i in $(seq 1 60); do
  if $COMPOSE exec -T api node -e 'require("http").get("http://127.0.0.1:4000/api/v1/auth/me", r => process.exit(r.statusCode < 500 ? 0 : 1))' >/dev/null 2>&1; then
    API_READY=1; break
  fi
  sleep 2
done
if [ "$API_READY" -ne 1 ]; then
  log "API never came up healthy — last 100 log lines:"
  docker logs --tail 100 itamls_api >> "$LOG" 2>&1 || true
  exit 1
fi
log "API is up"

# ---------- migrations ----------
log "Running database migrations"
if ! run $COMPOSE exec -T api sh -c "cd /app/apps/api && node_modules/.bin/prisma migrate deploy"; then
  log "migrate deploy failed — falling back to db push (schema-only sync)"
  if ! run $COMPOSE exec -T api sh -c "cd /app/apps/api && node_modules/.bin/prisma db push --skip-generate --accept-data-loss"; then
    log "Schema sync failed — check .update.log"; exit 1
  fi
fi

# ---------- seed (safe to re-run; all seeders are upsert-based) ----------
# Any new roles, permissions, network pools, toner types, template rows added
# in this update need to land in the running DB — the initial install writes
# a .seeded marker that the install script skips on, but updates MUST re-seed.
log "Re-running seed (idempotent upserts)"
if ! run $COMPOSE exec -T api sh -c "cd /app/apps/api && node_modules/.bin/ts-node prisma/seed.ts"; then
  log "SEED FAILED — new lookup rows / permissions may be missing (non-fatal but users may need to re-login once resolved)"
fi

log "Update complete"
