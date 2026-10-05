# envs/prod — Production environment root module

Full-size composition. Separate AWS account from dev + staging. Change-controlled; `apply` requires PR approval + Terraform Cloud / Scalr run.

## Production hardening

- `multi_az = true` on RDS; backup retention 30 days; PITR enabled
- ElastiCache 2+ replicas; snapshot retention 7 days
- Fargate autoscaling (min=4, max=20) on CPU + ALB request count
- WAF: all managed rule groups enabled; stricter rate limits
- Secrets rotation: 90-day DB password, 180-day JWT signing
- Enhanced monitoring on RDS; GuardDuty enabled at the account level
- Config rules for drift detection
- Enabled: AWS Macie (S3 PII scanning), AWS Shield Advanced (DDoS), AWS Backup
- Compliance log aggregation to the audit account

## Change control

No direct `apply` from an engineer's laptop. All production changes go through:

1. PR to `main` with Terraform plan output attached
2. Peer review + approval from DevOps lead
3. Terraform Cloud / Scalr run triggered by merge
4. Rollback plan documented in the PR
