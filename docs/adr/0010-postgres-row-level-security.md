# ADR 0010: Postgres row-level security — permissive-by-default infrastructure

**Status**: Accepted
**Date**: 2026-10-05
**Owner**: Platform engineering
**Deciders**: Platform engineering (compliance consulted)
**Supersedes**: —
**Superseded by**: —

## Context

The app layer enforces tenant isolation by filtering every query by
`tenantId` (either directly or via a `projectId` subquery). This is correct,
but it is a single layer of defence. A bug in a new route — forgetting the
tenant filter in a Prisma query — would leak cross-tenant data silently.
SOC 2 CC6.1 + ISO 27001 A.5.15 both call out defence-in-depth for data
segregation; auditors look for a database-layer control alongside the
app-layer one.

Postgres row-level security (RLS) is the standard database-layer control.
Enabling it late in a product lifecycle is expensive — every query path
needs re-verifying — so landing the infrastructure early (even if
non-enforcing initially) buys us an easy flip-the-switch later.

## Decision

Enable RLS on the six top-level tenant-scoped tables (`projects`,
`documents`, `publications`, `med_content_items`, `regulatory_submissions`,
`ideation_projects`) with **permissive-by-default** policies that activate
only when the connecting session sets the `app.tenant_id` GUC. The current
API doesn't set this GUC, so RLS is a passthrough — zero behavior change
today, real defence-in-depth once the connection-plumbing follow-up ships.

Policy shape:
```sql
CREATE POLICY tenant_isolation ON <table>
  FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR <tenant check for this table>
  )
```

Shipped as migration `00000000000027_rls_infrastructure` (commit b11b953).

## Options considered

### Option A — Permissive-by-default now, strict later (**chosen**)
- **Pros** Infrastructure in place without changing the app. Follow-up
  (SET LOCAL per Prisma $transaction) is a focused change in one place.
  Auditors see RLS enabled today; the strict flip is a scope-later ticket.
- **Cons** Tempting to leave in permissive state forever. Mitigated by a
  tracked compliance follow-up and a Prometheus alert that can be added
  later checking `current_setting('app.tenant_id', true)` is set per
  authed request.
- **Rough effort / cost** 1 migration + ~100 lines SQL.

### Option B — Strict RLS from day one
- **Pros** Zero drift risk — enforcement is on at every query.
- **Cons** Requires wrapping every Prisma call in a `$transaction` that
  does `SET LOCAL app.tenant_id` first. ~50 route handlers touched.
  High risk of a missed query path 500-ing in prod. Prisma's connection
  pool makes session-level GUCs unusable — only transaction-level works.
- **Rough effort / cost** 2-3 weeks + QA cycle.

### Option C — Separate app DB user with no `BYPASSRLS`
- **Pros** Flip the role, policies activate.
- **Cons** Breaks the migration tooling (prisma migrate expects to apply
  schema changes which require higher privileges than the app). Needs
  per-env role management. More operational surface.
- **Rough effort / cost** ~1 week + ops runbook.

## Rationale

Option A gets the compliance signal landed now without the risk of a
cross-codebase refactor. The second-best (Option B) is the right eventual
end state, but shipping it before Prisma connection scoping is figured out
would 500 many query paths. Option C solves a different problem (role
hygiene) that isn't the primary gap today.

## Consequences

### Positive
- Auditors can inspect `pg_class.relrowsecurity` and `pg_policies` to
  confirm RLS infrastructure exists.
- Infrastructure for strict enforcement is in place; activation is a
  single-location change (the Prisma connection wrapping) + a one-line
  policy edit per table (drop the NULL/'' branch).
- Any future direct psql access by a role without BYPASSRLS respects
  the policies immediately.

### Negative
- Easy to forget to come back and flip. Need a tracked ticket + ideally
  a Prometheus alert that fires if authed requests don't set
  `app.tenant_id`.

### Neutral / downstream work
- **Follow-up: Prisma connection scoping** — wrap authed requests in
  a `$transaction` that `SET LOCAL app.tenant_id = <value>` at the top.
  Blocks the enforcement flip.
- **Follow-up: Expand coverage** — child tables (comments, voice_notes,
  presence_sessions, etc.) deserve the same treatment once the parent
  tables are enforcing cleanly.
- **Follow-up: strict policies** — once connection scoping ships,
  drop the NULL/'' branch per table.

## Compliance implications

- **SOC 2 CC6.1**: data segregation. RLS satisfies the "logical access
  controls restrict data" criterion when enforcing. Permissive-by-default
  is a documented step on the path to that control.
- **ISO 27001 A.5.15**: access control. Same.
- **HIPAA §164.312(a)(1)**: access control. Same.
- Part 11 / GAMP 5: no direct touchpoint — these are about audit trail
  and software validation, not data segregation.

## References

- Postgres docs: [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- Migration: `apps/api/prisma/migrations/00000000000027_rls_infrastructure/migration.sql`
- Shipping commit: `b11b953`
- Memory follow-up: `project_phase_5_deferrals.md` under "Operational tasks"
