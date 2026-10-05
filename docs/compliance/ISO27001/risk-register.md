---
title: ISMS Risk Register
status: draft
owner: Security Lead
reviewers: ["Compliance Lead", "ISO 27001 Certification Body"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# ISMS Risk Register

Per ISO/IEC 27001:2022 clause 6.1.2. Scored on 1-5 likelihood × 1-5 impact.
Risks ≥ 15 trigger a documented mitigation plan with target residual score.

**Scoring:**
- Likelihood: 1 Rare → 5 Almost certain
- Impact: 1 Negligible → 5 Catastrophic

## Risks

| ID | Risk | Likelihood | Impact | Score | Current controls | Residual |
|---|---|---|---|---|---|---|
| R-01 | Unauthorised disclosure of patient data via AI prompt | 3 | 5 | 15 | PII scrubber in AI gateway; per-tenant quotas; audit of every AI call | 6 (2×3) with mitigation plan |
| R-02 | Audit trail tampering (insider) | 2 | 5 | 10 | Hash chain + DB triggers + separate audit_secret; chain verify endpoint | 4 (1×4) |
| R-03 | Database compromise via SQL injection | 2 | 5 | 10 | Prisma parameterised queries; no raw string concat in app code; audit_events raw SQL uses $N placeholders | 2 (1×2) |
| R-04 | Session hijacking via XSS | 2 | 4 | 8 | SPA framework escapes by default; CSP header; httpOnly session cookie | 2 (1×2) |
| R-05 | Loss of availability (VPS failure) | 3 | 4 | 12 | Backups to off-site B2; DR plan with 4h RTO | 6 (2×3) |
| R-06 | Loss of availability (DDoS) | 3 | 4 | 12 | Cloudflare WAF + rate limiting at nginx + Fastify @fastify/rate-limit | 4 (1×4) |
| R-07 | Supply chain compromise (npm dep) | 3 | 4 | 12 | npm audit in CI; Dependabot; package-lock.json committed; no post-install scripts in prod | 6 (2×3) |
| R-08 | Secret leakage via git | 2 | 5 | 10 | sops+age encryption; .env in .gitignore; pre-commit hook to detect secrets (TBD) | 4 (1×4) |
| R-09 | Backup corruption (undetected) | 2 | 5 | 10 | Monthly restore drill; backup checksum verification | 2 (1×2) |
| R-10 | Compliance drift (code changes without doc update) | 4 | 3 | 12 | ADR process requires compliance review; this risk register itself | 6 (2×3) |
| R-11 | Vendor failure (WorkOS/Anthropic outage) | 2 | 4 | 8 | Multi-provider SSO possible via SsoProvider interface; AI gateway permits provider switch | 4 (1×4) |
| R-12 | GDPR Art.17 (right to erasure) violation | 3 | 4 | 12 | User soft-deprovisioning; retention policy; manual DSR process via `/admin/users/:id` DELETE | 6 (2×3) |
| R-13 | Part 11 e-sig key compromise | 1 | 5 | 5 | Not yet implemented — deferred to compliance decision | 5 until implementation |
| R-14 | Multi-tenant data leakage (code bug) | 3 | 5 | 15 | tenantId filter enforced in route layer; integration tests cover cross-tenant isolation (TBD) | 6 (2×3) with mitigation plan |
| R-15 | Insufficient audit of AI non-determinism | 4 | 3 | 12 | AiCallRecord captures prompt (scrubbed), model, output; human review required per Part 11 | 6 (2×3) |

## Risks requiring documented mitigation (score ≥ 15)

### R-01 — AI prompt data disclosure
**Mitigation plan:**
1. ✅ Pii-scrub.ts strips email/SSN/phone/credit-card patterns pre-send.
2. ⏳ Expand pattern set to include medical record numbers, DEA numbers,
   NHS numbers.
3. ⏳ Add DLP engine (Nightfall or Google DLP) in Phase 5.
4. ⏳ Per-tenant policy: refuse AI calls on sections tagged "PHI-containing".
5. ⏳ Quarterly AI-prompt sampling + manual review.

**Target residual:** 6 (likelihood 2 × impact 3)

### R-14 — Multi-tenant data leakage
**Mitigation plan:**
1. ✅ Every list/get route filters by `tenantId` or project-scoped FK.
2. ⏳ Add integration tests that attempt cross-tenant reads and expect 404.
3. ⏳ Enable Postgres row-level security (RLS) policies on tenant-scoped
   tables — defence in depth beyond the app layer.
4. ⏳ Fuzzing / contract tests on tenantId handling in URL + body + query.

**Target residual:** 6

## Review cadence

- Quarterly risk review by the Security Lead + Compliance Lead.
- Each ADR acceptance checks whether a new risk is introduced.
- Each incident post-mortem reviews the register for lessons-learned items.
