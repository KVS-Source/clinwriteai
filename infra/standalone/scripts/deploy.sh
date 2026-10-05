#!/usr/bin/env bash
# Deploy: git pull → install → build → migrate → restart systemd units.
# Idempotent. Safe to re-run.
#
# Invoked by GitHub Actions `deploy-staging-standalone` job via SSH, or
# manually by DevOps on the VPS.

set -euo pipefail

cd /opt/platform/repo

log() { echo "[deploy $(date +'%H:%M:%S')] $*"; }

# ---------- Pull latest ----------
log "git fetch + checkout"
sudo -u platform git fetch origin main --quiet
sudo -u platform git checkout -q origin/main
HEAD_SHA=$(sudo -u platform git rev-parse --short HEAD)
log "At commit ${HEAD_SHA}"

# ---------- Install + build ----------
log "npm ci (API + worker + types)"
sudo -u platform npm ci --prefer-offline --no-audit --no-fund

log "Building workspaces (api + worker + web)"
sudo -u platform npm --workspace=apps/api    run build
sudo -u platform npm --workspace=apps/worker run build
# Web bundle is built with demo API endpoint baked in. Phase 2 cutover flags
# live in /opt/platform/env/web.env (plain, non-secret). Defaults: everything
# still mocked. Flip VITE_MOCK_<group>=off per the implementation plan.
if [[ -f /opt/platform/env/web.env ]]; then
  log "Loading web build env from /opt/platform/env/web.env"
  WEB_ENV_VARS=$(grep -v '^#' /opt/platform/env/web.env | xargs)
else
  log "No /opt/platform/env/web.env found — using defaults (all mocks on)"
  WEB_ENV_VARS=""
fi
sudo -u platform env VITE_API_URL=https://api.clinwrite.ai ${WEB_ENV_VARS} \
  npm --workspace=apps/web run build

# ---------- Copy build artefacts into /opt/platform/apps ----------
log "Syncing api + worker build artefacts"
sudo -u platform rsync -a --delete apps/api/dist/    /opt/platform/apps/api/dist/
sudo -u platform rsync -a --delete apps/worker/dist/ /opt/platform/apps/worker/dist/

# ---------- Copy web SPA bundle to nginx docroot ----------
log "Syncing web bundle to /var/www/platform/dist/"
mkdir -p /var/www/platform
rsync -a --delete apps/web/dist/ /var/www/platform/dist/
chown -R www-data:www-data /var/www/platform
# node_modules are deployed via npm ci --omit=dev into /opt/platform/apps/
sudo -u platform cp apps/api/package.json    /opt/platform/apps/api/
sudo -u platform cp apps/worker/package.json /opt/platform/apps/worker/
(cd /opt/platform/apps/api    && sudo -u platform npm ci --omit=dev --prefer-offline --no-audit --no-fund)
(cd /opt/platform/apps/worker && sudo -u platform npm ci --omit=dev --prefer-offline --no-audit --no-fund)

# ---------- Database migrations ----------
log "Running Prisma migrations"
cd /opt/platform/apps/api
sudo -u platform /opt/platform/scripts/decrypt-env.sh api
export $(grep -v '^#' /run/platform/api.env | xargs)
sudo -u platform npx prisma migrate deploy

# ---------- Restart services ----------
log "Restarting platform-api"
systemctl restart platform-api
log "Restarting platform-worker"
systemctl restart platform-worker

# ---------- Health gate ----------
log "Waiting for API health"
for i in {1..30}; do
  if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
    log "API healthy"
    break
  fi
  sleep 2
done

log "Deploy complete at ${HEAD_SHA}"
