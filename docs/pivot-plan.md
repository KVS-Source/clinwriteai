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

## Arc 2 — Tenant Admin data model ✅ landed 2026-10-06 (commit 1245a1a)

Foundation for Arcs 3 + 4. One Prisma schema file
(`apps/api/prisma/schema/tenant.prisma`) + one migration.

- [x] **2.1** `Tenant` model
- [x] **2.2** `SsoConnection` model
- [x] **2.3** `Membership` model
- [x] **2.4** Backfill migration (00000000000028)
- [x] **2.5** `tenantId` FK on Project (Module A inherits via projectId
      per the existing RLS migration 27)
- [x] **2.6** RLS policies on `tenants` / `memberships` / `sso_connections`
- [x] **2.7** Seed script: Acme Oncology + 1 super-admin + 2 writers +
      1 reviewer; modules `['A']`.

---

## Arc 3 — Tenant Admin API ✅ landed 2026-10-06 (commit 5a8ca94)

- [x] **3.1** tenants/routes.ts (list / create / rename / suspend / archive)
- [x] **3.2** PATCH /admin/tenants/:id/modules (replaces old env-only toggles;
      effectiveModules = intersect(env, tenant))
- [x] **3.3** users/routes.ts: /:id/suspend, /:id/reactivate, /:id/resend-invite
      (plus existing invite + deprovision)
