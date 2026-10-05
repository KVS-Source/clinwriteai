# ADR 0008: Job queue — BullMQ on ElastiCache Redis

**Status**: Accepted (2026-10-05, defaults policy)
**Date**: 2026-10-05
**Owner**: Tech lead
**Deciders**: Tech lead, 2× BE engineers, DevOps
**Supersedes**: —
**Superseded by**: —

## Context

The architecture doc (`01-architecture.md`) assumes synchronous request/response for everything. The implementation plan's "pushback" section flagged this as a gap: multiple real workloads are too slow or too side-effectful for a synchronous HTTP response.

Async jobs we need from Phase 1:

| Workload | Typical duration | Reason it's async |
|---|---|---|
| AI calls (Module A/C/D agentic flows) | 5–60s | HTTP timeout risk; retries; per-tenant rate limit |
| Notification fan-out (email + SMS + in-app) | 1–5s per recipient | Can delay response; retries on vendor failure |
| eCTD validation (Phase 3D) | 60–300s | Hard timeout limit; LRO pattern |
| Cross-module consistency check (Phase 3D) | 30–120s | Same |
| Canonical JSON indexing on CSR ingest (Phase 3D) | 30–180s | Long I/O-heavy work |
| Content expiry alerts (Module C, scheduled) | — | Cron-driven; 60-day + 30-day warnings |
| Source currency check (Module E, scheduled) | — | Cron-driven; 90-day rule |
| Publishing calendar overdue detection (Module E) | — | Cron-driven; hourly scan |
| Audit log retention sweep | — | Cron-driven; nightly |
| Backup orchestration | — | Cron-driven |

Requirements:

