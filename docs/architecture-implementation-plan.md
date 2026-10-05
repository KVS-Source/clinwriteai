# Aurora Backend — Implementation Plan

**Derived from** `docs/demo/01-architecture.md` (3,682 lines) · `docs/demo/02-datamodel.md` (154 tables) · `docs/demo/03-api-contract.md` (179 endpoints) · `docs/demo/04-acceptance-criteria.md` (174 ACs)
**Starting point** `v2.0-prototype-complete` (frozen on `prototype` branch, SHA `fd4e890`)
**Target** Production-ready, SOC 2 Type II / GAMP 5 / 21 CFR Part 11 compliant SaaS
**Date drafted** October 2026

---

## 1. Framing

The prototype is more complete than the architecture doc assumes. It already contains:

- All 5 modules' screens (Clinical / Scientific / Medical / Regulatory / Ideation & Publishing)
- 15-screen Platform Module (sPM04–sPM18)
- 65+ SME-validated JSON fixtures
- Module-scoped folders with ESLint boundaries
- 179 MSW handlers that mirror the API contract 1:1

**The backend is the long pole, not the frontend.** ~80% of calendar time is API, data model, security, compliance, infra. The frontend work is mostly surgical swaps (MSW handler delete + React Query re-enable) plus a handful of genuinely new UI (real diff, real presence, real file upload, KOL guest route).

### Three operating assumptions

1. **Monolith stays monolithic.** The arch doc is correct: Fastify (or Express) single Node service with ESLint-enforced module folders. Do not fragment into microservices until regulatory load actually demands it.
2. **GxP / 21 CFR Part 11 / HIPAA readiness is non-negotiable and sequenced early.** A production regulated-writing platform without a validated audit trail, immutable e-sig chain and SOC 2-aligned controls is not shippable — these are structural, not features bolted on at the end.
3. **Phase gates = demoable milestone + passing acceptance criteria subset.** Each phase is hung on a concrete slice of the 174 ACs from `04-acceptance-criteria.md`, not on hand-wavy "feature complete".

---

## 2. Phased Milestones

Phases 0–2 run strictly sequentially. Phases 3A–3E (per-module backends) parallelise across BE engineers once Phase 2 is green.

### Phase 0 — Prerequisites & Decisions · Weeks 1–2 ✅ COMPLETE (2026-10-05)

| | |
|---|---|
| **Goal** | Unblock build: finalise stack ambiguities, legal/compliance paperwork started, environments provisioned. |
| **Deliverables** | 9 ADRs Accepted (0001 Fastify, 0002 Prisma + raw SQL for audit, 0003 pgvector, 0004 Anthropic + Azure fallback, 0005 WorkOS, 0006 SecretsProvider interface with sops+age / Secrets Manager impls, 0007 **Standalone VPS year 1, AWS/Azure year 2**, 0008 BullMQ on Redis, 0009 Standalone deployment stack); `infra/standalone/` complete scaffold (Docker Compose + nginx + systemd + MinIO + sops + Prom/Grafana/Loki + B2 backup); `infra/terraform/` AWS year-2 skeleton; GitHub Actions base CI (web build green); FDA ESG onboarding noted — team will proceed with placeholders in Module D until licence lands. |
| **Dependencies** | None internal. External: VPS provider BAA, legal counsel engagement for Anthropic/WorkOS BAAs. |
| **Who** | DevOps (lead), Tech lead, Security, Compliance. |
| **Effort** | ~1 person-week actual (vs 2–4 estimated). |
| **Risks resolved** | Cloud spend eliminated for year 1; team already knows the standalone operational model from `proto.clinwrite.ai`. |
| **Exit criteria met** | 9 ADRs Accepted; standalone + cloud scaffolds in place; CI green on `main`; Phase 1 scaffold already begun. |

### Phase 1 — Backend Foundation & Platform APIs · Weeks 3–8

