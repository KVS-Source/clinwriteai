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

## Post-handover roadmap (reorganised 2026-10-08)

Everything after Arc 6 was previously handwaved as "Arc 7 (resume
frozen modules)" + "Arc 8 (DPDPA)". That underplayed the Phase 4/5/6
deferrals captured in the `project_phase_4/5/6_deferrals` memories.
The redo below reorganises all remaining work into tracks that can
move in parallel, with explicit dependencies + external blockers.

**Reading order:** Arcs 7, 8, 9 can start the moment Arc 6 signs off
(or sooner for Arc 7's DPDPA foundation subset, which has no code
dependency on handover). Arcs 10, 11, 12 need external gates to clear.

---

## Arc 7 — DPDPA foundations (ready-now subset)

Code work that doesn't depend on MeitY Rules finalisation. Lands the
schema + enforcement scaffolding so Indian tenants can be onboarded
the moment the external gates clear. All eng-only.

- [ ] **7.1** `Tenant.data_residency` field (`'EU' | 'IN' | 'US' | 'APAC'`,
      default 'EU'). Prisma migration + Tenant Admin UI picker on
      sPM04. 'IN' is the gate for every downstream DPDPA check.
- [ ] **7.2** `ConsentRecord` entity (purpose, scope, timestamp,
      consent-manager reference, Data Principal id). Immutable table
      (no update/delete routes). FK from User, KolContact, VoiceNote,
      MaContact where personal data is captured.
- [ ] **7.3** Consent-required write gates — when `tenant.data_residency =
      'IN'`, POST routes that write personal data assert a matching
      `ConsentRecord` exists for the subject; return 428 (precondition)
      otherwise with the consent intake URL.
- [ ] **7.4** Cross-border transfer gate — blob + queue writes refuse
      destinations outside the India government's notified-countries
      allow-list when the tenant is 'IN'. Allow-list is an
      Admin-editable table (initial list: empty — MeitY-blacklist model
      means empty allow-list = block all cross-border; operator
      populates with the published MeitY notification list when it
      lands). Enforcement in `S3Client` + `BullMQ.add` wrappers.
- [ ] **7.5** CDSCO submission pin — any Module D submission to CDSCO
      forces `region = 'ap-south-1'` at the publishing gate, regardless
      of tenant default. Depends on Arc 11 (Module D re-enable) to be
      user-visible, but can land the enforcement now.
- [ ] **7.6** DPDPA integration tests — consent-bypass attempts (POST
      without ConsentRecord), cross-border write smuggling (direct
      S3 PUT to a non-IN bucket), erasure chain gap probes. All should
      fail closed.

**Done when:** an IN tenant can be created in Tenant Admin, writing a
KolContact without a ConsentRecord returns 428, writing a document
blob to a non-IN bucket from an IN tenant returns 403, all tests
green.

**Sizing:** 2-3 sessions.

---

## Arc 8 — Real-provider cutover (Phase 4 deferrals)

Swap stubbed adapters for real vendors. Each row below is a one-file
change once the API key / vendor BAA lands.

- [ ] **8.1** `StubLlmClient` → `AnthropicLlmClient` wrapping
      `@anthropic-ai/sdk`. Response shape already matches; just plumb
      the key through secrets. Also enables prompt caching
      (`cachedTokens` already in `AiCallRecord`).
- [ ] **8.2** `NoopEmailAdapter` → SES or SendGrid. Fastify plugin
      pattern already in `apps/api/src/modules/platform/notification/`;
      swap the single adapter class. BullMQ `notification.email` queue
      already fans out.
- [ ] **8.3** `NoopSmsAdapter` → Twilio. Same pattern as above.
- [ ] **8.4** Subscription + rate-card admin backend — tables
      `subscriptions` + `rate_card_entries` (rate cards already have
      versions; need the per-tenant subscription linkage). Admin UI
      lands as sPM13 wiring.
- [ ] **8.5** Reports module expansion beyond `/ai/usage` — tenant
      spend, project-level cost, forecast. Pure groupBy work.

**Done when:** real AI responses stream through the gateway, real
emails + SMS deliver via the BullMQ queue, admin can CRUD subscriptions
+ rate cards from the UI.

**External blockers:** API key procurement (Anthropic), vendor
contracts (SES/SendGrid/Twilio), BAA where PHI touches email/SMS.

**Sizing:** 2-3 sessions once vendors land.

---

## Arc 9 — Compliance infrastructure (Phase 5 deferrals)

Pure eng work from the Phase 5 compliance hardening pass. No external
dependency on any of these; just hasn't been prioritised yet.

- [ ] **9.1** Column-level encryption on `KolContact.mobileEncrypted` +
      `MaContact.mobileEncrypted`. KMS strategy decision first (AWS
      KMS envelope keys vs app-managed with Vault), then the Prisma
      field encryption wrapper.
