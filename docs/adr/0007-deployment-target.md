# ADR 0007: Deployment target — AWS primary, cells per region for data residency

**Status**: Accepted (2026-10-05, defaults policy)
**Date**: 2026-10-05
**Owner**: Tech lead + DevOps
**Deciders**: Tech lead, DevOps, Security, Compliance
**Supersedes**: —
**Superseded by**: —

## Context

The architecture doc (`01-architecture.md`) is silent on cloud target. This decision gates:

- All infra-as-code (ADR 0007 directly drives Terraform providers)
- Secrets manager choice (ADR 0006)
- Managed Postgres flavour (RDS Aurora vs Cloud SQL vs Flexible Server)
- Container platform choice (EKS / GKE / AKS / Fargate / Cloud Run / Container Apps)
- Object storage SDK (S3 / GCS / Blob)
- Observability stack

Primary customers are regulated pharma. Three real cloud candidates:

- **AWS** — most mature regulated-SaaS story; standard in pharma for 15+ years
- **Azure** — easiest for M365/Entra-heavy pharma (same buyers who may require Azure OpenAI per ADR 0004)
- **GCP** — best data/ML tooling, cleaner multi-tenant primitives, uncommon in regulated pharma deployments

On-prem is a possibility only if a specific customer contract requires it; not the default architecture.

## Decision

**AWS as primary cloud**. Single-tenant architecture per region, with per-region cells for data residency.

- **Compute**: AWS Fargate (ECS) for the Fastify API — avoids EKS control-plane cost + complexity at Phase 1 scale. Flip to EKS later if we need pod-level primitives.
- **Database**: RDS for PostgreSQL (not Aurora initially — pgvector support on Aurora lags upstream Postgres; revisit at Phase 6 scale).
- **Cache / queue backend**: ElastiCache for Redis (for BullMQ per ADR 0008 and for Fastify session store).
- **Object storage**: S3 (document binaries, voice audio).
- **Secrets**: AWS Secrets Manager (ADR 0006).
- **Observability**: CloudWatch Logs + Managed Grafana + Managed Prometheus; OTel collector sidecar.
- **CDN / WAF**: CloudFront + AWS WAF (critical for public KOL guest route per Phase 3E).
- **Regions**: `us-east-1` default; `eu-west-1` for EU-data-residency tenants from GA. Add `ap-south-1` or `ap-southeast-1` when the first APAC customer signs.
- **IaC**: Terraform with S3+DynamoDB state backend; three separate root modules per env (dev / staging / prod) — not workspaces.

**Azure-first customers** (per ADR 0004 context) do not get a parallel Azure deployment in year 1. If a customer contractually requires Azure-only data residency, we extend the Terraform modules to Azure in year 2.

## Options considered

### Option A — AWS primary *(chosen)*
- **Pros**
  - Strongest regulated-SaaS track record; pharma procurement teams never blink at AWS.
  - FDA ESG integrations have been shipped on AWS by many vendors (Veeva, IQVIA, etc.) — well-trodden ground.
  - eCTD validators (Extedo, Lorenz) all publish AWS deployment guides.
  - HIPAA BAA is standard; signed as part of org account setup.
  - Richest service catalogue — Fargate, RDS, ElastiCache, S3, Secrets Manager, WAF, Shield, Macie, GuardDuty, CloudTrail all map onto architectural needs without reinventing.
  - Terraform AWS provider is the most mature; HashiCorp Registry has quality modules for everything we need.
- **Cons**
  - Vendor lock-in — AWS SDKs sprinkle through the codebase. Mitigate by owning the storage/queue/secrets abstractions behind thin interfaces so a future Azure parallel deploy swaps implementations without touching business logic.
  - Cost at scale requires active optimisation (reserved instances, savings plans) — a Phase 6 concern.

### Option B — Azure primary
- **Pros**
  - Natural fit for M365-first pharma customers.
  - Azure OpenAI integration is tighter (ADR 0004 Azure fallback path).
  - Entra ID integration is first-class (relevant to ADR 0005).
- **Cons**
  - Smaller ecosystem of regulated-pharma deployment guides than AWS.
  - Azure's "US Government" regions have more compliance posture but are different accounts — complicates operations.
  - Managed Postgres on Azure (Flexible Server) is good but pgvector support trails AWS RDS.
- **Rejected** as primary because customer-mandate flexibility is handled at the LLM layer (ADR 0004 per-tenant switching), not by picking the hosting cloud. Hosting cloud doesn't move the needle for most buyers — they ask about SOC 2 and HIPAA, not AWS vs Azure.

