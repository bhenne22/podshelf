#!/usr/bin/env bash
# Build Podshelf locally and ship the production output to the deployment
# host. Designed for small VPSes (1GB RAM) that can't bundle Nuxt+Vite
# without thrashing swap.
#
# What it does:
#   1. `npm ci` + `npm run build` here on your dev machine
#   2. `rsync` the resulting .output/ to ${REMOTE_HOST}:${REMOTE_DIR}/.output/
#   3. SSH in to chown to the app user and `systemctl restart` the service
#   4. Verify the service is active, dump recent logs if it isn't
#
# Defaults match the canonical podshelf.hennemo.com Linode. Override with
# env vars when deploying somewhere else:
#   REMOTE_HOST=stage.example.com ./scripts/deploy-linode.sh
#
# Requirements on the remote host:
#   - SSH access as REMOTE_USER (default root) without password (key auth)
#   - systemd unit ${SERVICE_NAME} (default 'podshelf') already installed
#   - ${REMOTE_DIR}/.output/ may already exist; we replace it atomically-ish
#     via rsync --delete
#
# Source code on the remote (everything outside .output/) is NOT touched
# here. The Linode keeps a git checkout for occasional admin scripts
# (`npm run create-admin`, password resets); pull that separately when
# you need it.

set -euo pipefail

REMOTE_USER="${REMOTE_USER:-root}"
# SSH target — usually an alias from ~/.ssh/config that points at the
# server's origin IP, NOT the public-facing hostname. Cloudflare and most
# CDNs don't proxy port 22, so connecting to `podshelf.hennemo.com:22`
# times out.
REMOTE_HOST="${REMOTE_HOST:-linode}"
REMOTE_DIR="${REMOTE_DIR:-/opt/podshelf}"
APP_USER="${APP_USER:-podshelf}"
SERVICE_NAME="${SERVICE_NAME:-podshelf}"

cd "$(dirname "$0")/.."

echo "==> Installing dependencies (npm ci)"
npm ci

echo "==> Building locally (npm run build)"
npm run build

if [ ! -d ".output" ]; then
  echo "Build did not produce .output/; aborting." >&2
  exit 1
fi

echo "==> Syncing .output/ -> ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/.output/"
rsync -avz --delete \
  .output/ \
  "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/.output/"

echo "==> Rebuilding native binary for better-sqlite3 + restarting ${SERVICE_NAME}"
# better-sqlite3 ships precompiled .node binaries per platform. When we build
# on Mac (darwin-arm64) and ship to Linux (linux-x64) the binary has the wrong
# ELF header and Node fails to load it. `npm rebuild better-sqlite3` triggers
# its `prebuild-install` to fetch the right binary for this host.
#
# We don't `npm rebuild` everything: ssh2's optional `cpu-features` extension
# fails because Nitro only bundles runtime files (not buildcheck.js) for it,
# and ssh2 falls back to pure-JS crypto when cpu-features isn't available.
ssh "${REMOTE_USER}@${REMOTE_HOST}" "
  set -e
  chown -R ${APP_USER}:${APP_USER} ${REMOTE_DIR}/.output
  cd ${REMOTE_DIR}/.output/server
  sudo -u ${APP_USER} npm rebuild better-sqlite3 --no-fund --no-audit
  systemctl restart ${SERVICE_NAME}
  sleep 1
  if systemctl is-active --quiet ${SERVICE_NAME}; then
    echo '${SERVICE_NAME}: active'
  else
    echo '${SERVICE_NAME} failed to start; recent logs:' >&2
    journalctl -u ${SERVICE_NAME} -n 40 --no-pager >&2
    exit 1
  fi
"

echo "==> Done."
