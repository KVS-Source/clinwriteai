# Development focus pivot — plan

**Decided 2026-10-06.** All new work is on **Tenant Administrative** +
**Clinical Writing (Module A)** only. Modules B / C / D / E are frozen
at runtime (code preserved, routes disabled, nav hidden). Resume order
decided later, after Module A is handed to Dev + QA.

Progress is tracked by Arc. Each Arc has numbered items; tick them off
as commits land. "Done" definition is at the end of each Arc.

---

## Arc 1 — Pivot setup ✅ landed 2026-10-06 (commit 8ca9bd1)

Low-risk housekeeping that locks in the pivot. One batch of commits.

- [x] **1.1** Add a `FEATURE_MODULES_ENABLED` env var on API; default to
      `['A']`. Any route whose `requireAuth({ modules: [...] })` list
      doesn't intersect the enabled set returns `503 module_disabled`.
- [x] **1.2** Hide B / C / D / E entries in the web nav
      (`apps/web/src/components/layout/Sidebar.tsx`); keep the route
      files mounted so deep links show a "module disabled" screen rather
      than 404.
- [x] **1.3** Add a `/CLAUDE.md` section documenting the pivot (focus
      modules, frozen modules, how to re-enable).
- [x] **1.4** Save a `project_focus_pivot` memory so future sessions see
      the strategy change.
- [x] **1.5** Mark Phase 2 cutover doc with a banner: shape-mapper work
      for B/C/D/E stays merged but is on ice.

**Done when:** `curl /publications` on a dev instance returns 503;
sidebar only shows Clinical Writing + Admin.

---

## Arc 2 — Tenant Admin data model

Foundation for Arcs 3 + 4. One Prisma schema file
(`apps/api/prisma/schema/tenant.prisma`) + one migration.

- [ ] **2.1** `Tenant` model: `id, name, slug (unique), status
      (active|suspended|archived), modulesEnabled String[],
      createdAt, archivedAt`.
- [ ] **2.2** `SsoConnection` model (per-tenant): `id, tenantId, type
      (oidc|saml), workosConnectionId, callbackUrl, status
      (draft|verified|disabled), createdAt`.
- [ ] **2.3** `Membership` model: `id, tenantId, userId, role
      (owner|admin|writer|reviewer|viewer), status, invitedAt,
      activatedAt`. Replaces `User.role` for tenant-scoped roles;
      `User.role` stays only for the platform-level `super-admin`
      super-user bit.
- [ ] **2.4** Backfill migration: existing `User.tenantId` strings
      promoted to Tenant rows; each User gets one Membership per
      tenantId.
- [ ] **2.5** Add `tenantId` FK to `Project` (and anywhere else that's
      tenant-scoped — audit the moduleA tables).
- [ ] **2.6** Row-level security policies: every tenant-scoped table
      filtered by `app.tenant_id` GUC.
- [ ] **2.7** Seed script expansion: 1 Tenant ("Acme Oncology") with 1
      super-admin + 2 writers + 1 reviewer; Modules enabled: `['A']`.

**Done when:** `npx prisma migrate deploy` applies clean; seed
reproduces Acme fixture; existing Module A integration tests pass
against the new schema.

---

## Arc 3 — Tenant Admin API

Depends on Arc 2. One route file per sub-resource under
`apps/api/src/modules/platform/tenant-admin/`.

- [ ] **3.1** `tenants/routes.ts` — list / create / rename / suspend /
      archive (super-admin role gate).
- [ ] **3.2** `tenants/modules/routes.ts` — GET/PATCH enabled modules;
      replaces the `VITE_MOCK_*` flags on cutover (web reads from
      `/me/tenant` at bootstrap instead of env).
- [ ] **3.3** `users/routes.ts` extension — invite (email + role),
      resend invite, suspend, reactivate, deprovision (soft-delete
      preserving audit chain).
- [ ] **3.4** `memberships/routes.ts` — role changes within a tenant
      (owner demotion requires a second owner; owners can't demote
      themselves to viewer).
- [ ] **3.5** `sso/routes.ts` — connection CRUD + a `/test` route that
      proxies a WorkOS discovery check; writes `status=verified` on
      success.
- [ ] **3.6** `audit/routes.ts` — paginated audit log query (actor,
      entity, date range, module); hash-chain verification endpoint
      (`/audit/verify`) + CSV export (`/audit/export`).
- [ ] **3.7** RBAC audit: tenant-admin surface requires `super-admin`
      (for tenant CRUD + SSO) or `owner`/`admin` membership (for users
      + audit).
- [ ] **3.8** API tests: happy-path per endpoint + the 2 negative paths
      that matter (cross-tenant leak, owner-demotion guard).

**Done when:** `vitest run` passes new tenant-admin suite; manual curl
walk of all 8 route files succeeds against a dev DB.

---

## Arc 4 — Tenant Admin web

Depends on Arc 3. Existing screens (`SuperAdminPanel`, `AdminPanel`,
`UserManagement`, `AuditTrailViewer`) are placeholders — rewire against
the real API.

- [ ] **4.1** `TenantDirectory` screen (super-admin only): list, create,
      suspend / archive tenant.
- [ ] **4.2** `TenantDetail` screen: name/slug edit, module-toggle
      switches, member count, SSO status pill.
- [ ] **4.3** `UserManagement` rewiring: invite flow, role picker,
      suspend / reactivate / deprovision confirm dialogs.