- [ ] **9.2** Postgres RLS pool refactor — currently RLS policies are
      permissive-by-default because the pool doesn't `SET LOCAL
      app.tenant_id` per Prisma `$transaction`. Flip to enforce-by-
      default once the pool is wrapped.
- [ ] **9.3** Data retention cron purge job — `GET /admin/compliance/
      retention-report` is dry-run today. Build the actual BullMQ purge
      worker.
- [ ] **9.4** Chain integrity Grafana alert — monthly snapshot filing
      works; need an alert when `verify-chain` returns `intact: false`
      between snapshots.
- [ ] **9.5** Part 11 §11.100(c) FDA letter template decision — ours
      vs customer-provided. Required before shipping to Part 11-
      regulated customers.
- [ ] **9.6** De-identification feature decision — HIPAA Safe Harbor
      §164.514(b). Lowers AI prompt risk substantially if offered.
- [ ] **9.7** HIPAA dedicated hosting decision — logical isolation
      (default) vs physical. Depends on first customer requirements.

**Done when:** every mobile field is KMS-encrypted at rest, RLS blocks
cross-tenant row reads in a smoke test, retention purge actually
deletes rows past their TTL, Grafana pages on a chain break, three
compliance decisions are documented in the compliance binder.

**Sizing:** 4-5 sessions.

---

## Arc 10 — DPDPA finalisation (externally blocked)

Last-mile DPDPA items that can't ship until MeitY Rules + the Data
Protection Board are operational.

- [ ] **10.1** Per-tenant DPO contact field + Significant Data
      Fiduciary criteria. Blocked on MeitY Rules — SDF thresholds
      (data volume, risk categories) aren't finalised.
- [ ] **10.2** Data Principal rights workflow — Admin inbox for
      access / correction / erasure / grievance. SLA timers (30 days
      per draft Rules). Erasure cascade reuses the GDPR
      right-to-erasure pipeline from Arc 9 (same content-delete,
      hash-preserve semantics).
- [ ] **10.3** 72-hour breach notification wiring — depends on India
      Data Protection Board's recipient endpoint being published.
- [ ] **10.4** DPDPA-specific pen test pass — adds consent-bypass,
      cross-border-smuggling, erasure-chain-gap probes to the regular
      pen-test scope (Arc 12.4). Required before IN tenants go live.

**Done when:** IN tenant can run a full Data Principal access +
erasure request end-to-end, breach test fires a notification to the
real DPB endpoint, pen-test pass clean.

**External blockers:**
- MeitY Rules finalisation (phased in-force from 2025)
- India Data Protection Board operational (email endpoint publication)
- Pen test firm engaged (shared with Arc 12.4)

**Sizing:** 2 sessions once blockers clear.

---

## Arc 11 — Resume frozen modules B/C/D/E

Enable modules one at a time. Each module runs through its deferrals
memory + the module-cutover-runbook. Sequencing driven by business
priority, not technical dependency — they're independent.

- [ ] **11.B** Scientific Writing — [`project_phase_3b_deferrals`](../../Users/cheta/.claude/projects/c--Chetan-GenBioCa-LifeSciences/memory/project_phase_3b_deferrals.md).
      External blockers: PubMed/CrossRef/ORCID API keys, debarment
      source procurement.
- [ ] **11.C** Medical Writing — [`project_phase_3c_deferrals`](../../Users/cheta/.claude/projects/c--Chetan-GenBioCa-LifeSciences/memory/project_phase_3c_deferrals.md).
      Eng: pgvector similarity engine, agentic MLR report. External:
      WCAG specialist walk, expiry scheduler.
- [ ] **11.D** Regulatory Writing — [`project_phase_3d_deferrals`](../../Users/cheta/.claude/projects/c--Chetan-GenBioCa-LifeSciences/memory/project_phase_3d_deferrals.md).
      External: FDA ESG / EMA CESP gateway credentials, validator
      vendor, regulatory alerts feed. **Also unblocks Arc 7.5 CDSCO
      pin to become user-visible.**
- [ ] **11.E** Ideation & Publishing — [`project_phase_3e_deferrals`](../../Users/cheta/.claude/projects/c--Chetan-GenBioCa-LifeSciences/memory/project_phase_3e_deferrals.md).
      Eng: public KOL guest-route security review, mobile encryption
      (overlaps Arc 9.1), reminder scheduler. External: CrossRef DOI
      account, SMS gateway (overlaps Arc 8.3).

**Done when (per module):** env flag enabled, module-cutover-runbook
executed, deferrals memory closed out, module appears in sidebar.

**Sizing:** 2-3 sessions per module (varies by deferral depth).

---

## Arc 12 — Launch infrastructure + external audits (Phase 6 + 5)

Procurement + hiring heavy. Calendar time, not engineering time. Start
procurement NOW even if execution is weeks out.

- [ ] **12.1** PagerDuty or Opsgenie provisioned, Alertmanager wired
      to actual paging (currently emails only).
- [ ] **12.2** Status page provider (Statuspage.io vs StatusGator vs
      self-hosted) chosen + public page live.
- [ ] **12.3** Four trained on-call engineers hired. Minimum rotation
      size for sustainable 24/7 cover. Months-lead item.
- [ ] **12.4** Penetration test firm engaged — annual budget. Scope
      includes DPDPA probes (Arc 10.4).
- [ ] **12.5** SOC 2 Type II auditor engaged. **Needs 6-month operating
      window AFTER evidence pipelines run clean — start evidence
      collection the moment Arc 9 lands.**
- [ ] **12.6** ISO 27001 Stage 1 + Stage 2 certification body.
- [ ] **12.7** GAMP 5 Validator for IQ/OQ/PQ witness.
- [ ] **12.8** External counsel engagements — DPA/BAA templates, DPO,
      HIPAA BAA counsel, DPDPA counsel for the India angle.
- [ ] **12.9** Blue/green QA integration test (currently manual
      script; needs CI gate asserting zero 5xx during the flip).
- [ ] **12.10** Pricing + ToS + Privacy Policy published.
- [ ] **12.11** Two reference customers lined up for Day 1 launch.

**Done when:** on-call rotation live, status page up, SOC 2 Type II
report issued, pen test pass + remediation closed, all legal in
place, reference customers signed.

**Sizing:** months-long calendar; a few eng sessions scattered within
(12.1, 12.9).

---

## Dependencies

```
Arc 1 ──┐
        ▼
