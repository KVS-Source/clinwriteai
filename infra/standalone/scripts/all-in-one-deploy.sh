#!/usr/bin/env bash
# All-in-one deploy. Fetches latest main, runs bootstrap (idempotent),
# runs deploy (idempotent), issues/expands the LE cert, restarts
# systemd, verifies both endpoints. Prints a clear PASS/FAIL at the
# end so you know whether to paste output back to me.
#
# One copy-paste on the VPS:
#   curl -fsSL https://raw.githubusercontent.com/KVS-Source/clinwriteai/main/infra/standalone/scripts/all-in-one-deploy.sh | sudo bash

set -uo pipefail
log() { echo "[all-in-one $(date +'%H:%M:%S')] $*"; }
fail() { echo; echo "✗ FAIL: $*"; echo; exit 1; }

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root (sudo bash)"; exit 1
fi

STEP=0
step() { STEP=$((STEP+1)); echo; echo "══════════════════════════════════════════════════════════════"; echo "STEP ${STEP}: $*"; echo "══════════════════════════════════════════════════════════════"; }

step "Bootstrap (installs prereqs, clones repo, creates env, nginx + systemd configs)"
curl -fsSL https://raw.githubusercontent.com/KVS-Source/clinwriteai/main/infra/standalone/scripts/first-run-bootstrap.sh \
  -o /tmp/bootstrap.sh
bash /tmp/bootstrap.sh || fail "bootstrap failed"
rm -f /tmp/bootstrap.sh

step "Deploy (git pull → npm ci → prisma generate → build → migrate → seed → restart)"
/opt/platform/repo/infra/standalone/scripts/deploy.sh || {
  echo
  log "deploy.sh exited non-zero — collecting diagnostics:"
  echo "--- systemd platform-api status ---"
  systemctl status platform-api --no-pager --lines=20 2>&1 | head -30
  echo "--- last 50 lines of API journal ---"
  journalctl -u platform-api --no-pager -n 50 2>&1 | tail -50
  echo "--- docker compose ps ---"
  cd /opt/platform/repo && docker compose -f infra/standalone/docker-compose.yml ps 2>&1 | head -10
  fail "deploy.sh failed — see diagnostics above"
}

step "Verify local API health"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/health || true)
  if [[ "$code" == "200" ]]; then
    log "✓ local API /health returns 200"
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "--- last 50 lines of API journal ---"
    journalctl -u platform-api --no-pager -n 50 | tail -50
    fail "local API /health never returned 200 (last code: $code)"
  fi
  sleep 2
done

step "Verify public URLs (through nginx + Let's Encrypt)"
sleep 2
demo_code=$(curl -sk -o /dev/null -w '%{http_code}' https://demo.clinwrite.ai/ --max-time 15)
api_code=$(curl -sk -o /dev/null -w '%{http_code}' https://api.clinwrite.ai/health --max-time 15)
log "demo.clinwrite.ai/ → ${demo_code}"
log "api.clinwrite.ai/health → ${api_code}"

step "Verify TLS cert covers both hostnames"
cert_sans=$(echo | openssl s_client -servername api.clinwrite.ai -connect api.clinwrite.ai:443 2>/dev/null \
  | openssl x509 -noout -ext subjectAltName 2>/dev/null | tr -d ' ' | tr ',' '\n')
echo "${cert_sans}"
if echo "${cert_sans}" | grep -q "DNS:api.clinwrite.ai"; then
  log "✓ cert covers api.clinwrite.ai"
else
  log "⚠ cert does NOT cover api.clinwrite.ai yet"
fi

step "FINAL STATUS"
if [[ "${demo_code}" == "200" && "${api_code}" == "200" ]]; then
  echo "✓ ✓ ✓  DEPLOY SUCCESSFUL  ✓ ✓ ✓"
  echo
  echo "  demo:  https://demo.clinwrite.ai/"
  echo "  api:   https://api.clinwrite.ai/health"
  echo
  echo "Try signing in with:"
  echo "  admin@clinwrite.ai    (platform admin, cross-tenant)"
  echo "  writer@clinwrite.ai   (Acme Oncology, writer)"
  echo "  reviewer@clinwrite.ai (Acme Oncology, reviewer)"
  echo "  Password doesn't matter (VITE_BYPASS_AUTH=true for the demo)"
else
  echo "⚠ Deploy script completed but endpoints aren't 200 yet."
  echo "  demo: ${demo_code} (want 200)"
  echo "  api:  ${api_code} (want 200)"
  echo
  echo "Likely one of:"
  echo "  - cert expansion to api.clinwrite.ai still pending (certbot HTTP-01 needs port 80 reachable from LE)"
  echo "  - nginx server_name conflict with another site on this VPS"
  echo "  - systemd platform-api starting but not binding :3001"
  echo
  echo "Paste the following to me:"
  echo "  journalctl -u platform-api --no-pager -n 100 | tail -100"
  echo "  nginx -T 2>/dev/null | grep -A 2 'server_name.*clinwrite'"
  echo "  curl -skI https://api.clinwrite.ai/health"
fi
