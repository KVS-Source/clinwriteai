#!/usr/bin/env bash
# Decrypts /opt/platform/env/<component>.env.enc into /run/platform/<component>.env
# so systemd EnvironmentFile= can read plaintext without it ever hitting disk
# outside tmpfs.
#
# Called as ExecStartPre by platform-api.service and platform-worker.service.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <component>  (e.g. api, worker)" >&2
  exit 2
fi

COMPONENT="$1"
ENC_FILE="/opt/platform/env/${COMPONENT}.env.enc"
OUT_FILE="/run/platform/${COMPONENT}.env"

if [[ ! -f "${ENC_FILE}" ]]; then
  echo "Encrypted env file not found: ${ENC_FILE}" >&2
  exit 1
fi

# Ensure /run/platform is a tmpfs (bootstrap.sh mounts it)
if ! mountpoint -q /run/platform; then
  mount -t tmpfs -o size=4M,mode=0700,uid=platform,gid=platform tmpfs /run/platform
fi

export SOPS_AGE_KEY_FILE="/etc/platform/age.key"
sops --decrypt "${ENC_FILE}" > "${OUT_FILE}"
chmod 0400 "${OUT_FILE}"
chown platform:platform "${OUT_FILE}"
