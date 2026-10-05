# ADR 0006: Secrets management — SecretsProvider interface; sops-encrypted .env for standalone, AWS Secrets Manager for cloud

**Status**: Accepted (2026-10-05, revised same day for standalone-first per ADR 0007)
**Date**: 2026-10-05 (revised same day)
**Owner**: DevOps + Security
**Deciders**: DevOps, Security, Tech lead
**Supersedes**: Prior "AWS Secrets Manager only" draft of this ADR
**Superseded by**: —

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

**A `SecretsProvider` interface in `apps/api/src/config/secrets.ts`** with two concrete implementations shipped from day one:

1. **`SopsEnvSecretsProvider`** — reads sops-encrypted `.env.enc` files on the host, decrypts with an age key kept in `/etc/platform/age.key` (owned by the service user, mode 0400). Used on the standalone VPS.
2. **`AwsSecretsManagerProvider`** — reads from AWS Secrets Manager via the AWS SDK. Used after the AWS migration.

Feature code never imports an SDK or reads `process.env` directly for secrets. The provider is injected via Fastify's dependency decoration.

Fastify boots by fetching required secrets through the provider; secrets are cached in memory with a TTL (default 15 min on standalone — the `.env.enc` is re-read on cache miss; default aligned with Secrets Manager rotation cadence in cloud).

**For low-sensitivity config** (feature flags, non-sensitive URLs, bucket names) a sibling `ConfigProvider` interface reads from unencrypted `.env` on standalone and from Parameter Store on AWS. Not security-critical; separated so secrets stay small and audit-tracked.

HashiCorp Vault explicitly rejected on both deployment profiles — not needed at our scale, and adds a service to run on standalone where it would compete with the simplicity we're buying.

## Options considered

### Option A — AWS Secrets Manager + Parameter Store split *(chosen for cloud deployment per ADR 0007 year 2)*
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

### Option F — sops-encrypted `.env` files on the standalone VPS *(chosen for year 1 per ADR 0007)*
- **Pros**
  - **Zero infrastructure**: file-based; works offline; survives Secrets Manager API outages trivially (there is no API).
  - **Age-encryption** keys are small files that fit in a password manager; team rotation is easy.
  - **Git-safe**: `.env.enc` files are encrypted on disk and in version control; only decryption keys live outside git.
  - **Audit trail**: file-system-level access logs via auditd; combined with the app's secret-fetch logging gives full access history.
  - **Same provider interface** as AWS Secrets Manager — swap at migration time without touching feature code.
- **Cons**
  - **No automated rotation**: DB password rotations are a manual (scripted) operation. Mitigated by a `scripts/rotate-db-password.sh` runbook in `infra/standalone/`.
  - **Key compromise is catastrophic**: anyone with `/etc/platform/age.key` reads every secret. Mitigated by strict file permissions + root-owned + full-disk encryption on the VPS + a documented key-rotation runbook.
  - **No cross-region replication**: not needed at single-VPS scale; relevant only after cloud migration.
- **Rough effort / cost**: ~0.5 engineer-week to set up sops + age + the `SopsEnvSecretsProvider` + the rotation runbooks. $0 ongoing.

## Rationale

Two deployment profiles → two implementations → one interface. The decisive factor is the **interface**: once `SecretsProvider` is in place, the actual storage backend is a swap. That lets year 1 run on a sops-encrypted file with zero infrastructure, and year 2 run on AWS Secrets Manager with zero code changes.

Running Vault is a project. Running sops-decrypted `.env` is a file. Running AWS Secrets Manager (when we migrate) is an SDK call.

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
- **Phase 1 Week 3 (standalone)**: `apps/api/src/config/secrets.ts` — `SecretsProvider` interface + `SopsEnvSecretsProvider` implementation. Lint rule blocks any `process.env.<SECRET_NAME>` or direct `@aws-sdk/*` imports from feature code.
- **Phase 1 Week 3 (standalone)**: `infra/standalone/sops/` with age key management runbook + rotation scripts.
- **Phase 1 Week 3 (standalone)**: `.env.example` documents sops-managed secret names (not values); separate `.env` file documents low-sensitivity config.
- **Cloud migration (year 2)**: add `AwsSecretsManagerProvider` implementation + Terraform modules under `infra/terraform/modules/secrets/`; swap the DI binding; delete the sops-encrypted `.env.enc`.
- **Phase 6+**: Lambda-based rotator template for RDS password rotation every 90 days (cloud only).

## Compliance implications

- **21 CFR Part 11 §11.300**: controls designed to ensure that identification codes and passwords are periodically checked, recalled, or revised. The rotation Lambda enforces this.
- **HIPAA**: AWS Secrets Manager is HIPAA-eligible under the AWS BAA.
- **SOC 2 CC6.1**: logical access controls — IAM policies restrict which Fargate tasks can read which secrets.
- **GAMP 5**: Secret names and rotation schedules are Configuration Items; captured in Configuration Specification (Phase 5).

## References

- AWS Secrets Manager docs: https://docs.aws.amazon.com/secretsmanager/
- RDS password rotation: https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets-rds.html
- Parameter Store vs Secrets Manager comparison: https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html
