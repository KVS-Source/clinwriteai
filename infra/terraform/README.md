# Terraform — Infrastructure as Code (AWS)

Per [ADR 0007](../../docs/adr/0007-deployment-target.md): **AWS as primary cloud**, Fargate + RDS Postgres + ElastiCache Redis + S3 + CloudFront+WAF + Secrets Manager.

## Status

Skeleton + AWS module shells only. Real resource definitions ship in Phase 1 Week 2–3 (DevOps) alongside the AWS org account provisioning.

## Layout

```
infra/terraform/
├── README.md                        ← you are here
├── versions.tf                      ← provider pins (AWS 5.x, Terraform ≥1.5)
├── backend.tf.example               ← S3+DynamoDB remote state template (per env)
├── envs/
│   ├── dev/                         ← dev tier root module
│   ├── staging/                     ← staging tier root module
│   └── prod/                        ← production tier root module
└── modules/
    ├── network/                     ← VPC + subnets (3 AZ) + NAT + route tables + flow logs
    ├── compute/                     ← Fargate service (apps/api) + task role + ALB + target groups
    ├── worker/                      ← Fargate service (apps/worker) for BullMQ consumers (ADR 0008)
    ├── database/                    ← RDS Postgres 16 + parameter group (pgvector enabled) + subnet group + snapshot schedule
    ├── cache/                       ← ElastiCache Redis 7 + replica + subnet group (serves BullMQ + session store)
    ├── object-storage/              ← S3 buckets (document-binaries, voice-audio, exports) + lifecycle policies
    ├── secrets/                     ← Secrets Manager entries + Parameter Store SecureStrings + rotation Lambdas (ADR 0006)
    ├── edge/                        ← CloudFront + ACM certs + WAF web ACL (incl. KOL guest route protection per Phase 3E)
    ├── observability/               ← OTel collector + Managed Grafana workspace + Managed Prometheus + CloudWatch log groups
    └── iam/                         ← cross-account roles for CI deploy via OIDC federation (no long-lived AWS keys in GitHub)
```

## Conventions

- **State backend**: S3+DynamoDB remote with locking. **Never** local state. One backend bucket per env.
- **Workspaces vs separate envs**: separate root modules per env (dev / staging / prod), **not** workspaces — reduces blast radius of a wrong `apply`.
- **Secrets**: Never in `.tf` files or `.tfvars`. Fetched from Secrets Manager at runtime per [ADR 0006](../../docs/adr/0006-secrets-manager.md).
- **Tags**: every resource tagged `Env`, `Module`, `Owner`, `CostCenter`, `DataClassification`.
- **Regions**: `us-east-1` default; `eu-west-1` for EU-data-residency tenants (added Phase 6).
- **Account structure** (AWS Organizations): one top-level org account, three child accounts (dev / staging / prod). Terraform runs assume cross-account roles via OIDC from GitHub Actions.
- **Drift detection**: Terraform Cloud / Scalr / Atlantis to be picked in Phase 1 Week 2.

## Phase 0 → Phase 1 handoff

DevOps engineer in Phase 1 Week 2–3 will:

1. Create the AWS organisation + three sub-accounts (dev / staging / prod).
2. Create the S3+DynamoDB state backends in each account.
3. Fill in each `modules/*/` with real resource definitions following the convention above.
4. Compose per-env root modules in `envs/{dev,staging,prod}/main.tf`.
5. Wire GitHub Actions OIDC federation (no AWS access keys stored in GitHub).
6. First `apply` creates the `dev` env; API scaffold deploys to it as the Phase 1 smoke test.

## Why no code yet

Writing Terraform without a real AWS account to `plan` against produces drift (hardcoded ARNs, incorrect dependency orders). The module shells + conventions above are enough for the DevOps engineer to execute against the real account in Phase 1 Week 2.
