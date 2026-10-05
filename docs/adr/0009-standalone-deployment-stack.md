# ADR 0009: Standalone deployment stack — Docker Compose + nginx + MinIO + Prometheus/Grafana/Loki + sops + Backblaze B2 backup

**Status**: Accepted (2026-10-05, follows from ADR 0007 standalone-first revision)
**Date**: 2026-10-05
**Owner**: DevOps + Tech lead
**Deciders**: DevOps, Tech lead, Security
**Supersedes**: —
**Superseded by**: —

## Context

ADR 0007 revised the deployment target to standalone VPS for year 1 with cloud-portable application architecture. That revision names "Docker Compose + nginx + systemd + MinIO + Prometheus/Grafana/Loki + sops + backup to Backblaze B2" as the stack but does not elaborate. This ADR fills in the detail.

Operational pattern mirrors the existing `proto.clinwrite.ai` deployment (nginx + Cloudflare + pm2/systemd on an Ubuntu VPS) but formalises the choices needed for a Part 11-compliant production service.

## Decision

### Host

- **One dedicated Ubuntu 24.04 LTS VPS** per environment (dev + staging + prod — three separate VPSes). Do **not** share the box with `proto.clinwrite.ai` or any other service; isolation is a Part 11 operational control.
- **VPS provider**: Hetzner Cloud (EU, best price/perf), Vultr (global), or DigitalOcean Business tier — pick one that offers a **BAA** before any PHI touches the box. Hetzner currently signs DPAs; HIPAA BAA posture requires verification.
- **Sizing** (prod baseline): 8 vCPU / 32 GB RAM / 500 GB NVMe SSD. Scale vertically if we hit limits before cloud migration.
- **Networking**: Cloudflare in front for TLS passthrough / WAF / DDoS. Direct VPS IP never exposed except via Cloudflare-origin TLS cert.
- **Full-disk encryption** (LUKS) at provision time.
- **Unattended security upgrades** (`unattended-upgrades` package) enabled from day one.
- **SSH**: key-only, no password; fail2ban; root login disabled; dedicated `platform` service user with no shell for application processes.

### Process topology

| Service | Supervision | Purpose |
|---|---|---|
| `platform-api` | **systemd** | Node `apps/api` (Fastify) |
| `platform-worker` | **systemd** | Node `apps/worker` (BullMQ consumers) |
| `postgres` | **Docker Compose** | PostgreSQL 16 + pgvector |
| `redis` | **Docker Compose** | Redis 7 (BullMQ broker + Fastify session store) |
| `minio` | **Docker Compose** | S3-API object storage |
| `prometheus` | **Docker Compose** | Metrics scraping |
| `grafana` | **Docker Compose** | Dashboards + alerting |
| `loki` | **Docker Compose** | Log aggregation |
| `promtail` | **Docker Compose** | Log shipper to Loki |
| `nginx` | **systemd** (host-level) | TLS termination + reverse proxy + static web |
| `certbot` | **systemd timer** | Let's Encrypt cert renewal (though Cloudflare origin cert is the primary path) |

Rationale for the split: data services (Postgres, Redis, MinIO, monitoring) are containerised for easy local-dev parity and clean upgrades; Node application services run as native systemd units for simpler restart semantics and log integration with journald.

### Storage layout

```
/opt/platform/
├── apps/              ← deployed Node code (API + worker); git clone + build
├── env/               ← .env.enc files (sops-encrypted) + .env files (low-sensitivity)
└── data/
    ├── postgres/      ← Docker volume mount for Postgres data (fs-level encryption on top of LUKS)
    ├── redis/         ← Redis AOF persistence
    ├── minio/         ← S3-compatible bucket data
    ├── prometheus/    ← time-series data (90-day retention)
    ├── grafana/       ← dashboards + alert state
    └── loki/          ← log chunks (30-day retention)

/etc/platform/
├── age.key            ← sops decryption key (mode 0400, owned by platform user)
└── systemd/           ← systemd unit files

/var/log/platform/
├── api.log            ← journald → file (keep 30 days)
└── worker.log

/var/backups/platform/ ← local pg_dump staging before off-site rclone push
```

### TLS + edge