### Option C — GCP primary
- **Pros**: Best-in-class data/ML tooling; Cloud SQL for Postgres is excellent; BigQuery for analytics.
- **Cons**: Rare in regulated pharma; procurement teams ask harder questions; fewer third-party integration recipes.
- **Rejected** — ecosystem fit > technical merit for this market.

### Option D — Multi-cloud from day one (AWS + Azure)
- **Pros**: Customer-choice flexibility.
- **Cons**: 2× the DevOps burden, 2× the compliance paperwork, 2× the integration-testing matrix, 2× the on-call runbooks. In year 1 we don't have the team to carry both.
- **Rejected** for year 1. Year 2 extension to Azure (for Azure-mandate customers) is in scope if demand materialises.

### Option E — On-prem (customer-hosted)
- **Pros**: Bypasses customer cloud-residency objections entirely.
- **Cons**: Requires Helm charts + a customer-side ops team + a very different update/support model. Only pursued if a specific contract requires it; not the default.
- **Deferred** — build cloud-first, extend to on-prem if revenue justifies.

## Rationale

Decisive factors:

1. **Pharma procurement familiarity.** Procurement teams at Pfizer / Novartis / Roche / Merck / Lilly all have standing AWS enterprise agreements and tested data-processing addenda. Signing an AWS-hosted SaaS is a shorter path than Azure-hosted for most of them.
2. **Regulated-vendor ecosystem.** FDA ESG / eCTD validator / MedDRA MSSO / PubMed / CrossRef all have AWS reference deployments. Azure requires reinventing some of them.
3. **Fargate over EKS at Phase 1.** We don't need Kubernetes primitives at year-1 scale; the ops burden of EKS is not justified. Fargate gives us container isolation without a control plane to patch.

The Azure argument is real for a subset of customers; it is addressed by the AI Gateway per-tenant provider switching (ADR 0004) and the Terraform-modules-can-be-extended structure (we don't rebuild from scratch when adding Azure).

## Consequences

### Positive
- Terraform skeleton in `infra/terraform/` can now be fleshed out with AWS provider modules (RDS, Fargate, ElastiCache, S3, Secrets Manager, WAF).
- Compliance narrative inherits AWS's SOC 2, HITRUST, HIPAA attestations — reduces our own audit scope.
- One cloud account per environment (dev/staging/prod) + one per region per env for data residency.
- `.env.example` can be AWS-flavoured (specific resource ARNs, regions).

### Negative
- Vendor lock-in on AWS. Mitigate by owning thin abstractions over storage / queue / secrets / email sending so a future Azure extension doesn't require rewriting feature code.
- Azure-mandate customers in year 1 get rejected or go-slow. Known trade-off; revisit at year-2 planning.
- RDS Postgres major-version upgrades require coordinating pgvector extension compatibility — minor friction every 1–2 years.

### Neutral / downstream work
- Phase 0 Week 2: AWS org account created; three sub-accounts for dev/staging/prod; cross-account IAM roles for CI deploys.
- Phase 0 Week 2: Terraform skeleton under `infra/terraform/` populated with AWS modules (network, compute, database, object-storage, secrets, observability, waf).
- Phase 0 Week 2: Legal confirms AWS HIPAA BAA signed.
- Phase 1 Week 3: GitHub Actions `deploy-staging` job uses AWS OIDC federation (no long-lived AWS keys in CI).
- Phase 6 Week 36: cost optimisation pass (reserved instances, savings plans).
- Year-2 revisit: Azure parallel deploy if customer demand justifies.

## Compliance implications

- **HIPAA**: AWS BAA covers all services we're using (confirmed on https://aws.amazon.com/compliance/hipaa-eligible-services-reference/).
- **GDPR**: EU-tenant data stays in `eu-west-1`. Cross-region replication for DR is explicitly disabled for EU tenants' data (per-tenant config in the data model).
- **SOC 2**: AWS SOC 2 Type II attestations inherited for infrastructure controls; our scope is application + process controls.
- **FDA 21 CFR Part 11**: AWS services used are documented in the GAMP 5 Configuration Specification (Phase 5).

## References

- AWS HIPAA eligible services: https://aws.amazon.com/compliance/hipaa-eligible-services-reference/
- AWS Fargate pricing: https://aws.amazon.com/fargate/pricing/
- RDS pgvector support announcement: https://aws.amazon.com/about-aws/whats-new/2023/05/amazon-rds-postgresql-pgvector-ml-model-integration/
- Terraform AWS provider: https://registry.terraform.io/providers/hashicorp/aws/latest/docs
