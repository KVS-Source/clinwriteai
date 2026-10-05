# network module

Creates per-env VPC, 3-AZ public + private + database subnets, NAT gateways, route tables, VPC flow logs.

## Inputs (planned)

- `env` (string): `dev` | `staging` | `prod`
- `region` (string): AWS region
- `vpc_cidr` (string): e.g. `10.10.0.0/16`

## Outputs (planned)

- `vpc_id`
- `public_subnet_ids` (list)
- `private_subnet_ids` (list)
- `database_subnet_ids` (list)
- `flow_logs_log_group_arn`
