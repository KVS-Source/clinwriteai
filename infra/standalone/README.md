# Standalone deployment (year 1)

Per [ADR 0007 (revised)](../../docs/adr/0007-deployment-target.md) and [ADR 0009](../../docs/adr/0009-standalone-deployment-stack.md): one dedicated Ubuntu 24.04 VPS per env (dev / staging / prod), Docker Compose for data services, systemd for Node processes, nginx for TLS + reverse proxy, sops+age for secrets, Backblaze B2 for off-site backup.

**AWS Terraform scaffold under [`../terraform/`](../terraform/) is the year-2 cloud migration target. Don't delete it.**

## Layout

```
infra/standalone/
├── README.md                              ← you are here
├── docker-compose.yml                     ← prod/staging: data services only (apps run as systemd)
├── docker-compose.local.yml               ← local dev: same data services, pointed at localhost
├── .env.example                           ← env vars read by docker-compose
├── Makefile                               ← dev shortcuts (make dev / make backup / make restore)
├── nginx/
│   ├── platform.conf                      ← reverse proxy for api + web + MinIO console
│   └── snippets/
│       ├── security-headers.conf
│       └── cloudflare-allowlist.conf
├── systemd/
│   ├── platform-api.service               ← Node Fastify API
│   ├── platform-worker.service            ← Node BullMQ worker
│   └── platform-backup.timer              ← triggers backup.sh every 6h
├── observability/
│   ├── prometheus/
│   │   ├── prometheus.yml                 ← scrape config
│   │   └── alerts.yml                     ← alert rules
│   ├── grafana/
│   │   ├── provisioning/datasources/
│   │   ├── provisioning/dashboards/
│   │   └── dashboards/                    ← JSON dashboards committed
│   ├── loki/
│   │   └── loki-config.yml
│   └── promtail/
│       └── promtail-config.yml
├── sops/
│   ├── README.md                          ← key management runbook
│   └── .sops.yaml                         ← age recipient config
├── scripts/
│   ├── bootstrap.sh                       ← first-time VPS setup
│   ├── deploy.sh                          ← pull + build + migrate + systemd restart
│   ├── backup.sh                          ← pg_dump + rclone to B2
│   ├── restore.sh                         ← fetch from B2 + pg_restore
│   ├── rotate-db-password.sh              ← secrets rotation runbook
│   └── sops-edit.sh                       ← wrapper for editing .env.enc files
├── BACKUP.md                              ← backup/restore runbook + monthly drill procedure
├── BOOTSTRAP.md                           ← first-time VPS provisioning runbook
└── DEPLOY.md                              ← deploy process + rollback runbook
```

## Phase 0 → Phase 1 handoff

DevOps in Phase 1 Week 2 will:

1. Provision a dedicated Ubuntu 24.04 VPS (Hetzner CPX31 or equivalent) for `staging`.
2. SSH in; clone the repo; run `scripts/bootstrap.sh` to install Docker + Compose + nginx + sops + age + rclone.
3. Create the age key, store it in a password manager + sealed hardcopy; register the public recipient in `sops/.sops.yaml`.
4. Create `.env.enc` files from `.env.example` templates, encrypted with the age recipient.
5. `docker compose up -d` the data services (Postgres + Redis + MinIO + Prometheus + Grafana + Loki).
6. `systemctl enable --now platform-api platform-worker` once the first build artefacts are on the box.
7. Configure Cloudflare DNS + origin cert for `api.staging.clinwrite.ai`.
8. Verify end-to-end: HTTPS → nginx → API → Postgres → audit log row appears.
9. Enable `platform-backup.timer`; verify first backup lands in B2.
10. Schedule monthly restore drill.

## Current status

**Phase 0 scaffold.** All files above exist as either real content (where small enough to be useful) or READMEs placeholder-ing the DevOps work. Real resource definitions ship in Phase 1 Week 2 against the real VPS.

## Cloud-portability principle (ADR 0007)

Three application-level interfaces keep the swap to AWS/Azure clean:

- **`SecretsProvider`** — `SopsEnvSecretsProvider` (here) ↔ `AwsSecretsManagerProvider` (year 2)
- **`BlobStorage`** — AWS SDK S3Client against MinIO on `localhost:9000` (here) ↔ against real S3 (year 2)
- **`QueueProducer`** — BullMQ against local Redis (here) ↔ against ElastiCache Redis (year 2)

Feature code never imports a provider SDK directly. Lint rule enforces this (see `apps/api/.eslintrc` once added in Phase 1).

## Monthly cost

- VPS (Hetzner CPX31, 4 vCPU / 16 GB / 240 GB): ~€15/month per env
- Backblaze B2 (100 GB with 10 GB/month download for restore drills): ~$1/month per env
- Cloudflare (Pro): $20/month (shared across envs)
- Three envs (dev/staging/prod): **~€65/month + $20 Cloudflare + ~$3 B2 = ~€85/month total**

vs AWS equivalent ~$1.5–3k/month baseline.
