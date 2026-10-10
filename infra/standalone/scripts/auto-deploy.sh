#!/usr/bin/env bash
# platform-scheduled-deploy — timer-triggered deploy of the ClinWrite
# platform (apps/api + apps/worker + apps/web).
#
# Mirrors /usr/local/bin/genrac-scheduled-deploy's shape:
#   - flock guard so overlapping ticks don't collide
#   - skip deploy when HEAD hasn't moved (no wasted npm ci + build)
#   - full stdout+stderr -> /var/log/platform/deploy-<UTC>.log
#   - on failure, email ops via NOTIFICATION_SMTP_* in /opt/platform/env/api.env
#   - retention: prune deploy logs older than 30 days
#
# Invoked by /etc/systemd/system/platform-deploy.timer. For on-demand
# deploys, call /opt/platform/repo/infra/standalone/scripts/deploy.sh
# directly.
#
# Install path on VPS: /opt/platform/scripts/auto-deploy.sh
# Installed by first-run-bootstrap.sh under section G.
#
# Required env in /opt/platform/env/api.env for the failure-email path:
#   NOTIFICATION_SMTP_HOST, NOTIFICATION_SMTP_PORT, NOTIFICATION_SMTP_USER,
#   NOTIFICATION_SMTP_PASSWORD, NOTIFICATION_FROM_ADDRESS, NOTIFICATION_FROM_NAME

set -uo pipefail

REPO=/opt/platform/repo
LOG_DIR=/var/log/platform
LOCKFILE=/var/lock/platform-scheduled-deploy.lock
ENV_FILE=/opt/platform/env/api.env
DEPLOY_SCRIPT=/opt/platform/repo/infra/standalone/scripts/deploy.sh
RECIPIENTS='chetan@genbioca.com,prajakta@genbioca.com,dev@genbioca.com'

mkdir -p "$LOG_DIR"
TS=$(date -u +%Y%m%d-%H%M%SZ)
LOG="$LOG_DIR/deploy-$TS.log"
exec > "$LOG" 2>&1

echo "==> platform-scheduled-deploy start at $(date +%FT%T%z)"

# Retention: prune deploy logs older than 30 days
find "$LOG_DIR" -maxdepth 1 -name 'deploy-*.log' -mtime +30 -delete 2>/dev/null || true

# Concurrency guard
exec 200>"$LOCKFILE"
if ! flock -n 200; then
  echo 'Another scheduled deploy is already running — exiting cleanly.'
  exit 0
fi

cd "$REPO"

# Skip if HEAD hasn't moved (avoid wasted rebuilds + restarts)
OLD_SHA=$(sudo -u platform git rev-parse HEAD)
sudo -u platform git fetch origin main --quiet
NEW_SHA=$(sudo -u platform git rev-parse origin/main)
if [ "$OLD_SHA" = "$NEW_SHA" ]; then
  echo "No new commits on origin/main ($OLD_SHA) — nothing to deploy."
  exit 0
fi
echo "HEAD change detected: $OLD_SHA -> $NEW_SHA — proceeding with deploy."

# Run the canonical deploy
DEPLOY_RC=0
bash "$DEPLOY_SCRIPT" || DEPLOY_RC=$?

if [ $DEPLOY_RC -eq 0 ]; then
  echo "==> deploy OK at $(date +%FT%T%z)"
  exit 0
fi

# Deploy failed — email ops via .env SMTP
echo "==> deploy FAILED (rc=$DEPLOY_RC) at $(date +%FT%T%z). Sending email."

set -a
# shellcheck disable=SC1090
source <(grep -E '^NOTIFICATION_(SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASSWORD|FROM_ADDRESS|FROM_NAME)' "$ENV_FILE")
set +a

RECIPIENTS_ENV="$RECIPIENTS" LOG_PATH="$LOG" DEPLOY_RC_ENV="$DEPLOY_RC" python3 <<'PYEOF'
import os, ssl, smtplib, socket
from email.message import EmailMessage
from email.utils import formatdate

host = os.environ.get('NOTIFICATION_SMTP_HOST', '')
port = int(os.environ.get('NOTIFICATION_SMTP_PORT', '465'))
user = os.environ.get('NOTIFICATION_SMTP_USER', '')
password = os.environ.get('NOTIFICATION_SMTP_PASSWORD', '')
from_addr = os.environ.get('NOTIFICATION_FROM_ADDRESS', user)
recipients = [r.strip() for r in os.environ['RECIPIENTS_ENV'].split(',') if r.strip()]
log_path = os.environ['LOG_PATH']
rc = os.environ['DEPLOY_RC_ENV']

try:
    with open(log_path) as f:
        log_tail = ''.join(f.readlines()[-100:])
except Exception as e:
    log_tail = f'(could not read log: {e})'

msg = EmailMessage()
msg['Subject'] = '[ClinWrite] Scheduled deploy FAILED on demo.clinwrite.ai'
msg['From'] = from_addr
msg['To'] = ', '.join(recipients)
msg['Date'] = formatdate(localtime=True)
msg.set_content(f'''The scheduled deploy on demo.clinwrite.ai failed.

Host: {socket.gethostname()}
Log:  {log_path}
Exit: {rc}

Last 100 lines of the log:
---------------------------------------------
{log_tail}
---------------------------------------------

Sent by /opt/platform/scripts/auto-deploy.sh
Timer status:  systemctl status platform-deploy.timer
Full logs:     ls -la /var/log/platform/
''')

try:
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL(host, port, context=ctx, timeout=30) as s:
        s.login(user, password)
        s.send_message(msg)
    print(f'Email sent to {recipients}')
except Exception as e:
    print(f'Email FAILED: {e}')
PYEOF

exit $DEPLOY_RC