| | |
|---|---|
| **Goal** | A real `apps/api` serving auth, users, projects and audit — the floor every module sits on. |
| **Deliverables** | Fastify server scaffold in `apps/api/src/`; Prisma schema translating §3 (Platform Layer) + §50 (Project) of data model = ~20 tables; migration pipeline; `/auth/login`, `/auth/mfa`, `/auth/me`, `/auth/logout` wired to SSO + TOTP MFA; session store (Redis); RBAC middleware with Admin / Super Admin / project roles; projects CRUD (`/projects/*`) with status state machine from arch §44.1 (incl. hard "Closed = read-only" enforcement at API layer); **immutable audit trail engine** (append-only `audit_events` table, hash-chained rows, no UPDATE/DELETE grants); structured JSON logging + OpenTelemetry; shared `@platform/types` already exists — wire it into `apps/api` tsconfig paths; integration test harness (Vitest + Testcontainers Postgres); OpenAPI/Zod validators generated from `packages/types/src/api.ts`. |
| **Dependencies** | Phase 0. |
| **Who** | 2 BE engineers, 1 DevOps, 1 Security (part-time). |
| **Effort** | 10–14 person-weeks. |
| **Risks** | SSO/MFA integration always slips (customer directory specifics unknown); audit trail "immutable" semantics vary by regulator interpretation — needs Compliance sign-off, not just dev opinion; Prisma struggles with JSONB + complex partial indexes used by audit trail — fallback to Drizzle or raw SQL for that table. |
| **Exit criteria** | Login + MFA + project create/list/close work end-to-end against staging DB; AC-PM-001 through AC-PM-010 (platform/project ACs) pass; audit entries demonstrably hash-chained; penetration test on auth surface clean. |

### Phase 2 — Cutover Infrastructure · Weeks 7–10 *(overlaps Phase 1 tail)*

| | |
|---|---|
| **Goal** | The mechanism by which MSW handlers get removed one at a time without breaking the prototype. |
| **Deliverables** | Env-flag `VITE_API_URL` wired to real staging API; `apps/web/src/mocks/browser.ts` refactored so each handler group is independently togglable via `VITE_MOCK_<module>=on/off`; auth header injection in `api/client.ts`; React Query devtools in staging; **frontend regression suite** — Playwright smoke covering the five module happy paths (currently none — this is critical and worth 1–2 weeks on its own); CI pipeline gains a staging deploy step. |
| **Dependencies** | Phase 1 auth works. |
| **Who** | 1 FE engineer, 1 DevOps. |
| **Effort** | 3–4 person-weeks. |
| **Risks** | MSW's "all or nothing" bypass behaviour needs careful handler scoping; cookie/CORS semantics between `proto.clinwrite.ai` and `api.clinwrite.ai`. |
| **Exit criteria** | Auth flows fire real HTTP; everything else still MSW; Playwright suite green; ability to kill one handler group and have the app fall through to real API without rebuilding. |

---

### Phase 3 — Per-Module Backends · Weeks 9–30 *(parallelised)*

Each module below is a self-contained backend slice. They do **not** block each other after Phase 2. Allocate one BE engineer as module owner, with a shared BE engineer floating between the two most complex modules (A and D).

#### Phase 3A — Module A (Clinical Writing) Backend

| | |
|---|---|
| **Goal** | Replace all `documents.*` MSW handlers with real services. |
| **Deliverables** | Prisma models for data model §4–§13 (~40 tables: documents, sections, checklist, comments, voice notes, audit, e-sig, CRM, TLF, MedDRA lookup); 60+ endpoints from `03-api-contract.md` §3–§13; **real diff engine** (replace `simulateRestore` — arch doc hints `diff-match-patch`); **real e-signature chain** (Part 11-grade — hash of document content + credential + meaning + timestamp, cryptographically chained); S3/blob storage for document binaries + voice note audio; AI connector service (Anthropic SDK with prompt caching per project context) replacing `simulateAI()`; Socket.io for section-level presence (FR-A-053). |
| **Dependencies** | Phase 2. |
| **Who** | 2 BE engineers (A is the largest module), 1 FE (surgical fixes), Compliance for e-sig sign-off. |
| **Effort** | 14–18 person-weeks. |
| **Risks** | AI prompt engineering to match the quality of the canned demo responses is non-trivial; Part 11 e-sig implementation nuances (what exactly is "the signed artefact's hash" — the HTML? the rendered PDF? needs Compliance decision); real-time presence under load (test with 10+ concurrent authors per doc); MedDRA licensing (MSSO fee + distribution restriction). |
| **Exit criteria** | All Module A ACs pass; MSW handler file deleted; prototype still demos identically. |

