# ADR 0006: Secrets manager — AWS Secrets Manager (native), Parameter Store for low-sensitivity config

**Status**: Accepted (2026-10-05, defaults policy)
**Date**: 2026-10-05
**Owner**: DevOps + Security
**Deciders**: DevOps, Security, Tech lead
**Supersedes**: —
**Superseded by**: ADR 0007 (deployment target → AWS) bounds this decision

## Context

Every environment needs centralised secret storage for:

- Database connection strings (`DATABASE_URL` per env)
- JWT signing secret + audit hash secret (per ADR 0002)
- SSO provider API keys (WorkOS per ADR 0005)
- LLM provider API keys (Anthropic per ADR 0004; Azure OpenAI fallback)
- Third-party service keys (SendGrid, Twilio, Datadog, Sentry)
- Vendor credentials (MedDRA MSSO, CrossRef, ORCID, eCTD validator licence)
- Future: FDA ESG PGP private keys, EMA CESP certificates

Requirements:

- Rotation support (database passwords every 90 days per compliance SOP)
- Audit log of every secret access
- Fine-grained IAM (Fargate task role can read only the secrets it needs)
- Encryption at rest (KMS)
- No long-lived secrets in environment variables, Docker images, or CI config

ADR 0007 picks AWS as the cloud. That bounds the natural options.

## Decision

**AWS Secrets Manager for actual secrets** (anything that would compromise security if leaked).

**AWS Systems Manager Parameter Store** (standard tier, SecureString) **for low-sensitivity config** that doesn't need rotation or cross-region replication (feature flags, non-sensitive URLs, bucket names).

Fastify boots by fetching secrets from Secrets Manager via the AWS SDK at startup; secrets are cached in memory with a TTL that aligns with rotation cadence. The `.env.example` file documents the secret **names**; it never contains values.

HashiCorp Vault explicitly rejected — not needed at our scale, and adds a service to run.

## Options considered

### Option A — AWS Secrets Manager + Parameter Store split *(chosen)*
- **Pros**
  - **Native rotation** for RDS passwords with Lambda rotators (built-in).
  - **IAM-based access control** at per-secret granularity. Fargate task role scopes to only the ARNs it reads.
  - **KMS encryption at rest** by default; CloudTrail logs every `GetSecretValue` call for audit.
  - **Cross-region replication** supported for DR (critical for the data-residency architecture per ADR 0007).
  - **No new service to run** — AWS-managed.
  - Parameter Store is **free** for standard parameters; use it for the 90% of config that isn't a true secret.
- **Cons**
  - **Pricing** at ~$0.40/secret/month + API calls. At ~50 secrets × 3 envs = $60/month baseline. Trivial but worth monitoring.
  - AWS-coupled; swapping to another cloud requires migrating secrets. Mitigated by the thin `SecretsProvider` interface in `apps/api/src/config/`.
- **Rough effort / cost**: ~0.5 engineer-week for the Fastify integration + rotation Lambda templates.

### Option B — HashiCorp Vault (self-hosted)
- **Pros**: Cloud-agnostic; richer feature set (dynamic secrets, PKI, SSH signing).
- **Cons**
  - **Another critical-path service to run**: HA deployment, upgrades, patching, unseal operations, Raft storage backup, secrets-engine configuration.
  - A Vault outage takes down our ability to boot new API instances — the exact opposite of what we want.
  - Dynamic secrets (ephemeral DB creds) are powerful but overkill for Phase 1.
  - Features we don't need become ongoing complexity.
- **Rough effort / cost**: 2–3 EW initial deploy; ongoing SRE time.
- **Rejected** at our scale.

### Option C — HashiCorp Vault Cloud (HCP Vault)
- **Pros**: Managed Vault, cloud-agnostic.
- **Cons**: Pricing is heavy for small deployments (~$2000/month entry tier); duplicates functionality AWS Secrets Manager already provides at 50× lower cost in-cloud.
- **Rejected** — pricing doesn't justify at our scale.

### Option D — Doppler
- **Pros**: Developer-first UX; secret versioning + rollback.
- **Cons**: Another SaaS vendor to BAA-review; its value prop (dev UX) is marginal when IaC + Secrets Manager handles the same thing with less vendor sprawl.
- **Rejected**.

### Option E — Infisical (open-source Vault alternative)
- **Pros**: Open source, lighter than Vault.
- **Cons**: Young project; still requires us to run and secure it. Same Vault-outage-kills-us-at-boot problem.
- **Rejected**.

## Rationale

Decisive factor: **we are already on AWS (ADR 0007); AWS Secrets Manager + Parameter Store cover every requirement without running another service**. Vault's advantages (dynamic secrets, cross-cloud) are not advantages for a single-cloud, single-tenant-per-region architecture at Phase 1.

Running Vault is a project. Running AWS Secrets Manager is a config file.

## Consequences

### Positive
- Zero new infrastructure to deploy or maintain for secrets.
- Secret rotation for RDS is handled by AWS-maintained Lambda rotators — we don't write rotation code.
- Every secret access is audit-logged in CloudTrail by default.
- IAM-based access scope naturally maps to Fargate task roles per module.

### Negative
- AWS-coupled. Swapping clouds requires migrating secrets. Mitigate with the `SecretsProvider` interface.
- Secret caching TTL vs rotation cadence requires discipline; a 90-day DB password rotation with a 1-hour cache means a 1-hour window where some instances have the old password. Acceptable — RDS supports both the old and new password briefly during rotation.

### Neutral / downstream work
- Phase 0 Week 2: Terraform modules under `infra/terraform/modules/secrets/` create the Secrets Manager + Parameter Store resources + IAM policies for the Fargate task role.
- Phase 1 Week 3: `apps/api/src/config/secrets.ts` — thin interface over AWS SDK; cached in memory; refreshes on rotation signal.
- Phase 1 Week 3: `.env.example` updated to reference secret **names** (e.g. `DATABASE_URL_SECRET_NAME=platform/dev/db-url`) rather than secret **values**.
- Phase 1 Week 4: Lambda-based rotator template for RDS password rotation every 90 days.
- Phase 6: cross-region replication for secrets that back the EU residency tenant.

## Compliance implications

- **21 CFR Part 11 §11.300**: controls designed to ensure that identification codes and passwords are periodically checked, recalled, or revised. The rotation Lambda enforces this.
- **HIPAA**: AWS Secrets Manager is HIPAA-eligible under the AWS BAA.
- **SOC 2 CC6.1**: logical access controls — IAM policies restrict which Fargate tasks can read which secrets.
- **GAMP 5**: Secret names and rotation schedules are Configuration Items; captured in Configuration Specification (Phase 5).

## References

- AWS Secrets Manager docs: https://docs.aws.amazon.com/secretsmanager/
- RDS password rotation: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets-rds.html
- Parameter Store vs Secrets Manager comparison: https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html
