# @platform/api — Aurora Backend

Backend for the Aurora/ClinWrite platform. Phase 1 target per [`architecture-implementation-plan.md`](../../docs/architecture-implementation-plan.md).

## Current status

**Phase 1 scaffold.** Fastify server with health + ready endpoints, env + secrets config loader, audit-trail hash-chain module with passing unit tests, Prisma multi-file schema with initial + audit_trail SQL migrations. **Next (Phase 1 Week 3–5)**: Prisma client, auth routes (WorkOS SSO + JWT session), audit plugin wiring, OpenAPI generation from Zod.

## Stack (per ADRs)

- **Node.js 20+** · **TypeScript strict**
- **Fastify** HTTP framework ([ADR 0001](../../docs/adr/0001-backend-framework.md))
- **Prisma** multi-file schema + raw SQL for `audit_events` ([ADR 0002](../../docs/adr/0002-orm.md))
- **PostgreSQL + pgvector** (dim ≤ 1536) ([ADR 0003](../../docs/adr/0003-vector-store.md))
- **Anthropic Claude** via centralised AI Gateway ([ADR 0004](../../docs/adr/0004-llm-provider.md))
- **WorkOS** SSO ([ADR 0005](../../docs/adr/0005-sso-provider.md))
- **SecretsProvider** interface — sops+age standalone, AWS Secrets Manager cloud ([ADR 0006](../../docs/adr/0006-secrets-manager.md))
- **Standalone VPS** year 1, AWS/Azure year 2 ([ADR 0007](../../docs/adr/0007-deployment-target.md))
- **BullMQ** on Redis ([ADR 0008](../../docs/adr/0008-job-queue.md))
- **Standalone deployment stack** — Compose + nginx + MinIO + Prom/Grafana/Loki + sops + B2 backup ([ADR 0009](../../docs/adr/0009-standalone-deployment-stack.md))
- **Zod** schemas, shared via `@platform/types`
- **OpenTelemetry** instrumentation
- **Vitest + Testcontainers** for integration tests

## Local dev

```bash
# From repo root — start data services (Postgres + Redis + MinIO)
make -C infra/standalone dev

# In another terminal — run the API
cp apps/api/.env.example apps/api/.env.local
# Set DATABASE_URL to postgresql://platform:platform@localhost:5432/platform_dev
npm install
npm --workspace=apps/api run db:generate
npm --workspace=apps/api run db:migrate:dev
npm --workspace=apps/api run dev
```

API listens on `http://localhost:3001`. Health check: `curl http://localhost:3001/health`.

## Directory layout

```
apps/api/
├── prisma/
│   ├── schema/                      ← multi-file Prisma schema (ADR 0002 amendment)
│   │   ├── schema.prisma            ← generator + datasource only
│   │   └── platform.prisma          ← User / Session / Project models
│   └── migrations/                  ← Prisma + raw SQL migrations
│       ├── 00000000000001_init/     ← extensions (pgcrypto, pgvector)
│       └── 00000000000002_audit_trail/  ← immutable audit_events (raw SQL)
├── src/
│   ├── server.ts                    ← Fastify entrypoint
│   ├── config/
│   │   ├── env.ts                   ← Zod-validated env
│   │   └── secrets.ts               ← SecretsProvider interface + impls
│   ├── audit/
│   │   ├── hash.ts                  ← hash-chain primitives
│   │   ├── hash.test.ts             ← unit tests (passing)
│   │   ├── repository.ts            ← append-only repo (InMemory + Postgres impls)
│   │   └── repository.test.ts       ← unit tests (passing)
│   ├── auth/                        ← [Phase 1 W5] WorkOS + JWT + MFA
│   ├── ai-gateway/                  ← [Phase 4] centralised LLM calls
│   ├── queue/                       ← [Phase 1 W4] BullMQ producer interface
│   └── modules/                     ← [Phase 3A-3E] per-module Fastify plugins
└── tests/
    ├── unit/                        ← vitest (fast, no DB)
    └── integration/                 ← vitest + Testcontainers Postgres
```

Each module in `src/modules/<module>/` will be a Fastify plugin — enforced boundary at runtime.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Watch mode with tsx |
| `npm run build` | TypeScript compile |
| `npm run start` | Run compiled JS |
| `npm run typecheck` | Type-check without emit |
| `npm run test` | Unit tests (fast) |
| `npm run test:integration` | Integration tests (Testcontainers Postgres) |
| `npm run db:generate` | Prisma client codegen |
| `npm run db:migrate:dev` | Apply + create migrations (dev) |
| `npm run db:migrate` | Apply migrations (prod, forward-only) |
| `npm run db:studio` | Open Prisma Studio GUI |

## Phase 1 kickoff checklist

- [x] ADRs 0001–0009 Accepted ([docs/adr/](../../docs/adr/))
- [x] `apps/api/src/config/env.ts` validates all required env vars at boot
- [x] Prisma multi-file schema layout (`prisma/schema/*.prisma`)
- [x] Audit trail raw-SQL migration (`prisma/migrations/00000000000002_audit_trail/`)
- [x] Audit repository + hash chain + unit tests (passing)
- [ ] Prisma client generated against Postgres and typechecked by `apps/api`
- [ ] `src/audit/plugin.ts` — Fastify `onResponse` hook wires repository
- [ ] `src/audit/postgres-repository.ts` — the real Postgres impl replaces InMemory
- [ ] `src/auth/plugin.ts` + `src/auth/routes.ts` — WorkOS SSO + MFA + JWT
- [ ] RBAC middleware with Admin / Super Admin / project roles
- [ ] `/auth/login` + `/auth/mfa` return real JWTs against test SSO
- [ ] OpenAPI spec served at `/docs` from Zod schemas
- [ ] Integration test harness green against Testcontainers Postgres
- [ ] CI `api` job expanded from scaffold-only to full typecheck + unit + integration
- [ ] GitHub Actions `deploy-standalone-staging` job wires `infra/standalone/scripts/deploy.sh`