#### Phase 3B — Module B (Scientific Writing) Backend

| | |
|---|---|
| **Goal** | Real publications, citations, ICMJE, submission readiness, peer review. |
| **Deliverables** | ~25 Prisma tables (data model §17–§24); 30+ endpoints (API contracts §16–§24); **PubMed E-utilities integration** (replace mock PubMed search); **CrossRef API integration** for DOI minting; **ORCID OAuth2** for author verification; AI footprint tracking engine (immutable span records per FR-B footprint); GPP-2022 report generator (PDF). |
| **Dependencies** | Phase 2; Module A if `sourceDocumentId` cross-reference is enforced server-side. |
| **Who** | 1 BE engineer. |
| **Effort** | 8–10 person-weeks. |
| **Risks** | PubMed rate limits (3 req/s unauthenticated — need API key); CrossRef requires registered depositor account (admin/legal, weeks of lead time); ORCID OAuth redirect flows need production domain. |
| **Exit criteria** | Module B ACs pass; `publicationHandlers` deleted. |

#### Phase 3C — Module C (Medical Writing) Backend

| | |
|---|---|
| **Goal** | Pre-MLR + agentic pipeline, Claims Matrix, FK gate, tier routing, expiry tracking. |
| **Deliverables** | ~22 Prisma tables (data model §27–§33); 35+ endpoints (API contracts §30–§42); **two-pass AI pipeline** (pre-MLR structured check → agentic deeper check); **FK readability scoring service**; **Claims Matrix similarity engine** (recommend pgvector embeddings against Master Library claim corpus); **content expiry scheduler** (cron, 60/30-day alerts); **WCAG automated test harness** (axe-core + custom contrast checker). |
| **Dependencies** | Phase 2; Module A for CSR source document access; Master Library (Phase 4) ideally first. |
| **Who** | 1 BE engineer, AI/ML engineer part-time for pipeline tuning. |
| **Effort** | 10–12 person-weeks. |
| **Risks** | Claims similarity accuracy — pgvector + embeddings is a bet; may need to iterate on embedding model choice; FK scoring algorithms vary (classic FK vs modern readability-with-medical-vocabulary) — needs product decision; ACCME compliance track accuracy needs CME SME review. |
| **Exit criteria** | Module C ACs pass; `medContentHandlers` deleted. |

#### Phase 3D — Module D (Regulatory Writing) Backend 🚨 *(largest module)*

| | |
|---|---|
| **Goal** | eCTD assembly, consistency checks, gateway transmission, PPD/CCI redaction, Regulatory Intelligence. |
| **Deliverables** | ~30 Prisma tables (data model §36–§43); 32 endpoints (API contracts §44–§54); **canonical JSON indexing service** (parses CSRs/IBs/SAPs into structured, versioned data points — this is a project unto itself); **cross-module consistency check engine** (compares Module 2.5/2.7 values against Module 5 TFL — hard gate); **eCTD v3.2.2 package assembly** (XML backbone, folder structure, file naming per ICH M4); **validator integration** (Extedo or Lorenz — commercial); **FDA ESG + EMA CESP gateway clients** (AS2 messaging; FDA ESG test account can take weeks); **Part 11 inline confirmation** middleware (every gateway transmit requires fresh credential confirm within request); **irreversible PPD/CCI redaction**; Regulatory Intelligence cross-module alert push service. |
| **Dependencies** | Phase 2; ideally Module A done so CSRs exist to index. |
| **Who** | 1 senior BE engineer, Compliance/regulatory SME (deep involvement), 3rd-party integration specialist for gateways. |
| **Effort** | 18–24 person-weeks — **the largest module by far**. |
| **Risks** | eCTD validator licensing + integration — commercial contracts and APIs vary wildly; FDA ESG onboarding is **months** (production certs, test transactions, PGP keys); EMA CESP needs qualified e-signature cert (QES) in some member states; canonical JSON extraction accuracy; MHRA gateway marked `apiReady: false` in `GATEWAY_PRIORITY` — treat as UI-only until MHRA opens the API. |
| **Exit criteria** | Module D ACs pass; one real FDA ESG test transmission acknowledged in staging; `regulatoryWritingHandlers` deleted. |

