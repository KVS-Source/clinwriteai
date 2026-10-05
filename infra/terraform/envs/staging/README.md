# envs/staging — Staging environment root module

Same composition as `envs/dev` but with multi-AZ RDS, 1 Redis replica, larger Fargate sizes. Mirror of prod topology for pre-release validation.

## Differences from dev

- `multi_az = true` on RDS
- `num_replicas = 1` on ElastiCache
- Fargate `desired_count` matches prod minimums
- WAF rules match prod
- Backup retention 14 days
- Alerting routes to the on-call channel (same as prod)
