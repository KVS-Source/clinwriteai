# observability module

CloudWatch log groups + Managed Grafana + Managed Prometheus + OTel collector sidecar config.

## Log groups (planned)

- `/aws/ecs/platform-api-<env>` — Fastify logs (Pino JSON)
- `/aws/ecs/platform-worker-<env>` — BullMQ worker logs
- `/aws/rds/instance/platform-<env>` — RDS logs
- `/aws/vpc/flowlogs-<env>` — VPC flow logs

## Metrics

- OTel collector sidecar on each Fargate task exports to Managed Prometheus
- Managed Grafana workspace with provisioned dashboards (API latency, queue depth, DB connections, Fargate CPU/mem)

## Alerting

- SLO alerts in Grafana against the 99.9% uptime target
- Queue dead-letter growth alarm
- RDS CPU > 80% for 5 min alarm
- WAF blocked-request spike alarm (potential attack)
- Secrets Manager access anomaly (CloudTrail-based)
