# @platform/worker — BullMQ Workers

Separate Fargate service that consumes jobs enqueued by `apps/api` via BullMQ ([ADR 0008](../../docs/adr/0008-job-queue.md)).

## Current status

**Phase 0 scaffold.** Package exists so the workspace resolves and `apps/worker/` has a committed presence. Real code lands in Phase 1 Week 4.

## Why a separate service

Keeping workers out of `apps/api`:

- HTTP latency isn't degraded by long-running jobs (AI calls, eCTD validation)
- Workers autoscale on queue depth; API autoscales on request rate — different signals
- A worker crash doesn't affect ability to serve HTTP
- Blue/green deploys of workers don't require ALB drain

## Planned workloads (ADR 0008 §Context)

| Workload | Queue | Trigger | Priority |
|---|---|---|---|
| AI call | `ai` | HTTP enqueue | medium |
| Notification fan-out | `notifications` | HTTP enqueue | medium |
| eCTD validation | `ectd-validation` | HTTP enqueue | high |
| Cross-module consistency check | `consistency` | HTTP enqueue | high |
| Canonical JSON indexing | `canonical-index` | HTTP enqueue | low |
| Content expiry alerts | `expiry` | Cron (daily) | low |
| Source currency check | `source-currency` | Cron (daily) | low |
| Publishing calendar overdue scan | `publishing-overdue` | Cron (hourly) | medium |
| Audit log retention sweep | `audit-retention` | Cron (nightly) | low |

## Phase 1 Week 4 TODO

- `src/worker.ts` entrypoint (BullMQ `Worker` per queue)
- Idempotency convention + lint rule
- Audit event emission on enqueue, start, retry, dead-letter, completion
- Bull Board dashboard mount under `apps/api/admin/queue` (Super Admin only)
- Shared `apps/api/src/queue/` producer types imported here
