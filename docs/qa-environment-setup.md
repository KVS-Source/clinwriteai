# QA environment — single-server setup runbook

**One hosted VPS**, Postgres + Redis + MinIO + API + worker + web app all on it. QA accesses the app at `https://qa.clinwrite.ai` and the API at `https://qa-api.clinwrite.ai`.

**Target audience**: DevOps / tech lead running this once. Takes ~90 minutes end-to-end.

**Reference ADRs**: [ADR 0007](adr/0007-deployment-target.md), [ADR 0009](adr/0009-standalone-deployment-stack.md).

---

## Prerequisites

Before SSH'ing anywhere, have these ready:

| Item | Where | Notes |
|---|---|---|
| Ubuntu 24.04 LTS VPS | Hetzner Cloud CPX31 recommended (€15/mo) | 4 vCPU / 16 GB / 240 GB NVMe |
| Root SSH access | Provider dashboard | Your SSH public key added at provision time |
| Domain configured | Cloudflare | Two DNS A records: `qa.clinwrite.ai` and `qa-api.clinwrite.ai` → VPS IP, both proxied |
| Cloudflare origin cert | Cloudflare → SSL/TLS → Origin Server | 15-year cert covering `*.clinwrite.ai`; save the PEM + KEY |
| age key pair | Generated on your workstation | `age-keygen -o ~/qa-age.key` ; keep private, note the public recipient |
| Backblaze B2 bucket | B2 dashboard | 1 bucket named `platform-qa-backups` + application key with write access |
| Anthropic API key | console.anthropic.com | For Phase 3 AI features; QA can use test tier |
| WorkOS account | workos.com | Create a project; QA env; grab API key + client ID |

If any of these aren't ready, do the next section first.

---

## Step 1 — Provision + initial SSH (10 min)

**From the Hetzner dashboard**:

- Project: create or pick existing
- Server → Add
  - Location: Falkenstein (DE) or Ashburn (US) depending on QA team location
  - Image: Ubuntu 24.04
  - Type: Shared vCPU · CPX31
  - SSH key: your workstation's public key
  - Firewall: block everything except 22, 80, 443
  - Name: `qa-aurora-01`
- Create

Note the public IP. Then:

```bash
ssh root@<vps-ip>

# On the VPS
passwd root            # set a strong root password (write it in your password manager)
apt-get update && apt-get install -y curl git
```

---

## Step 2 — DNS + Cloudflare (10 min)

In Cloudflare dashboard for `clinwrite.ai`:

- DNS → add two **proxied** A records:
  - `qa` → `<vps-ip>`
  - `qa-api` → `<vps-ip>`
- SSL/TLS → Overview → set to **Full (strict)**
- SSL/TLS → Origin Server → **Create Certificate** for `*.clinwrite.ai`, 15 years; save PEM + KEY
- Security → WAF → enable the "Cloudflare Managed Ruleset" (free tier)
- Security → Rate limiting → add a rule: `(http.request.uri.path contains "/kol-review/")` → 50 req/5 min per IP

Verify DNS resolves:
```bash
# From your workstation
dig +short qa.clinwrite.ai      # should return a Cloudflare IP, not your VPS IP (proxied)
dig +short qa-api.clinwrite.ai  # same
```

---

## Step 3 — Run bootstrap on the VPS (20 min)

```bash
# On the VPS, as root
curl -fsSL https://raw.githubusercontent.com/KVS-Source/clinwriteai/main/infra/standalone/scripts/bootstrap.sh | bash
```

This installs Docker, Node 20, nginx, sops, age, rclone, certbot, fail2ban, UFW. Creates `platform` service user. Clones the repo into `/opt/platform/repo`. Takes ~15 min on a fresh VPS.

**At the end you'll see "== Bootstrap complete ==" with 9 next-step prompts. Follow them (or follow Steps 4–8 below which cover the same ground with QA-specific values).**

---

## Step 4 — Install the age key (5 min)

```bash
# On your workstation
scp ~/qa-age.key root@<vps-ip>:/tmp/age.key

# On the VPS
install -m 0400 -o root -g root /tmp/age.key /etc/platform/age.key
rm -f /tmp/age.key
```

Register the public recipient (printed by `age-keygen` earlier) in `infra/standalone/sops/.sops.yaml`:

```bash
cd /opt/platform/repo
sudo -u platform nano infra/standalone/sops/.sops.yaml
# Replace the placeholder `age1xxxxxx...` line with your actual public recipient
# Commit this change locally (we don't push from the VPS normally, but the file must match)
```

---

## Step 5 — Create .env + .env.enc files (15 min)

