---
title: HIPAA Privacy + Security Rule Compliance Assessment
status: draft
owner: DPO
reviewers: ["Compliance Lead", "External Counsel", "Security Lead"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# HIPAA — Compliance Assessment

ClinWrite.AI acts as a **Business Associate** when processing Protected
Health Information (PHI) on behalf of Covered Entity customers (pharma
sponsors, CROs, etc.). This assessment maps the Platform's controls to
the HIPAA Security Rule (45 CFR §164 Subpart C) and the Breach Notification
Rule (Subpart D).

A separate Business Associate Agreement (BAA) is executed with each
Covered Entity customer prior to processing their PHI.

## Scope

**PHI handled by the platform** (via customer-authored document content):
- Patient initials, DOB, medical record numbers (potentially)
- Clinical trial data linked to identifiable patients
- Adverse event narratives

**NOT PHI handled by the platform**:
- Platform user identity (customer's employees — covered by GDPR / employment, not HIPAA)
- AI call records (prompts are scrubbed; see pii-scrub.ts)

## §164.308 — Administrative Safeguards

| Standard | Required | Addressable | Implementation |
|---|---|---|---|
| §164.308(a)(1) Security Management Process | ✓ | | Risk analysis (ISO 27001 register); risk mgmt; sanction policy (TBD); info system activity review (SOC 2 CC4) |
| §164.308(a)(2) Assigned Security Responsibility | ✓ | | Security Lead role |
| §164.308(a)(3) Workforce Security | ✓ | | Authorisation + supervision (SSO + RBAC); workforce clearance (background checks TBD); termination (offboarding runbook TBD) |
| §164.308(a)(4) Information Access Management | ✓ | | Isolating healthcare clearinghouse functions (N/A); access authorisation (RBAC); access establishment + modification (admin UI) |
| §164.308(a)(5) Security Awareness and Training | | ✓ | Annual training (TBD); malware (Dependabot); login monitoring (audit); password mgmt (via WorkOS) |
| §164.308(a)(6) Security Incident Procedures | ✓ | | Incident response runbook |
| §164.308(a)(7) Contingency Plan | ✓ | | DR plan; data backup; emergency mode operation; testing (quarterly drill) |
| §164.308(a)(8) Evaluation | ✓ | | SOC 2 Type II + ISO 27001 + annual pen test |
| §164.308(b) Business Associate Contracts | ✓ | | DPA/BAA with each Covered Entity + sub-processor DPAs |

## §164.310 — Physical Safeguards

Delegated to Hetzner (ISO 27001 certified data centres); customer accepts
in DPA.

| Standard | Status |
|---|---|
| §164.310(a) Facility Access Controls | 🟢 Via Hetzner |
| §164.310(b) Workstation Use | 🟡 MDM on engineering laptops TBD |
| §164.310(c) Workstation Security | 🟡 Same |
| §164.310(d) Device and Media Controls | 🟢 Hetzner handles disposal; our backups encrypted-at-rest |

## §164.312 — Technical Safeguards

| Standard | Required | Implementation |
|---|---|---|
| §164.312(a)(1) Access Control | ✓ | Unique user ID (User.id); emergency access (super-admin break-glass procedure — TBD); automatic logoff (session expiry 24h); encryption + decryption (sops+age for secrets; TLS in flight) |
| §164.312(b) Audit Controls | ✓ | audit_events table — hash-chained, append-only |
| §164.312(c) Integrity | ✓ | content_hash on document_versions; audit chain; chain verification endpoint |
| §164.312(d) Person or Entity Authentication | ✓ | WorkOS SSO + MFA |
| §164.312(e) Transmission Security | ✓ | TLS 1.2+; integrity via sha256 content_hash |

## §164.314 — Organizational Requirements

| Standard | Implementation |
|---|---|
| §164.314(a) Business Associate Contracts | Standard BAA template; signed before PHI processing |
| §164.314(b) Group Health Plans | Not applicable |

## §164.316 — Documentation

| Standard | Implementation |
|---|---|
| §164.316(a) Policies and Procedures | This compliance docs directory |
| §164.316(b) Documentation retention | 6 years from creation or last effective date — Git retains compliance docs indefinitely |

## Breach Notification Rule (§164.400+)

**Breach definition** (HIPAA): acquisition / access / use / disclosure of
PHI not permitted by the Privacy Rule, where probability of compromise is
not low under the Risk Assessment of §164.402(2).

### Notification timelines

| To | Trigger | Clock |
|---|---|---|
| **Covered Entity (customer)** | Any breach of their PHI | Without unreasonable delay, max 60 days from discovery; typically 24-72h per BAA |
| **HHS / OCR** | ≥500 individuals affected | Within 60 days of discovery |
| **HHS / OCR** | <500 affected | Annual aggregate report by March 1 following year |
| **Media** | ≥500 in a state | Prominent local media within 60 days |
| **Individuals** | Any affected | Covered Entity's responsibility, not Business Associate's |

### Risk assessment factors (§164.402(2))

Every potential breach must be assessed on:
1. Nature + extent of PHI involved
2. Unauthorised person who used / to whom disclosed
3. Whether PHI was actually acquired / viewed
4. Extent to which the risk has been mitigated

Low-probability-of-compromise finding documented → notification not required
BUT the risk assessment itself IS a required record.

## Workflow: suspected PHI exposure

1. On-call engineer invokes incident runbook (Sev1 if confirmed, Sev2 if suspected).
2. DPO + Compliance Lead + Security Lead convene within 2h.
3. Run §164.402(2) risk assessment within 24h.
4. If probability-of-compromise is not low:
   - Notify Covered Entity per BAA (usually 24-72h).
   - Covered Entity notifies affected individuals + HHS per their obligations.
   - Business Associate assists with investigation + remediation.
5. If low: document the risk assessment with evidence; file in compliance archive.

## Specific PHI handling in the Platform

### At rest
- Postgres encrypted via LUKS at host-OS level + per-column encryption
  for mobileEncrypted (TBD; see Phase 3E deferral memory).
- MinIO buckets encrypted (SSE-S3-equivalent); Backblaze B2 server-side
  encryption on backups.

### In transit
- TLS 1.2+ for all customer traffic; Cloudflare origin cert on nginx.
- Internal API-to-DB traffic over loopback (Postgres binds 127.0.0.1).

### Access logs
- Every PHI read is audit-eventable through the entity-type pattern — a
  future tightening would require explicit "PHI accessed" logging for
  document GET endpoints on PHI-flagged documents. See action items.

### Minimum necessary
- RBAC enforces role × module scoping.
- Document assignment limits who can read a given document (TBD — currently
  all project members can read all project documents; row-level isolation
  TBD).

## Action items for full HIPAA readiness

- [ ] BAA template approved by external counsel
- [ ] Workforce PHI training module + annual refresher
- [ ] Automated hard-delete / anonymisation on §164.512 removal requests
- [ ] Column-level encryption on mobileEncrypted (Module E)
- [ ] Row-level document isolation per project membership (minimum necessary)
- [ ] PHI-aware audit log tag (explicit read logging on PHI docs)
- [ ] Annual HIPAA risk analysis (per §164.308(a)(1)(ii)(A))

## Open questions

1. Should the platform offer **de-identification** (Safe Harbor §164.514(b))
   as a feature so AI can process a reduced-risk form? Could substantially
   lower the GDPR Art. 9 + HIPAA risk posture.
2. Do we need separate **dedicated hosting** for HIPAA customers (physical
   isolation) or does logical isolation + BAA suffice? Default: logical;
   customer may require dedicated per contract.
