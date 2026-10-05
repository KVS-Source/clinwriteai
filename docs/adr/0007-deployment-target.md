# ADR 0007: Deployment target — Standalone VPS year 1 with cloud-portable architecture; AWS/Azure year 2

**Status**: Accepted (2026-10-05, revised to standalone-first on user direction)
**Date**: 2026-10-05 (revised same day)
**Owner**: Tech lead + DevOps
**Deciders**: Tech lead, DevOps, Security, Compliance
**Supersedes**: Prior "AWS primary" draft of this ADR (same ADR number; revision in-place)
**Superseded by**: —

## Context

The architecture doc (`01-architecture.md`) is silent on cloud target. This decision gates:

- All infrastructure-as-code tooling (Terraform providers)
- Secrets manager choice (ADR 0006)
- Managed vs self-hosted Postgres and Redis
- Container orchestration platform
- Object storage SDK
- Observability stack
- Operational posture (managed-service HA vs single-VPS discipline)

**Primary funding stance in year 1**: pre-revenue; AWS spend of $1.5–3k/month is a budget line item not justified until paying customers arrive. **Regulatory stance**: 21 CFR Part 11, GAMP 5, HIPAA, SOC 2 all work on a well-run standalone deployment — AWS is a convenience, not a regulator requirement.

The product's customers (regulated pharma) will eventually require managed-cloud hosting with the attestations only AWS/Azure/GCP can carry at scale. That migration must stay cheap.

## Decision

**Year 1 (through first ~5 paying customers): standalone VPS** running the full stack via Docker Compose + nginx + systemd. Mirrors the existing `proto.clinwrite.ai` deployment pattern (dedicated Ubuntu VPS, nginx TLS termination, Cloudflare in front for WAF/DDoS, pm2/systemd for Node processes).

**Year 2 onwards (triggered by paying-customer requirement or SOC 2 Type II customer demand): migrate to AWS** per the prior "AWS primary" plan — Fargate + RDS + ElastiCache + S3 + CloudFront+WAF + Secrets Manager.

**Non-negotiable principle: the application code is architecturally cloud-portable from day one.** Three interfaces enforce this:

1. **`SecretsProvider`** interface — standalone implementation reads from sops-encrypted `.env`; AWS implementation calls Secrets Manager; Azure implementation calls Key Vault. Feature code never imports an SDK directly.
2. **`BlobStorage`** interface against the **S3 API** — standalone uses MinIO at `http://localhost:9000` (S3-API-compatible); AWS uses S3; Azure uses Blob via S3-gateway or an Azure SDK adapter. Feature code uses the AWS SDK's `S3Client` throughout; only the endpoint URL changes.
3. **`QueueProducer`** interface over BullMQ — portable regardless of hosting since BullMQ runs on any Redis.

Everything else (Postgres, Anthropic, WorkOS, SendGrid, Twilio) is already vendor-SDK-based and portable without an abstraction — only connection strings change.

## Standalone deployment stack (year 1)

Per the new [ADR 0009 — Standalone deployment stack](0009-standalone-deployment-stack.md):

| Concern | Standalone (year 1) | Cloud (year 2 target) |
|---|---|---|
| Host | Dedicated Ubuntu 24.04 VPS (new, not the proto.clinwrite.ai box) | AWS Fargate |
| Process supervision | systemd units for `apps/api` and `apps/worker` | ECS task definitions |
| Database | Self-hosted PostgreSQL 16 + pgvector | RDS for Postgres 16 + pgvector |
| Queue broker | Self-hosted Redis 7 (same VPS or dedicated DB VPS) | ElastiCache for Redis |
| Object storage | **MinIO** (S3-API, self-hosted) | S3 |
| TLS termination | nginx + Let's Encrypt (certbot) + Cloudflare in front | CloudFront + ACM + AWS WAF |
| Secrets | sops-encrypted `.env` files + `SOPS_AGE_KEY` on host | Secrets Manager |
| Observability | Prometheus + Grafana + Loki self-hosted via Docker Compose | CloudWatch + Managed Grafana + Managed Prometheus |
| Backup | `pg_dump` + rclone to Backblaze B2 (off-site) | AWS Backup + cross-region replication |
| Supervision | systemd + Docker Compose for data services | ECS + managed services |

## Options considered

### Option A — AWS primary from day one *(previous decision)*
- **Pros**: Managed HA, familiar to pharma procurement, migration path well-trodden.
- **Cons at pre-revenue stage**: $1.5–3k/month baseline burn without customer-funded ROI; AWS org setup takes 2 weeks that aren't on the critical path; forces the team into AWS specifics before any product has shipped.
- **Rejected now, revived year 2.**

### Option B — Standalone VPS year 1 with cloud-portable architecture *(chosen)*
- **Pros**
  - Zero cloud bill until revenue justifies it.
  - Matches the operational posture of your existing `proto.clinwrite.ai` deployment — team already knows this operational model.
  - Simpler mental model for a 4–6 person team: one VPS to administer, not an AWS Organization.
  - All compliance frameworks (Part 11, GAMP 5, HIPAA, SOC 2) achievable on a well-run standalone — regulators do not require AWS.
  - **The cloud-portability interfaces are good software hygiene regardless** — not throw-away work.
- **Cons**
  - No managed HA — single VPS failure means downtime. Mitigated by: automated off-site backups with documented restore RTO, Cloudflare in front for DDoS/edge caching, and a documented "promote standby VPS" runbook if we go to warm-standby in year 1.5.
  - Patching + security monitoring is on us (vs AWS Shared Responsibility model).
  - Larger first customers may push back on standalone hosting as a diligence red flag — gating event that forces the AWS migration.
