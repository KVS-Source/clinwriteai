#!/usr/bin/env bash
# Rotate the Postgres platform user password. Standalone equivalent of what
# the AWS Secrets Manager rotation Lambda does automatically on cloud.
#
# Run quarterly per compliance SOP. Must be scheduled; not automatic on standalone.
#
# Steps:
#   1. Generate new password
#   2. Update Postgres role
#   3. Update sops-encrypted .env.enc with new password
#   4. Decrypt + restart platform-api + platform-worker so they pick up the new value

set -euo pipefail

log() { echo "[rotate-db-password $(date +'%H:%M:%S')] $*"; }

# ---------- Generate new password ----------
NEW_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
log "Generated new password (32 chars)"

# ---------- Update Postgres role ----------
export SOPS_AGE_KEY_FILE="/etc/platform/age.key"
CURRENT_PASSWORD=$(sops --decrypt /opt/platform/env/api.env.enc | grep '^DATABASE_URL=' | sed 's|.*://[^:]*:\([^@]*\)@.*|\1|')
log "Updating Postgres role password"
PGPASSWORD="${CURRENT_PASSWORD}" psql --host=127.0.0.1 --username=platform --dbname=postgres <<SQL
ALTER USER platform WITH PASSWORD '${NEW_PASSWORD}';
SQL

# ---------- Update sops-encrypted env ----------
log "Updating .env.enc files"
# Decrypt → modify → re-encrypt (sops supports in-place edit via `sops set`)
sops --set '["DATABASE_URL"] "postgresql://platform:'"${NEW_PASSWORD}"'@127.0.0.1:5432/platform?schema=public"' /opt/platform/env/api.env.enc
sops --set '["DATABASE_URL"] "postgresql://platform:'"${NEW_PASSWORD}"'@127.0.0.1:5432/platform?schema=public"' /opt/platform/env/worker.env.enc

# ---------- Restart services ----------
log "Restarting services with new password"
systemctl restart platform-api platform-worker

log "Verifying services came up healthy"
sleep 5
curl -fsS http://127.0.0.1:3001/health >/dev/null
log "Rotation complete. Record in compliance log."

# ---------- Audit event ----------
# The API's audit trail should receive a 'system.password_rotation' event when
# the restart happens; verify with:
#   psql -c "SELECT * FROM audit_events WHERE action='system.password_rotation' ORDER BY id DESC LIMIT 1;"
