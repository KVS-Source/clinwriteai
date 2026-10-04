# ADR 0001: Backend framework — Fastify over Express

**Status**: Proposed
**Date**: 2026-10-05
**Owner**: Tech lead
**Deciders**: Tech lead, 2× BE engineers
**Supersedes**: —
**Superseded by**: —

## Context

`docs/demo/01-architecture.md §1` lists "Node.js / Fastify or Express" without picking. The decision has to be made before Phase 1 begins because every subsequent choice (validation layer, OpenAPI generation, plugin ecosystem, request-lifecycle hooks for audit) cascades from it.

Two constraints:
1. We already own a types-first API contract (`packages/types/src/domain.ts` + `03-api-contract.md`) and want **schema-driven validation** on every request without hand-writing validators.
2. Every request handler must emit an audit event into the immutable audit trail (Phase 1). The framework's lifecycle hooks matter.

## Decision

**Fastify** for the `apps/api` HTTP layer.

Used as a single long-running Node process. Each module in `apps/api/src/modules/<module>/` registers its routes via a Fastify plugin. Request/response schemas come from Zod (shared with `apps/web` via `packages/types`); Fastify validates automatically. The audit-trail write runs in the `onResponse` hook so it fires even on 4xx/5xx without being bypassable by handler code.

## Options considered

### Option A — Fastify
- **Pros**
  - Schema-first: handlers declare Zod schemas, Fastify auto-validates request + response, auto-generates OpenAPI. Matches our types-first contract exactly.
  - ~2× throughput vs Express under identical workloads (published benchmarks).
  - First-class lifecycle hooks (`preHandler`, `preValidation`, `onResponse`, `onError`) that we need for RBAC and audit-trail writes without wrapper middleware spaghetti.
  - Plugin encapsulation model enforces module boundaries at runtime (prefix scoping, decorator isolation) — matches the ESLint-enforced module folders.
  - Active maintenance (OpenJS foundation project).
- **Cons**
  - Smaller plugin ecosystem than Express.
  - Lifecycle hook names and encapsulation take a day to internalise for Express-native engineers.
- **Rough effort / cost**: Zero migration cost (greenfield). Learning curve ~1 engineer-day.

### Option B — Express
- **Pros**
  - Largest Node.js ecosystem; nearly every integration has an Express example.
  - Every BE engineer knows it.
- **Cons**
  - No native schema validation → we hand-write Zod wrappers around every route, or add `express-zod-api` which reintroduces Fastify's shape without its performance.
  - No native OpenAPI generation → we hand-maintain OpenAPI YAML (drift risk) or bolt on `swagger-jsdoc` (comment-driven = unreliable).
  - Lower throughput; matters once we hit the 500-concurrent-author load target.
  - Middleware stack is linear and bypassable — audit hooks have to be wrapped by every handler author, who can forget.
- **Rough effort / cost**: Zero migration. But ~1–2 engineer-weeks over the project to compensate for the missing schema+OpenAPI story.

### Option C — Hono
- **Pros**: Even lighter, edge-friendly.
- **Cons**: Immature plugin ecosystem for enterprise concerns (Prisma, OpenTelemetry, Sentry adapters are second-class). Hono is optimised for edge runtimes we're not targeting.
- **Rejected** without deep evaluation.

## Rationale

The decisive factor is **schema-first validation + OpenAPI generation from a single Zod source of truth**. Our API contract is already defined (179 endpoints in `03-api-contract.md`); we need handlers that enforce it automatically, not hand-rolled validators that can drift. Fastify's plugin model also gives us a runtime enforcement of module boundaries that complements the ESLint boundaries we already use in `apps/web`.

Express would work, but the compensating effort to add the missing bits (schema validation, OpenAPI, structured lifecycle for audit) over the project is 1–2 engineer-weeks — enough to justify the small learning curve on Fastify.

## Consequences

### Positive
- Every endpoint has validated request + response shapes with zero handler boilerplate.
- OpenAPI spec is generated at build time, served at `/docs`, and consumed by the frontend's auto-generated API client (eliminating hand-maintained `publicationsApi.ts` etc. post-Phase 2).
- Audit-trail writes run in `onResponse` hook — architecturally impossible to bypass from a handler.
- Module isolation at runtime via Fastify plugins + prefix scoping.

### Negative
- Engineers used to Express will spend 1–2 days learning Fastify's encapsulation and lifecycle hooks.
- Some ecosystem gaps (fewer Stack Overflow answers for exotic plugins) — mitigated by Fastify's own docs being high-quality.

### Neutral / downstream work
- ADR 0002 (ORM) and ADR 0008 (job queue) decisions should both consider Fastify plugin availability.
- A Fastify starter template needs to be scaffolded in `apps/api/` in Phase 1 Week 3.
- The frontend's `apps/web/src/api/*.ts` client files are candidates for replacement by a generated client from the OpenAPI spec (defer to Phase 2 Week 8).

## Compliance implications

- **21 CFR Part 11 §11.10(e)**: Secure, computer-generated, time-stamped audit trails. The `onResponse` hook is where this gets implemented and must be impossible to bypass — Fastify's lifecycle model supports this; verify in Phase 1 validation.
- **GAMP 5**: Framework choice is documented in the Functional Specification (FS) deliverable in Phase 5.

## References

- Fastify v5 docs: https://fastify.dev/docs/latest/
- Fastify vs Express benchmarks: https://fastify.dev/benchmarks/
- Zod + Fastify integration pattern: `fastify-type-provider-zod`
