# CLAUDE.md

Instructions for assistants working in this repo. Keep this file short —
link out to docs rather than inlining long context.

## Development focus

- **Clinical Writing (Module A)** — handed to Dev + QA. See
  [memory/project_phase_3a_deferrals.md](../../Users/cheta/.claude/projects/c--Chetan-GenBioCa-LifeSciences/memory/project_phase_3a_deferrals.md).
- **Tenant Administrative** — live. Tenant / org / project CRUD +
  module toggles, user + role management, SSO/IdP config, audit log
  viewer + compliance exports. Shipped Arc 2-4.
- **Modules B / C / D / E** — re-enabled 2026-10-08 (Arc 11). Each
  module exposes its shipped surface; external-blocker items (PubMed /
  CrossRef / ORCID for B; FDA ESG / EMA CESP for D; etc.) are listed in
  each module's deferrals memory and are pending vendor procurement.
- **DPDPA 2023 compliance** — foundations landed Arc 7
  ([memory/project_dpdpa.md](../../Users/cheta/.claude/projects/c--Chetan-GenBioCa-LifeSciences/memory/project_dpdpa.md));
  finalisation (DPO workflow, DPB breach-notification endpoint, pen
  test) is Arc 10 and blocked on MeitY Rules finalisation.

### Kill-switch mechanics

- **API**: `FEATURE_MODULES_ENABLED` env var (comma-separated,
  default `A`). Routes guarded by
  `requireAuth({ modules: ['B'] })` return `503 module_disabled` when
  the module isn't in the enabled set. See
  [apps/api/src/auth/rbac.ts](apps/api/src/auth/rbac.ts).
- **Web**: `VITE_MODULES_ENABLED` env var (same shape). Sidebar hides
  disabled modules; deep links land on `ModuleDisabledScreen` via
  `<ModuleGate />` in the router. See
  [apps/web/src/config/modules.ts](apps/web/src/config/modules.ts).

### Re-enabling a frozen module

1. Add the module key to `FEATURE_MODULES_ENABLED` (API env).
2. Add the same key to `VITE_MODULES_ENABLED` (web env).
3. Rebuild + redeploy both.

The two must move together — a web build with `B` enabled against an
API without `B` just gets 503s on every call. API without the web flag
is harmless but shows nothing in the sidebar.

### Plan

[docs/pivot-plan.md](docs/pivot-plan.md) is the trackable plan — 12
Arcs. Arcs 1-9 + 11 landed; Arc 10 (DPDPA finalisation) + Arc 12
(launch infra + external audits) await external gates. See the
"Post-handover roadmap" section of pivot-plan.md for status.

## Repo map

- `apps/api` — Fastify + Prisma backend. Port 3001 locally.
- `apps/web` — Vite + React SPA. Port 5173 locally.
- `apps/worker` — Background job runner (BullMQ consumer).
- `packages/types` — Shared TS interfaces. UI consumes these; API shapes
  Prisma rows to match them via inline `*Shape()` helpers per route.
- `docs/` — Living architecture docs + runbooks.
- `infra/standalone/` — Single-VPS deploy scripts + systemd units.

## Conventions

- **Shape mappers** live inline in route files (no premature extraction
  to a shared package). Pattern: a pure `*Shape()` function + optional
  batched `fetch*Context()` helper. See
  [apps/api/src/modules/clinical-writing/documents/routes.ts](apps/api/src/modules/clinical-writing/documents/routes.ts)
  for the canonical example.
- **Audit chain**: every mutating route appends via `app.audit.append`.
  Hash-chained; `AUDIT_HASH_SECRET` never rotates (breaks the chain).
- **Validation protocol**: when the user asks for validation passes, run
  **3 cycles** — typecheck + tests → build → git-status review. See
  [memory/feedback_validation_passes.md](../../Users/cheta/.claude/projects/c--Chetan-GenBioCa-LifeSciences/memory/feedback_validation_passes.md).
- **Secrets**: `docs/.env` and `docs/.clinwrite-db-credentials.local.md`
  are gitignored and contain real production values. Never paste
  secrets into chat.

## Testing

```bash
npm --workspace=apps/api test -- --run    # vitest, ~88 tests, <2s
npm --workspace=apps/api run build         # tsc --build
npm --workspace=apps/web run build         # tsc && vite build
```

CI also runs a `web-integration` job that spins postgres + redis +
built API container, seeds, then runs Playwright smoke against the
live API with MSW off.

## Module deferrals

Each module has a deferral memory
([project_phase_3b_deferrals.md](../../Users/cheta/.claude/projects/c--Chetan-GenBioCa-LifeSciences/memory/project_phase_3b_deferrals.md)
through `3e`) listing the shape-mapper work landed in batches 37-59 +
the external blockers (vendor licences, SDK procurement) + the
remaining scope-choice items. Modules are re-enabled at runtime —
work the deferrals memory per module when picking one up.