- **Cloudflare** fronts every public host (`app.<customer>.clinwrite.ai`, `api.<customer>.clinwrite.ai`, `kol.clinwrite.ai`).
- Cloudflare origin cert (15-year validity) installed in nginx; Let's Encrypt is backup for direct-origin access during Cloudflare incidents.
- **Cloudflare WAF managed rules** enabled + custom rate limits on `/kol-review/*` and `/auth/*`.
- **nginx** terminates TLS from Cloudflare, reverse-proxies to the API on `127.0.0.1:3001` and the worker admin UI on `127.0.0.1:3002/admin`.

### Secrets management

Per [ADR 0006 — revised](0006-secrets-manager.md):

- Secrets live in **sops-encrypted** `.env.enc` files under `/opt/platform/env/`.
- Decryption key is an **age private key** at `/etc/platform/age.key` (mode 0400, root-owned).
- `SopsEnvSecretsProvider` in `apps/api` decrypts on boot, caches in memory with 15-min TTL.
- Rotation runbook: `infra/standalone/scripts/rotate-db-password.sh` etc.
- Age keys are backed up to a password manager + a hardcopy sealed in a safe (two-person recovery).

### Backups

- `infra/standalone/scripts/backup.sh` runs as a systemd timer every 6 hours.
- **Postgres**: `pg_dump --format=custom --compress=6` → encrypt with age → rclone to **Backblaze B2** bucket (cross-region vs the VPS). Retention: 30 daily, 12 weekly, 24 monthly.
- **MinIO buckets**: rclone sync nightly to the same B2 bucket, with versioning on the B2 side.
- **Redis**: AOF persistence; snapshotted into the main backup for crash-recovery convenience; the queue state is reconstructible from Postgres truth anyway.
- **Grafana dashboards + Prometheus rules**: committed to git under `infra/standalone/observability/`; no backup needed beyond the repo.
- **Restore drill**: monthly, documented in `infra/standalone/BACKUP.md`. If a restore drill fails, the on-call engineer is paged.

### Observability

- **Prometheus** scrapes `apps/api` + `apps/worker` + Postgres (via `postgres_exporter`) + Redis (via `redis_exporter`) + nginx (via `nginx-prometheus-exporter`) + node (via `node_exporter`).
- **Loki** receives logs via Promtail (tails journald + nginx logs).
- **Grafana** has pre-provisioned dashboards (API latency, queue depth, DB connections, nginx request rate, VPS resource usage) and alert rules (API error rate >1%, p99 latency >1s, queue dead-letter growth, DB connections >80% of max, disk >80%, VPS memory >90%).
- Alerts fire to a Slack/PagerDuty webhook (one webhook per env).

### Deployment

- **GitHub Actions `deploy-standalone` job**: on push to `main`, builds Docker images (API + worker + web), SSHes to the staging VPS, pulls the images or runs `git pull && npm ci && npm run build`, restarts systemd units with zero-downtime (systemd `Restart=always` + health-check gate).
- **Blue/green**: not year 1 — we use a brief rolling restart (sub-second downtime) acceptable for a pre-SLA product.
- **Database migrations**: `prisma migrate deploy` run as part of the deploy job; migrations are forward-only.

### Local dev parity

`docker-compose.local.yml` in `infra/standalone/` spins up the data services identically to prod (Postgres + Redis + MinIO + Prometheus + Grafana + Loki). API + worker run on the host via `npm run dev`. **One command** (`make dev`) brings everything up.

## Options considered

### Option A — Everything in Docker Compose (including API + worker)
- **Pros**: Single `docker compose up`; identical topology dev vs prod.
- **Cons**: Slower deploy loop (image build + registry push + pull); harder journald integration; obscures Node's native `process` controls (SIGTERM graceful shutdown handling).
- **Rejected** — the split (data in Compose, apps in systemd) keeps each layer in its optimal supervision model.

### Option B — Kubernetes (k3s / microk8s single-node)
- **Pros**: Portable to any cloud k8s later; good tooling.
- **Cons**: Operational overhead for a single node; team doesn't need pod abstractions at this scale; cert manager + ingress + autoscaler all become our ops burden.
- **Rejected** at Phase 1 size.

