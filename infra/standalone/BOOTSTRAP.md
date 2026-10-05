# VPS Bootstrap Runbook

First-time provisioning of a new Ubuntu 24.04 VPS for the platform. Run this once per environment (dev / staging / prod).

**Estimated time**: 90 minutes end-to-end.

## Prerequisites

- An Ubuntu 24.04 LTS VPS (Hetzner Cloud CPX31 recommended for staging/prod, CPX21 for dev)
- Root SSH access
- A domain name configured in Cloudflare pointing at the VPS IP (DNS A record)
- A Cloudflare origin cert generated for the domain
- A Backblaze B2 bucket + application key with write access
- An age key pair (public recipient added to `sops/.sops.yaml`, private key available)

## Steps

### 1. Initial SSH + user setup (10 min)

```bash
# From your workstation
ssh root@<vps-ip>

# On the VPS
# Change root password; disable root SSH login after platform user is set up
passwd root

# Install the bootstrap script's prerequisites manually (it will do the full thing)
apt-get update && apt-get install -y curl git
```

### 2. Run bootstrap (20 min)

```bash
# On the VPS
curl -fsSL https://raw.githubusercontent.com/KVS-Source/clinwriteai/main/infra/standalone/scripts/bootstrap.sh | bash
```

This installs Docker + Node 20 + nginx + sops + age + rclone, creates the `platform` service user, sets up firewall + fail2ban, and clones the repo into `/opt/platform/repo`.

### 3. Install the age key (5 min)

```bash
# Install the service age private key
# (DevOps obtains from the password manager; copies via secure channel)
install -m 0400 -o root -g root /tmp/age.key /etc/platform/age.key
rm -f /tmp/age.key
```

### 4. Create .env + .env.enc files (15 min)

Low-sensitivity config in plaintext:

```bash
sudo -u platform cp /opt/platform/repo/infra/standalone/.env.example /opt/platform/env/.env
# Edit /opt/platform/env/.env — set non-secret values
```

High-sensitivity secrets, sops-encrypted:

```bash
# For the API
sudo -u platform cp /opt/platform/repo/apps/api/.env.example /tmp/api.env
# Edit /tmp/api.env — fill in real values (DB password, JWT secret, API keys)
export SOPS_AGE_KEY_FILE=/etc/platform/age.key
sops --encrypt /tmp/api.env > /opt/platform/env/api.env.enc
rm -f /tmp/api.env
chown platform:platform /opt/platform/env/api.env.enc
chmod 0400 /opt/platform/env/api.env.enc

# Repeat for the worker
```

### 5. Install nginx config (10 min)

```bash
# Install Cloudflare origin cert
mkdir -p /etc/ssl/cloudflare
install -m 0644 /tmp/origin.pem /etc/ssl/cloudflare/origin.pem
install -m 0400 /tmp/origin.key /etc/ssl/cloudflare/origin.key

# Install nginx config
cp /opt/platform/repo/infra/standalone/nginx/snippets/*.conf /etc/nginx/snippets/
cp /opt/platform/repo/infra/standalone/nginx/platform.conf /etc/nginx/sites-available/platform
ln -s /etc/nginx/sites-available/platform /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 6. Install systemd units (5 min)

```bash
cp /opt/platform/repo/infra/standalone/systemd/platform-*.service /etc/systemd/system/
cp /opt/platform/repo/infra/standalone/systemd/platform-*.timer /etc/systemd/system/

# Create a target that depends on the Compose data services
cat > /etc/systemd/system/platform-data.target <<EOF
[Unit]
Description=Platform data services (Postgres, Redis, MinIO)

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now platform-data.target
```

### 7. Start data services (10 min)

```bash
cd /opt/platform/repo
set -a; . /opt/platform/env/.env; set +a
docker compose -f infra/standalone/docker-compose.yml up -d
docker compose -f infra/standalone/docker-compose.yml ps
```

Verify all services are `healthy`. If any aren't, check `docker compose logs <service>`.

### 8. Initial build + deploy (10 min)

```bash
# From the VPS
sudo -u platform /opt/platform/repo/infra/standalone/scripts/deploy.sh
```

Verify:
```bash
curl -fsS http://127.0.0.1:3001/health   # should return JSON with "ok"
curl -fsS https://api.staging.clinwrite.ai/health   # should return the same via nginx+Cloudflare
```

### 9. Enable backups (5 min)

```bash
# Configure rclone with B2 credentials
sudo -u platform rclone config
# Add a remote named 'b2' with your Backblaze credentials

# Enable the backup timer
systemctl enable --now platform-backup.timer
systemctl list-timers platform-backup

# Trigger first backup manually to verify
systemctl start platform-backup.service
journalctl -u platform-backup -f
```

### 10. Smoke test (5 min)

- Hit the health endpoint from your workstation
- Check Grafana at `http://<vps-ip>:3030` (via SSH tunnel) — admin password from `/opt/platform/env/.env`
- Verify a request lands in Loki (via Grafana → Explore)
- Verify Prometheus is scraping (via Grafana → Explore → Prometheus datasource)

### 11. Schedule monthly restore drill

```bash
# Add to the platform user's crontab
sudo -u platform crontab -e
# Add: 0 3 1 * * /opt/platform/scripts/restore.sh --drill
```

## Done

The VPS is now serving the platform. Future deploys go through the GitHub Actions `deploy-standalone` job (SSH into the VPS, invoke `scripts/deploy.sh`).

## Troubleshooting

- **nginx won't start**: `nginx -t` for config errors; check cert paths exist with correct permissions.
- **Docker Compose services not starting**: `docker compose logs <service>`; usually bad env values.
- **API won't boot**: `journalctl -u platform-api -f`; usually a missing env var or Postgres connection failure.
- **Backup fails**: `journalctl -u platform-backup`; usually bad rclone config or B2 credentials.
