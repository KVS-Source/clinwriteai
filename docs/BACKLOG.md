# Backlog — what's genuinely left to ship

Current as of 2026-10-05. Updated per ship; see `git log` for history.

Everything that could ship without an external procurement gate or a
stakeholder architectural decision is in `main`. What remains falls into
four buckets below. Items are grouped so the next developer can pick up
the thread without re-reading the deferral memories.

---

## Blocked on external procurement

Code is ready to swap or wire the moment the external gate clears. Each
item documents the one-file-or-less change needed.

| Item | Blocker | Swap-in point |
|---|---|---|
| Anthropic SDK | API key procurement in motion | `StubLlmClient` in `apps/api/src/modules/platform/ai-gateway/service.ts` |
| PubMed E-utils | NCBI API key | `/pubmed/search` route in `scientific-writing/publications` |
| CrossRef DOI mint | Registered depositor account | `/doi` POST in `ideation/publishing/routes.ts` |
| ORCID OAuth2 | Production domain callback | `authors/routes.ts` (invite flow) |
| MedDRA lookup | MSSO licensing contract | Would populate the deferred `meddra_terms` table |
| OIG/FDA debarment feed | Live feed source | `debarment-check` runner in `authors/routes.ts` |
| pgvector claims similarity | `apt install postgresql-16-pgvector` on VPS | `claims/routes.ts` `recomputeSimilarity` |
| FDA ESG + EMA CESP gateway | Months of onboarding (certs + PGP + test transactions) | Would create the `gateway_submissions` table + route |
| Extedo/Lorenz eCTD validator | Commercial contract + API licensing | `/validation/run` route |
| Canonical JSON extraction | Separate project — PDF/Word → structured JSON | `/canonical-json` route |
| SMS gateway | Twilio or equivalent | `NoopSmsAdapter` in notification service |
| Email adapter | SES/SendGrid | `NoopEmailAdapter` in notification service |
| Social listening | Brandwatch/Sprinklr | Would create `social_listening_alerts` table |
| PagerDuty / Opsgenie | Paging provider provisioning | Alertmanager routing config |
| Status page provider | Statuspage.io vs StatusGator decision | New |

---

## Blocked on stakeholder decision

Code can land once the decision is made; the implementation path is clear
but the choice isn't ours alone.

| Item | Decision needed | Owner |
|---|---|---|
| Column encryption on `mobileEncrypted` | KMS strategy (per-tenant key vs shared; envelope vs column) | Compliance + eng |
| PDF signature stack (Part 11 §11.70) | Signing cert source + key management | Compliance + eng |
| Master Library claim-level reuse graph | Design pass — tagging model, back-reference shape | Medical writing lead + eng |
| Strict RLS policy flip + per-route adoption of `withTenantScope` | Pick first adopter route + do QA sweep of all queries | Platform eng |
| Audit append from workers | AuditRepository extraction to shared package | Platform eng |

---

## Blocked on legal / HR / commercial

Not platform scope but gate GA.

- SOC 2 Type I/II auditor engagement (6-month operating window required)
- ISO 27001 Stage 1 + Stage 2 auditor
- Penetration test firm (annual)
- GAMP 5 Validator (IQ/OQ/PQ)
- DPA/BAA templates — external counsel review
- HIPAA BAA counsel approval
- DPO + external counsel review of all compliance docs
- 4 trained on-call engineers (minimum rotation size)
- 2 reference customers lined up for Day 1
- Marketing website + support portal
- Pricing / Terms of Service / Privacy Policy
- MDM for engineering laptops (SoA A.6.7)
- Workforce PHI training module (HIPAA §164.308(a)(5))

---

## Follow-up items — scope-later but shippable

Lower priority than everything else because they don't block GA or
compliance, but worth a session when there's capacity.

- `prisma $extends` middleware so new routes auto-wrap in `withTenantScope`
  (opt-in → opt-out pattern)
- Expand WCAG a11y suite to deep screens (currently covers 5 module home pages;
  per-screen specs land as UI stabilises)
- OpenAPI schema per route (currently auto-generated from route handlers;
  explicit `schema:` definitions would make `/docs` richer)
- Audit chain nightly verify + fail PR check if verify-chain returns false
- Expand `withTenantScope` adoption + flip one table's RLS policy to strict
  as proof-of-concept (ADR 0010 follow-up)

---

## What's shipped (session 2026-10-05)

30 batches landed in autonomous mode. Full list in `git log --oneline`.
Highlights by surface:

**Module A — Clinical Writing**: TLF packages, CRM workflow, Part 11
e-signature chain, voice transcription worker, presence (REST + Socket.io
push), PHI access audit tags.

**Module B — Scientific Writing**: peer-review workflow, congress exports,
submission readiness, point-by-point response letter assembly, portfolio
dashboard, GPP-2022 compliance report (JSON + PDF), AI footprint denominator.

**Module C — Medical Writing**: MLR workflow, agentic MLR report stub,
content expiry scheduler.

**Module D — Regulatory Writing**: HA correspondence round-trip,
PSUR/PBRER aggregate safety reports, orphan drug assessments.

**Module E — Ideation**: KOL/calendar workers, UTM auto-generator,
Dublin Core auto-populate.

**Platform**: regulatory alerts cross-module push, therapeutic-areas
taxonomy, reports/analytics, rate-card hot-reload, AI quota soft-cap
notifications, worker health endpoint.

**Infrastructure**: Postgres RLS infrastructure (permissive-by-default),
`withTenantScope` helper, Redis-backed rate limit, realtime bridge
(worker → Redis → API → Socket.io), `@socket.io/redis-adapter` for
cross-instance fanout, rate-card version history, gitleaks pre-commit +
CI gate, real `/ready` health check, WCAG axe-core regression suite,
PDF renderer smoke tests, retention purge cron (deletes expired
sessions / 2y+ notifications / 7y+ ai_call_records).

**Compliance**: GDPR Art. 17 anonymisation, access review cron,
compliance report PDF, audit log JSONL export, PHI access audit tags,
expanded PII scrubber patterns (MRN/NHS/DEA).

**ADRs**: 0010 (RLS), 0011 (realtime push), 0012 (PDF stack).

See `C:\Users\cheta\.claude\projects\c--Chetan-GenBioCa-LifeSciences\memory\`
for the per-phase deferral memories with per-item shipping commit hashes.