#### Phase 3E — Module E (Ideation & Publishing) Backend

| | |
|---|---|
| **Goal** | Source gating, AI atomisation, KOL guest route, calendar, publishing record. |
| **Deliverables** | ~15 Prisma tables (data model §44–§48); 25+ endpoints; **public JWT-based KOL guest route** (7-day one-time token, isolated API surface, rate-limited); **AI atomisation pipeline** (one structured call per channel format); **source currency check service** (90-day rule); **Master Library integration**; **calendar + localisation** (`LocaleRecord` per §47); SMS gateway integration (Twilio or equivalent); DOI/ORCID/Dublin Core service **shared with Module B** (owned here per DD-E-006). |
| **Dependencies** | Phase 2; shared DOI/ORCID service ideally built in 3B first and extended here. |
| **Who** | 1 BE engineer. |
| **Effort** | 8–10 person-weeks. |
| **Risks** | Public KOL route is a juicy attack surface — needs its own threat model and WAF rules; SMS costs (budget line item); explicitly **no social platform APIs** per DD-E-005 — do not let scope creep. |
| **Exit criteria** | Module E ACs pass; KOL review link works end-to-end from an external email; `ideationHandlers` deleted. |

---

### Phase 4 — Shared Platform Services · Weeks 15–28 *(overlaps 3A–3E)*

| | |
|---|---|
| **Goal** | The cross-cutting services every module consumes. |
| **Deliverables** | **Master Library** service (tagged sections, best practices, platform API access per arch §57); **notification engine** (email via SES/SendGrid, in-app, SMS); Admin/Super Admin screens' backends (users, RACI matrix, taxonomy, subscription, rate card, framework registry); reports/analytics service; **AI gateway** (centralised Anthropic SDK wrapper with per-project rate limits, prompt caching, cost accounting, PII scrubbing). |
| **Dependencies** | Phase 1. |
| **Who** | 1 BE engineer, 1 FE for admin screens polish. |
| **Effort** | 10–14 person-weeks. |
| **Risks** | Notification engine fan-out needs a queue (SQS/BullMQ); AI cost control is a real line item at scale — the gateway must enforce it. |
| **Exit criteria** | Admin and Super Admin screens functional against real backend; AI calls flow through the gateway with billing records. |

### Phase 5 — Compliance Hardening & Validation · Weeks 25–36 *(overlaps 3/4 tail)*

| | |
|---|---|
| **Goal** | Pass the audits the product's buyers will demand. |
| **Deliverables** | GAMP 5 computerised system validation (CSV) documentation set — URS, FS, DS, IQ/OQ/PQ (the AC document is already PQ-shaped — big head start); SOC 2 Type II controls implementation + evidence collection running for **6 months before audit**; ISO 27001 ISMS artefacts; third-party pen test; data residency (EU vs US) deployment variants; backup/restore drills; incident response runbook; disaster recovery with documented RTO/RPO; 21 CFR Part 11 compliance assessment signed by Compliance; HIPAA + GDPR DPIAs. |
| **Dependencies** | Phases 3+4 substantially done. |
| **Who** | Security lead, Compliance, external auditor engagements. |
| **Effort** | 10–15 person-weeks (plus the 6-month SOC 2 evidence window — calendar, not engineering effort). |
| **Risks** | SOC 2 Type II requires 6-month operating window — **start evidence collection in Phase 1**, not Phase 5; validator engagement costs; certain customers (big pharma) will require their own CSV review — budget for it. |
| **Exit criteria** | Pen test clean (critical/high remediated per §55); SOC 2 Type I report issued (Type II after 6-month window); CSV binder available on request. |