- **Rough effort / cost**: ~1 engineer-week to stand up the VPS + Docker Compose + nginx + backup. $50–150/month hosting (vs AWS $1.5–3k/month).

### Option C — Standalone first, no cloud-portability (direct VPS-coupled code)
- **Pros**: Simpler Phase 1 scaffold (no interfaces).
- **Cons**: Year 2 AWS migration becomes a code rewrite rather than an infra swap. Burns 4–6 engineer-weeks later vs ~1 engineer-week of up-front interface work now.
- **Rejected** — the up-front abstraction cost is small and the downstream saving is real.

### Option D — Hybrid (frontend on CDN, backend on standalone VPS)
- **Pros**: Static web stays on Cloudflare/Vercel (free); only backend is on-VPS.
- **Cons**: Already how the prototype is deployed; applies naturally. Not a separate decision.
- **Already in effect**: `apps/web` builds to a static bundle served by nginx on the same VPS (or Cloudflare Pages if we want to split later). No change needed.

## Rationale

Three decisive factors:

1. **No paying customers yet.** AWS's advantages (managed services, HA, compliance attestations) are advantages for *production customers*, not for *shipping product*. Spending AWS money without customer-funded ROI is premature optimisation.
2. **The cloud migration is primarily an infra swap, not a code rewrite** — provided we write the three portability interfaces (secrets / blob / queue) from day one. This ADR mandates them.
3. **Operational pattern already exists.** Your existing `proto.clinwrite.ai` + `b2b.moringa-ai.com` + `genrac` + others on the same Ubuntu VPS prove the standalone operational model works for your team. Reuse the pattern.

The "when do we migrate to AWS" trigger is explicit:
- First paying customer with contractual data-residency requirement, OR
- SOC 2 Type II audit kickoff (needs 6-month evidence window on managed infra), OR
- Hitting a scale ceiling on the VPS (sustained >70% CPU/RAM or Postgres >70% of instance capacity), OR
- Customer diligence red-flags standalone hosting

Whichever comes first.

## Consequences

### Positive
- $1.5–3k/month saved through year 1 → ~$18–36k that funds another month of engineering runway.
- Faster Phase 0 → Phase 1 handoff (no AWS org setup on the critical path).
- Team keeps the operational muscle memory from the prototype deployment.
- Cloud migration becomes a well-scoped Year-2 project rather than permanent AWS-coupling.
- Compliance posture is unchanged — Part 11 / GAMP 5 / HIPAA / SOC 2 all work.

### Negative
- **Single point of failure**: VPS downtime = full product downtime. Backup/restore drills become a critical operational discipline. Document monthly test-restore.
- **Patching + security monitoring is manual**: Ubuntu unattended-upgrades + Falco for intrusion detection + weekly review of security logs. More work than AWS GuardDuty giving you alerts for free.
- **Larger first customer may force the migration earlier than planned** — accept this; have the migration ADR ready.
- **The team must enforce the cloud-portability discipline** — a lint rule or review checklist that blocks direct `@aws-sdk/*` or standalone-specific imports from feature code; everything goes through the interfaces.

### Neutral / downstream work
- ADR 0006 (secrets) revised: adds sops-encrypted `.env` as the standalone implementation; `SecretsProvider` interface mandatory from day one.
- **New ADR 0009** — Standalone deployment stack (Docker Compose + nginx + MinIO + Prometheus/Grafana/Loki + sops + backup to Backblaze B2).
- `infra/terraform/` **stays** — it is the AWS migration target, not deleted. Flagged as "year 2".
- **New** `infra/standalone/` — Docker Compose files, nginx configs, systemd units, backup scripts, bootstrap runbook.
- `apps/api/.env.example` updated for standalone-first defaults.
- Phase 1 scaffold begins immediately: the application code is identical to the AWS plan; only the deployment target changes.

## Compliance implications

- **21 CFR Part 11**: Part 11 does not mandate cloud hosting. Standalone VPS satisfies §11.10 provided we deliver on access controls, audit trail, backup, and change control — all handled in-application.
- **HIPAA**: BAA required with the VPS provider (most reputable VPS providers — Hetzner, Vultr, DigitalOcean Business tier, Linode-Akamai — offer BAAs; pick one that does).
- **SOC 2**: Standalone is a disadvantage for SOC 2 Type II because the "operating effectiveness over 6+ months" window is harder to evidence without managed-service logs. Plan: start SOC 2 evidence collection on managed infra (post-migration), not on the standalone.
- **GDPR**: EU-tenant data residency is a VPS-region choice. Pick an EU-based VPS provider for EU customers (Hetzner Germany/Finland or OVH France are the obvious options).
- **GAMP 5**: Standalone deployment is a Configurable Item documented in the Hardware/Software Specification (Phase 5).

## References

- `proto.clinwrite.ai` existing deployment runbook: [`deploy/nginx/README.md`](../../deploy/nginx/README.md)
- MinIO (S3-compatible self-hosted): https://min.io/
- sops: https://github.com/getsops/sops
- Backblaze B2 (off-site backup target): https://www.backblaze.com/cloud-storage
- Hetzner Cloud (EU VPS): https://www.hetzner.com/cloud/
- Previous version of this ADR (AWS primary) preserved in git history pre-2026-10-05 evening.