- [ ] **4.4** `RoleAssignment` inline UX in UserManagement (one
      membership per tenant; cross-tenant view for super-admins).
- [ ] **4.5** `SsoConnectionConfig` screen (per-tenant): WorkOS
      connection id, callback URL, test-connect button, status pill.
- [ ] **4.6** `AuditTrailViewer` rewiring: filter form (actor / entity /
      date range), hash-chain verify button, CSV export button.
- [ ] **4.7** `AdminGuard` + `SuperAdminGuard` wired to the new
      membership + role model; nav gates both surfaces.
- [ ] **4.8** Playwright smoke: invite a user → assign writer role →
      verify audit entry → export CSV.

**Done when:** a super-admin can run through tenant creation → invite
users → enable Module A → user signs in and sees Clinical Writing.

---

## Arc 5 — Module A hardening

Can start in parallel with Arcs 2 / 3 (no DB-schema conflict). Blocked
on Arc 2 only for the final tenant-scoped RLS test.

### 5a — Reality audit

- [ ] **5.1** Verify shipped-vs-deferred for Module A. The
      `project_phase_3a_deferrals` memory says S3 / diff / voice /
      presence / TLF / CRM / eSig all shipped; walk the code and
      confirm. Update the memory to reflect truth.
- [ ] **5.2** Walk the 10-flow smoke in `docs/module-cutover-runbook.md`
      against a live dev API; record any regression as a tracked bug.

### 5b — Coverage + quality gates

- [ ] **5.3** API test coverage audit: Module A hot paths
      (documents, sections, comments, voice-notes, CRM, TLF,
      signatures, presence). Each handler needs at least one
      happy-path + one authorisation negative test.
- [ ] **5.4** Playwright suite expansion: at least 1 happy-path per
      Module A screen (DocumentEditor, CommentsDashboard, ReviewerView,
      DiffView, CRMModule, ESignature).
- [ ] **5.5** Load test: 50 concurrent writers on one document; measure
      Socket.io presence fan-out + section-save p99.
- [ ] **5.6** Security review: PHI blob access controls, presigned URL
      TTLs, audit-chain integrity across restart, authorisation on
      every Module A route (checklist).
- [ ] **5.7** Accessibility pass: WCAG 2.1 AA on all Module A screens
      (keyboard nav, screen-reader labels, colour contrast). Fix
      P1 blockers only — P2+ into QA backlog.

### 5c — External blocker tracking (not code)

- [ ] **5.8** AI connector: capture current procurement status for
      `ANTHROPIC_API_KEY`. If key arrives during this arc, land the
      connector + wire real document classifier.
- [ ] **5.9** MedDRA: capture MSSO licence status. If licence arrives,
      swap the lookup stub for real data.

### 5d — Documentation pack

- [ ] **5.10** Operator runbook: deploy, rollback, incident response,
      scheduled jobs (presence reaper, voice transcription).
- [ ] **5.11** Developer onboarding: how to run locally, where tests
      live, the shape-mapper pattern, how to add a new document kind.
- [ ] **5.12** API examples: one `curl` recipe per Module A endpoint
      (POST document → upload section → add comment → sign-off).
- [ ] **5.13** Known-limitations doc: what's stubbed (AI, MedDRA), what's
      single-instance only (presence Redis adapter when scale lands).

**Done when:** Playwright suite green on CI; load test meets p99
targets; docs reviewed by one developer who hasn't worked on the code.

---

## Arc 6 — Handover gate

Final gate before Dev + QA own Module A.

- [ ] **6.1** Dev team walkthrough: architecture, hot paths, where to
      extend, which patterns to copy (shape mapper, audit append).
- [ ] **6.2** QA team walkthrough: test plan, Playwright suite,
      regression checklist, known-limitations doc.
- [ ] **6.3** Open a defect tracker (GH issues or Linear) for anything
      found in the walkthroughs.
- [ ] **6.4** Resolve all P0 / P1 defects from walkthroughs.
- [ ] **6.5** Pin "Module A frozen" in CLAUDE.md — any further Module A
      changes go through the Dev team, not this assistant.

**Done when:** Dev + QA accept the handover; sign-off recorded in
CLAUDE.md.

---

## Arc 7 — Resume Modules B/C/D/E (future, out of scope now)

Not planned here. When ready, enable one module at a time via the
toggle built in **3.2**, land the shape-mapper work remaining per
`project_phase_3*_deferrals` memories, and run the module-cutover
runbook per module.

---

## Dependencies

```
Arc 1  ──────────────────┐
                         ▼
Arc 2 ──► Arc 3 ──► Arc 4
             │
             └────────► Arc 5.5 (tenant RLS test only)

Arc 5a / 5b / 5c / 5d can run anytime after Arc 1.

Arc 6 depends on both Arc 4 and Arc 5 complete.
```

Arcs 2+3+4 and 5 can proceed in parallel; the only hard coupling is
5.5's RLS test which needs Arc 2.6 live.

## Rough sizing

Order-of-magnitude only — not commitments.

| Arc | Items | Rough effort |
|-----|-------|--------------|
| 1   | 5     | 1 session    |
| 2   | 7     | 1-2 sessions |
| 3   | 8     | 2-3 sessions |
| 4   | 8     | 2-3 sessions |
| 5   | 13    | 3-4 sessions |
| 6   | 5     | 1 session (external walk-throughs) |

Total: ~10-14 sessions to hand Module A + Tenant Admin to Dev + QA.
