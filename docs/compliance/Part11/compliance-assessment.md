---
title: 21 CFR Part 11 Compliance Assessment
status: draft
owner: Compliance Lead
reviewers: ["Head of Engineering", "External Compliance Consultant", "Customer QA (via DPA)"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# 21 CFR Part 11 — Compliance Assessment

Assessment of ClinWrite.AI against 21 CFR Part 11 subparts B and C
(predicate rules for electronic records + electronic signatures).

**Scope**: Records that meet FDA's definition of "electronic record" within
the platform — primarily Module A documents (CSR, protocol, IB, etc.),
Module D regulatory submissions, and all audit trail entries supporting
those records.

**Not in scope here** (pending Compliance decision):
- The exact artefact format bound to an e-signature (HTML? rendered PDF?) —
  see §11.70 below.

## Section-by-section assessment

### §11.10 Controls for closed systems

| Clause | Requirement | Implementation | Status |
|---|---|---|---|
| §11.10(a) | Validation of systems | GAMP 5 CSV binder (see `GAMP5/`) | 🟡 In progress |
| §11.10(b) | Ability to generate accurate and complete copies | Document GET + versions endpoint; exports via Module A | 🟢 Implemented |
| §11.10(c) | Protection of records | Audit chain + encryption at rest + off-site backup | 🟢 |
| §11.10(d) | Limiting access to authorised individuals | WorkOS SSO + RBAC + module scoping | 🟢 |
| §11.10(e) | Audit trail — secure, computer-generated, time-stamped | hash-chained audit_events, append-only (BEFORE UPDATE/DELETE triggers) | 🟢 |
| §11.10(f) | Operational system checks | state machines (document / publication / content / submission / card) | 🟢 |
| §11.10(g) | Authority checks | `requireAuth({roles, modules})` on every mutating route | 🟢 |
| §11.10(h) | Device checks | TBD — IP + user-agent captured in session; device registration not implemented | 🟡 |
| §11.10(i) | Determination of persons' education, training, experience | HR responsibility; outside system scope | ⚪ |
| §11.10(j) | Written policies that hold individuals accountable | AUP + user agreement (TBD) | 🔴 |
| §11.10(k) | Appropriate controls over systems documentation | ADR + compliance docs in version-controlled repo | 🟢 |

### §11.30 Controls for open systems

The platform is a **closed system** per FDA's definition — access is
controlled by the SSO provider under our control. §11.30 does not apply.

### §11.50 Signature manifestations

| Clause | Requirement | Implementation | Status |
|---|---|---|---|
| §11.50(a) | Printed name of signer | Captured at e-sig invocation (TBD) | 🔴 Not implemented |
| §11.50(a) | Date and time of signature | TBD | 🔴 |
| §11.50(a) | Meaning (reviewed, approved, authored) | Enum in signature_records table (shipped as part of ADR 0002 roadmap) | 🔴 |
| §11.50(b) | Signature manifestations attached to the record | TBD — PDF embedding or sealed JSON manifest | 🔴 |

### §11.70 Signature/record linking

**Open question — Compliance to decide:**
> "What exactly is the signed artefact's hash? The HTML content? The rendered
> PDF? The canonical JSON of the document version?"

Current scaffold: document_versions.content_hash is `sha256(join of
section.sectionId + section.contentHtml)`. This bytes-the-HTML approach is
reproducible but doesn't match what a human sees in a PDF export.

Options:
1. **Bind to canonical JSON** (shipped). Pro: deterministic, machine-verifiable.
   Con: a reviewer approving "the document" is really approving a JSON blob.
2. **Bind to rendered PDF hash**. Pro: matches human intent. Con: rendering
   must be deterministic (same fonts, same renderer version, etc).
3. **Both**. Pro: belt + braces. Con: double audit surface.

**Decision needed before Phase 3A e-signature implementation lands.**

### §11.100 General requirements for electronic signatures

| Clause | Requirement | Status |
|---|---|---|
| §11.100(a) | Unique to one individual | SSO subject + User.id are 1:1 | 🟢 |
| §11.100(a) | Not reused or reassigned | User rows soft-deprovision — never deleted | 🟢 |
| §11.100(b) | Identity verified before issuance | WorkOS SCIM + email verification | 🟢 |
| §11.100(c) | Certified in writing to FDA that electronic signatures are intended to be legally binding | Customer deliverable — included in DPA | 🟡 |

### §11.200 Electronic signature components and controls

| Clause | Requirement | Implementation | Status |
|---|---|---|---|
| §11.200(a)(1) | Signing uses at least two distinct identification components (e.g., password + token) | Session cookie + fresh password re-auth (TBD) | 🔴 |
| §11.200(a)(2) | Subsequent signings during a single session use at least one component | TBD — "sign all" pattern | 🔴 |
| §11.200(a)(3) | Non-biometric signatures only used by their genuine owner | WorkOS MFA + session owner identity | 🟢 |
| §11.200(b) | Biometric signatures only used by genuine owner | Not applicable — no biometric sigs | ⚪ |

### §11.300 Controls for identification codes and passwords

| Clause | Requirement | Implementation | Status |
|---|---|---|---|
| §11.300(a) | Uniqueness of each combined ID+PW | WorkOS enforces uniqueness | 🟢 |
| §11.300(b) | Periodic revision | WorkOS policy configurable per tenant | 🟡 Tenant-config |
| §11.300(c) | Loss management procedures | Password reset via WorkOS | 🟢 |
| §11.300(d) | Transaction safeguards against unauthorised use | Session revocation + MFA + rate limiting | 🟢 |
| §11.300(e) | Initial / periodic testing of tokens | TBD | 🔴 |

## Open items (Compliance to decide before e-signature lands)

1. **§11.70 — bound artefact format**: HTML, PDF, or JSON? See above.
2. **§11.200(a)(1-2) — "two components" during signing**: Current session
   cookie counts as one. Do we require password re-auth per signature? Per
   session? What's the UX?
3. **§11.50 — signature manifestation visibility**: Where does the "signed
   by X on Y, meaning Z" text appear in exports?
4. **§11.100(c) — FDA letter**: Customer-provided template or ours?

## Current compliance posture summary

- 🟢 Implemented: 10 clauses
- 🟡 Partial / in-progress: 5
- 🔴 Not implemented (pending e-signature decision): 7
- ⚪ Not applicable: 2

**Blocker for shipping to Part 11-regulated customers**: §11.50, §11.70,
§11.200 — all gated on the e-signature chain implementation, which is
gated on the four open decisions above.

## Non-code deliverables for customers under BAA

- Validation Summary Report (from the GAMP 5 binder) — provided per DPA.
- Audit trail export procedure — currently via `GET /admin/compliance/report`
  with ISO window; customer-facing endpoint TBD.
- Chain integrity attestation — `GET /admin/compliance/verify-chain` output
  signed by the customer's compliance team on quarterly reviews.
