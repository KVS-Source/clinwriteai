# @platform/api — Aurora Backend

Backend for the Aurora/ClinWrite platform. Phase 1 target per [`architecture-implementation-plan.md`](../../docs/architecture-implementation-plan.md).

## Current status

**Phase 0 scaffold.** Nothing is wired yet beyond a `/health` endpoint. Phase 1 begins when ADRs 0001–0008 are Accepted.

## Stack (per ADRs)

- **Node.js 20+** · **TypeScript strict**
- **Fastify** HTTP framework ([ADR 0001](../../docs/adr/0001-backend-framework.md))
- **Prisma + raw SQL for audit trail** ([ADR 0002](../../docs/adr/0002-orm.md))
- **PostgreSQL + pgvector** ([ADR 0003](../../docs/adr/0003-vector-store.md))
- **Anthropic Claude** via centralised AI Gateway ([ADR 0004](../../docs/adr/0004-llm-provider.md))
- **Zod** schemas, shared via `@platform/types`
- **OpenTelemetry** instrumentation
- **Vitest + Testcontainers** for integration tests

## Local dev (once Phase 1 lands)

```bash
cp .env.example .env.local
# Fill in DATABASE_URL at minimum.

npm install
npm --workspace=apps/api run db:migrate:dev
npm --workspace=apps/api run dev
```

API will listen on `http://localhost:3001`. Health check: `curl http://localhost:3001/health`.

## Directory layout (planned)

```
apps/api/
├── prisma/
│   ├── schema.prisma         ← app-level models
│   ├── migrations/           ← Prisma + raw SQL migrations
│   └── seed.ts               ← seeds from apps/web/src/data/*.json
├── src/
│   ├── server.ts             ← Fastify entrypoint
│   ├── config/               ← env parsing + validation
│   ├── auth/                 ← SSO + MFA + session
│   ├── audit/                ← immutable audit trail repo + plugin
│   ├── ai-gateway/           ← centralised LLM calls per ADR 0004
│   ├── queue/                ← BullMQ workers per ADR 0008
│   └── modules/
│       ├── clinical-writing/
│       ├── scientific-writing/
│       ├── medical-writing/
│       ├── regulatory-writing/
│       └── ideation/
└── tests/
    ├── unit/
    └── integration/
```

Each module in `src/modules/<module>/` is a Fastify plugin — enforced boundary at runtime.

## Phase 1 kickoff checklist

Before writing production code:

- [ ] ADRs 0001–0008 Accepted (see [adr/](../../docs/adr/))
- [ ] `apps/api/src/config/env.ts` validates all required env vars at boot
- [ ] Prisma schema has Platform layer (~20 tables) migrated against a disposable Postgres
- [ ] Audit trail raw-SQL migration landed; audit repository unit-tested
- [ ] `/auth/login` + `/auth/mfa` returning real JWTs against test SSO
- [ ] Integration test harness green against Testcontainers Postgres
- [ ] OpenAPI spec served at `/docs` and matches `03-api-contract.md` endpoints that are implemented
- [ ] GitHub Actions `api` job expanded from scaffold-only to full typecheck + unit + integration
