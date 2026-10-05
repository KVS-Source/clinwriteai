# database module

RDS for PostgreSQL 16 (not Aurora — pgvector support lags on Aurora per ADR 0003). Multi-AZ in staging/prod; single-AZ in dev. Parameter group enables `pgvector` extension. Automated snapshots + PITR.

## Inputs (planned)

- `env`, `vpc_id`, `database_subnet_ids`
- `instance_class` (dev: `db.t4g.medium`; prod: `db.r6g.xlarge` to start)
- `allocated_storage_gb`, `max_allocated_storage_gb`
- `multi_az` (bool)
- `backup_retention_days`, `backup_window`, `maintenance_window`

## Outputs

- `endpoint`, `port`, `database_name`, `master_secret_arn`