### Phase 6 — Production Hardening & Launch · Weeks 34–40

| | |
|---|---|
| **Goal** | Scale, observability, on-call, GA. |
| **Deliverables** | Load test to 500 concurrent authors; autoscaling policies; Datadog/Grafana dashboards + SLO alerting against the 99.9% uptime target; on-call rota + runbooks; blue/green deployment; data migration from any pilot tenant; marketing launch readiness; customer onboarding playbook. |
| **Dependencies** | Phase 5. |
| **Who** | DevOps, SRE, whole team on-call. |
| **Effort** | 6–8 person-weeks. |
| **Exit criteria** | GA. |

---

## 3. Critical Path

```
Phase 0 → Phase 1 (auth + audit + projects) → Phase 2 (cutover rails)
                                                    │
                               (parallel) ──────────┼──→ 3A, 3B, 3C, 3D, 3E, 4
                                                    │
                                               Phase 5 (compliance)
                                                    │
                                               Phase 6 (GA)
```

### Gating items — slip here = whole project slips

1. **Auth + audit trail** (Phase 1) — nothing else can land without them.
2. **SOC 2 evidence collection** — should begin end of Phase 1, not Phase 5.
3. **FDA ESG onboarding** (Phase 3D) — must be kicked off at Phase 0 given months-long lead time.
4. **DPA/BAA/customer contracting** (Phase 0) — gates any PHI touching the system.
5. **eCTD validator commercial contract** (Phase 3D) — procure early.

---

## 4. Architectural Decisions Needing Confirmation

The arch doc is unusually prescriptive and most decisions are settled. Genuine ambiguities:

- **Fastify vs Express.** Arch §1 lists both ("or"). Recommend Fastify: better schema-first validation (plays well with the Zod/types-first contract), ~2x throughput, native OpenAPI. Low cost to change later if wrong.
- **Diff algorithm.** Arch §8 says "e.g. diff-match-patch" — needs confirmation and depth: character-level, word-level, or section-level? Impacts restore semantics in Screen 24.
- **Claims Matrix similarity engine.** Arch §23 pattern 2 names Claims Matrix but is silent on implementation. Recommend pgvector + sentence embeddings; needs an ADR because it introduces a new infra dependency.
- **Canonical JSON indexing (FR-D-001).** Arch §30 lists this as a pattern but gives no extraction approach. This is a multi-week project; needs scoping before Phase 3D starts (parse CSR PDFs? Require source structured data? Hybrid?).
- **E-signature document hash scope.** Which bytes are hashed — the HTML content, the rendered PDF, the serialised JSON? Must be nailed down with Compliance before Phase 3A codes the Part 11 engine.
- **LLM provider.** Arch assumes Anthropic (`simulateAI` sets `model: 'claude-sonnet'`). Confirm BAA/DPA with Anthropic, or fall back to Azure OpenAI with the enterprise-tier BAA.
- **Deployment target.** Nothing in the arch doc says AWS vs GCP vs Azure vs on-prem. Impacts DevOps weeks materially.
- **Prisma vs Drizzle.** Prisma struggles with the audit trail hash-chain + partial indexes; worth a 1-day spike before committing.

---

## 5. Prototype work that migrates as-is

- **Entire frontend screen inventory** (Platform + 5 modules, 65+ screens) — no rework.
- **`packages/types/src/domain.ts`** — the typed contract, already consumed by both apps and ready for backend.
- **MSW handler structure** — 1:1 mirror of API contracts; use as the API's integration-test oracle (handler input/output = known-good contract behaviour).
- **65+ fixture JSON files in `apps/web/src/data`** — SME-validated. Reuse as the backend seed-data/demo tenant and as fixture for Playwright E2E.
- **Zustand store architecture, React Query hooks, ESLint module boundaries, Tailwind token system, panel/screen/UI layering** — all production-grade; do not revisit.
- **SubNav + role-scoped sidebar + AuthGuard composition** — ship unchanged.
- **The 174 acceptance criteria** — these are effectively PQ scripts; wire them directly into Playwright/Vitest as the acceptance test suite rather than rewriting.

