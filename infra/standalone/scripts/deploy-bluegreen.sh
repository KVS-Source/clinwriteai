#!/usr/bin/env bash
# Blue/green deploy for the Fastify API tier.
#
# Why: zero-downtime deploys for the SLO 99.9% target. A straight restart
# of `platform-api` costs ~2-3s of availability each release — tolerable
# at low release cadence but unacceptable once we're shipping multiple
# times a day during Phase 3 cutovers.
#
# Model:
#   - Two systemd units: platform-api-blue (port 3001) + platform-api-green (3002).
#   - nginx upstream `platform_api` lists both; weight=0 on the inactive
#     colour so no traffic lands there during warm-up.
#   - Deploy picks the inactive colour, builds + migrates + starts it,
#     waits for /health, flips nginx weights (new=1 old=0), reloads nginx,
#     then stops the old colour.
#
# Migrations run BEFORE the flip so both colours see the new schema. New
# schema must be backwards-compatible with the old colour (expand/contract
# migration discipline — see docs/launch/release-checklist.md).

set -euo pipefail
cd /opt/platform/repo

log() { echo "[bluegreen $(date +'%H:%M:%S')] $*"; }

# Determine active + inactive colours from the nginx config. The config
# stores the active colour as a comment marker: `# ACTIVE_COLOUR=blue`.
ACTIVE_COLOUR=$(grep -oP 'ACTIVE_COLOUR=\K(blue|green)' /etc/nginx/sites-enabled/platform || echo blue)
if [[ "$ACTIVE_COLOUR" == "blue" ]]; then
  NEW_COLOUR=green
  NEW_PORT=3002
  OLD_PORT=3001
else
  NEW_COLOUR=blue
  NEW_PORT=3001
  OLD_PORT=3002
fi
log "Active=$ACTIVE_COLOUR; deploying to $NEW_COLOUR on port $NEW_PORT"

# ---------- Pull latest ----------
log "git fetch + checkout"
sudo -u platform git fetch origin main --quiet
sudo -u platform git checkout -q origin/main
HEAD_SHA=$(sudo -u platform git rev-parse --short HEAD)
log "At commit ${HEAD_SHA}"

# ---------- Install + build (shared workspaces) ----------
log "npm ci"
sudo -u platform npm ci --prefer-offline --no-audit --no-fund

log "Building workspaces (api + worker + web)"
sudo -u platform npm --workspace=apps/api    run build
sudo -u platform npm --workspace=apps/worker run build
if [[ -f /opt/platform/env/web.env ]]; then
  WEB_ENV_VARS=$(grep -v '^#' /opt/platform/env/web.env | xargs)
else
  WEB_ENV_VARS=""
fi
sudo -u platform env VITE_API_URL=https://demo-api.clinwrite.ai ${WEB_ENV_VARS} \
  npm --workspace=apps/web run build

# ---------- Sync build artefacts into the inactive colour tree ----------
NEW_ROOT=/opt/platform/apps/api-${NEW_COLOUR}
log "Syncing api dist to ${NEW_ROOT}"
sudo -u platform mkdir -p "${NEW_ROOT}/dist"
sudo -u platform rsync -a --delete apps/api/dist/ "${NEW_ROOT}/dist/"
sudo -u platform cp apps/api/package.json "${NEW_ROOT}/package.json"
(cd "${NEW_ROOT}" && sudo -u platform npm ci --omit=dev --prefer-offline --no-audit --no-fund)

# Worker + web deploy same as blue/green-less path — single-colour services.
sudo -u platform rsync -a --delete apps/worker/dist/ /opt/platform/apps/worker/dist/
rsync -a --delete apps/web/dist/ /var/www/platform/dist/
chown -R www-data:www-data /var/www/platform

# ---------- Database migrations (expand-only — safe for both colours) ----------
log "Running Prisma migrations (expand phase)"
cd /opt/platform/apps/api-${NEW_COLOUR}
sudo -u platform /opt/platform/scripts/decrypt-env.sh api
export $(grep -v '^#' /run/platform/api.env | xargs)
sudo -u platform npx prisma migrate deploy

# ---------- Start the inactive colour ----------
log "Starting platform-api-${NEW_COLOUR}"
systemctl start "platform-api-${NEW_COLOUR}"

log "Waiting for ${NEW_COLOUR} health on port ${NEW_PORT}"
for i in {1..60}; do
  if curl -fsS "http://127.0.0.1:${NEW_PORT}/health" >/dev/null 2>&1; then
    log "${NEW_COLOUR} healthy"
    break
  fi
  if [[ $i -eq 60 ]]; then
    log "✗ ${NEW_COLOUR} failed to come up — aborting; active colour unchanged"
    systemctl stop "platform-api-${NEW_COLOUR}" || true
    exit 1
  fi
  sleep 2
done

# ---------- Soak period — hammer /ready to catch cold-cache or boot issues ----------
log "30s warm-up soak on ${NEW_COLOUR}"
for i in {1..30}; do
  if ! curl -fsS "http://127.0.0.1:${NEW_PORT}/ready" >/dev/null; then
    log "✗ /ready began failing during soak — aborting flip"
    systemctl stop "platform-api-${NEW_COLOUR}" || true
    exit 1
  fi
  sleep 1
done

# ---------- Flip nginx ----------
log "Flipping nginx upstream to ${NEW_COLOUR}"
sed -i -E \
  -e "s/^(\s*)server 127\.0\.0\.1:${OLD_PORT}.*$/\1server 127.0.0.1:${OLD_PORT} weight=0 fail_timeout=10s max_fails=3;/" \
  -e "s/^(\s*)server 127\.0\.0\.1:${NEW_PORT}.*$/\1server 127.0.0.1:${NEW_PORT} fail_timeout=10s max_fails=3;/" \
  -e "s/# ACTIVE_COLOUR=.*$/# ACTIVE_COLOUR=${NEW_COLOUR}/" \
  /etc/nginx/sites-enabled/platform

if nginx -t; then
  systemctl reload nginx
  log "nginx reloaded; ${NEW_COLOUR} is now active"
else
  log "✗ nginx -t failed — reverting"
  # Flip the marker back; next deploy will take the other colour.
  sed -i -E -e "s/# ACTIVE_COLOUR=.*$/# ACTIVE_COLOUR=${ACTIVE_COLOUR}/" /etc/nginx/sites-enabled/platform
  exit 1
fi

# ---------- Drain and stop the old colour ----------
log "Draining old colour (${ACTIVE_COLOUR}) for 30s"
sleep 30
log "Stopping platform-api-${ACTIVE_COLOUR}"
systemctl stop "platform-api-${ACTIVE_COLOUR}" || log "already stopped"

# ---------- Restart worker (single-colour; safe because contract-only queue payload) ----------
log "Restarting platform-worker"
systemctl restart platform-worker

# ---------- Record deploy audit ----------
# Appends to the Postgres audit chain via a small helper script. Keeps the
# "who deployed what, when" record in the same immutable store as app audits.
log "Recording deploy audit event"
sudo -u platform /opt/platform/scripts/audit-deploy.sh "${NEW_COLOUR}" "${HEAD_SHA}" || log "(audit record failed — not blocking)"

log "✓ Deploy complete — ${NEW_COLOUR} serving ${HEAD_SHA}"
