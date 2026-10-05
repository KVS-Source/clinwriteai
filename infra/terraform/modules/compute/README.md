# compute module

Fargate service hosting `apps/api` (Fastify). ALB in front; target group with health checks on `/health`. Task role scoped to Secrets Manager ARNs this service needs (ADR 0006).

## Inputs (planned)

- `env`, `vpc_id`, `private_subnet_ids`, `public_subnet_ids`
- `container_image` (ECR URI), `container_port` (3001)
- `desired_count`, `cpu`, `memory`
- `secrets_arns` (list — read-only access)

## Outputs

- `service_name`, `alb_dns_name`, `task_role_arn`