### Option C — Nomad
- **Pros**: Lighter than Kubernetes.
- **Cons**: Another thing to learn; adds no value over systemd+Compose at single-VPS scale.
- **Rejected**.

### Option D — Everything on PM2
- **Pros**: Team uses it on `proto.clinwrite.ai` already.
- **Cons**: PM2 doesn't supervise non-Node processes (nginx, Postgres); systemd does. Also PM2 is being deprecated (maintainer sponsorship issues).
- **Rejected** — use systemd for Node processes, matches modern Linux practice.

## Rationale

Three guiding factors:

1. **Operational parity with existing deployments** — your team already runs `proto.clinwrite.ai` + others on nginx + systemd + Docker. Reuse the pattern; no retraining.
2. **Pluggable data services via Compose** — Postgres/Redis/MinIO/observability isolate neatly in containers for easy local-dev matching, clean upgrades, and painless swap-out at cloud migration time.
3. **No premature abstraction** — Kubernetes-ish choices (k3s, Nomad) add complexity we don't need at single-VPS scale. The migration to AWS Fargate (year 2) is the right time to adopt orchestration primitives.

## Consequences

### Positive
- Full stack reproducible in dev with one command (`make dev`).
- Prod topology mirrors dev: same containers, same ports, same nginx config, same backup script.
- Zero vendor lock-in beyond Backblaze B2 for off-site backup (and B2 is S3-compatible — swap-friendly).
- Monthly cost: ~$50 VPS + ~$10 Backblaze = **~$60/month per env**. Three envs = ~$180/month total vs AWS ~$1.5–3k baseline.
- All compliance frameworks (Part 11, GAMP 5, HIPAA, SOC 2) achievable.

### Negative
- **Operational burden**: unattended-upgrades, security monitoring, backup drills, cert rotation — all on us. Mitigated by Falco + fail2ban + unattended-upgrades + the monthly restore drill.
- **Single VPS = SPOF**: a VPS hardware failure or hosting-provider incident is a full outage. Mitigated by: documented restore RTO ≤4h, warm-standby runbook if we need to add one in year 1.5.
- **Scaling is vertical**: when we hit CPU/RAM limits, we provision a bigger VPS and migrate; no autoscaling. Trigger for cloud migration.

### Neutral / downstream work
- Phase 1 Week 2: provision prod + staging VPSes with Terraform/Hetzner provider (or manual bootstrap script if Terraform is overkill for year-1 scale); DevOps runs `infra/standalone/scripts/bootstrap.sh` to install Docker + Compose + nginx + systemd units.
- Phase 1 Week 3: `apps/api` + `apps/worker` systemd units land; GitHub Actions `deploy-staging-standalone` wires up.
- Phase 1 Week 4: Prometheus + Grafana dashboards provisioned; alert rules; Slack webhook; monthly restore drill scheduled.
- Phase 5 Week 25+: SOC 2 evidence collection must start on the standalone (or wait for cloud migration — tradeoff for the Compliance lead).

## Compliance implications

- **21 CFR Part 11**: Standalone is fully compliant. Operational SOPs replace managed-service convenience; evidence collection is more manual but tractable.
- **HIPAA**: VPS provider BAA required; file-system-level audit (auditd) + journald + Loki provide the access evidence trail.
- **SOC 2**: Audit scope is wider on standalone (we own more controls). Start evidence collection post-cloud-migration unless time-to-attestation pressure forces starting on standalone.
- **GAMP 5**: Docker Compose files, systemd units, nginx configs, and backup scripts are all Configuration Items under git version control — satisfies the Configuration Specification requirement natively.

## References

- Existing `proto.clinwrite.ai` nginx config: [`deploy/nginx/clinwrite-proto.conf`](../../deploy/nginx/clinwrite-proto.conf)
- MinIO: https://min.io/docs/minio/linux/index.html
- sops: https://github.com/getsops/sops
- age encryption: https://github.com/FiloSottile/age
- Backblaze B2: https://www.backblaze.com/cloud-storage
- Hetzner Cloud: https://www.hetzner.com/cloud/
- rclone: https://rclone.org/
- Falco: https://falco.org/
