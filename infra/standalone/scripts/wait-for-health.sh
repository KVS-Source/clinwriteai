#!/usr/bin/env bash
# Poll a health URL until it returns 200, or fail after timeout seconds.
# Used by systemd ExecStartPost to gate service "started" state on real readiness.
#
# Usage: wait-for-health.sh <url> <timeout_seconds>

set -euo pipefail

URL="${1:?URL required}"
TIMEOUT="${2:-60}"

for ((i=0; i<TIMEOUT; i++)); do
  if curl -fsS "${URL}" >/dev/null 2>&1; then
    echo "healthy after ${i}s"
    exit 0
  fi
  sleep 1
done

echo "unhealthy after ${TIMEOUT}s" >&2
exit 1
