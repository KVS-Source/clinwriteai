#!/usr/bin/env bash
# Idempotent first-run bootstrap. No short-circuit — every step runs
# on every invocation, each gated on "is this already done?" so re-runs
# finish in ~30 sec. First-time runs take 3-5 min for apt/docker install.
#
# Rewritten after discovering that an earlier short-circuit path was
# syncing nginx + systemd configs from a stale repo checkout (the git
# fetch happened AFTER the short-circuit exit). All fixes were in the
# full path, so re-runs kept hitting the old bugs forever.
#
# Order of operations:
#   A. apt prereqs (apt install -y — already-installed is a no-op)
#   B. Node 20 LTS (skip if `node` on PATH)
#   C. Docker CE (skip if `docker` on PATH)
#   D. Platform user + /opt/platform layout
#   E. Clone OR update repo (git fetch + checkout origin/main)
#   F. Env regeneration (keeps existing values if present + complete)
#   G. decrypt-env.sh shim-v2
#   H. /run/platform chown + env file copies
#   I. nginx snippets + site config
#   J. systemd units + daemon-reload
#   K. ufw rules
#   L. docker compose up (idempotent)
#   M. Postgres role + database creation

set -uo pipefail
log() { echo "[bootstrap $(date +'%H:%M:%S')] $*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root (sudo bash)"; exit 1
fi

REPO_URL="${PLATFORM_REPO_URL:-https://github.com/KVS-Source/clinwriteai.git}"
REPO_DIR=/opt/platform/repo

# ================================================================
# A. apt prereqs
# ================================================================
log "A. apt prereqs"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git make build-essential \
  nginx certbot python3-certbot-nginx ufw jq openssl \
  >/dev/null

# ================================================================
# B. Node 20 LTS
# ================================================================
if ! command -v node >/dev/null 2>&1; then
  log "B. installing Node.js 20 LTS"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
log "B. node: $(node --version)"

# ================================================================
# C. Docker CE
# ================================================================
if ! command -v docker >/dev/null 2>&1; then
  log "C. installing Docker CE"
  curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
  systemctl enable --now docker >/dev/null 2>&1
fi
log "C. docker: $(docker --version | cut -d, -f1)"

# ================================================================
# D. Platform user + dirs
# ================================================================
log "D. platform user + /opt/platform layout"
if ! id -u platform >/dev/null 2>&1; then
  useradd --system --home /opt/platform --shell /bin/bash platform
fi
usermod -aG docker platform 2>/dev/null || true
mkdir -p \
  /opt/platform/apps/{api,worker} \
  /opt/platform/env \
  /opt/platform/scripts \
  /opt/platform/data/{postgres,redis,blob} \
  /var/www/platform/dist \
  /var/www/acme \
  /var/log/platform \
  /run/platform
chown -R platform:platform /opt/platform /run/platform /var/log/platform
chown www-data:www-data /var/www/platform /var/www/acme

# ================================================================
# E. Clone OR update repo
# ================================================================
if [[ ! -d "${REPO_DIR}/.git" ]]; then
  log "E. cloning repo"
  sudo -u platform git clone --depth 1 "${REPO_URL}" "${REPO_DIR}"
fi
cd "${REPO_DIR}"
# Switch main to track origin/main so fetch + checkout picks up changes
sudo -u platform git fetch --quiet origin main
sudo -u platform git checkout -q origin/main
# Defensive exec bits — git mode-tracking can drop on some clones
chmod +x "${REPO_DIR}/infra/standalone/scripts/"*.sh
log "E. repo at $(sudo -u platform git rev-parse --short HEAD)"

# ================================================================
# F. Env regeneration
# ================================================================
ENV_FILE=/opt/platform/env/api.env
DOTENV_FILE=/opt/platform/env/.env
NEED_ENV_REGEN=0
if [[ ! -f "${ENV_FILE}" ]]; then
  NEED_ENV_REGEN=1
elif [[ ! -f "${DOTENV_FILE}" ]] \
     || ! grep -q "^MINIO_ROOT_PASSWORD=" "${DOTENV_FILE}" \
     || ! grep -q "^GRAFANA_ADMIN_PASSWORD=" "${DOTENV_FILE}" \
     || ! grep -q "^MINIO_ROOT_USER="     "${DOTENV_FILE}"; then
  log "F. ${DOTENV_FILE} missing required docker-compose vars — regenerating"
  NEED_ENV_REGEN=1
fi

if [[ ${NEED_ENV_REGEN} -eq 1 ]]; then
  log "F. generating ${ENV_FILE} + ${DOTENV_FILE}"
  JWT_SECRET=$(openssl rand -hex 32)
  AUDIT_HASH_SECRET=$(openssl rand -hex 32)
  BLOB_SIGNING_KEY=$(openssl rand -hex 32)
  # Preserve the Postgres password if one already exists so re-runs
  # don't orphan the DB and leave the role unable to connect.
  PG_PASSWORD=$(grep -oP '(?<=^POSTGRES_PASSWORD=).*' "${DOTENV_FILE}" 2>/dev/null || openssl rand -hex 16)
  REDIS_PWD=$(grep -oP '(?<=^REDIS_PASSWORD=).*' "${DOTENV_FILE}" 2>/dev/null)
  [[ -z "${REDIS_PWD}" || "${REDIS_PWD}" == "unused" ]] && REDIS_PWD=$(openssl rand -hex 16)
  MINIO_PWD=$(openssl rand -hex 16)
  GRAFANA_PWD=$(openssl rand -hex 16)

  cat > "${ENV_FILE}" <<ENV
# Generated by first-run-bootstrap.sh. Replace with sops-encrypted
# .env.enc once operator provisions an age key (BOOTSTRAP.md step 4).
DATABASE_URL=postgresql://platform:${PG_PASSWORD}@127.0.0.1:5432/platform?schema=public
REDIS_URL=redis://:${REDIS_PWD}@127.0.0.1:6379
JWT_SECRET=${JWT_SECRET}
AUDIT_HASH_SECRET=${AUDIT_HASH_SECRET}
S3_DOCUMENTS_BUCKET=platform-documents
BLOB_PROVIDER=local
BLOB_LOCAL_ROOT_DIR=/opt/platform/data/blob
BLOB_LOCAL_SIGNING_KEY=${BLOB_SIGNING_KEY}
CORS_ORIGIN=https://demo.clinwrite.ai
SESSION_COOKIE_DOMAIN=.clinwrite.ai
NODE_ENV=production
PORT=3001
HOST=127.0.0.1
LOG_LEVEL=info
SECRETS_PROVIDER=env
FEATURE_MODULES_ENABLED=A
FEATURE_OPENAPI_DOCS=false
# Server-side auth bypass — mirrors VITE_BYPASS_AUTH in apps/web/.env.demo.
# Any request without a session cookie is served as this user. Unset once
# WorkOS lands + the SSO E2E runbook is complete.
AUTH_BYPASS_EMAIL=admin@clinwrite.ai
ENV

  cat > "${DOTENV_FILE}" <<DOTENV
POSTGRES_USER=platform
POSTGRES_PASSWORD=${PG_PASSWORD}
POSTGRES_DB=platform
REDIS_PASSWORD=${REDIS_PWD}
MINIO_ROOT_USER=platform
MINIO_ROOT_PASSWORD=${MINIO_PWD}
GRAFANA_ADMIN_PASSWORD=${GRAFANA_PWD}
DOTENV
fi

# Always-run perms + ownership (fix any stale root-owned files from
# previous botched runs)
chmod 600 "${ENV_FILE}" "${DOTENV_FILE}"
chown platform:platform "${ENV_FILE}" "${DOTENV_FILE}"

# Worker shares API env; symlink so systemd's EnvironmentFile=worker.env resolves
WORKER_ENV_FILE=/opt/platform/env/worker.env
if [[ ! -L "${WORKER_ENV_FILE}" ]] || [[ "$(readlink "${WORKER_ENV_FILE}")" != "api.env" ]]; then
  ln -sfn api.env "${WORKER_ENV_FILE}"
fi

# ================================================================
# G. decrypt-env.sh shim-v2
# ================================================================
SHIM=/opt/platform/scripts/decrypt-env.sh
# Copy the health-check helper that platform-api.service references
# via ExecStartPost. Without this, systemd fails the whole service
# with status=203/EXEC (program not found) and kills the Fastify
# process immediately after boot.
install -m 755 -o platform -g platform \
  "${REPO_DIR}/infra/standalone/scripts/wait-for-health.sh" \
  /opt/platform/scripts/wait-for-health.sh 2>/dev/null || \
  log "G. WARN: wait-for-health.sh not found in repo"

if [[ ! -x "${SHIM}" ]] || ! grep -q "shim-v2" "${SHIM}"; then
  log "G. installing shim-v2 at ${SHIM}"
  cat > "${SHIM}" <<'SHIMEOF'
#!/usr/bin/env bash
# Shim installed by first-run-bootstrap.sh (shim-v2). Replaced by the
# real sops-driven version once /etc/platform/age.key +
# /opt/platform/env/${name}.env.enc are set up (BOOTSTRAP.md).
#
# Uses `cat >` instead of `install` — install unlinks the destination
# before writing, which fails if the file was created by another user.
set -euo pipefail
NAME="$1"
SRC="/opt/platform/env/${NAME}.env"
DST="/run/platform/${NAME}.env"
# Deref symlinks (worker.env → api.env)
SRC_REAL=$(readlink -f "${SRC}")
cat "${SRC_REAL}" > "${DST}"
chmod 600 "${DST}"
SHIMEOF
  chmod +x "${SHIM}"
  chown platform:platform "${SHIM}"
fi

# ================================================================
# H. /run/platform chown + env file copies
# ================================================================
log "H. /run/platform ownership + env file copies"
chown platform:platform /run/platform
chmod 755 /run/platform
# Nuke any existing files owned by root so the platform user can
# re-create them. This is the fix for "install: cannot remove" that
# bit us on every re-run of deploy.sh.
rm -f /run/platform/api.env /run/platform/worker.env
install -o platform -g platform -m 600 "${ENV_FILE}" /run/platform/api.env
install -o platform -g platform -m 600 "${ENV_FILE}" /run/platform/worker.env

# ================================================================
# I. nginx snippets + site config
# ================================================================
log "I. nginx config"
mkdir -p /etc/nginx/snippets /etc/nginx/sites-available /etc/nginx/sites-enabled
# Where we park conflicting configs. Kept outside sites-enabled so
# nginx's `include /etc/nginx/sites-enabled/*` glob doesn't pick them
# up — the previous `.bak` rename failed on this because nginx's
# default include has no file-extension filter.
mkdir -p /etc/nginx/sites-disabled-by-platform

for snip in "${REPO_DIR}/infra/standalone/nginx/snippets/"*.conf; do
  install -m 644 "${snip}" "/etc/nginx/snippets/platform-$(basename "${snip}")"
done
install -m 644 "${REPO_DIR}/infra/standalone/nginx/platform.conf" /etc/nginx/sites-available/platform
ln -sfn /etc/nginx/sites-available/platform /etc/nginx/sites-enabled/platform

# Sweep .bak files that prior versions of this script created in
# sites-enabled. nginx loads them (its glob has no extension filter)
# which still triggers "protocol options redefined" + "conflicting
# server name" warnings. Move them out.
shopt -s nullglob
for f in /etc/nginx/sites-enabled/*.bak; do
  log "I. moving stale ${f} out of sites-enabled → /etc/nginx/sites-disabled-by-platform/"
  mv "${f}" "/etc/nginx/sites-disabled-by-platform/$(basename ${f})"
done
shopt -u nullglob

# Scan for ANY sites-enabled file (not our `platform`) that explicitly
# claims one of OUR hostnames in a server_name directive. On a shared
# VPS with prior deployment attempts there may be a stale demo.clinwrite.ai
# or api.clinwrite.ai server block from an earlier iteration.
#
# IMPORTANT: match ONLY the exact hostnames we own. Earlier revisions
# matched "*clinwrite*" which incorrectly disabled proto.clinwrite.ai
# and clinwrite.ai (separate sites owned by the operator, not us).
# server_name uses space-separated hostnames so we assert word-boundary
# via (^|[[:space:]]) and ($|[[:space:];]) around each target.
#
# Previously we renamed to .bak, but nginx's default
# `include /etc/nginx/sites-enabled/*` has no extension filter so
# .bak files were still being loaded (observed in prod: "protocol
# options redefined for [::]:443 in sites-enabled/clinwrite-proto.bak").
# Moving the file out of sites-enabled entirely is the correct fix.
OUR_HOSTS_RE='server_name[[:space:]]+[^;]*(^|[[:space:]])(demo|api)\.clinwrite\.ai($|[[:space:];])'
shopt -s nullglob
for f in /etc/nginx/sites-enabled/*; do
  name=$(basename "${f}")
  [[ "${name}" == "platform" ]] && continue
  if grep -qE "${OUR_HOSTS_RE}" "${f}" 2>/dev/null; then
    log "I. disabling conflicting ${f} (claims demo./api.clinwrite.ai) → /etc/nginx/sites-disabled-by-platform/"
    if [[ -L "${f}" ]]; then
      target=$(readlink -f "${f}")
      rm -f "${f}"
      echo "${target}" > "/etc/nginx/sites-disabled-by-platform/${name}.symlink-was"
    else
      mv "${f}" "/etc/nginx/sites-disabled-by-platform/${name}"
    fi
  fi
done
shopt -u nullglob

# Repair pass: if a previous (overly-broad) bootstrap run moved
# configs for domains we don't own (proto.clinwrite.ai, clinwrite.ai,
# etc.), restore them. This fires once per re-run until the leftover
# is gone — operator doesn't have to manually mv anything.
if [[ -d /etc/nginx/sites-disabled-by-platform ]]; then
  shopt -s nullglob
  for f in /etc/nginx/sites-disabled-by-platform/*; do
    name=$(basename "${f}")
    # Skip the symlink markers themselves + anything already a .bak
    [[ "${name}" == *.symlink-was ]] && continue
    [[ "${name}" == *.bak ]] && continue
    # If this file does NOT claim demo./api.clinwrite.ai, it was
    # mis-disabled by the earlier aggressive match. Put it back.
    if ! grep -qE "${OUR_HOSTS_RE}" "${f}" 2>/dev/null; then
      log "I. restoring mis-disabled ${f} → /etc/nginx/sites-enabled/${name} (doesn't claim our hostnames)"
      mv "${f}" "/etc/nginx/sites-enabled/${name}"
      # Clean up any companion symlink-was marker
      rm -f "/etc/nginx/sites-disabled-by-platform/${name}.symlink-was"
    fi
  done
  shopt -u nullglob
fi
# Validate — if invalid, log and continue (deploy.sh will try cert
# issuance which may fix a path-not-found error).
if ! nginx -t 2>&1 | tail -5; then
  log "I. WARN: nginx -t failed; continuing"
else
  systemctl reload nginx 2>&1 || log "I. WARN: nginx reload failed; continuing"
fi

# ================================================================
# J. systemd units + daemon-reload
# ================================================================
log "J. systemd units"
for unit in "${REPO_DIR}/infra/standalone/systemd/platform-"*.service \
            "${REPO_DIR}/infra/standalone/systemd/platform-"*.timer; do
  [[ -f "${unit}" ]] && install -m 644 "${unit}" /etc/systemd/system/
done

# A platform-data.target is referenced by platform-api.service via
# Requires=; create one if the repo doesn't ship it so systemctl can
# resolve the dependency on start.
if [[ ! -f /etc/systemd/system/platform-data.target ]]; then
  cat > /etc/systemd/system/platform-data.target <<'TARGET'
[Unit]
Description=Platform data services (Postgres, Redis, MinIO)

[Install]
WantedBy=multi-user.target
TARGET
fi
systemctl daemon-reload
systemctl enable platform-data.target >/dev/null 2>&1 || true

# ================================================================
# K. Firewall
# ================================================================
log "K. ufw rules"
ufw allow 22/tcp comment "SSH" >/dev/null 2>&1 || true
ufw allow 80/tcp comment "HTTP (ACME)" >/dev/null 2>&1 || true
ufw allow 443/tcp comment "HTTPS" >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true

# ================================================================
# L. docker compose up — only the services the demo actually needs
# ================================================================
# Full compose file includes minio (BLOB_PROVIDER=local avoids it),
# prometheus, grafana, loki, promtail (observability — nice-to-have).
# Explicitly start just pg + redis.
#
# Port conflicts: a shared VPS often has existing pg (5432) or redis
# (6379) from other projects. Detect + remap to 15432 / 16379 via a
# bootstrap-generated docker-compose.override.yml, and keep api.env's
# DATABASE_URL / REDIS_URL in sync.
log "L. detecting port conflicts"
PG_PORT=5432
REDIS_PORT=6379
API_PORT=3001
if ss -tln 2>/dev/null | awk '{print $4}' | grep -qE ":${PG_PORT}\$"; then
  log "L. port 5432 in use — remapping postgres to 15432"
  PG_PORT=15432
fi
if ss -tln 2>/dev/null | awk '{print $4}' | grep -qE ":${REDIS_PORT}\$"; then
  log "L. port 6379 in use — remapping redis to 16379"
  REDIS_PORT=16379
fi
if ss -tln 2>/dev/null | awk '{print $4}' | grep -qE ":${API_PORT}\$"; then
  log "L. port 3001 in use — remapping API to 3011"
  API_PORT=3011
  # Patch api.env's PORT (Fastify's listen port) + nginx upstream +
  # systemd health-check URL so the whole chain agrees on the new port.
  sed -i "s|^PORT=.*|PORT=${API_PORT}|" "${ENV_FILE}"
  install -o platform -g platform -m 600 "${ENV_FILE}" /run/platform/api.env
  install -o platform -g platform -m 600 "${ENV_FILE}" /run/platform/worker.env
  sed -i "s|127.0.0.1:3001|127.0.0.1:${API_PORT}|g" /etc/nginx/sites-available/platform
  sed -i "s|127.0.0.1:3001/health|127.0.0.1:${API_PORT}/health|g" /etc/systemd/system/platform-api.service
  nginx -t 2>&1 | tail -3 && systemctl reload nginx 2>&1 || log "L. WARN: nginx reload failed after port patch"
  systemctl daemon-reload
fi

# Write with quoted delimiter so bash does NO expansion — otherwise
# `!override` triggers history expansion ("!override: command not
# found") and the heredoc gets corrupted mid-write. Substitute port
# placeholders afterward with sed.
cat > "${REPO_DIR}/infra/standalone/docker-compose.override.yml" <<'OVERRIDE'
# Generated by first-run-bootstrap.sh.
#
# 1. Remaps pg + redis to non-conflicting host ports when 5432 / 6379
#    are already in use by other projects on the same VPS.
# 2. Drops the custom postgresql.conf mount — the base compose file
#    expects ./postgres/postgresql.conf to exist in the repo, but it
#    doesn't. Docker auto-creates missing host paths as empty DIRS
#    which postgres then fails to parse as a config file, producing
#    "input in flex scanner failed" and crashing in a restart loop.
#    Postgres container defaults are fine for the demo.
#
# `!override` on list fields forces complete replacement — without it
# docker compose APPENDS (so port 5432 would still bind alongside
# 15432 and fail on the host-port conflict).
services:
  postgres:
    ports: !override
      - "127.0.0.1:__PG_PORT__:5432"
    volumes: !override
      - /opt/platform/data/postgres:/var/lib/postgresql/data
    command: !override ["postgres"]
  redis:
    ports: !override
      - "127.0.0.1:__REDIS_PORT__:6379"
OVERRIDE
sed -i "s/__PG_PORT__/${PG_PORT}/g; s/__REDIS_PORT__/${REDIS_PORT}/g" \
  "${REPO_DIR}/infra/standalone/docker-compose.override.yml"
chown platform:platform "${REPO_DIR}/infra/standalone/docker-compose.override.yml" 2>/dev/null || true

# Sync api.env to use the chosen ports — only patch if different from
# the default 5432/6379 to keep the normal case untouched.
if [[ "${PG_PORT}" != "5432" ]] || [[ "${REDIS_PORT}" != "6379" ]]; then
  sed -i "s|@127.0.0.1:5432|@127.0.0.1:${PG_PORT}|" "${ENV_FILE}"
  sed -i "s|@127.0.0.1:6379|@127.0.0.1:${REDIS_PORT}|" "${ENV_FILE}"
  install -o platform -g platform -m 600 "${ENV_FILE}" /run/platform/api.env
  install -o platform -g platform -m 600 "${ENV_FILE}" /run/platform/worker.env
fi

log "L. docker compose up postgres + redis (pg:${PG_PORT} redis:${REDIS_PORT})"
cd "${REPO_DIR}"
set -a; . "${DOTENV_FILE}"; set +a
# Bring services up one at a time so a failure in one doesn't abort
# the other (previous runs had redis-port-in-use kill postgres too).
docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml up -d postgres 2>&1 | tail -10 || \
  log "L. WARN: postgres failed to start"
docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml up -d redis 2>&1 | tail -10 || \
  log "L. WARN: redis failed to start"

# Wait up to 60s for postgres to be ready for DDL.
for i in $(seq 1 30); do
  if docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml exec -T postgres \
       pg_isready -U platform -d platform >/dev/null 2>&1; then
    log "L. postgres ready"
    break
  fi
  sleep 2
done

# If postgres data dir was initialised with a stale password on a
# previous bootstrap attempt (we regenerated .env after that attempt
# but postgres only honors POSTGRES_PASSWORD on first init), auth will
# fail. Detect + wipe + re-up.
if ! docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml exec -T postgres \
     psql -U platform -d platform -c 'SELECT 1' >/dev/null 2>&1; then
  log "L. stale postgres credentials detected — wiping data dir + re-initialising"
  docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml down postgres >/dev/null 2>&1 || true
  rm -rf /opt/platform/data/postgres/*
  docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml up -d postgres 2>&1 | tail -10
  for i in $(seq 1 30); do
    if docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml exec -T postgres \
         pg_isready -U platform -d platform >/dev/null 2>&1; then
      log "L. postgres re-initialised + ready"
      break
    fi
    sleep 2
  done
fi

# ================================================================
# M. Postgres role + database
# ================================================================
log "M. postgres role + database"
docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml exec -T postgres \
  psql -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='platform'" 2>/dev/null | grep -q 1 \
  || docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml exec -T postgres \
       psql -U postgres -c "CREATE ROLE platform WITH LOGIN PASSWORD '${POSTGRES_PASSWORD}'" >/dev/null 2>&1 || true
docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml exec -T postgres \
  psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='platform'" 2>/dev/null | grep -q 1 \
  || docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml exec -T postgres \
       createdb -U postgres -O platform platform >/dev/null 2>&1 || true

log "✓ bootstrap complete"
log "  repo:    ${REPO_DIR} ($(sudo -u platform git rev-parse --short HEAD))"
log "  env:     ${ENV_FILE}"
PG_STATE=$(cd ${REPO_DIR} && docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep postgres | awk '{print $2}')
REDIS_STATE=$(cd ${REPO_DIR} && docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep redis | awk '{print $2}')
log "  compose: postgres=${PG_STATE:-?}  redis=${REDIS_STATE:-?}"

# If postgres isn't healthy, surface its logs so we can see why.
if [[ "${PG_STATE}" != "running" ]]; then
  log "  ⚠ postgres not running — dumping container logs:"
  cd ${REPO_DIR} && docker compose -f infra/standalone/docker-compose.yml -f infra/standalone/docker-compose.override.yml logs --tail=30 postgres 2>&1 | sed 's/^/    /'
fi
