#!/usr/bin/env bash
# Blue/green QA integration test — Arc 12.9 of docs/pivot-plan.md.
#
# Exercises the deploy-bluegreen.sh flip under load to catch any 5xx
# during the cutover window. Run on a QA environment; the real prod
# gate pairs this with the live-API smoke suite.
#
# Flow:
#   1. Start a background curl loop hitting /health every 100ms, log codes.
#   2. Trigger deploy-bluegreen.sh to flip to the inactive colour.
#   3. Stop the loop + grep for non-200 responses.
#   4. Exit 0 iff zero 5xx + at most N transient non-200s (default 0).
#
# Env:
#   API_URL          — defaults to http://127.0.0.1:3011/health
#   DURATION_SEC     — total probe window; defaults to 60
#   MAX_NON_200      — accept this many non-200 (not 5xx) during the flip
#                      (defaults 0; sometimes nginx briefly returns 502
#                      during config reload, raise to tolerate)
#   DEPLOY_SCRIPT    — path to the bluegreen deploy script
#
# Exit codes: 0 PASS, 1 FAIL (any 5xx), 2 setup error.

set -uo pipefail

API_URL="${API_URL:-http://127.0.0.1:3011/health}"
DURATION_SEC="${DURATION_SEC:-60}"
MAX_NON_200="${MAX_NON_200:-0}"
DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-/opt/platform/repo/infra/standalone/scripts/deploy-bluegreen.sh}"

log() { echo "[bluegreen-smoke $(date +'%H:%M:%S')] $*"; }

if [[ ! -x "${DEPLOY_SCRIPT}" ]]; then
  log "FAIL: ${DEPLOY_SCRIPT} not executable"
  exit 2
fi

LOG_FILE=$(mktemp /tmp/bluegreen-smoke.XXXXXX.log)
trap 'rm -f "${LOG_FILE}"' EXIT

log "probing ${API_URL} every 100ms for ${DURATION_SEC}s"
(
  end=$(( SECONDS + DURATION_SEC ))
  while (( SECONDS < end )); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "${API_URL}" || echo "000")
    echo "$(date +%s.%N) ${code}" >> "${LOG_FILE}"
    sleep 0.1
  done
) &
PROBE_PID=$!

# Give the probe a 2s head start to establish baseline.
sleep 2

log "triggering ${DEPLOY_SCRIPT}"
"${DEPLOY_SCRIPT}" > /tmp/bluegreen-deploy.log 2>&1
DEPLOY_RC=$?
log "deploy-bluegreen.sh exited ${DEPLOY_RC}"

# Wait for the probe window to close.
wait "${PROBE_PID}"

# Analyse the log.
TOTAL=$(wc -l < "${LOG_FILE}")
NON_200=$(awk '$2 != "200"' "${LOG_FILE}" | wc -l)
FIVEXX=$(awk '$2 ~ /^5/' "${LOG_FILE}" | wc -l)

log "requests=${TOTAL} non_200=${NON_200} 5xx=${FIVEXX}"
log "sample of non-200 responses:"
awk '$2 != "200"' "${LOG_FILE}" | head -5

if [[ "${FIVEXX}" -gt 0 ]]; then
  log "FAIL: ${FIVEXX} five-xx responses during flip window"
  exit 1
fi
if [[ "${NON_200}" -gt "${MAX_NON_200}" ]]; then
  log "FAIL: ${NON_200} non-200 responses (threshold MAX_NON_200=${MAX_NON_200})"
  exit 1
fi
if [[ "${DEPLOY_RC}" -ne 0 ]]; then
  log "FAIL: deploy script exited ${DEPLOY_RC}"
  exit 1
fi
log "PASS"
exit 0
