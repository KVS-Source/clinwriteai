# Deploy Runbook

## Deploy flow (automatic)

1. Developer pushes to `main` → GitHub Actions `ci` job runs (lint + typecheck + build + markdown lint).
2. If `ci` is green, `deploy-staging-standalone` job (Phase 1 Week 3 — not yet wired) SSHes to the staging VPS and runs `scripts/deploy.sh`.
3. `deploy.sh` on the VPS:
   - `git pull origin main`
   - `npm ci` + `npm run build` for `apps/api` and `apps/worker`
   - `rsync` build artefacts into `/opt/platform/apps/`
   - `npm ci --omit=dev` in the deployed dirs
   - `prisma migrate deploy` (forward-only migrations)
   - `systemctl restart platform-api platform-worker`
   - Health-check gate: wait up to 60s for `/health` to return 200
4. On success: ✓ in GitHub Actions. On failure: alert + previous version keeps running (no restart happens if build fails).

## Prod deploy (manual, change-controlled)

Prod deploys do NOT auto-trigger from `main`. A separate GitHub Actions workflow is triggered by a signed tag (`v*.*.*`):

1. On a PR to `main`, the developer tags the release: `git tag -s v1.2.3 -m 'release notes'`
2. On push of a `v*` tag, the `deploy-prod-standalone` workflow runs with required approvers.
3. Approver (DevOps lead) reviews the deploy against the change calendar + customer-impact considerations.
4. Approval triggers the same `scripts/deploy.sh` on the prod VPS.
5. Rollback: `git checkout <previous-tag> && scripts/deploy.sh`.

## Manual deploy (dev only — not for prod)

```bash
# SSH to the staging VPS
ssh platform@staging-vps

# From /opt/platform/repo
sudo /opt/platform/scripts/deploy.sh
```

## Rollback

Fast rollback (previous deploy still has artefacts cached by npm):

```bash
# On the VPS
cd /opt/platform/repo
sudo -u platform git checkout <previous-commit-sha>
sudo /opt/platform/scripts/deploy.sh
```

If a database migration landed with the bad deploy, rollback is harder — the migration is forward-only. Options:

- **Fast forward**: write a new migration that reverses the bad one and deploy that
- **Full restore**: use `scripts/restore.sh --at <timestamp just before bad deploy>` — loses any writes since

Policy: never ship a migration that can't be reversed by writing a new migration. If a migration is destructive (dropping a column), ship it in two deploys: first stop writing to the column, verify quiet, then drop in a second deploy.

## Health gates

The deploy script won't declare success unless:

- `curl /health` returns 200 within 60s of restart
- `systemctl is-active platform-api platform-worker` returns `active` for both

If either fails, the script exits non-zero and the GitHub Actions job fails. Services may still be running the new (broken) code — on-call engineer investigates.

## Downtime window

- Current (Phase 1): ~2–5s of 502s during restart (acceptable pre-SLA).
- Phase 6: blue/green deploys cut this to zero.

## Smoke tests after deploy

Automated (part of the `deploy.sh` script):
- `/health` returns 200

Manual (first deploy of a major release):
- Log in with a test account
- Create a dummy project
- Verify an audit event appears in `audit_events`
- Check Grafana for request latency + error rate
- Verify the queue is processing (`SELECT count(*) FROM bullmq_jobs WHERE state IN ('active','waiting')`)