---

## 6. Push back on these in the architecture doc

- **"Delete MSW handlers one at a time" (arch §13).** Fine for small modules, risky at scale. Add a feature-flag layer so handlers can be re-enabled per-environment (e.g. demo tenant). This is cheap insurance.
- **Socket.io for presence (arch §1).** Fine for v1, but for the regulated audit requirements, every presence event must still write to the audit trail — do not let Socket.io become a side-channel that bypasses it. Enforce via a presence service, not direct client-to-socket writes.
- **No explicit queue layer.** The arch doc assumes synchronous everything. AI calls, notification fan-out, eCTD validation (300s), consistency check (120s) — all need async job infra. Add BullMQ or SQS-backed workers in Phase 1; do not retrofit later.
- **"Regulatory Intelligence as a cross-module service" (arch §30, pattern 5).** Correct conceptually, but implementing framework change monitoring from scratch is a 6-month moonshot. Scope v1 to **manual Super Admin entry** of framework updates (the registry is already defined in arch §54); defer automated scraping to v2.
- **MHRA gateway UI without API (DD-D-008 / `GATEWAY_PRIORITY`).** Build only the UI stub; do not spend engineering on an API that does not exist. The arch doc is already honest about this — hold the line.
- **`validatorEngine: 'extedo' | 'lorenz'` enum (arch §32).** This is a vendor lock-in decision smuggled into a type. Make it a config string, not a union — avoids a schema migration when adding Verrochio or similar.
- **Terms & Conditions screen (arch §56).** Fine, but ensure acceptance is written to the **project-scoped audit trail**, not just the user audit trail — some customers will require per-project T&C evidence.

---

## 7. Rough total & staffing

**Total engineering effort:** approximately **95–125 person-weeks** across all phases, excluding the 6-month SOC 2 Type II operating window (calendar, not labour).

### Suggested staffing (4–6 person team)

| Role | Engagement |
|---|---|
| Tech lead / senior BE | Full-time, all phases |
| 2 × BE engineers | Full-time from Phase 1 |
| 1 × FE engineer | Part-time Phase 2, full-time for module cutovers |
| 1 × DevOps / SRE | Full-time Phase 0–2 and 5–6, part-time otherwise |
| 1 × Security + Compliance | Part-time throughout, full-time in Phase 5 |

### Calendar

- **~9 months** of calendar time to GA (production-ready) with the above staffing
- Internal milestone at **~5–6 months**: all 5 module backends live on staging, SOC 2 Type I issued, pending Type II window and FDA ESG certification
- Add 2 months of buffer for FDA ESG onboarding and SOC 2 Type II operating window overlap
- Realistic external launch date: **~11 months** from Phase 0 kickoff

---

## 8. Critical files for implementation

- `docs/demo/01-architecture.md` — authoritative stack and module boundary spec
- `docs/demo/02-datamodel.md` — 154-table Prisma schema source
- `docs/demo/03-api-contract.md` — 179-endpoint OpenAPI source
- `docs/demo/04-acceptance-criteria.md` — 174 ACs that double as PQ scripts
- `packages/types/src/domain.ts` — shared typed contract (already consumed by both apps)
- `apps/web/src/mocks/browser.ts` — MSW handler registry; the switchboard that gets dismantled module by module
- `apps/web/src/data/*.json` — SME-validated seed data for the real backend
- `prototype` branch / `v2.0-prototype-complete` tag — frozen reference point for regression comparisons

---

*Plan drafted by Claude (Plan agent synthesis of `docs/demo/01-architecture.md`), October 2026. Supersedes any earlier informal planning notes.*
