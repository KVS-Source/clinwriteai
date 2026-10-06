#!/usr/bin/env bash
# First-time bootstrap for a fresh Ubuntu 24.04 VPS.
# Idempotent — safe to re-run.
#
# Usage (on the VPS, as root):
#   curl -fsSL https://raw.githubusercontent.com/KVS-Source/clinwriteai/main/infra/standalone/scripts/bootstrap.sh | bash
#
# Or (preferred): clone the repo first, then run from /opt/platform.

set -euo pipefail

log() { echo "[$(date +'%H:%M:%S')] $*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  echo "bootstrap.sh must run as root" >&2
  exit 1
fi

log "== Platform VPS bootstrap =="
log "OS: $(lsb_release -ds)"

# ---------- Base system ----------
log "Updating apt + installing base packages"
apt-get update
apt-get upgrade -y
apt-get install -y \
  curl ca-certificates gnupg lsb-release \
  nginx certbot python3-certbot-nginx \
  ufw fail2ban unattended-upgrades \
  jq rclone age \
  git make build-essential \
  auditd

# ---------- Node.js 20 LTS ----------
if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js 20 LTS via NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
log "Node: $(node --version)  npm: $(npm --version)"

# ---------- Docker + Compose plugin ----------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker CE"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
log "Docker: $(docker --version)"

# ---------- sops ----------
if ! command -v sops >/dev/null 2>&1; then
  log "Installing sops"
  SOPS_VERSION="3.9.0"
  curl -fsSL -o /tmp/sops "https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/sops-v${SOPS_VERSION}.linux.amd64"
  install -m 0755 /tmp/sops /usr/local/bin/sops
fi
log "sops: $(sops --version | head -1)"

# ---------- Platform service user ----------
if ! id -u platform >/dev/null 2>&1; then
  log "Creating platform service user"
  useradd --system --home /opt/platform --shell /usr/sbin/nologin platform
fi
usermod -aG docker platform

# ---------- Platform directory layout ----------
log "Creating /opt/platform/* and /var/log/platform"
mkdir -p \
  /opt/platform/apps \
  /opt/platform/env \
  /opt/platform/data/{postgres,redis,minio,prometheus,grafana,loki} \
  /opt/platform/scripts \
  /etc/platform \
  /var/log/platform \
  /var/backups/platform \
  /run/platform

chown -R platform:platform /opt/platform /var/log/platform /var/backups/platform /run/platform
chmod 0750 /etc/platform

# ---------- Firewall ----------
log "Configuring UFW"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment "SSH"
ufw allow 80/tcp comment "HTTP (certbot ACME)"
ufw allow 443/tcp comment "HTTPS"
ufw --force enable

# ---------- Unattended security upgrades ----------
log "Enabling unattended-upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades

# ---------- fail2ban ----------
log "Enabling fail2ban"
systemctl enable --now fail2ban

# ---------- Clone the repo ----------
if [[ ! -d /opt/platform/repo ]]; then
  log "Cloning repo into /opt/platform/repo"
  sudo -u platform git clone https://github.com/KVS-Source/clinwriteai.git /opt/platform/repo
fi

log ""
log "== Bootstrap complete =="
log ""
log "Next steps:"
log "  1. Generate an age key:  sudo -u platform age-keygen -o /etc/platform/age.key && chmod 0400 /etc/platform/age.key"
log "  2. Register the age public key in infra/standalone/sops/.sops.yaml and commit"
log "  3. Create sops-encrypted .env.enc files under /opt/platform/env/"
log "  4. Create unencrypted .env for low-sensitivity config under /opt/platform/env/"
log "  5. Install nginx configs:  cp /opt/platform/repo/infra/standalone/nginx/* /etc/nginx/sites-available/ && ln -s ..."
log "  6. Install systemd units:  cp /opt/platform/repo/infra/standalone/systemd/* /etc/systemd/system/ && systemctl daemon-reload"
log "  7. Issue Let's Encrypt certs:  sudo /opt/platform/repo/infra/standalone/scripts/setup-letsencrypt.sh"
log "     (deploy.sh will auto-run this on first deploy if the cert is missing)"
log "  8. Start data services:  cd /opt/platform/repo && docker compose -f infra/standalone/docker-compose.yml up -d"
log "  9. See infra/standalone/BOOTSTRAP.md for full walkthrough"
