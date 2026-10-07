#!/usr/bin/env bash
# One-shot Let's Encrypt cert provisioning for demo.clinwrite.ai +
# api.clinwrite.ai. Replaces the Cloudflare-origin-cert path assumed
# by bootstrap step 7 — see infra/standalone/BOOTSTRAP.md.
#
# Idempotent — safe to re-run. If a cert already covers both domains,
# the script no-ops with a note. certbot's own `certonly` is already
# idempotent (returns success + "Certificate not yet due for renewal"
# when the current cert is valid for >30 days).
#
# Flow:
#   1. If a usable cert already covers both domains, no-op.
#   2. Otherwise temporarily stop nginx (if running) so port 80 is free.
#   3. certbot certonly --standalone — brings its own HTTP:80 for the
#      ACME HTTP-01 challenge. Avoids the chicken-and-egg of requiring
#      nginx up before the cert exists (since platform.conf references
#      the Let's Encrypt paths).
#   4. Start nginx with the real cert now in place.
#   5. Install a renewal deploy-hook that reloads nginx when a renewed
#      cert replaces the old one. certbot.timer runs twice-daily.
#
# Called by:
#   - infra/standalone/scripts/deploy.sh (first-run cert check)
#   - operator manually: sudo /opt/platform/repo/infra/standalone/scripts/setup-letsencrypt.sh
#
# Required env (export before invoking or set in /opt/platform/env/):
#   LETSENCRYPT_EMAIL  — Let's Encrypt notification email (defaults to
#                        ops@clinwrite.ai; use a real monitored inbox in
#                        production so expiry warnings don't bitrot).

set -euo pipefail

