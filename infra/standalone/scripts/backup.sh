#!/usr/bin/env bash
# Backup: pg_dump + MinIO sync → encrypt with age → rclone to Backblaze B2.
# Invoked by platform-backup.service (via platform-backup.timer every 6h).
#
# Expected env (from /opt/platform/env/.env.enc, decrypted by caller or ExecStartPre):
#   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
#   AGE_RECIPIENT          — age public key for backup encryption (different from secret-reading key)
#   B2_BUCKET              — Backblaze B2 bucket name
#   RCLONE_CONFIG_B2       — path to rclone config with [b2] remote defined

set -euo pipefail

TS="$(date -u +%Y%m%d-%H%M%S)"
STAGING_DIR="/var/backups/platform/${TS}"
LOG_PREFIX="[backup ${TS}]"

mkdir -p "${STAGING_DIR}"

log() { echo "${LOG_PREFIX} $*"; }

# ---------- Postgres ----------
log "pg_dump → ${STAGING_DIR}/db.dump"
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  --host=127.0.0.1 \
  --port=5432 \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --format=custom \
  --compress=6 \
  --file="${STAGING_DIR}/db.dump"

DB_SIZE=$(du -h "${STAGING_DIR}/db.dump" | cut -f1)
log "pg_dump complete (${DB_SIZE})"

# ---------- Encrypt the DB dump ----------
log "age-encrypting → ${STAGING_DIR}/db.dump.age"
age --recipient "${AGE_RECIPIENT}" --output "${STAGING_DIR}/db.dump.age" "${STAGING_DIR}/db.dump"
rm -f "${STAGING_DIR}/db.dump"   # keep only the encrypted copy locally

# ---------- MinIO buckets (sync, not snapshot) ----------
log "rclone sync MinIO buckets → B2"
# Uses mc or rclone's s3 backend configured against MinIO; copies to B2 bucket per env.
rclone sync \
  "minio:platform-documents-${ENV_NAME:-staging}" \
  "b2:${B2_BUCKET}/${ENV_NAME:-staging}/minio/documents" \
  --b2-hard-delete \
  --fast-list

# ---------- Upload DB backup to B2 ----------
log "rclone copy db.dump.age → B2"
rclone copy \
  "${STAGING_DIR}/db.dump.age" \
  "b2:${B2_BUCKET}/${ENV_NAME:-staging}/postgres/${TS}/" \
  --fast-list

# ---------- Retention: prune local staging ----------
log "Pruning local staging > 2 generations"
find /var/backups/platform/ -maxdepth 1 -type d -name "20*" | sort -r | tail -n +3 | xargs -r rm -rf

# ---------- Retention: B2 lifecycle rules handle remote retention ----------
# Configure once in B2 console: 30 daily / 12 weekly / 24 monthly = ~66 full copies retained

log "Backup complete"

# ---------- Health signal to monitoring ----------
# Primary path: write a timestamp file the API's ComplianceGaugeScheduler
# reads on its 5-min tick to publish `platform_backup_last_success_seconds`.
# File lives on the host; API reads via bind-mount or shared volume.
TS_FILE="${PLATFORM_BACKUP_TS_FILE:-/var/lib/platform/backup.last_success}"
mkdir -p "$(dirname "${TS_FILE}")"
echo "$(date +%s)" > "${TS_FILE}"
log "Wrote ${TS_FILE} for Prometheus gauge"

# Fallback: emit a Prometheus pushgateway metric if configured. Useful when
# the API process is down and the gauge-scheduler can't publish.
if [[ -n "${PROM_PUSHGATEWAY:-}" ]]; then
  echo "platform_backup_last_success_seconds $(date +%s)" \
    | curl --data-binary @- "${PROM_PUSHGATEWAY}/metrics/job/platform_backup/env/${ENV_NAME:-staging}" || true
fi