```bash
# On the VPS

# Low-sensitivity .env (goes to /opt/platform/env/.env, plaintext)
sudo -u platform cp /opt/platform/repo/infra/standalone/.env.example /opt/platform/env/.env
sudo -u platform nano /opt/platform/env/.env
# Set:
#   POSTGRES_USER=platform
#   POSTGRES_PASSWORD=<generate: openssl rand -base64 32 | tr -d '/+=' | head -c 32>
#   POSTGRES_DB=platform_qa
#   REDIS_PASSWORD=<another generated password>
#   MINIO_ROOT_USER=platform-qa
#   MINIO_ROOT_PASSWORD=<another generated password>
#   GRAFANA_ADMIN_PASSWORD=<another generated password>

# High-sensitivity API secrets (sops-encrypted)
sudo -u platform cp /opt/platform/repo/apps/api/.env.example /tmp/api.env
sudo -u platform nano /tmp/api.env
# Fill in:
#   NODE_ENV=production
#   DATABASE_URL=postgresql://platform:<same POSTGRES_PASSWORD as above>@127.0.0.1:5432/platform_qa?schema=public
#   SECRETS_PROVIDER=sops
#   SOPS_AGE_KEY_FILE=/etc/platform/age.key
#   REDIS_URL=redis://:<same REDIS_PASSWORD>@127.0.0.1:6379
#   JWT_SECRET=<openssl rand -base64 32>
#   AUDIT_HASH_SECRET=<openssl rand -base64 32>   # NEVER rotate this
#   ANTHROPIC_API_KEY=<from console.anthropic.com>
#   WORKOS_API_KEY=<from workos.com>
#   WORKOS_CLIENT_ID=<from workos.com>
#   S3_ENDPOINT=http://127.0.0.1:9000
#   S3_ACCESS_KEY_ID=<same MINIO_ROOT_USER>
#   S3_SECRET_ACCESS_KEY=<same MINIO_ROOT_PASSWORD>
#   CORS_ORIGIN=https://qa.clinwrite.ai

export SOPS_AGE_KEY_FILE=/etc/platform/age.key
sudo -E -u platform sops --encrypt /tmp/api.env > /opt/platform/env/api.env.enc
rm -f /tmp/api.env

# Repeat for worker.env.enc (same content; both services read the same vars)
sudo -u platform cp /opt/platform/env/api.env.enc /opt/platform/env/worker.env.enc

chown platform:platform /opt/platform/env/*.env.enc
chmod 0400 /opt/platform/env/*.env.enc
```

---

## Step 6 — Install nginx config + Cloudflare cert (10 min)

```bash
# On the VPS

# Install Cloudflare origin cert
mkdir -p /etc/ssl/cloudflare
# (upload origin.pem and origin.key from Cloudflare → via scp from your workstation)
install -m 0644 /tmp/origin.pem /etc/ssl/cloudflare/origin.pem
install -m 0400 /tmp/origin.key /etc/ssl/cloudflare/origin.key
rm -f /tmp/origin.pem /tmp/origin.key

# Install nginx snippets
cp /opt/platform/repo/infra/standalone/nginx/snippets/security-headers.conf /etc/nginx/snippets/platform-security-headers.conf
cp /opt/platform/repo/infra/standalone/nginx/snippets/cloudflare-allowlist.conf /etc/nginx/snippets/platform-cloudflare-allowlist.conf
cp /opt/platform/repo/infra/standalone/nginx/snippets/proxy-headers.conf /etc/nginx/snippets/platform-proxy-headers.conf

# Install the QA-flavoured platform.conf
cp /opt/platform/repo/infra/standalone/nginx/platform.conf /etc/nginx/sites-available/platform
# Edit to replace `staging.clinwrite.ai` with `qa.clinwrite.ai`
sed -i 's/staging\.clinwrite\.ai/qa.clinwrite.ai/g' /etc/nginx/sites-available/platform

# Add rate-limit zones to nginx.conf http{} block
cat >> /etc/nginx/conf.d/platform-rate-limits.conf <<'EOF'
limit_req_zone $binary_remote_addr zone=kol_review:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=auth:10m rate=20r/m;
EOF

# Enable
ln -sf /etc/nginx/sites-available/platform /etc/nginx/sites-enabled/platform
# Remove the default site that ships with Ubuntu nginx
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
```

---

## Step 7 — Install systemd units + data services (10 min)

```bash
# On the VPS

# systemd target that groups the data services (so platform-api can "Requires=" it)
cat > /etc/systemd/system/platform-data.target <<'EOF'
[Unit]
Description=Platform data services (Postgres, Redis, MinIO)
After=docker.service
Requires=docker.service

[Install]
WantedBy=multi-user.target
EOF

# API + worker + backup units
cp /opt/platform/repo/infra/standalone/systemd/*.service /etc/systemd/system/
cp /opt/platform/repo/infra/standalone/systemd/*.timer   /etc/systemd/system/

systemctl daemon-reload
systemctl enable platform-data.target
systemctl enable platform-api.service
systemctl enable platform-worker.service
systemctl enable platform-backup.timer

# Start the data services (Docker Compose)
cd /opt/platform/repo
set -a; . /opt/platform/env/.env; set +a
docker compose -f infra/standalone/docker-compose.yml up -d

# Wait for health
sleep 10
docker compose -f infra/standalone/docker-compose.yml ps
# All services should show "healthy" or "running"
```

