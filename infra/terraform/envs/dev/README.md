# envs/dev — Development environment root module

Composes `modules/*` to stand up the dev environment on AWS. Single-AZ RDS, no replica Redis, smallest Fargate task sizes.

## Phase 1 Week 2 — DevOps TODO

Fill in `main.tf` with:

```hcl
module "network" {
  source   = "../../modules/network"
  env      = "dev"
  region   = "us-east-1"
  vpc_cidr = "10.10.0.0/16"
}

module "database" {
  source               = "../../modules/database"
  env                  = "dev"
  vpc_id               = module.network.vpc_id
  database_subnet_ids  = module.network.database_subnet_ids
  instance_class       = "db.t4g.medium"
  allocated_storage_gb = 100
  multi_az             = false
  backup_retention_days = 7
}

# ... cache, secrets, object-storage, edge, compute, worker, observability, iam
```

Then: `terraform init -backend-config=backend.conf && terraform plan && terraform apply`.
