#!/usr/bin/env bash
# Restore DB from the latest B2 backup. Supports --drill mode (restore into a
# scratch DB, verify, drop) for the monthly backup verification requirement.
#
# Usage:
#   scripts/restore.sh              — real restore into the production DB (DESTRUCTIVE)
#   scripts/restore.sh --drill      — monthly drill: restore into platform_restore_test, run checks, drop
#   scripts/restore.sh --at TS      — restore the backup from a specific timestamp (format: YYYYMMDD-HHMMSS)
#
# Required env (sourced from /opt/platform/env/.env.enc):
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
#   AGE_IDENTITY_FILE      — path to age private key for decrypting the backup
#   B2_BUCKET, RCLONE_CONFIG_B2

set -euo pipefail

MODE="restore"
TARGET_TS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --drill) MODE="drill"; shift ;;
    --at)    TARGET_TS="$2"; shift 2 ;;
    *)       echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

log() { echo "[restore] $*"; }

# ---------- Find the backup to restore ----------
if [[ -z "${TARGET_TS}" ]]; then
  log "Finding latest B2 backup"
  TARGET_TS=$(rclone lsd "b2:${B2_BUCKET}/${ENV_NAME:-staging}/postgres/" | awk '{print $NF}' | sort -r | head -1)
  if [[ -z "${TARGET_TS}" ]]; then
    log "ERROR: no backup found in B2"
    exit 1
  fi
fi
log "Target backup: ${TARGET_TS}"

# ---------- Fetch + decrypt ----------
STAGING="/var/backups/platform/restore-${TARGET_TS}"
mkdir -p "${STAGING}"
log "Fetching backup from B2"
rclone copy "b2:${B2_BUCKET}/${ENV_NAME:-staging}/postgres/${TARGET_TS}/db.dump.age" "${STAGING}/"
log "Decrypting with age"
age --decrypt --identity "${AGE_IDENTITY_FILE}" --output "${STAGING}/db.dump" "${STAGING}/db.dump.age"

# ---------- Determine target DB ----------
if [[ "${MODE}" == "drill" ]]; then
  TARGET_DB="platform_restore_test_${TARGET_TS//-/_}"
  log "Drill mode: restoring into scratch DB ${TARGET_DB}"
  PGPASSWORD="${POSTGRES_PASSWORD}" dropdb --host=127.0.0.1 --username="${POSTGRES_USER}" --if-exists "${TARGET_DB}"
  PGPASSWORD="${POSTGRES_PASSWORD}" createdb --host=127.0.0.1 --username="${POSTGRES_USER}" "${TARGET_DB}"
else
  TARGET_DB="${POSTGRES_DB}"
  log "⚠️  LIVE RESTORE: will overwrite ${TARGET_DB}"
  log "Press Ctrl+C within 10s to abort"
  sleep 10
  log "Stopping API + worker to prevent in-flight writes"
  systemctl stop platform-api platform-worker || true
fi

# ---------- Restore ----------
log "pg_restore into ${TARGET_DB}"
PGPASSWORD="${POSTGRES_PASSWORD}" pg_restore \
  --host=127.0.0.1 \
  --port=5432 \
  --username="${POSTGRES_USER}" \
  --dbname="${TARGET_DB}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --jobs=4 \
  "${STAGING}/db.dump"

# ---------- Verify ----------
log "Running integrity checks"
PGPASSWORD="${POSTGRES_PASSWORD}" psql --host=127.0.0.1 --username="${POSTGRES_USER}" --dbname="${TARGET_DB}" <<SQL
SELECT 'users', count(*) FROM users;
SELECT 'projects', count(*) FROM projects;
SELECT 'audit_events', count(*) FROM audit_events;
-- Hash-chain integrity on audit_events
SELECT 'audit_chain_breaks', count(*) FROM (
  SELECT row_hash, LAG(row_hash) OVER (ORDER BY id) AS expected_prev, prev_hash
  FROM audit_events
) t WHERE expected_prev IS NOT NULL AND prev_hash != expected_prev;
SQL

# ---------- Cleanup for drill ----------
if [[ "${MODE}" == "drill" ]]; then
  log "Drill complete; dropping scratch DB"
  PGPASSWORD="${POSTGRES_PASSWORD}" dropdb --host=127.0.0.1 --username="${POSTGRES_USER}" "${TARGET_DB}"

  # Emit metric for drill success
  if [[ -n "${PROM_PUSHGATEWAY:-}" ]]; then
    echo "platform_backup_drill_last_success_seconds $(date +%s)" \
      | curl --data-binary @- "${PROM_PUSHGATEWAY}/metrics/job/platform_backup_drill/env/${ENV_NAME:-staging}" || true
  fi
else
  log "Live restore complete; restarting services"
  systemctl start platform-api platform-worker
fi

rm -rf "${STAGING}"
log "Done"
