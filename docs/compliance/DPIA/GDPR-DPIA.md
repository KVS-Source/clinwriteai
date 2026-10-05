---
title: GDPR Data Protection Impact Assessment (DPIA)
status: draft
owner: DPO
reviewers: ["Compliance Lead", "External Counsel", "Security Lead"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# GDPR DPIA — ClinWrite.AI

Required under GDPR Art. 35 when processing is "likely to result in a high
risk to the rights and freedoms of natural persons." The platform handles
employee identity data + reviewer contact details + (indirectly, via document
content) patient-level clinical data. This qualifies for DPIA.

## 1. Processing operations and purposes

| Operation | Purpose | Lawful basis |
|---|---|---|
| User account storage (name, email, SSO subject) | Platform access + RBAC | Art. 6(1)(b) — contract (customer agreement) |
| Session tokens + IPs | Auth + fraud detection | Art. 6(1)(f) — legitimate interest |
| Document content authored by users | Core service | Art. 6(1)(b) — contract |
| Audit trail of user actions | Part 11 compliance + security | Art. 6(1)(c) — legal obligation (21 CFR Part 11 contractually imposed) |
| AI prompt + response + token counts | Service delivery + cost accounting | Art. 6(1)(b) + Art. 6(1)(f) |
| KOL contact info (email, mobile_encrypted) | Review workflow | Art. 6(1)(f) — legitimate interest (reviewer-recipient relationship) |
| MA contact info | Review workflow | Art. 6(1)(f) |

**Special category data**: document content *may* include patient-level
clinical information. Processing basis: Art. 9(2)(j) — scientific research
+ customer's own basis under their consent framework. We require customers
to warrant under the DPA that they have appropriate basis for including
such data.

## 2. Necessity and proportionality

| Element | Assessment |
|---|---|
| Lawful basis documented | ✅ Per table above |
| Specified, explicit, legitimate purposes | ✅ Service terms of use |
| Data minimisation | ✅ Only fields required for stated function |
| Accuracy | ✅ Users self-edit; audit of changes |
| Storage limitation | ✅ Retention policy in `../README.md` |
| Integrity and confidentiality | ✅ Encryption at rest + TLS + RBAC |
| Accountability | ✅ Audit chain + this DPIA |

## 3. Rights of data subjects

### Art. 15 — Right of access
- **Response time**: 1 month (extendable to 3 for complex)
- **Technical mechanism**: `GET /admin/users/:id` returns the user record
  (admins only); the user's own data via `GET /auth/me`; cross-record
  activity via `GET /documents/:documentId/audit` for documents they
  authored.
- **Gap**: no self-serve "download all my data" endpoint yet — manual
  export by DPO today.

### Art. 16 — Right to rectification
- Users self-serve correct name/email via future `/me/profile` route (TBD).
- Admins correct via `PATCH /admin/users/:id`.

### Art. 17 — Right to erasure ("right to be forgotten")
- Procedure: Admin receives DSR; verifies identity; calls
  `DELETE /admin/users/:id` → soft-deprovisions (status='deprovisioned') +
  revokes sessions.
- **PII retained**: audit_events.actorId still references the user id.
  Rationale: Part 11 audit integrity > erasure. Documented in DPA.
- **PII erased**: name, email, SSO subject tombstoned by anonymisation
  script (TBD — currently manual via DBA).
- **Hard-delete gap**: full erasure procedure needs more automation; see
  action items.

### Art. 18 — Right to restriction
- Can be approximated by `status='suspended'` on User row — the user is
  retained for audit but cannot log in or author.

### Art. 20 — Right to portability
- Data export in a structured format (JSON) — currently manual via DPO.
- Automation TBD.

### Art. 21 — Right to object
- For legitimate-interest processing (sessions / fraud detection), the user
  may object. Resolution: account suspension.

### Art. 22 — Automated decision-making
- AI-generated content is **advisory only** per URS §6 UR-NFR-008; every
  AI output requires human acceptance before entering a record. No automated
  decision has legal / significant effect on data subjects.

## 4. Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| GDPR-R-01 | Unlawful disclosure of patient data via AI prompt | Medium | High | PII scrubber + per-tenant quotas + audit + annual DLP review. See R-01 in `../ISO27001/risk-register.md`. |
| GDPR-R-02 | Cross-tenant data leakage via code bug | Medium | High | tenantId filters + Postgres RLS (planned) + integration tests. See R-14. |
| GDPR-R-03 | Insufficient erasure response | Medium | Medium | Automate hard-delete script; measurable SLA. |
| GDPR-R-04 | Breach notification missed within 72h | Low | High | Incident runbook explicit 72h clock + DPO on-call. |
| GDPR-R-05 | Transfer to third country without SCCs | Low | High | Vendor list reviewed — Anthropic (US) + Backblaze (EU option used); SCCs in DPA with Anthropic. |
| GDPR-R-06 | Child data processed without parental consent | Low | High | Not applicable — platform not marketed to or usable by children. |
| GDPR-R-07 | Automated decision-making impacting data subjects | Low | Medium | Human-in-the-loop requirement codified in URS. |

## 5. Third-country transfers

| Processor | Country | Transfer mechanism |
|---|---|---|
| Anthropic | US | Standard Contractual Clauses (SCCs) in DPA; EU-US Data Privacy Framework if certified |
| WorkOS | US | SCCs |
| Hetzner | DE / FI (EEA only) | None required for EU data |
| Backblaze B2 | NL (EEA) for backups | Chose EU-central region deliberately for EU data |
| Cloudflare | DE / UK proxies for EU hostnames | SCCs for US processing of logs |

## 6. Data subject categories

| Category | Volume | Sensitivity |
|---|---|---|
| ClinWrite employees (platform staff) | ~30 by Year 2 | Standard |
| Customer employees (writers, reviewers, admins) | ~500-5000 across all tenants | Standard |
| External KOL reviewers | 10-50 per project | Standard + email + optional mobile |
| Patients (indirectly, via document content) | Variable per customer | **Special category Art. 9** |

## 7. Consultation

- Internal: Security Lead + Head of Engineering reviewed
- DPO: owns this document
- External counsel: review scheduled with GDPR specialist firm
- Supervisory authority: pre-consultation under Art. 36 **only if**
  mitigation fails to bring high-risk processing below the threshold —
  not required with mitigations in §4

## 8. DPIA conclusion

Processing is permissible under GDPR provided:

1. Customer DPAs include SCCs for US processors.
2. Pseudonymisation of audit event actorId before Art. 17 erasure is
   automated.
3. Annual DLP review of AI prompts.
4. Cross-tenant isolation tests ship in Phase 5 Batch 5+ validation suite.
5. Breach-notification clock trained into on-call rotation.

Next review: 12 months OR after any ADR acceptance that materially changes
data flow.
