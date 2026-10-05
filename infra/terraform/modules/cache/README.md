# cache module

ElastiCache for Redis 7. Serves two purposes:

1. BullMQ broker (ADR 0008)
2. Fastify session store (ADR 0001 — sessions after SSO per ADR 0005)

Cluster mode disabled at Phase 1 scale; single primary + one replica for HA. Reconsider cluster mode at Phase 6 if we hit throughput ceiling.

## Inputs (planned)

- `env`, `vpc_id`, `private_subnet_ids`
- `node_type` (dev: `cache.t4g.small`; prod: `cache.r7g.large`)
- `num_replicas` (dev: 0; staging/prod: 1)
- `snapshot_retention_days`

## Outputs

- `primary_endpoint`, `reader_endpoint`, `port`, `auth_token_secret_arn`
