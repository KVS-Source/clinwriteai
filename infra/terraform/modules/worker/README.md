# worker module

Fargate service hosting `apps/worker` (BullMQ consumers per ADR 0008). No ALB — polls Redis. Autoscales on queue depth metric.

## Inputs (planned)

- `env`, `vpc_id`, `private_subnet_ids`
- `container_image` (ECR URI)
- `desired_count`, `cpu`, `memory`
- `redis_endpoint`, `redis_secret_arn`
- `scaling_target_queue_depth` (default 100)

## Outputs

- `service_name`, `task_role_arn`