Arc 2 ──► Arc 3 ──► Arc 4
             │
             └────────► Arc 5.5 (tenant RLS test)

Arc 5a / 5b / 5c / 5d run anytime after Arc 1.
Arc 6 depends on both Arc 4 and Arc 5 complete.

── Handover gate (end of Arc 6) ──

Arc 7   (DPDPA foundations)  ─┐
Arc 8   (real-provider cutover) ──┤  all can start in parallel after Arc 6
Arc 9   (compliance infra)   ─┤   (procurement unlocks when it unlocks)
Arc 11  (resume modules)     ─┘

Arc 10  (DPDPA finalisation) ── needs MeitY Rules + DPB endpoint + pen-test (12.4)
Arc 12  (launch + external audits) ── calendar-time; start procurement NOW
              │
              └── 12.5 SOC 2 Type II needs Arc 9 evidence pipelines live FIRST
              └── 12.4 pen-test unblocks 10.4
```

**Critical path to "GA for IN tenants":** Arc 6 → Arc 7 → Arc 9 → Arc 10 →
Arc 12.4 → Arc 12.5. Everything else is parallel.

**Critical path to "resume Module D with CDSCO support":** Arc 6 → Arc 7
→ Arc 11.D (Arc 7.5 CDSCO pin becomes user-visible on 11.D re-enable).

## Rough sizing

Order-of-magnitude only — not commitments.

| Arc | Scope | Rough effort |
|-----|-------|--------------|
| 1   | Pivot setup                | ✅ 1 session   |
| 2   | Tenant Admin data model    | ✅ 1-2 sessions |
| 3   | Tenant Admin API           | ✅ 2-3 sessions |
| 4   | Tenant Admin web           | ✅ 2-3 sessions |
| 5   | Module A hardening         | ✅ 3-4 sessions (4 items pending Dev/QA) |
| 6   | Handover gate              | 1 session (external walk-throughs) |
| 7   | DPDPA foundations          | 2-3 sessions (eng-only, ready now) |
| 8   | Real-provider cutover      | 2-3 sessions (procurement-gated) |
| 9   | Compliance infrastructure  | 4-5 sessions (eng-only) |
| 10  | DPDPA finalisation         | 2 sessions (externally blocked) |
| 11  | Resume modules B/C/D/E     | 2-3 sessions per module (8-12 total) |
| 12  | Launch infra + ext audits  | months calendar; a few eng sessions scattered |

**Totals:**
- To finish Arc 6 handover: ~1 session (plus Dev/QA walk-through time)
- To add Arcs 7+8+9 on top: ~8-11 eng sessions
- To re-enable all four frozen modules: ~8-12 eng sessions
- Arc 12 is procurement + hiring + calendar; eng involvement is light

**Earliest "GA for IN tenants":** Arc 6 handover (1 session) + Arc 7
(2-3 sessions) + Arc 9 column encryption + RLS (~2 sessions subset) +
Arc 12 SOC 2 operating window (6 months) + Arc 12.4 pen test (external
calendar). Engineering is weeks; calendar is ~6 months after Arc 9
evidence pipelines are clean.
