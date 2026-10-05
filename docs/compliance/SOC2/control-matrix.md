---
title: SOC 2 Trust Services Criteria — Control Matrix
status: draft
owner: Security Lead
reviewers: ["Compliance Lead", "External SOC 2 Auditor"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# SOC 2 Trust Services Criteria — Control Matrix

Mapping SOC 2 TSC (2017) + 2022 Points of Focus to shipped controls.
Scope: **Security + Availability + Confidentiality**. Processing Integrity
and Privacy are out of scope for the initial Type I; Privacy folds in at
Type II after GDPR DPIA.

**Legend:**
- 🟢 Implemented (evidence available)
- 🟡 Partially implemented
- 🔴 Not implemented
- ⚪ N/A for scope

## CC1 — Control Environment

| TSC | Control | Status | Evidence |
|---|---|---|---|
| CC1.1 | Ethics code published and acknowledged by all staff | 🔴 | HR to issue |
| CC1.2 | Board / executive oversight of security | 🟡 | Weekly security sync — minutes TBD |
| CC1.3 | Organisation structure + reporting lines | 🟡 | Org chart TBD |
| CC1.4 | HR practices: background checks, onboarding, offboarding | 🟡 | Partially via WorkOS SCIM deprovisioning |
| CC1.5 | Accountability — role descriptions + performance review | 🔴 | TBD |

## CC2 — Communication and Information

| TSC | Control | Status | Evidence |
|---|---|---|---|
| CC2.1 | Internal communication of policies | 🟡 | Compliance docs in repo (this folder) |
| CC2.2 | External communication (customers, regulators) | 🟡 | Status page + security.txt TBD |
| CC2.3 | Information quality + reliability | 🟢 | Audit trail (ADR 0002, this doc §CC7.4) |

## CC3 — Risk Assessment

| TSC | Control | Status | Evidence |
|---|---|---|---|
| CC3.1 | Risk assessment process | 🟡 | ISO 27001 risk register (see `ISO27001/risk-register.md`) |
| CC3.2 | Fraud risk assessment | 🔴 | TBD — Compliance to initiate |
| CC3.3 | Significant change evaluation | 🟢 | ADR process (`docs/adr/`) + change control §CC8 |
| CC3.4 | Risk mitigation | 🟡 | Per-ADR mitigation strategies |

## CC4 — Monitoring Activities

| TSC | Control | Status | Evidence |
|---|---|---|---|
| CC4.1 | Ongoing + separate evaluations | 🟡 | Loki + Prometheus + Grafana dashboards (shipped in infra/standalone/) |
| CC4.2 | Deficiency communication | 🔴 | Incident response runbook (see `runbooks/incident-response.md`) |

## CC5 — Control Activities

| TSC | Control | Status | Evidence |
|---|---|---|---|
| CC5.1 | Control activities selected and developed | 🟢 | This matrix |
| CC5.2 | Technology-general-controls selected | 🟢 | ADR series + infra/standalone/ |
| CC5.3 | Policies deployed via procedures | 🟡 | Partial — runbooks in progress |

## CC6 — Logical and Physical Access Controls

| TSC | Control | Status | Evidence |
|---|---|---|---|
| CC6.1 | Logical access provisioned via roles + MFA | 🟢 | WorkOS SSO (ADR 0005) + `src/auth/rbac.ts` |
| CC6.2 | Prior to issuing credentials, identity verified | 🟢 | WorkOS SCIM + email verification |
| CC6.3 | Access removed when no longer required | 🟢 | `DELETE /admin/users/:id` revokes sessions in same tx |
| CC6.4 | Physical access to data centres | ⚪ | Cloud provider (VPS: Hetzner — SOC 2 Type II; Backblaze — SOC 2 Type II) |
| CC6.5 | Logical + physical media disposal | 🟡 | Hetzner handles disks; our backups stored encrypted-at-rest on B2 |
| CC6.6 | Firewall / network perimeter | 🟢 | Cloudflare WAF + nginx + ufw host-level firewall |
| CC6.7 | Transmission of confidential info | 🟢 | TLS 1.2+ enforced; nginx cipher config |
| CC6.8 | Prevention + detection of malicious code | 🟡 | Dependency scanning via npm audit; CI; Snyk integration TBD |

## CC7 — System Operations

| TSC | Control | Status | Evidence |
|---|---|---|---|
| CC7.1 | Vulnerability monitoring | 🟡 | npm audit + GitHub Dependabot; annual pen test TBD |
| CC7.2 | Infrastructure monitoring | 🟢 | Prometheus scrape + Grafana alerts + Loki log aggregation |
| CC7.3 | Anomalies detected via logging | 🟢 | All mutating requests → audit_events; non-5xx errors logged |
| CC7.4 | Response to detected incidents | 🟡 | `runbooks/incident-response.md` (Phase 5 Batch 4) |
| CC7.5 | Backup + recovery procedures tested | 🟡 | `infra/standalone/scripts/backup.sh` + `restore.sh`; drill in Phase 6 |

## CC8 — Change Management

| TSC | Control | Status | Evidence |
|---|---|---|---|
| CC8.1 | Changes authorised, designed, developed, tested, approved | 🟢 | ADR process + PR review + CI + deployment via `deploy.sh` |

## CC9 — Risk Mitigation

| TSC | Control | Status | Evidence |
|---|---|---|---|
| CC9.1 | Risk mitigation activities for business disruption | 🟡 | DR plan — `runbooks/disaster-recovery.md` |
| CC9.2 | Vendor + business partner risk | 🟡 | DPA with each hosting + Anthropic + WorkOS + Backblaze |

## A1 — Availability

| TSC | Control | Status | Evidence |
|---|---|---|---|
| A1.1 | Capacity monitored | 🟢 | Prometheus — CPU, memory, disk, DB connections |
| A1.2 | Environmental protections | ⚪ | Cloud provider responsibility |
| A1.3 | Business continuity + DR plan maintained + tested | 🟡 | Plan in `runbooks/`; test cycle Phase 6 |

## C1 — Confidentiality

| TSC | Control | Status | Evidence |
|---|---|---|---|
| C1.1 | Confidential information identified + maintained | 🟢 | Data classification §Retention in `../README.md`; sops+age for secrets |
| C1.2 | Confidential information disposed when no longer required | 🟡 | Retention policy in README; automated expiry Phase 6 |

## Status rollup

| Status | Count |
|---|---|
| 🟢 Implemented | 14 |
| 🟡 Partial | 15 |
| 🔴 Not implemented | 4 |
| ⚪ N/A | 3 |

Target before Type I audit: zero red, ≤5 yellow.
Target before Type II audit: zero red, zero yellow, 6-month operating window.

See `evidence-collection-plan.md` for the Type II operating-window plan.
