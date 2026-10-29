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
elif ! openssl x509 -in "${CERT_PATH}" -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:api.clinwrite.ai"; then
  log "Existing cert doesn't cover api.clinwrite.ai — expanding SAN via setup-letsencrypt.sh"
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

# Guard against the stale-client-vs-fresh-schema race that broke the
# 2026-10-28 12:30 deploy: the scheduled run pulled main, generated a
# client from a pre-@map schema snapshot, migrations said "no pending"
# (because the column already existed from an earlier run), then seed.ts
# blew up with P2022 because the generated client was looking for
# "legacyRole" instead of the @map'd "legacy_role".
#
# Check: every @map("...") target in the Prisma schema must appear as a
# literal string in the generated client's runtime DMMF (index.js).
# If any are missing, the client is stale — fail fast with a clean
# message instead of letting the build + migrate + seed waste 90 seconds
# before hitting P2022.
log "Verifying generated client reflects every @map(...) in the schema"
SCHEMA_DIR=/opt/platform/repo/apps/api/prisma/schema
CLIENT_JS=/opt/platform/repo/node_modules/.prisma/client/index.js
if [[ ! -f "${CLIENT_JS}" ]]; then
  log "ERROR: Prisma client not found at ${CLIENT_JS} after generate — generator failed silently?"
  exit 1
fi
MISSING_MAPS=()
while IFS= read -r col; do
  [[ -z "${col}" ]] && continue
  # Fixed-string whole-word match — Prisma 5+ serializes the DMMF with
  # escaped quotes (\"legacy_role\"), so grepping for the literal
  # "legacy_role" (with surrounding quotes) misses every target. Plain
  # word match catches the dbName string regardless of surrounding
  # escaping. '_' counts as a word char under GNU grep, so partial
  # matches like legacy_role_old don't false-pass.
  if ! grep -qwF "${col}" "${CLIENT_JS}"; then
    MISSING_MAPS+=("${col}")
  fi
