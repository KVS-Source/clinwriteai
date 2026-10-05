# iam module

Cross-account IAM roles for CI deploys via GitHub Actions OIDC federation. **No long-lived AWS access keys** stored anywhere.

## Roles (planned)

- `platform-ci-deploy-<env>` — assumed by GitHub Actions via OIDC when the workflow runs on `main`. Scoped to only the resources that env's deploy touches.
- `platform-terraform-apply-<env>` — assumed by DevOps (via SSO) when running `terraform apply` locally.
- `platform-readonly-<env>` — assumed by on-call / support for debug access without mutation rights.

## Trust policy pattern

GitHub OIDC provider trusted for the `KVS-Source/clinwriteai` repo, with condition that limits to specific branches/tags (e.g. `main` for staging deploy, `v*` tags for prod deploy).

Scoped so a compromised GitHub Actions run cannot touch resources outside its target env.
