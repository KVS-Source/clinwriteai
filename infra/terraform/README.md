# Terraform — Infrastructure as Code

Phase 0 skeleton. Provider-agnostic structure; fills in once [ADR 0007 — Deployment target](../../docs/adr/0007-deployment-target.md) is Accepted.

## Layout

```
infra/terraform/
├── README.md                 ← you are here
├── envs/
│   ├── dev/                  ← dev tier config
│   ├── staging/              ← staging tier config
│   └── prod/                 ← production tier config
└── modules/
    ├── network/              ← VPC + subnets + routes + NAT
    ├── compute/              ← ECS / GKE / AKS cluster (per ADR 0007)
    ├── database/             ← Postgres (RDS / Cloud SQL / Flexible Server)
    │                           with pgvector extension (ADR 0003)
    ├── object-storage/       ← S3 / GCS / Blob for document binaries + voice
    ├── secrets/              ← Secrets Manager / KMS wiring (ADR 0006)
    ├── observability/        ← CloudWatch / Cloud Logging / Monitor + OTel collector
    └── waf/                  ← WAF for public endpoints incl. KOL review route
```

## Phase 0 state

Only this README and the directory skeleton exist. Terraform code lands when ADR 0007 is Accepted and the chosen cloud account exists.

## Conventions once we start

- **State backend**: remote (S3+DynamoDB / GCS+Firestore / Azure Storage) with locking. Never local state.
- **Workspaces vs separate envs**: separate root modules per env (dev/staging/prod), **not** workspaces — reduces blast radius of a wrong `apply`.
- **Secrets**: Never in `.tf` files or `.tfvars`. Fetch from secrets manager at runtime.
- **Tags**: every resource tagged `env`, `module`, `owner`, `cost-center`, `data-classification`.
- **Drift detection**: Terraform Cloud / Scalr / Atlantis — one of them, picked in Phase 1.

## Opening questions for ADR 0007

Before this skeleton can be filled in:

1. **Primary cloud**: AWS (most mature regulated-tenant story), GCP (best data/ML tooling), Azure (easiest if customers use M365/Entra heavily), or on-prem (if a specific pharma customer requires it)?
2. **Data residency**: single-region, multi-region active-passive, or multi-region active-active? Impacts RTO/RPO and cost.
3. **Tenancy model**: pooled multi-tenant (one DB, tenant_id column) or silo per customer (one DB per customer)? Affects every module.
4. **Compute flavour**: container orchestration (ECS/EKS/GKE/AKS), serverless (Lambda/Cloud Run/Container Apps), or Nomad? For a stateful API with Socket.io presence, container orchestration is probably right — but open.