log() { echo "[letsencrypt $(date +'%H:%M:%S')] $*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  echo "setup-letsencrypt.sh must run as root" >&2
  exit 1
fi

DOMAINS=(demo.clinwrite.ai api.clinwrite.ai)
PRIMARY="${DOMAINS[0]}"
EMAIL="${LETSENCRYPT_EMAIL:-ops@clinwrite.ai}"
CERT_DIR="/etc/letsencrypt/live/${PRIMARY}"

# ----------------------------------------------------------------------
# 1. Pre-flight — tools
# ----------------------------------------------------------------------
if ! command -v certbot >/dev/null 2>&1; then
  log "certbot not installed — bootstrap should have apt-installed it. Aborting."
  exit 1
fi

# ----------------------------------------------------------------------
# 2. Short-circuit if a cert already covers both domains with >30 days
#    left. certbot's own renewal check handles this, but checking here
#    skips the nginx stop/start dance on routine re-runs.
# ----------------------------------------------------------------------
if [[ -f "${CERT_DIR}/fullchain.pem" ]]; then
  if openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -checkend $((30*24*3600)) >/dev/null 2>&1; then
    # Also verify both domains are on the SAN list — if an operator ran
    # certbot earlier with only one -d, we need to --expand.
    san_output=$(openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null || true)
    missing=0
    for d in "${DOMAINS[@]}"; do
      grep -q "DNS:${d}" <<<"${san_output}" || missing=1
    done
    if [[ ${missing} -eq 0 ]]; then
      log "cert at ${CERT_DIR}/fullchain.pem already covers ${DOMAINS[*]} with >30d left — nothing to do"
      systemctl enable --now certbot.timer || true
      exit 0
    fi
    log "existing cert missing a SAN entry; running --expand"
  else
    log "existing cert expires within 30 days — renewing"
  fi
fi

# ----------------------------------------------------------------------
# 3. Issue (or expand) the cert. Standalone mode avoids the chicken-
#    and-egg of needing nginx up with a cert that doesn't exist yet.
#    certbot briefly binds :80 for the ACME HTTP-01 challenge.
# ----------------------------------------------------------------------
NGINX_WAS_UP=0
if systemctl is-active --quiet nginx; then
  NGINX_WAS_UP=1
  log "stopping nginx so certbot can bind :80 for the ACME challenge"
  systemctl stop nginx
fi

DOMAIN_ARGS=()
for d in "${DOMAINS[@]}"; do
  DOMAIN_ARGS+=(-d "$d")
done

# Decide whether we need --force-renewal.
#
# Problem observed in prod: when a lineage already exists (even with
# a stale/wrong domain set — e.g. covers demo.clinwrite.ai +
# demo.clinwriteai.com from a prior deploy's typo), certbot with
# --expand --keep-until-expiring short-circuits with "Certificate not
# yet due for renewal; no action taken" and never actually extends
# the SAN.
#
# Resolution: if the local SAN check above found a missing domain
# (we got past the short-circuit), force a re-issue so --expand's
# new domain set lands on disk. --force-renewal overrides the
# "not due for renewal" check. Note: Let's Encrypt rate-limits
# duplicate certs (5/week per domain set), so don't force-renew on
# routine redeploys — only when we KNOW the SAN is wrong.
FORCE_FLAG=()
if [[ -f "${CERT_DIR}/fullchain.pem" ]]; then
  san_check=$(openssl x509 -in "${CERT_DIR}/fullchain.pem" -noout -ext subjectAltName 2>/dev/null || true)
  for d in "${DOMAINS[@]}"; do
    if ! grep -q "DNS:${d}" <<<"${san_check}"; then
      log "forcing renewal — existing cert lineage missing DNS:${d}"
      FORCE_FLAG=(--force-renewal)
      break
    fi
  done
fi

# Pin the lineage name so certbot updates the existing cert in-place
# rather than creating a parallel demo.clinwrite.ai-0001 lineage that
# nginx wouldn't be pointing at.
log "running certbot certonly --standalone for: ${DOMAINS[*]}"
set +e
certbot certonly \
  --standalone \
  --cert-name "${PRIMARY}" \
  "${DOMAIN_ARGS[@]}" \
  --email "${EMAIL}" \
  --agree-tos --no-eff-email \
  --non-interactive \
  --expand \
  "${FORCE_FLAG[@]}"
certbot_rc=$?
set -e

# Always try to restart nginx even if certbot failed, so the site isn't
# left dark due to an issuance error.
if [[ ${NGINX_WAS_UP} -eq 1 ]]; then
  log "restarting nginx"
  systemctl start nginx || log "WARN: nginx failed to start — probably because the cert path doesn't exist yet. See /var/log/nginx/error.log."
fi

if [[ ${certbot_rc} -ne 0 ]]; then
  log "ERROR: certbot exited ${certbot_rc}. Check /var/log/letsencrypt/letsencrypt.log for details."
  exit ${certbot_rc}
fi

if [[ ! -f "${CERT_DIR}/fullchain.pem" ]]; then
  log "ERROR: cert file still missing at ${CERT_DIR}/fullchain.pem after certbot"
  exit 1
fi

# ----------------------------------------------------------------------
# 4. If nginx wasn't running (first boot), start it now that the cert
#    paths it references actually exist.
# ----------------------------------------------------------------------
if [[ ${NGINX_WAS_UP} -eq 0 ]] && ! systemctl is-active --quiet nginx; then
  log "nginx wasn't running — starting it with the new cert"
  systemctl start nginx
fi

log "nginx -t"
nginx -t

log "reloading nginx"
systemctl reload nginx

# ----------------------------------------------------------------------
# 5. Auto-renewal. certbot.timer ships with the certbot apt package
#    and does a twice-daily `certbot renew`. Deploy hook reloads nginx
#    only when a cert actually changed.
# ----------------------------------------------------------------------
systemctl enable --now certbot.timer

mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/usr/bin/env bash
# Fired by certbot after a successful renewal. Reloads nginx so it
# picks up the new cert without a restart.
systemctl reload nginx
HOOK
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

log "✓ Let's Encrypt cert installed, covers: ${DOMAINS[*]}"
log "  cert path:  ${CERT_DIR}/fullchain.pem"
log "  key path:   ${CERT_DIR}/privkey.pem"
log "  renewal:    certbot.timer (twice-daily); reload hook installed"
