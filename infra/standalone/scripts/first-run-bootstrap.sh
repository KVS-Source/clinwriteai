#!/usr/bin/env bash
# First-run bootstrap for a shared/fresh Ubuntu VPS.
#
# Idempotent — safe to re-run on every deploy. On an already-bootstrapped
# VPS it short-circuits in a fraction of a second. On a fresh VPS it
# installs system prereqs, creates the /opt/platform layout, clones the
# repo, lays down nginx + systemd configs, generates sensible defaults
# for secrets, and starts the postgres+redis data services via Docker.
#
# Safe for shared VPSes — it does NOT touch other projects' nginx sites,
# other systemd units, or other databases. Our files are all under
# /opt/platform/ and /etc/nginx/sites-{available,enabled}/platform.
#
# Called by the deploy workflow before `deploy.sh` so a first-time deploy
# just works, no human SSH session required.

set -euo pipefail
log() { echo "[bootstrap $(date +'%H:%M:%S')] $*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  echo "first-run-bootstrap.sh must run as root" >&2
  exit 1
fi

REPO_URL="${PLATFORM_REPO_URL:-https://github.com/KVS-Source/clinwriteai.git}"
REPO_DIR=/opt/platform/repo

# -------- 1. Idempotence check --------
# If the deploy.sh is already present under /opt/platform/repo AND the
# key systemd units are installed, skip the heavy apt-install / docker-
# compose work. BUT always re-sync nginx + systemd configs from the
# repo so a committed config change (e.g. systemd WorkingDirectory
# update) takes effect on the next deploy.
if [[ -x "${REPO_DIR}/infra/standalone/scripts/deploy.sh" ]] \
   && [[ -f /etc/systemd/system/platform-api.service ]] \
   && [[ -f /etc/nginx/sites-enabled/platform ]]; then
  log "already bootstrapped — refreshing nginx + systemd configs from repo"
  # Re-sync nginx snippets + site config
  for snip in "${REPO_DIR}/infra/standalone/nginx/snippets/"*.conf; do
    install -m 644 "${snip}" "/etc/nginx/snippets/platform-$(basename "${snip}")"
  done
  install -m 644 "${REPO_DIR}/infra/standalone/nginx/platform.conf" /etc/nginx/sites-available/platform
  # Re-sync systemd units
  for unit in "${REPO_DIR}/infra/standalone/systemd/platform-"*.service \
              "${REPO_DIR}/infra/standalone/systemd/platform-"*.timer; do
    [[ -f "${unit}" ]] && install -m 644 "${unit}" /etc/systemd/system/
  done
  systemctl daemon-reload
  # Validate + reload nginx. Non-fatal (deploy.sh will try cert issuance
  # later if the error is cert-path-not-found).
  nginx -t 2>&1 | tail -5 || log "WARN: nginx -t failed; continuing"
  systemctl reload nginx 2>&1 || log "WARN: nginx reload failed; continuing"
  exit 0
fi

log "=== fresh/incomplete bootstrap — installing/updating prereqs ==="

# -------- 2. System prereqs --------
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git make build-essential \
  nginx certbot python3-certbot-nginx ufw jq openssl

if ! command -v node >/dev/null 2>&1; then
  log "installing Node.js 20 LTS"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
log "node: $(node --version)"

if ! command -v docker >/dev/null 2>&1; then
  log "installing Docker CE"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
log "docker: $(docker --version)"

# -------- 3. Platform user + dirs --------
if ! id -u platform >/dev/null 2>&1; then
  log "creating platform service user"
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
  /run/platform

chown -R platform:platform /opt/platform
chown www-data:www-data /var/www/platform /var/www/acme

# -------- 4. Clone repo --------
if [[ ! -d "${REPO_DIR}/.git" ]]; then
  log "cloning repo"
  sudo -u platform git clone --depth 1 "${REPO_URL}" "${REPO_DIR}"
fi
cd "${REPO_DIR}"
sudo -u platform git fetch --quiet origin main
sudo -u platform git checkout -q origin/main
# Defensive: ensure all shell scripts in infra/standalone/scripts are
# executable regardless of git mode-tracking. A stale clone from before
# the chmod +x commit landed would otherwise fail with "command not
# found" on the next deploy.sh invocation.
chmod +x "${REPO_DIR}/infra/standalone/scripts/"*.sh
log "repo at $(sudo -u platform git rev-parse --short HEAD)"

# -------- 5. Env file (minimal defaults; operator can replace later) --------
# Uses plain-text env (no sops) for first boot. Replace with sops-encrypted
# .env.enc + /etc/platform/age.key when ready (BOOTSTRAP.md full flow).
ENV_FILE=/opt/platform/env/api.env
NEED_ENV_REGEN=0
if [[ ! -f "${ENV_FILE}" ]]; then
  NEED_ENV_REGEN=1
elif [[ ! -f /opt/platform/env/.env ]] \
     || ! grep -q "^MINIO_ROOT_PASSWORD=" /opt/platform/env/.env \
     || ! grep -q "^GRAFANA_ADMIN_PASSWORD=" /opt/platform/env/.env; then
  # Previous bootstrap run (before this fix) wrote a partial .env missing
  # MINIO/GRAFANA keys. Rewrite from scratch — preserves the api.env
  # secrets if we can read the password out, otherwise generates fresh.
  log "existing /opt/platform/env/.env is missing compose vars — regenerating"
  NEED_ENV_REGEN=1
fi
if [[ ${NEED_ENV_REGEN} -eq 1 ]]; then
  log "generating default api.env at ${ENV_FILE}"
  JWT_SECRET=$(openssl rand -hex 32)
  AUDIT_HASH_SECRET=$(openssl rand -hex 32)
  BLOB_SIGNING_KEY=$(openssl rand -hex 32)
  # Preserve the Postgres password if one already exists so re-run
  # doesn't orphan the DB.
  PG_PASSWORD=$(grep -oP '(?<=^POSTGRES_PASSWORD=).*' /opt/platform/env/.env 2>/dev/null || openssl rand -hex 16)
  cat > "${ENV_FILE}" <<ENV
# Generated by first-run-bootstrap.sh. Replace with sops-encrypted
# .env.enc once operator provisions an age key (BOOTSTRAP.md step 4).
DATABASE_URL=postgresql://platform:${PG_PASSWORD}@127.0.0.1:5432/platform?schema=public
REDIS_URL=redis://127.0.0.1:6379
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
ENV
  chmod 600 "${ENV_FILE}"
  chown platform:platform "${ENV_FILE}"
  # Also drop all vars docker-compose needs into /opt/platform/env/.env.
  # The compose file validates with the `${X:?...}` pattern, so missing
  # keys abort `docker compose up` before any service starts.
  REDIS_PWD=$(openssl rand -hex 16)
  MINIO_PWD=$(openssl rand -hex 16)
  GRAFANA_PWD=$(openssl rand -hex 16)
  cat > /opt/platform/env/.env <<DOTENV
POSTGRES_USER=platform
POSTGRES_PASSWORD=${PG_PASSWORD}
POSTGRES_DB=platform
REDIS_PASSWORD=${REDIS_PWD}
MINIO_ROOT_USER=platform
MINIO_ROOT_PASSWORD=${MINIO_PWD}
GRAFANA_ADMIN_PASSWORD=${GRAFANA_PWD}
DOTENV
  chmod 600 /opt/platform/env/.env
  chown platform:platform /opt/platform/env/.env
  # Update api.env's REDIS_URL to include the password since compose
  # starts redis with --requirepass.
  sed -i "s|^REDIS_URL=.*|REDIS_URL=redis://:${REDIS_PWD}@127.0.0.1:6379|" "${ENV_FILE}"
fi

# Ensure both env files are readable by the platform user even if
# this script was re-run or files were created with wrong ownership.
chown platform:platform "${ENV_FILE}" /opt/platform/env/.env 2>/dev/null || true

# The worker shares the same env as the API (same DB, Redis, blob
# backend). Symlink worker.env to api.env so platform-worker.service's
# EnvironmentFile=/run/platform/worker.env resolves.
WORKER_ENV_FILE=/opt/platform/env/worker.env
if [[ ! -f "${WORKER_ENV_FILE}" ]]; then
  ln -sf api.env "${WORKER_ENV_FILE}"
fi

# Place plaintext copies at /run/platform/ for deploy.sh (which
# normally runs decrypt-env.sh to materialise them from the sops-
# encrypted versions). Mimic the same path so deploy.sh works unchanged.
# Dir owned by platform:platform so the shim running as platform can
# overwrite its own files on re-run (previously permission denied).
mkdir -p /run/platform
chown platform:platform /run/platform
chmod 755 /run/platform
install -o platform -g platform -m 600 "${ENV_FILE}" /run/platform/api.env
install -o platform -g platform -m 600 "${ENV_FILE}" /run/platform/worker.env

# Shim decrypt-env.sh if the real one (sops-based) isn't present yet,
# so deploy.sh's `sudo -u platform /opt/platform/scripts/decrypt-env.sh api`
# call doesn't fail. The shim just copies the plaintext env into /run.
if [[ ! -x /opt/platform/scripts/decrypt-env.sh ]] \
   || ! grep -q "shim-v2" /opt/platform/scripts/decrypt-env.sh; then
  log "installing shim decrypt-env.sh (plaintext env; replace with sops later)"
  cat > /opt/platform/scripts/decrypt-env.sh <<'SHIM'
#!/usr/bin/env bash
# Shim installed by first-run-bootstrap.sh (shim-v2). Replaced by the
# real sops-driven version once /etc/platform/age.key +
# /opt/platform/env/api.env.enc are set up (BOOTSTRAP.md).
#
# Uses `cat >` instead of `install` because install unlinks the
# destination before writing — which fails with "Permission denied"
# when the file was created by a different user on a previous run.
# `cat >` opens the existing inode for write (truncate), which works
# as long as the file itself (not just the dir) is writable by us.
set -euo pipefail
NAME="$1"
SRC="/opt/platform/env/${NAME}.env"
DST="/run/platform/${NAME}.env"
# Deref SRC if it's a symlink (worker.env -> api.env).
SRC_REAL=$(readlink -f "${SRC}")
cat "${SRC_REAL}" > "${DST}"
chmod 600 "${DST}"
SHIM
  chmod +x /opt/platform/scripts/decrypt-env.sh
  chown platform:platform /opt/platform/scripts/decrypt-env.sh
fi

# -------- 6. nginx config --------
mkdir -p /etc/nginx/snippets /etc/nginx/sites-available /etc/nginx/sites-enabled
# Our snippets are prefixed to avoid collision with other projects' files
# on a shared VPS.
for snip in "${REPO_DIR}/infra/standalone/nginx/snippets/"*.conf; do
  dest="/etc/nginx/snippets/platform-$(basename "${snip}")"
  cp "${snip}" "${dest}"
done
cp "${REPO_DIR}/infra/standalone/nginx/platform.conf" /etc/nginx/sites-available/platform
ln -sf /etc/nginx/sites-available/platform /etc/nginx/sites-enabled/platform
# Don't nginx -t yet; cert may not exist. certbot script handles it.

# -------- 7. systemd units --------
for unit in "${REPO_DIR}/infra/standalone/systemd/platform-"*.service; do
  cp "${unit}" /etc/systemd/system/
done
for unit in "${REPO_DIR}/infra/standalone/systemd/platform-"*.timer; do
  [[ -f "${unit}" ]] && cp "${unit}" /etc/systemd/system/
done
systemctl daemon-reload

# -------- 8. Firewall --------
ufw allow 22/tcp comment "SSH" >/dev/null 2>&1 || true
ufw allow 80/tcp comment "HTTP (ACME)" >/dev/null 2>&1 || true
ufw allow 443/tcp comment "HTTPS" >/dev/null 2>&1 || true
ufw --force enable >/dev/null 2>&1 || true

# -------- 9. Start data services (postgres + redis via docker compose) --------
cd "${REPO_DIR}"
set -a; . /opt/platform/env/.env; set +a
docker compose -f infra/standalone/docker-compose.yml up -d
# Wait up to 60s for postgres to be ready for DDL.
for i in $(seq 1 30); do
  if docker compose -f infra/standalone/docker-compose.yml exec -T postgres pg_isready -U platform -d platform >/dev/null 2>&1; then
    log "postgres ready"
    break
  fi
  sleep 2
done

# Create the platform database + role if docker-compose didn't already.
docker compose -f infra/standalone/docker-compose.yml exec -T postgres \
  psql -U postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='platform'" | grep -q 1 \
  || docker compose -f infra/standalone/docker-compose.yml exec -T postgres \
       psql -U postgres -c "CREATE ROLE platform WITH LOGIN PASSWORD '${POSTGRES_PASSWORD}'" || true
docker compose -f infra/standalone/docker-compose.yml exec -T postgres \
  psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='platform'" | grep -q 1 \
  || docker compose -f infra/standalone/docker-compose.yml exec -T postgres \
       createdb -U postgres -O platform platform || true

log "=== bootstrap complete ==="
log "  repo:    ${REPO_DIR} ($(sudo -u platform git rev-parse --short HEAD))"
log "  env:     ${ENV_FILE} (regenerate secrets by deleting + re-running)"
log "  nginx:   /etc/nginx/sites-enabled/platform"
log "  systemd: platform-api / platform-worker installed"
log "  data:    postgres + redis running under docker compose"
log ""
log "Next: deploy.sh will migrate + seed + start the API."
