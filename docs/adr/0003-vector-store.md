# ADR 0003: Vector store — pgvector on the same Postgres instance

**Status**: Proposed
**Date**: 2026-10-05
**Owner**: AI engineer (TBD) + Tech lead
**Deciders**: Tech lead, AI engineer, DevOps
**Supersedes**: —
**Superseded by**: —

## Context

Two production features need vector similarity search:

1. **Claims Matrix similarity engine** (Module C, Phase 3C) — match proposed claims against the Master Library's corpus of approved claims. ~10k–50k claims per tenant, growing linearly.
2. **Content Card similarity** (Module E, Phase 3E, lower priority) — find duplicate or near-duplicate atomised content cards.

Both need: cosine-similarity nearest-neighbour queries, filtered by tenant/project, with the ability to re-rank or filter by metadata (TA, lifecycle status, approval date).

Options span a continuum from "run it inside Postgres" to "run a dedicated vector DB alongside Postgres".

## Decision

**`pgvector` extension on the same PostgreSQL cluster** that hosts the application data. Use HNSW indexes with cosine distance. Keep embeddings in the same tenant-scoped rows as the originating content.

Revisit when any single tenant exceeds ~500k vectors or when p99 query latency exceeds 100ms despite tuning.

## Options considered

### Option A — pgvector in Postgres *(chosen)*
- **Pros**
  - **Zero additional infrastructure** — Postgres is already in the stack.
  - **Transactional consistency** — a claim and its embedding are inserted in the same transaction; impossible to have one without the other.
  - **Tenant isolation for free** — the same row-level filters that scope Postgres queries scope vector queries.
  - **HNSW indexes** (added in `pgvector` 0.5.0) give sub-10ms p95 for datasets up to ~1M vectors on modest hardware.
  - **Single backup / restore / audit story** — compliance paperwork covers vectors by default.
  - **No separate network hop** — joining vector results back to row metadata is a local join, not a cross-service call.
- **Cons**
  - Scaling limits around ~1M vectors per index; mitigation is partitioning by tenant.
  - Index rebuild on bulk ingest can be slow; mitigate by using `CONCURRENTLY` option and inserting in batches.
- **Rough effort / cost**: 0.5 engineer-week to add the extension + migration + initial index + benchmark harness. $0 incremental infra.

### Option B — Pinecone (managed vector DB)
- **Pros**: Purpose-built, massive scale, excellent recall benchmarks, hosted.
- **Cons**
  - **Separate data store** — breaks transactional consistency; need an outbox pattern to keep claim rows and Pinecone in sync. Extra failure modes.
  - **~$70/month minimum** per tenant for a dedicated namespace; multi-tenant namespace sharing creates its own isolation problem.
  - **Separate compliance surface** — Pinecone's SOC 2 report has to be read into our audit; vendor BAA needs to be negotiated for HIPAA tenants (slow).
  - **Network latency** — ~30–80ms per query vs <10ms local pgvector.
  - **Vendor lock-in** — their query API is proprietary.
- **Rough effort / cost**: 1–2 engineer-weeks for outbox + sync. ~$70–200/tenant/month ongoing.

### Option C — Weaviate / Qdrant (self-hosted vector DB)
- **Pros**: Richer vector-DB features than pgvector (hybrid search, filtering).
- **Cons**: Another service to deploy, monitor, patch, back up. Separate access control. Same transactional-consistency problem as Pinecone.
- **Rough effort / cost**: 2–3 engineer-weeks for deploy + ops integration + outbox. Significant ongoing DevOps load.

### Option D — Elasticsearch with dense_vector
- **Pros**: If we were already running Elastic for search, this would be a freebie.
- **Cons**: We're not running Elastic. Deploying it just for vectors is the worst of all worlds.
- **Rejected**.

## Rationale

For our scale (likely ≤100k vectors per tenant in year 1), pgvector is objectively the right call: it's faster per-query than any networked vector DB, it keeps compliance simple, and it piggybacks on the Postgres HA, backup, and audit infrastructure we're already investing in. The counter-argument — "but what if we need to scale to millions?" — is a problem for later, and the migration path from pgvector to Pinecone/Weaviate is well-trodden if we ever need it.

Decisive factor: **transactional consistency between the semantic row and its embedding**. For a regulated-content product where every claim must be traceable, having the vector and the row in different systems is a correctness liability.

## Consequences

### Positive
- Simplest possible operations story (one DB).
- Compliance posture inherits from the Postgres compliance work (no second vendor review).
- Local joins between vector-ranked candidates and row metadata are trivially fast.
- Zero incremental hosting cost.

### Negative
- Index tuning (HNSW `m` and `ef_construction` parameters) requires an AI/DBA engineer to benchmark on realistic data; defaults are good but not optimal.
- Postgres major-version upgrades need to validate pgvector compatibility first (minor friction every 1–2 years).
- Hard limit at ~1M vectors per table before we need to partition — we'll want a monitoring alert at 500k.

### Neutral / downstream work
- Phase 1 Week 4: add `CREATE EXTENSION pgvector` to the initial migration.
- Phase 3C: Module C BE owner implements the Claims Matrix similarity service against pgvector.
- Phase 6: monitoring on `pg_stat_user_indexes` for vector indexes; alert at 500k rows/tenant.
- Embedding model choice is a separate decision (ADR 0012 — Claims Matrix similarity engine).

## Compliance implications

- **No change** to the compliance surface — vectors live in the same database as the content they describe, under the same tenancy, backup, and audit controls.
- **HIPAA**: embeddings are a derived form of the source text and may themselves be PHI if the source is PHI. Confirm with Compliance that the embedding is covered under the same encryption-at-rest controls as the source row (it is, since both are in the same Postgres).

## References

- `pgvector` 0.5 HNSW announcement: https://github.com/pgvector/pgvector/releases/tag/v0.5.0
- Supabase pgvector benchmark: https://supabase.com/blog/pgvector-vs-pinecone
- HNSW algorithm overview: https://arxiv.org/abs/1603.09320