---

## Step 8 — First deploy (10 min)

```bash
# On the VPS, as root
sudo /opt/platform/repo/infra/standalone/scripts/deploy.sh
```

This:
1. `git pull` latest `main`
2. `npm ci` + build for `apps/api` + `apps/worker` + `apps/web`
3. rsync build artefacts to `/opt/platform/apps/`
4. rsync web dist to `/var/www/platform/dist/`
5. `prisma migrate deploy` creates all tables + the audit trail
6. `systemctl restart platform-api platform-worker`
7. Health gate: wait for `/health` to return 200

Verify:

```bash
curl -fsS http://127.0.0.1:3001/health | jq
# Should return: {"status":"ok","service":"platform-api","phase":"Phase 1 scaffold",...}

curl -fsS https://qa-api.clinwrite.ai/health | jq
# Same, via Cloudflare

curl -I https://qa.clinwrite.ai/
# Should return HTTP/2 200 (nginx serving the SPA)
```

---

## Step 9 — Configure Backblaze B2 + enable backups (10 min)

```bash
# On the VPS, as the platform user
sudo -u platform -i
rclone config
# Add a remote named 'b2' with your Backblaze application key
# Test: rclone lsd b2:
exit

# Start the backup timer
systemctl start platform-backup.timer
systemctl list-timers platform-backup   # confirm it's armed

# Trigger first backup immediately to verify
systemctl start platform-backup.service
journalctl -u platform-backup -f
# Watch for "Backup complete" — may take 2-5 minutes on first run
```

---

## Step 10 — Smoke tests (5 min)

- Visit `https://qa.clinwrite.ai` in a browser → the Aurora frontend loads
- Open DevTools Network tab → fire a login → request should hit `https://qa-api.clinwrite.ai/auth/...` with proper CORS headers
- SSH tunnel to Grafana for ops visibility:
  ```bash
  ssh -L 3030:localhost:3030 root@<vps-ip>
  # Then open http://localhost:3030 in browser
  # Login: admin / <your GRAFANA_ADMIN_PASSWORD from .env>
  ```
- Verify Postgres from psql:
  ```bash
  PGPASSWORD=<POSTGRES_PASSWORD> psql -h 127.0.0.1 -U platform -d platform_qa -c "\dt"
  # Should list: users, sessions, projects, project_team_members, audit_events, _prisma_migrations
  ```

---

## Done

QA environment is live. Hand `https://qa.clinwrite.ai` to the QA team.

## Ongoing operations

| Task | Cadence | How |
|---|---|---|
| Deploy new code | Per PR to main | Auto via `.github/workflows/deploy-qa.yml` (next phase) or manual `scripts/deploy.sh` |
| Monitor backups succeeding | Weekly | Grafana alert fires if `platform_backup_last_success_seconds` is stale > 24h |
| Restore drill | Monthly | `scripts/restore.sh --drill` |
| Review access logs | Weekly | `journalctl -u nginx` + Grafana Loki query |
| Rotate DB password | Quarterly | `scripts/rotate-db-password.sh` |
| Patch VPS | Automatic | `unattended-upgrades` runs nightly; reboot after kernel updates |

## Monthly cost

- Hetzner CPX31 VPS: ~€15
- Backblaze B2 (expected 5 GB with turnover): ~$1
- Cloudflare Pro (if upgraded): $20 (free tier is fine for QA)
- Domain: ~$12/year
- **Total: ~€16–40/month depending on Cloudflare tier**

## Troubleshooting

| Symptom | First thing to check |
|---|---|
| `curl /health` returns 502 | `systemctl status platform-api` + `journalctl -u platform-api -n 100` |
| `curl /health` connects but 500 | API probably can't reach Postgres; `docker compose logs postgres` |
| Can't reach `qa.clinwrite.ai` from browser | Cloudflare DNS not proxied, or VPS firewall blocking 443; `curl -I https://qa.clinwrite.ai` from your workstation to see the hop |
| Deploy fails on `prisma migrate deploy` | Usually a schema conflict with an existing dev DB; check `/opt/platform/apps/api/prisma/migrations/` has all migrations committed; `psql ... -c "SELECT * FROM _prisma_migrations ORDER BY started_at DESC LIMIT 5"` |
| Backup fails | `journalctl -u platform-backup -n 100`; usually bad rclone config or B2 credentials expired |
| MinIO buckets missing | First run: `mc alias set qa http://127.0.0.1:9000 <USER> <PASS> && mc mb qa/platform-documents qa/platform-voice qa/platform-exports qa/platform-ectd` |