- [x] **3.4** memberships/routes.ts with owner-protection (can't demote
      last owner; owners can't self-demote)
- [x] **3.5** sso/routes.ts with /test stub (flips status=verified when
      workosConnectionId is set — real SDK call swaps in later)
- [x] **3.6** audit/routes.ts: paginated query + /verify + /export CSV
- [x] **3.7** RBAC: super-admin bypasses; tenant-scoped handlers use
      assertTenantAccess() per route
- [x] **3.8** shape.test.ts (8 unit tests). Full route integration
      coverage rides the CI web-integration Playwright job.

---

## Arc 4 — Tenant Admin web ✅ landed 2026-10-06 (commit 7404bd7)

- [x] **4.1** API clients (apps/web/src/api/tenantAdmin.ts)
- [x] **4.2** React Query hooks (apps/web/src/hooks/useTenantAdmin.ts)
- [x] **4.3** TenantDirectory screen with new-tenant dialog
- [x] **4.4** TenantDetail with module-toggle checkbox grid + members table
- [x] **4.5** UserManagementLive wired to real invite/suspend/reactivate/
      resend-invite/deprovision endpoints
- [x] **4.6** SsoConnectionConfig per-tenant screen
- [x] **4.7** AuditTrailViewerLive with filter form + hash-chain verify
      + CSV export via <a href>
- [x] **4.8** Router + sidebar wired; legacy mock screens kept at
      /-mock paths for the handover demo

---

## Arc 5 — Module A hardening ✅ partially landed 2026-10-06

Full report: [docs/module-a-hardening-report.md](module-a-hardening-report.md).

- [x] **5.1** Reality audit — every "deferred" item in
      project_phase_3a_deferrals actually shipped; memory updated to
      reflect truth
- [x] **5.3** Test coverage audit — 101 passing, Module A hot-path
      gaps documented in report §2
- [x] **5.6** Security review (10-point checklist, all pass)
- [x] **5.8** AI connector blocker status captured
- [x] **5.9** MedDRA blocker status captured
- [x] **5.10** Operator runbook (already in module-cutover-runbook.md)
- [x] **5.11** Developer onboarding + extension patterns (in hardening report)
- [x] **5.12** API curl examples (in hardening report)
- [x] **5.13** Known-limitations doc (in hardening report)
- [ ] **5.2** 10-flow smoke against live API — needs provisioned env;
      Dev team runs on handover
- [ ] **5.4** Playwright suite expansion — CI web-integration job runs
      the smoke; adding per-screen happy paths is Dev team's expand-
      the-covered-surface task
- [ ] **5.5** Load test — needs provisioned env; Dev team performance
      baseline pass
- [ ] **5.7** Full WCAG 2.1 AA walk — Dev team's a11y specialist

**Done when:** Items 5.2, 5.4, 5.5, 5.7 picked up by Dev + QA post-
handover (Arc 6).

---

## Arc 6 — Handover gate ⚠ awaits human walkthrough

Final gate before Dev + QA own Module A. Artefacts are ready; the
walkthroughs themselves are human-driven and can't be auto-landed.

- [ ] **6.1** Dev team walkthrough — use [docs/module-a-hardening-report.md](module-a-hardening-report.md)
      as the single starting doc
- [ ] **6.2** QA team walkthrough — pair the report with
      [module-cutover-runbook.md](module-cutover-runbook.md)
- [ ] **6.3** Open a defect tracker (GH issues or Linear) for anything
      found in the walkthroughs
- [ ] **6.4** Resolve all P0 / P1 defects from walkthroughs
- [ ] **6.5** Pin "Module A frozen" in CLAUDE.md once sign-off recorded

**Done when:** Dev + QA accept the handover; sign-off recorded in
CLAUDE.md.

---

## Arc 7 — Resume Modules B/C/D/E (future, out of scope now)

Not planned here. When ready, enable one module at a time via the
toggle built in **3.2**, land the shape-mapper work remaining per
`project_phase_3*_deferrals` memories, and run the module-cutover
runbook per module.

---

## Arc 8 — India DPDPA 2023 compliance (future, scoped 2026-10-08)

Cross-cutting compliance work across Tenant Admin + every module.
Decided in response to India market expansion. See each PRD's §8.1 /
§8.3 / §10 for module-level requirements (added v0.4 for A, v0.1+ for
B/C, v0.2 for D, v0.3 for E). This Arc tracks the platform build-out.

- [ ] **8.1** `Tenant.data_residency` field (`'EU' | 'IN' | 'US' | 'APAC'`),
      with 'IN' as the gate for DPDPA enforcement. Prisma migration +
      Tenant Admin UI picker (sPM04 or new sub-screen).
- [ ] **8.2** Per-tenant DPO contact (name, email, phone) persisted on
      `Tenant`. Surface in Tenant Admin for Significant Data Fiduciary
      tenants (threshold: Admin-flagged, criteria pending MeitY Rules
      finalisation).
- [ ] **8.3** Consent artefact store — new `ConsentRecord` entity
      (purpose, scope, timestamp, consent-manager reference, Data
      Principal id). Immutable. Linked from `User`, `KolContact`,
      `VoiceNote` where personal data is captured. Required at point
      of collection; absence of consent blocks writes.
- [ ] **8.4** Data Principal rights workflow — Admin inbox for access /
      correction / erasure / grievance requests. SLA timers (30 days
      per DPDPA Rules draft, confirm on finalisation). Erasure
      executor cascades through documents, provenance, comments,
      voice notes, signatures — content redacted, hash preserved
      (same semantics as GDPR right-to-erasure in Module A §8.3).
- [ ] **8.5** Cross-border transfer gate — tenants with
      `data_residency = 'IN'` reject writes to buckets/queues outside
      the India government's notified-countries list. Block list is
      Admin-updatable (MeitY publishes periodically; initial list
      pending Rules finalisation).
- [ ] **8.6** 72-hour breach notification — tie into the existing
      audit chain + an operator notification path. Admin configures
      recipient (Data Protection Board email + tenant-side DPO).
- [ ] **8.7** CDSCO submission pinning — any Module D submission
      destined for CDSCO (India HA) always flows through `ap-south-1`
      regardless of tenant default residency. Enforced at the
      publishing gate.
- [ ] **8.8** Audit — pen-test DPDPA controls specifically (consent
      bypass attempts, cross-border write smuggling, erasure chain
      gaps). External auditor pass before go-live for IN tenants.

**Done when:** an IN-residency tenant can be created, personal data
collection requires consent, cross-border writes are blocked, a
Data Principal access/erasure request completes end-to-end in staging,
and the external audit sign-off is on file.

**External blockers:**
- MeitY Rules finalisation (phased in-force from 2025; consent-manager
  requirements and SDF thresholds not yet final)
- India Data Protection Board operational (board constituted; email
  endpoint for breach notification not yet published)
- External auditor engagement (budget + scope TBD; same pool as the
  SOC 2 Type II roadmap in §8.2 of each PRD)

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
| 8   | 8     | 3-5 sessions (DPDPA; depends on MeitY Rules finalisation) |

Total: ~10-14 sessions to hand Module A + Tenant Admin to Dev + QA.
Arc 8 (DPDPA) sized separately — adds 3-5 sessions on top, kicked off
after Arc 6 handover or sooner if an IN tenant is contracted.
