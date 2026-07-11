#!/usr/bin/env bash
#
# Fashion Fusion ITAMLS — remote bootstrap installer
#
# Usage on a fresh Ubuntu 22.04 / 24.04 VM:
#
#   curl -fsSL https://raw.githubusercontent.com/YOUR-USER/YOUR-REPO/main/bootstrap.sh | sudo bash
#
# Prompts for:
#   - IP address the web app should be reachable on
#   - Port to expose the web app on
# Then:
#   1. Installs git + curl if missing
#   2. Clones (or updates) the repo into /opt/itamls
#   3. Runs install.sh which brings up the full Docker stack
#

set -euo pipefail

# ---------- Repository ----------
REPO_URL="${REPO_URL:-https://github.com/YusufE7860/fashionfusion-itamls.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/itamls}"
# If the repo is private, run:  sudo GITHUB_TOKEN=github_pat_... bash -c '...bootstrap.sh...'
# — or pass ?token=... in the raw URL. The installer will inject it into REPO_URL.
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
# --------------------------------

BOLD=$(tput bold 2>/dev/null || true); RESET=$(tput sgr0 2>/dev/null || true)
GREEN=$(tput setaf 2 2>/dev/null || true); YELLOW=$(tput setaf 3 2>/dev/null || true)
CYAN=$(tput setaf 6 2>/dev/null || true); RED=$(tput setaf 1 2>/dev/null || true)

step() { printf "\n${BOLD}▶ %s${RESET}\n" "$*"; }
ok()   { printf "  ${GREEN}✓ %s${RESET}\n" "$*"; }
fail() { printf "  ${RED}✗ %s${RESET}\n" "$*"; exit 1; }
warn() { printf "  ${YELLOW}⚠ %s${RESET}\n" "$*"; }

# Read from the terminal even when the script came from a pipe (curl | bash).
if [[ -e /dev/tty ]]; then TTY=/dev/tty; else TTY=/dev/stdin; fi
prompt() {
  # $1 = prompt text, $2 = default value; echoes the user's answer or the default.
  local reply
  read -r -p "  $1 [$2]: " reply < "$TTY" || true
  echo "${reply:-$2}"
}

banner() {
cat <<'EOF'

  ██████  Fashion Fusion · ITAMLS Remote Installer
  ██  ██  IT Asset Management & Logistics System
  ██████  Pulls from GitHub → builds → starts

EOF
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    fail "Run as root: curl ... | sudo bash"
  fi
  return 0
}

install_prereqs() {
  if command -v git &>/dev/null && command -v curl &>/dev/null; then
    ok "git and curl already installed"
    return
  fi
  step "Installing git + curl"
  apt-get update -y
  apt-get install -y git curl ca-certificates
  ok "Prerequisites installed"
}

fetch_repo() {
  # For private repos, inject GITHUB_TOKEN into the URL for the clone
  local url="${REPO_URL}"
  if [[ -n "${GITHUB_TOKEN}" ]]; then
    url="$(echo "${REPO_URL}" | sed "s#https://github.com/#https://${GITHUB_TOKEN}@github.com/#")"
  fi

  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    step "Repo already at ${INSTALL_DIR} — pulling latest"
    git -C "${INSTALL_DIR}" fetch --all
    git -C "${INSTALL_DIR}" checkout "${BRANCH}"
    git -C "${INSTALL_DIR}" pull --ff-only
    ok "Updated to latest ${BRANCH}"
  else
    step "Cloning ${REPO_URL} → ${INSTALL_DIR}"
    if ! git clone --branch "${BRANCH}" "${url}" "${INSTALL_DIR}" 2>/dev/null; then
      fail "Clone failed. If the repo is private, either make it public, or re-run with:
    curl -fsSL <bootstrap-url> | sudo GITHUB_TOKEN=github_pat_xxxx bash
  (create a fine-grained token at github.com/settings/tokens with 'Contents: Read' on this repo)"
    fi
    ok "Cloned"
  fi
  return 0
}

collect_config() {
  step "Configuration"
  local detected_ip
  detected_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -z "${detected_ip}" ]] && detected_ip="127.0.0.1"

  IP_ADDRESS="$(prompt 'Server IP address (or DNS name)' "${detected_ip}")"
  WEB_PORT="$(prompt 'Port to expose the web app on'       '80')"

  if [[ "${WEB_PORT}" == "80" ]] || [[ "${WEB_PORT}" == "443" ]]; then
    WEB_BASE_URL_OVERRIDE="http://${IP_ADDRESS}"
  else
    WEB_BASE_URL_OVERRIDE="http://${IP_ADDRESS}:${WEB_PORT}"
  fi

  echo
  ok "Web URL:  ${CYAN}${WEB_BASE_URL_OVERRIDE}${RESET}"
  ok "Web port: ${CYAN}${WEB_PORT}${RESET}"
  export IP_ADDRESS WEB_PORT WEB_BASE_URL_OVERRIDE
}

run_installer() {
  step "Handing off to install.sh"
  cd "${INSTALL_DIR}"
  chmod +x install.sh || true
  bash install.sh
}

# ---------- main ----------
banner
require_root
install_prereqs
collect_config
fetch_repo
run_installer