done < <(grep -hoE '@@?map\("[^"]+"\)' "${SCHEMA_DIR}"/*.prisma 2>/dev/null \
         | sed -E 's/@@?map\("([^"]+)"\)/\1/' | sort -u)
if [[ ${#MISSING_MAPS[@]} -gt 0 ]]; then
  log "ERROR: generated Prisma client is stale — these @map targets are not baked in:"
  for m in "${MISSING_MAPS[@]}"; do log "  - ${m}"; done
  log "Fix: sudo rm -rf /opt/platform/repo/node_modules/.prisma /opt/platform/repo/node_modules/@prisma/client"
  log "     cd /opt/platform/repo && sudo -u platform npm --workspace=apps/api run db:generate"
  log "     Then re-run this deploy."
  exit 1
fi

log "Building workspaces (api + worker + collab-server + web)"
sudo -u platform npm --workspace=apps/api           run build
sudo -u platform npm --workspace=apps/worker        run build
# collab-server (Phase 2.3 of docs/pivot-plan.md) is optional at runtime —
# gated by platform-collab.service being installed + VITE_COLLAB_URL being
# set on the web build. Build it unconditionally so the artefact is ready;
# the systemd unit decides whether to run it.
sudo -u platform npm --workspace=apps/collab-server run build 2>/dev/null || \
  log "collab-server build skipped (workspace not present on this deploy)"
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
# Build via a nested subshell that sources the env files cleanly —
# `source` preserves values with spaces (e.g. VITE_APP_NAME="ClinWrite.AI (Demo)")
# that the previous `xargs` pipeline split and corrupted. `set -a`
# auto-exports every subsequent assignment so the npm child process
# sees them. Overrides from /opt/platform/env/web.env load last so
# they win over the repo defaults (bash variable assignment is
# left-to-right: last assignment wins).
if [[ -f "${WEB_ENV_FILE_REPO}" ]]; then
  log "Loading web build defaults from ${WEB_ENV_FILE_REPO}"
fi
if [[ -f "${WEB_ENV_FILE_LOCAL}" ]]; then
  log "Loading web build overrides from ${WEB_ENV_FILE_LOCAL}"
fi
sudo -u platform bash -c "
  set -a
  export VITE_API_URL=https://api.clinwrite.ai
  [[ -f '${WEB_ENV_FILE_REPO}' ]] && source '${WEB_ENV_FILE_REPO}'
  [[ -f '${WEB_ENV_FILE_LOCAL}' ]] && source '${WEB_ENV_FILE_LOCAL}'
  set +a
  npm --workspace=apps/web run build
"

# ---------- Copy web SPA bundle to nginx docroot ----------
log "Syncing web bundle to /var/www/platform/dist/"
mkdir -p /var/www/platform
rsync -a --delete apps/web/dist/ /var/www/platform/dist/
chown -R www-data:www-data /var/www/platform

# No separate rsync + npm-ci-prod into /opt/platform/apps anymore.
# systemd units point at /opt/platform/repo/apps/{api,worker} directly
# and resolve node_modules via the monorepo's hoisted install at
# /opt/platform/repo/node_modules. Simpler + avoids the "no lockfile
# in the workspace dir" trap npm ci --omit=dev kept hitting.

# ---------- Database migrations ----------
log "Running Prisma migrations"
cd /opt/platform/repo/apps/api
sudo -u platform /opt/platform/scripts/decrypt-env.sh api
set -a; . /run/platform/api.env; set +a
sudo -u platform --preserve-env=DATABASE_URL npx prisma migrate deploy

# ---------- Seed data ----------
# Loads fixtures from apps/web/src/data/* into the DB. Idempotent via
# upserts, safe to run every deploy. We run from the repo path rather
# than the /opt/platform/apps/api copy because the seed uses `tsx`
# (a devDep) which only exists in the repo's node_modules.
#
# Env sourcing: `set -a; . file; set +a` auto-exports every subsequent
# assignment to the npm child process. Replaces an earlier `env $(... |
# xargs)` pattern that broke on quoted values containing spaces or
# shell-metacharacters (e.g. NOTIFICATION_FROM_ADDRESS="Name <email>" —
# xargs stripped the quotes + env interpreted `<email>` as an input
# redirect). Same shape the web-build block already uses.
log "Seeding fixtures (tenants + users + projects + documents)"
cd /opt/platform/repo
sudo -u platform bash -c "
  set -a
  . /run/platform/api.env
  set +a
  npm --workspace=apps/api run db:seed
"

# ---------- Blob storage directories ----------
# BLOB_PROVIDER=local writes under BLOB_LOCAL_ROOT_DIR (default
# /opt/platform/data/blob). On an older VPS where the initial bootstrap
# didn't create this, uploads fail with
#   ENOENT: no such file or directory, mkdir '/opt/platform/data/blob/documents'
# The local-storage adapter already uses { recursive: true }, but needs
# the ROOT to exist first. Create the four buckets referenced by the API
# (documents, voice, exports, ectd) + chown to the platform user.
log "Ensuring blob storage directories exist"
mkdir -p /opt/platform/data/blob/{documents,voice,exports,ectd}
chown -R platform:platform /opt/platform/data/blob

# ---------- Sync systemd unit files from the repo ----------
# Bootstrap-only installation leaves /etc/systemd/system/platform-*.service
# frozen at whatever shape it had on first deploy. Any later change to
# ReadWritePaths / Environment / ExecStart in the repo wouldn't take
# effect until an operator manually copied + daemon-reload'd. Sync here
# every deploy so systemd + the repo never drift. cmp -s skips the
# daemon-reload when the units are unchanged.
log "Syncing systemd unit files"
UNITS_CHANGED=0
for unit in platform-api platform-worker platform-collab; do
  src="/opt/platform/repo/infra/standalone/systemd/${unit}.service"
  dst="/etc/systemd/system/${unit}.service"
  [[ -f "${src}" ]] || continue
  if [[ ! -f "${dst}" ]] || ! cmp -s "${src}" "${dst}"; then
    install -m 644 "${src}" "${dst}"
    UNITS_CHANGED=1
    log "  updated ${dst}"
  fi
done
if [[ "${UNITS_CHANGED}" == "1" ]]; then
  log "Running systemctl daemon-reload (unit files changed)"
  systemctl daemon-reload
fi

# ---------- Restart services ----------
log "Restarting platform-api"
systemctl restart platform-api
log "Restarting platform-worker"
systemctl restart platform-worker
# Collab sidecar only exists on deployments where the unit was installed
# (bootstrap drops it in alongside the api/worker units). Restart if
# active; silently skip otherwise so pre-2.3 VPS deploys keep working.
if systemctl is-enabled platform-collab.service >/dev/null 2>&1; then
  log "Restarting platform-collab"
  systemctl restart platform-collab
fi

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
