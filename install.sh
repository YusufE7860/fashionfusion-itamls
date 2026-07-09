#!/usr/bin/env bash
#
# Fashion Fusion ITAMLS — On-server installer
#
# Usually invoked from bootstrap.sh (which sets IP_ADDRESS / WEB_PORT /
# WEB_BASE_URL_OVERRIDE from prompts). Can also be run directly:
#
#   sudo bash install.sh
#
# Idempotent — safe to re-run.

set -euo pipefail

# --------- colours ---------
BOLD=$(tput bold 2>/dev/null || true); DIM=$(tput dim 2>/dev/null || true)
RESET=$(tput sgr0 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true); RED=$(tput setaf 1 2>/dev/null || true)
YELLOW=$(tput setaf 3 2>/dev/null || true); BLUE=$(tput setaf 4 2>/dev/null || true)
CYAN=$(tput setaf 6 2>/dev/null || true)

step() { printf "\n${BOLD}${BLUE}▶ %s${RESET}\n" "$*"; }
ok()   { printf "  ${GREEN}✓ %s${RESET}\n" "$*"; }
warn() { printf "  ${YELLOW}⚠ %s${RESET}\n" "$*"; }
fail() { printf "  ${RED}✗ %s${RESET}\n" "$*"; exit 1; }

# Interactive terminal — works when the script is piped from curl too.
if [[ -e /dev/tty ]]; then TTY=/dev/tty; else TTY=/dev/stdin; fi
prompt() { local r; read -r -p "  $1 [$2]: " r < "$TTY" || true; echo "${r:-$2}"; }

banner() {
cat <<'EOF'

  ██████  Fashion Fusion · ITAMLS Installer
  ██  ██  IT Asset Management & Logistics System
  ██████  Production stack on Docker Compose

EOF
}

require_root() {
  [[ "${EUID}" -ne 0 ]] && fail "Run as root: sudo bash install.sh"
}

require_ubuntu() {
  [[ -f /etc/os-release ]] || fail "Not an Ubuntu system"
  . /etc/os-release
  if [[ "${ID:-}" == "ubuntu" ]]; then
    ok "Detected ${PRETTY_NAME}"
  else
    warn "Detected '${PRETTY_NAME:-unknown}'. Tested on Ubuntu 22.04/24.04 but should also work on Debian."
  fi
}

require_project_root() {
  [[ -f docker-compose.prod.yml ]] || fail "Run from the project root (where docker-compose.prod.yml lives)."
  ok "Project root: $(pwd)"
}

install_docker() {
  if command -v docker &>/dev/null && docker compose version &>/dev/null; then
    ok "Docker Engine + Compose plugin already installed"; return
  fi
  step "Installing Docker Engine + Compose plugin"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  ok "Docker installed"
}

# --------- config ---------
rand() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }

collect_config() {
  step "Configuration"
  local detected_ip; detected_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -z "${detected_ip}" ]] && detected_ip="127.0.0.1"

  # Env vars from bootstrap take precedence — otherwise prompt interactively.
  IP_ADDRESS="${IP_ADDRESS:-$(prompt 'Server IP address (or DNS name)' "${detected_ip}")}"
  WEB_PORT="${WEB_PORT:-$(prompt 'Port to expose the web app on' '80')}"

  if [[ -n "${WEB_BASE_URL_OVERRIDE:-}" ]]; then
    WEB_BASE_URL="${WEB_BASE_URL_OVERRIDE}"
  elif [[ "${WEB_PORT}" == "80" ]] || [[ "${WEB_PORT}" == "443" ]]; then
    WEB_BASE_URL="http://${IP_ADDRESS}"
  else
    WEB_BASE_URL="http://${IP_ADDRESS}:${WEB_PORT}"
  fi

  ok "Web URL:  ${CYAN}${WEB_BASE_URL}${RESET}"
  ok "Web port: ${CYAN}${WEB_PORT}${RESET}"
}

