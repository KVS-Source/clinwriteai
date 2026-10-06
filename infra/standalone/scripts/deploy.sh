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
PREV_SHA=$(sudo -u platform git rev-parse --short HEAD 2>/dev/null || echo "none")
sudo -u platform git fetch origin main --quiet
sudo -u platform git checkout -q origin/main
HEAD_SHA=$(sudo -u platform git rev-parse --short HEAD)
log "At commit ${HEAD_SHA}"

# Self re-exec guard. bash reads scripts as it executes them; if
# deploy.sh itself changed between PREV_SHA and HEAD_SHA, the running
# bash is still executing the pre-pull version — any new logic added to
# deploy.sh (like a Prisma generate step) silently gets skipped. Re-exec
# once with a marker env so the fresh version takes over.
if [[ "${PREV_SHA}" != "${HEAD_SHA}" ]] && [[ "${DEPLOY_RELOADED:-0}" != "1" ]]; then
  if ! sudo -u platform git diff --quiet "${PREV_SHA}" "${HEAD_SHA}" -- infra/standalone/scripts/deploy.sh 2>/dev/null; then
    log "deploy.sh itself changed between ${PREV_SHA} and ${HEAD_SHA} — re-exec'ing"
    DEPLOY_RELOADED=1 exec bash /opt/platform/repo/infra/standalone/scripts/deploy.sh
  fi
fi

# ---------- TLS cert — first-run provisioning ----------
# nginx config in infra/standalone/nginx/platform.conf references
# /etc/letsencrypt/live/demo.clinwrite.ai/fullchain.pem. If that file
# doesn't exist yet (first deploy to a fresh VPS), run the Let's
# Encrypt setup script before nginx tries to serve TLS.
#
# The script is idempotent — on routine redeploys where a valid cert
# already covers both demo + api domains, it short-circuits in a few ms.
CERT_PATH=/etc/letsencrypt/live/demo.clinwrite.ai/fullchain.pem
if [[ ! -f "${CERT_PATH}" ]]; then
  log "No Let's Encrypt cert found at ${CERT_PATH} — running setup-letsencrypt.sh"
  bash /opt/platform/repo/infra/standalone/scripts/setup-letsencrypt.sh
fi

# ---------- Install + build ----------
log "npm ci (API + worker + types)"
sudo -u platform npm ci --prefer-offline --no-audit --no-fund

# Prisma client must be generated BEFORE tsc runs — the API tsc build
# imports types from @prisma/client (TransactionIsolationLevel, model
# shapes, $transaction overloads). On a fresh npm ci we need to regen
# explicitly because the Prisma client is a build artefact of the
# schema, not a plain dep. CI picks this up via `npm run db:generate`;
# the deploy script was missing the equivalent.
log "Generating Prisma client"
sudo -u platform npm --workspace=apps/api run db:generate

log "Building workspaces (api + worker + web)"
sudo -u platform npm --workspace=apps/api    run build
sudo -u platform npm --workspace=apps/worker run build
# Web bundle is built with demo API endpoint baked in.
#
# Env resolution order (first wins per key):
#   1. /opt/platform/env/web.env  — operator-managed, VPS-local overrides
#   2. apps/web/.env.demo         — version-controlled demo defaults
#
# .env.demo in the repo is the source of truth for the demo prototype's
# web build (BYPASS_AUTH=true until WorkOS lands, module kill-switch,
# MSW cutover flags). The operator-local file lets us override anything
# per environment without a commit.
WEB_ENV_FILE_REPO=/opt/platform/repo/apps/web/.env.demo
WEB_ENV_FILE_LOCAL=/opt/platform/env/web.env
WEB_ENV_VARS=""
if [[ -f "${WEB_ENV_FILE_REPO}" ]]; then
  log "Loading web build defaults from ${WEB_ENV_FILE_REPO}"
  WEB_ENV_VARS+=" $(grep -v '^#' "${WEB_ENV_FILE_REPO}" | grep -v '^$' | xargs)"
fi
if [[ -f "${WEB_ENV_FILE_LOCAL}" ]]; then
  log "Loading web build overrides from ${WEB_ENV_FILE_LOCAL}"
  # Operator overrides come last so they take precedence (env var
  # assignment is left-to-right; later wins).
  WEB_ENV_VARS+=" $(grep -v '^#' "${WEB_ENV_FILE_LOCAL}" | grep -v '^$' | xargs)"
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

# ---------- Seed data ----------
# Loads fixtures from apps/web/src/data/* into the DB. Idempotent via
# upserts, safe to run every deploy. We run from the repo path rather
# than the /opt/platform/apps/api copy because the seed uses `tsx`
# (a devDep) which only exists in the repo's node_modules.
log "Seeding fixtures (tenants + users + projects + documents)"
cd /opt/platform/repo
sudo -u platform env $(grep -v '^#' /run/platform/api.env | xargs) \
  npm --workspace=apps/api run db:seed

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