- Delayed jobs + scheduled (cron) jobs
- Priority queues (safety alerts outrank batch exports)
- Retry with exponential backoff + dead-letter queue
- Per-queue rate limiting (critical for AI gateway tenant throttling)
- Observability (what's queued, what's retrying, what's dead-lettered)
- Portable (not AWS-locked at the API level, even though we deploy on AWS per ADR 0007)

## Decision

**BullMQ** as the job queue library, backed by **ElastiCache for Redis** (Redis 7, cluster mode disabled at Phase 1 scale — single node + replica for HA).

Workers run as a separate Fargate service (`apps/api` is HTTP only; `apps/worker` is the queue consumer — new scaffold in Phase 1 Week 4).

Scheduled jobs use BullMQ's `JobScheduler` (replaces the legacy `repeatable jobs`) for cron-driven work.

## Options considered

### Option A — BullMQ + Redis *(chosen)*
- **Pros**
  - **Best Node.js queue DX by a wide margin.** TypeScript-first; events typed; Flows API for multi-step jobs (needed for the ingest → index → notify chain).
  - **Rich scheduler**: `JobScheduler` supports cron patterns, delayed jobs, repeatable jobs. Needed for Module C expiry alerts and Module E currency checks.
  - **Priority queues**: safety alerts can jump ahead of batch exports in the same queue.
  - **Per-queue rate limiting**: critical for AI Gateway tenant throttling — we can cap "no more than 10 Anthropic calls/sec per tenant" at the queue level.
  - **Portable**: BullMQ runs on any Redis. Not AWS-locked.
  - **Great local dev**: `docker run redis` and you're going. SQS requires LocalStack or hitting real SQS.
  - **Observability**: Bull Board, Taskforce, or custom dashboard — all production-tested.
- **Cons**
  - **Needs Redis**: another thing to run (mitigated: ElastiCache is managed).
  - **At-least-once semantics**: jobs must be idempotent (true for SQS too, but worth stating).
  - **Memory bound**: Redis is in-memory; a backlog of 10M jobs will cost RAM. Mitigate: eviction policy + dead-letter cleanup cron.

### Option B — AWS SQS + Lambda / Fargate workers
- **Pros**
  - **Fully managed**: no Redis to run.
  - **AWS-native**: IAM-scoped, CloudWatch-integrated.
  - **Visibility timeout** model is simple.
- **Cons**
  - **No native cron scheduler** — have to pair with EventBridge, which adds a second mental model.
  - **No priority queues** — need separate SQS queues per priority and consumer logic that polls them in order.
  - **No per-queue rate limiting** — have to implement in the consumer.
  - **FIFO queues are limited** (300 msg/s default, extended throughput is per-group).
  - **Local dev needs LocalStack** or real AWS calls.
- **Rejected** because the cron scheduler + priority + rate-limit combination is 60% of why we need a queue at all.

### Option C — Temporal
- **Pros**: Workflow orchestration; durable execution; replay semantics great for long sagas.
- **Cons**
  - **Heavy**: self-hosting Temporal is a project; Temporal Cloud is expensive.
  - **Overkill for Phase 1** workloads — most of our async work is "do thing, with retries", not multi-step sagas with human-in-the-loop steps.
  - Steeper learning curve than BullMQ.
- **Deferred**: revisit if Phase 3D's canonical JSON indexing + consistency check pipeline grows into a true saga pattern.

### Option D — RabbitMQ
- **Pros**: Mature; feature-rich.
- **Cons**: AMQP broker to run and tune; Erlang runtime; no advantage over BullMQ+Redis at our scale.
- **Rejected**.

### Option E — NATS JetStream
- **Pros**: Fast, lightweight, OSS.
- **Cons**: Smaller Node ecosystem; weaker scheduler story; another service to run with less community reach than Redis.
- **Rejected**.

## Rationale

Three decisive factors:

1. **Scheduler + priority + rate-limit combo.** The architecture plan calls out at least 4 cron-driven workloads (content expiry, source currency, publishing overdue detection, audit retention). SQS requires EventBridge for scheduling, custom queue-polling order for priorities, and consumer-side rate limiting. BullMQ gives all three natively.
2. **Per-tenant AI rate limiting.** The AI Gateway (per ADR 0004) enforces per-tenant Anthropic/Azure quotas. BullMQ's per-queue rate limiter is the enforcement point — one line of config per tenant.
3. **DX advantage ships faster.** BullMQ's TypeScript DX and local Redis story make queue-backed features easier to write and test, which matters on a 9-month timeline.

Redis is "another thing to run" but it's ElastiCache — managed, HA, backed up, auto-failover. Not a real ops burden.

## Consequences

### Positive
- Cron-driven workloads are first-class, not EventBridge-glued.
- Priority queues let safety alerts (hepatotoxicity SAE narrative review) jump ahead of batch exports.
- Per-tenant rate limits on AI calls enforced at queue level, uniformly across all AI workloads.
- Flows API handles the ingest → index → notify multi-step chains needed in Phase 3D.
- Dev loop: `docker-compose up redis postgres` and the app runs fully offline.

### Negative
- Requires ElastiCache Redis cluster (same cluster as the Fastify session store per ADR 0007 — not an extra service).
- Workers are a separate deploy target (`apps/worker`) — more CI steps, more monitoring surface.
- At-least-once delivery means every job handler must be idempotent. Documented convention + lint rule.

### Neutral / downstream work
- Phase 1 Week 4: `apps/worker/` scaffolded alongside `apps/api/`. Same TypeScript config; shares `packages/types`.
- Phase 1 Week 4: BullMQ dashboard (Bull Board) mounted on `apps/api/admin/queue` behind Super Admin RBAC.
- Phase 1 Week 4: `.env.example` adds `REDIS_URL` (already present); documents cron schedules in `apps/worker/README.md`.
- Phase 1 Week 5: idempotency convention documented; audit event emitted on job start + completion + retry.
- Phase 3A onwards: feature code enqueues via a typed `JobProducer` interface; direct `queue.add()` calls lint-blocked.
- Phase 6: load-test queue throughput; tune Redis cluster size.

## Compliance implications

- **21 CFR Part 11 §11.10(e)**: every job emits audit events on enqueue, start, retry, dead-letter, completion. The audit trail covers the queue's lifecycle alongside the HTTP lifecycle.
- **GAMP 5**: BullMQ version is a Configuration Item; job schedules are Configuration Items.
- **SOC 2 CC7.1**: system monitoring — Bull Board + CloudWatch alarms cover queue depth, dead-letter growth, worker health.

## References

- BullMQ docs: https://docs.bullmq.io/
- BullMQ JobScheduler (replaces repeatable jobs): https://docs.bullmq.io/guide/job-schedulers
- Bull Board: https://github.com/felixmosh/bull-board
- ElastiCache for Redis best practices: https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/BestPractices.html
