---
title: GA Launch Readiness Checklist
status: draft
owner: Head of Engineering
reviewers: ["Compliance Lead", "Security Lead", "Head of Customer Success", "SRE Lead"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# GA Launch Readiness Checklist

Pass criterion: every row at ✅ before announcing General Availability.
Rows at 🟡 are documented accepted-risk items with owner + sign-off.

## 1. Product completeness

| # | Item | Status | Evidence |
|---|---|---|---|
| 1.1 | All 5 modules at MVP (A/B/C/D/E) | 🟡 | Backend scaffolds shipped; blockers tracked in `~/.claude/.../memory/project_phase_3*_deferrals.md` |
| 1.2 | Each module has 1 Playwright happy-path smoke | 🟡 | 6 smoke tests pass; depth per-module ships with each cutover |
| 1.3 | AI Gateway integrated with real Anthropic SDK | 🔴 | Blocked on API key (see Phase 4 deferrals) |
| 1.4 | E-signature chain (Part 11) implemented | 🔴 | Blocked on 4 Compliance decisions (`compliance/Part11/compliance-assessment.md`) |
| 1.5 | S3 upload / document binary storage | 🔴 | Phase 3A deferred — MinIO exists but no routes yet |
| 1.6 | Email + SMS notification adapters | 🔴 | Noop adapters shipped; SES/Twilio pending procurement |

## 2. Compliance

| # | Item | Status | Evidence |
|---|---|---|---|
| 2.1 | GAMP 5 CSV binder: URS + FS/DS + IQ/OQ/PQ | 🟡 | `docs/compliance/GAMP5/`; status: draft; needs external validator review |
| 2.2 | SOC 2 Type I report issued | 🔴 | Auditor not yet engaged |
| 2.3 | SOC 2 Type II in progress (6-month window) | 🔴 | Evidence pipelines ready; clock has not started |
| 2.4 | ISO 27001 Stage 1 audit complete | 🔴 | Not yet engaged |
| 2.5 | 21 CFR Part 11 compliance assessment signed | 🟡 | Draft complete; 4 open Compliance decisions needed |
| 2.6 | GDPR DPIA + HIPAA DPIA reviewed by external counsel | 🟡 | Drafts complete |
| 2.7 | DPA + BAA templates approved by external counsel | 🔴 | TBD |
| 2.8 | Pen test clean (critical/high remediated) | 🔴 | Not yet commissioned |
| 2.9 | Data residency variants documented | 🟢 | `docs/compliance/runbooks/data-residency-strategy.md` |

## 3. Operations

| # | Item | Status | Evidence |
|---|---|---|---|
| 3.1 | Baseline + peak load test green on target hardware | 🔴 | Smoke in CI; baseline/peak scheduled but not yet executed |
| 3.2 | SLOs defined with error-budget policy | 🟢 | `docs/launch/slo.md` |
| 3.3 | Grafana overview + compliance dashboards provisioned | 🟢 | `infra/standalone/observability/grafana/dashboards/*.json` |
| 3.4 | Prometheus alerts cover all SLOs + compliance signals | 🟢 | `alerts.yml` — api/worker/infra/compliance/ai groups |
| 3.5 | Alertmanager → paging provider wired | 🔴 | PagerDuty/Opsgenie not yet provisioned |
| 3.6 | On-call rota has ≥4 trained engineers | 🔴 | Hiring/training gate |
| 3.7 | Blue/green deploy tested in QA | 🟡 | Script shipped; integration test in Phase 6 Batch 5 |
| 3.8 | DR drill executed within last quarter | 🔴 | Drill cadence doc exists; first drill TBD |
| 3.9 | Backup pipeline healthy + verified | 🟡 | `backup.sh` ships; verification cron needs wiring |
| 3.10 | Status page provider chosen + wired | 🔴 | TBD |

## 4. Security

| # | Item | Status | Evidence |
|---|---|---|---|
| 4.1 | SSL Labs score A or better | 🟡 | Config in place; score verified post-launch |
| 4.2 | Pre-commit secret scanner | 🔴 | Called out in incident runbook; not yet installed |
| 4.3 | MDM on engineering laptops | 🔴 | SoA A.6.7 action item |
| 4.4 | Column-level encryption on mobile_encrypted | 🔴 | Phase 3E deferral; KMS decision pending |
| 4.5 | Workforce PHI training module | 🔴 | HIPAA §164.308(a)(5) action item |
| 4.6 | Public KOL guest route threat model | 🔴 | Phase 3E deferral; blocked until the route itself ships |

## 5. Customer-facing

| # | Item | Status | Evidence |
|---|---|---|---|
| 5.1 | Status page live | 🔴 | Depends on 3.10 |
| 5.2 | Customer onboarding playbook | 🟢 | `docs/launch/customer-onboarding.md` |
| 5.3 | Marketing website | 🔴 | Not in platform scope |
| 5.4 | Pricing + rate card | 🔴 | Business decision |
| 5.5 | Terms of Service + Privacy Policy | 🔴 | Legal |
| 5.6 | Support portal / help docs | 🔴 | TBD |
| 5.7 | At least 2 reference customers for Day 1 | 🟡 | Pilot customers TBD |

## 6. Business

| # | Item | Status | Evidence |
|---|---|---|---|
| 6.1 | Sales enablement complete | 🔴 | AE training + collateral |
| 6.2 | Customer Success team hired + trained | 🔴 | Hiring gate |
| 6.3 | Legal reviewed all customer-facing contracts | 🔴 | Depends on 2.7 |
| 6.4 | Procurement: Anthropic + WorkOS + Hetzner + Backblaze + Cloudflare + SOC 2 auditor + GAMP 5 validator + pen test firm | 🔴 | Finance + Procurement gate |
| 6.5 | Launch date agreed + comms plan | 🔴 | Exec decision |

## Rollup

| Status | Count |
|---|---|
| 🟢 Done | 4 |
| 🟡 Partial / accepted risk | 10 |
| 🔴 Not yet done | 23 |

**Target before GA announcement**: zero red in sections 2 (Compliance) and
3 (Operations), ≤3 yellow across the board, section 6 (Business) at
Head of Engineering's discretion.

## Go/no-go meeting

T-2 weeks before announced GA:
- Head of Engineering, Compliance Lead, Security Lead, SRE Lead, Head of CS, CEO.
- Review this doc live; any 🔴 in sections 2 or 3 is a hard no-go.
- Document decision + sign-offs in the launch log.
- If no-go: new target date; this doc updated; comms adjusted.

## Soft-launch option

If the business needs to onboard pilot customers before full GA readiness:

- **Pilot program** = named-customer, waiver-signed access to the platform
  at a reduced SLO (99.5% not 99.9%, best-effort response).
- Each pilot signs a specific risk acceptance addendum enumerating which
  🔴 items apply to them.
- Max 3 pilot customers to limit incident blast radius.
- Pilot runs transition the applicable 🔴 → 🟡 after 30 days of clean operation.
