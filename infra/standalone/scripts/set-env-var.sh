#!/usr/bin/env bash
# set-env-var.sh — upsert a single KEY=VALUE into a sops-encrypted env file,
# re-encrypt, and restart the dependent service.
#
# Idempotent: running twice with the same arguments is a no-op after the first.
# Preserves file format (dotenv). Takes a backup before writing.
#
# Usage (run on the VPS as root):
#   ./set-env-var.sh <component> <KEY> <VALUE>
#
# Example:
#   ./set-env-var.sh api EMAIL_PROVIDER smtp

set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <component> <KEY> <VALUE>" >&2
  echo "  component: api | worker" >&2
  exit 2
fi

COMPONENT="$1"
KEY="$2"
VALUE="$3"

ENC_FILE="/opt/platform/env/${COMPONENT}.env.enc"
BACKUP_DIR="/opt/platform/env/backups"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/${COMPONENT}.env.enc.${TS}.bak"

# --- Preconditions ---

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Must run as root (sops needs /etc/platform/age.key)." >&2
  exit 1
fi

if ! command -v sops >/dev/null 2>&1; then
  echo "sops not found on PATH." >&2
  exit 1
fi

if [[ ! -f "${ENC_FILE}" ]]; then
  echo "Encrypted env file not found: ${ENC_FILE}" >&2
  exit 1
fi

if [[ ! -r "/etc/platform/age.key" ]]; then
  echo "age key not readable at /etc/platform/age.key." >&2
  exit 1
fi

if [[ ! "${KEY}" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
  echo "KEY must be upper-snake-case: got '${KEY}'" >&2
  exit 1
fi

export SOPS_AGE_KEY_FILE="/etc/platform/age.key"

# --- Backup ---

mkdir -p "${BACKUP_DIR}"
cp -p "${ENC_FILE}" "${BACKUP_FILE}"
echo "Backup written: ${BACKUP_FILE}"

# --- Decrypt → upsert → re-encrypt ---

TMPFILE="$(mktemp --suffix=.env)"
trap 'rm -f "${TMPFILE}"' EXIT

sops --decrypt --input-type dotenv --output-type dotenv "${ENC_FILE}" > "${TMPFILE}"

# Normalise VALUE for grep/sed (escape | since we use it as sed delim)
ESC_VALUE="$(printf '%s' "${VALUE}" | sed 's/[|&]/\\&/g')"

if grep -qE "^${KEY}=" "${TMPFILE}"; then
  CURRENT="$(grep -E "^${KEY}=" "${TMPFILE}" | head -1 | cut -d= -f2-)"
  if [[ "${CURRENT}" == "${VALUE}" ]]; then
    echo "${KEY} already set to '${VALUE}' — no change."
    rm -f "${BACKUP_FILE}"   # no change happened, drop the no-op backup
    exit 0
  fi
  echo "Updating ${KEY}: '${CURRENT}' → '${VALUE}'"
  sed -i "s|^${KEY}=.*|${KEY}=${ESC_VALUE}|" "${TMPFILE}"
else
  echo "Appending ${KEY}=${VALUE}"
  # ensure file ends with newline before appending
  [[ -s "${TMPFILE}" && -z "$(tail -c1 "${TMPFILE}")" ]] || printf '\n' >> "${TMPFILE}"
  printf '%s=%s\n' "${KEY}" "${VALUE}" >> "${TMPFILE}"
fi

# Re-encrypt in-place (sops picks recipients from .sops.yaml / existing metadata)
sops --encrypt --input-type dotenv --output-type dotenv "${TMPFILE}" > "${ENC_FILE}"
chmod 0400 "${ENC_FILE}"
chown platform:platform "${ENC_FILE}" 2>/dev/null || true

# --- Verify ---

VERIFY_VALUE="$(sops --decrypt --input-type dotenv --output-type dotenv "${ENC_FILE}" | grep -E "^${KEY}=" | head -1 | cut -d= -f2-)"
if [[ "${VERIFY_VALUE}" != "${VALUE}" ]]; then
  echo "Verification failed. Expected '${VALUE}', got '${VERIFY_VALUE}'. Restoring backup." >&2
  cp -p "${BACKUP_FILE}" "${ENC_FILE}"
  exit 1
fi
echo "Encrypted file updated and verified."

# --- Restart dependent service ---

ACTIVE_SERVICE=""
case "${COMPONENT}" in
  api)
    # Prefer blue/green if either is active; fall back to vanilla.
    for svc in platform-api-blue.service platform-api-green.service platform-api.service; do
      if systemctl is-active --quiet "${svc}"; then
        ACTIVE_SERVICE="${svc}"
        break
      fi
    done
    ;;
  worker)
    ACTIVE_SERVICE="platform-worker.service"
    ;;
esac

if [[ -z "${ACTIVE_SERVICE}" ]]; then
  echo "No active service found for ${COMPONENT}. File updated, but no restart performed." >&2
  echo "Restart manually with: systemctl restart platform-${COMPONENT}.service" >&2
  exit 0
fi

echo "Restarting ${ACTIVE_SERVICE}..."
systemctl restart "${ACTIVE_SERVICE}"
sleep 2
if systemctl is-active --quiet "${ACTIVE_SERVICE}"; then
  echo "${ACTIVE_SERVICE} is active."
else
  echo "WARNING: ${ACTIVE_SERVICE} is not active after restart. Check: journalctl -u ${ACTIVE_SERVICE} -n 50" >&2
  exit 1
fi

echo "Done. Backup kept at ${BACKUP_FILE}"