write_env() {
  step "Generating production .env"
  if [[ -f .env.prod ]]; then
    warn ".env.prod already exists — keeping existing secrets. Updating WEB_BASE_URL + WEB_PORT only."
    sed -i "s|^WEB_BASE_URL=.*|WEB_BASE_URL=${WEB_BASE_URL}|" .env.prod
    sed -i "s|^WEB_PORT=.*|WEB_PORT=${WEB_PORT}|" .env.prod
    return
  fi

  cat > .env.prod <<EOF
# Generated $(date -u +"%Y-%m-%dT%H:%M:%SZ") by install.sh — keep this file safe

# Postgres
POSTGRES_USER=itamls
POSTGRES_PASSWORD=$(rand 32)
POSTGRES_DB=itamls

# MinIO
MINIO_ROOT_USER=$(rand 20)
MINIO_ROOT_PASSWORD=$(rand 40)

# JWT
JWT_SECRET=$(rand 64)

# Where the browser reaches the app (used for CORS + reset links + QR labels)
WEB_BASE_URL=${WEB_BASE_URL}
WEB_PORT=${WEB_PORT}

# 2FA issuer label
TOTP_ISSUER=Fashion Fusion ITAMLS

# Path to this repo on the host (used by the in-app updater to git-pull)
HOST_REPO_PATH=$(pwd)

# Optional integrations — fill these in later if/when you want them
HELPDESK_SYSTEM=STUB
PRICE_LOOKUP_PROVIDER=SEARCH_LINKS

# SMTP (leave blank for dry-run / log-only mode)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=ITAMLS <no-reply@fashionfusion.local>
EOF
  chmod 600 .env.prod
  ok "Wrote .env.prod (chmod 600)"
}

build_and_start() {
  step "Building images (this may take a few minutes the first time)"
  docker compose --env-file .env.prod -f docker-compose.prod.yml build --pull
  ok "Images built"
  step "Starting stack"
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
  ok "Stack started"
}

wait_for_db() {
  step "Waiting for Postgres to be ready"
  for i in {1..60}; do
    if docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
         pg_isready -U "$(. ./.env.prod; echo ${POSTGRES_USER})" &>/dev/null; then
      ok "Postgres is up"; return
    fi
    sleep 2
  done
  fail "Postgres did not become ready within ~2 minutes"
}

migrate_and_seed() {
  step "Running database migrations"
  docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T api \
    sh -c "cd /app/apps/api && pnpm exec prisma migrate deploy"
  ok "Migrations applied"

  step "Seeding demo data"
  if docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T api \
       sh -c "cd /app/apps/api && [ ! -f .seeded ] && pnpm exec prisma db seed && touch .seeded" 2>/dev/null; then
    ok "Seed complete"
  else
    warn "Seed already run — skipping"
  fi
}

summary() {
  . ./.env.prod
  cat <<EOF

${BOLD}${GREEN}══════════════════════════════════════════════════════════════${RESET}
${BOLD}✓ Installation complete${RESET}
${BOLD}${GREEN}══════════════════════════════════════════════════════════════${RESET}

  ${BOLD}Web app:${RESET}        ${CYAN}${WEB_BASE_URL}${RESET}
  ${BOLD}API:${RESET}            ${CYAN}${WEB_BASE_URL}/api/v1${RESET}
  ${BOLD}MinIO console:${RESET}  ${CYAN}http://${IP_ADDRESS:-$(hostname -I | awk '{print $1}')}:9001${RESET}
                  user: ${DIM}${MINIO_ROOT_USER}${RESET}
                  pass: ${DIM}${MINIO_ROOT_PASSWORD}${RESET}

  ${BOLD}Demo accounts${RESET} (sign in then immediately change passwords):
    admin@fashionfusion.local     /  ${DIM}password${RESET}
    itmanager@fashionfusion.local /  ${DIM}password${RESET}
    tech@fashionfusion.local      /  ${DIM}password${RESET}

  ${BOLD}Secrets:${RESET}        ${DIM}stored in .env.prod (chmod 600 — back this up offline)${RESET}

  ${BOLD}Useful commands:${RESET}
    Status:   sudo docker compose --env-file .env.prod -f docker-compose.prod.yml ps
    Logs:     sudo docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f
    Stop:     sudo docker compose --env-file .env.prod -f docker-compose.prod.yml down
    Update:   git pull && sudo bash install.sh

  ${YELLOW}⚠ Next steps for real production:${RESET}
    1. Point a DNS name at the server, update WEB_BASE_URL in .env.prod
    2. Put nginx / Caddy / Traefik in front for TLS
    3. Fill in SMTP_HOST/USER/PASS to start emailing alerts
    4. Enable 2FA on every admin account (Admin → My Security)
    5. Schedule nightly Postgres backups of the postgres_data volume

EOF
}

# --------- main ---------
banner
require_root
require_ubuntu
require_project_root
install_docker
collect_config
write_env
build_and_start
wait_for_db
migrate_and_seed
summary
