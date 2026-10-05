---
title: User Requirements Specification (URS) — ClinWrite.AI
status: draft
owner: Compliance Lead
reviewers: ["Head of Engineering", "External GAMP 5 Validator"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# User Requirements Specification (URS)

**GAMP 5 Category:** 4 (Configured Products — Modular Platform with Multi-Tenant Config) with GAMP 5 Category 3-like components (COTS libraries). The AI engine is treated as a **non-deterministic subsystem** — see §6.

## 1. System overview

ClinWrite.AI is a multi-tenant SaaS platform for life-sciences content
authoring and regulatory submissions. It supports five modules:

- **Module A — Clinical Writing**: CSR, Protocol, IB, ICF authoring with
  AI-assisted drafting, section-level versioning, and Part-11 e-signature.
- **Module B — Scientific Writing**: Publication lifecycle (manuscript,
  abstract, poster, PLS), ICMJE compliance, Vancouver citations.
- **Module C — Medical Writing**: HCP decks, PILs, MI letters, CME content;
  claims matrix with similarity-based reuse against a Master Library;
  Pre-MLR + Agentic MLR advisory report; MLR review workflow.
- **Module D — Regulatory Writing**: eCTD assembly, consistency checks,
  CMC readiness, PPD/CCI redaction, validator integration, gateway transmit.
- **Module E — Ideation & Publishing**: Source gating, AI atomisation,
  KOL review, calendar, publishing record, DOI minting.

Each module writes to a shared audit trail and respects shared Platform
services (Master Library, Notifications, AI Gateway, RACI).

## 2. Business purpose

Reduce the human effort required to produce regulated medical content while
preserving auditability, provenance, and compliance with ICH, FDA, EMA,
and other health authorities' expectations.

## 3. Scope

**In scope:**
- Multi-tenant SaaS deployment with per-tenant data isolation at the
  application layer (shared Postgres schema with `tenantId` columns).
- Role-based access control (RBAC) with module scoping.
- Full audit trail of every mutating action (hash-chained, append-only).
- AI-assisted content generation via a central gateway with cost accounting,
  PII scrubbing, and per-tenant monthly quotas.
- Document, publication, content item, submission, and ideation project
  lifecycle state machines.

**Out of scope:**
- The underlying LLM provider (Anthropic / Azure OpenAI) — treated as a
  qualified external service with its own compliance posture.
- End-user devices (customers' laptops) — covered by their own IT policy.
- Printing / local caching of exported outputs — customer responsibility.

## 4. User classes

| Class | Responsibilities | RBAC role(s) |
|---|---|---|
| Super Admin | Platform configuration, framework registry, quota mgmt | `super-admin` |
| Admin | User mgmt, project setup, RACI, library curation | `admin` |
| Clinical Writer | Module A authoring | `clinical-writer` |
| Scientific Writer | Module B authoring | `scientific-writer` |
| Medical Writer | Module C authoring | `medical-writer` |
| Regulatory Writer | Module D authoring | `regulatory-writer` |
| Ideation Lead | Module E authoring | `ideation-lead` |
| Reviewer | Cross-module reviewer / commenter | `reviewer` |
| Read-only | Observer with no write access | `read-only` |

See `docs/adr/0005-sso-workos.md` for authentication; `apps/api/src/auth/rbac.ts`
for the enforcement layer.

## 5. Functional requirements

### 5.1 Authentication & Authorisation
- **UR-AUTH-001**: The system shall authenticate users via SSO (WorkOS) with
  session cookie storage.
- **UR-AUTH-002**: The system shall support MFA at the IdP level (WorkOS
  TOTP, SMS, or hardware key).
- **UR-AUTH-003**: The system shall enforce RBAC with role + module gating
  on every mutating endpoint.
- **UR-AUTH-004**: The system shall revoke sessions on logout or admin
  deprovisioning.

### 5.2 Audit Trail (Part 11 §11.10(e))
- **UR-AUDIT-001**: The system shall record every mutating action with
  actor id, timestamp (UTC), action, entity, and request IP.
- **UR-AUDIT-002**: Audit records shall be append-only — UPDATE and DELETE
  shall be refused at the database layer.
- **UR-AUDIT-003**: Audit records shall carry a hash chain (prev_hash +
  row_hash) that enables detection of tampering.
- **UR-AUDIT-004**: The system shall provide an admin-accessible chain
  verification endpoint that returns intact=true/false + first break id.

### 5.3 Document Lifecycle (Module A)
- **UR-DOC-001**: Documents shall be versioned on every content change.
- **UR-DOC-002**: Document versions shall carry a content hash that binds
  to the e-signature chain.
- **UR-DOC-003**: AI-drafted spans shall record provenance (model, time,
  accepting user) in an append-only ProvenanceRecord table.
- **UR-DOC-004**: Document status transitions shall be gated by a state
  machine with explicit allowed-transition rules.

### 5.4 Publication Lifecycle (Module B)
- **UR-PUB-001**: Publications shall advance through planning→authoring→
  review→submission→published; published is terminal.
- **UR-PUB-002**: ICMJE criteria (0-3) shall be tracked per author.
- **UR-PUB-003**: Soft-gate acknowledgements of missing ICMJE criteria
  shall be logged with the acting user and missing criteria indices.
- **UR-PUB-004**: Vancouver citation numbering shall be computed from
  insertion order; soft-delete shall renumber automatically.
- **UR-PUB-005**: Source document (Clinical Writing CSR) citations shall
  not be removable while the publication is active (FR-B-025).

### 5.5 Medical Content Lifecycle (Module C)
- **UR-MC-001**: Compliance track selection shall lock from stage 2 onward
  (DD-C-001).
- **UR-MC-002**: Patient-facing content shall require a passing Flesch-Kincaid
  readability score (≤8.0) before advancing from stage 3 to stage 4.
- **UR-MC-003**: Library adoption shall require ≥80% similarity to an
  approved Master Library section (FR-C-018).
- **UR-MC-004**: Must-fix Pre-MLR issues shall block submission to MLR.
- **UR-MC-005**: Approved (stage 6) items shall not be archivable while active.

### 5.6 Regulatory Submission Lifecycle (Module D)
- **UR-REG-001**: Module 5 eCTD granularity nodes shall be read-only (DD-D-001).
- **UR-REG-002**: Resolving a major consistency contradiction shall require
  a non-empty resolution_note (DD-D-002).
- **UR-REG-003**: Redactions shall be immutable at stage 5+ (DD-D-003).
- **UR-REG-004**: Advancing to publishing shall require the latest consistency
  check to pass AND the CMC readiness report to be acknowledged.
- **UR-REG-005**: Advancing to submitted shall require the latest eCTD
  validation to pass (critical=0 && major=0).

### 5.7 Ideation Lifecycle (Module E)
- **UR-IDE-001**: Content card overall_status shall be derived from
  (kol_status, ma_status) per the data model derivation table.
- **UR-IDE-002**: Only approved cards shall be schedulable.
- **UR-IDE-003**: Atomised content shall be unique per (card, channel).
- **UR-IDE-004**: KOL review links shall be one-time tokens with 7-day expiry.
- **UR-IDE-005**: Master Library pulls older than 90 days shall trigger
  a currency warning (FR-E-002 v0.3).

### 5.8 AI Gateway
- **UR-AI-001**: All LLM calls shall route through a central gateway.
- **UR-AI-002**: Prompts shall be scrubbed for structured PII (email, SSN,
  phone, credit card patterns) before transmission.
- **UR-AI-003**: Per-tenant monthly cost caps shall be enforced; monthly
  cap of 0 shall reject all calls.
- **UR-AI-004**: Every call shall produce an AiCallRecord with model,
  tokens, cost, latency, and rate-limit decision — even on failure.

## 6. Non-functional requirements

| ID | Requirement |
|---|---|
| UR-NFR-001 | 99.9% uptime target for the API tier |
| UR-NFR-002 | p95 latency ≤500ms for non-AI endpoints under 100 concurrent users |
| UR-NFR-003 | Horizontal scale to 500 concurrent writers |
| UR-NFR-004 | Encryption at rest for the database + object storage |
| UR-NFR-005 | TLS 1.2+ for all API traffic |
| UR-NFR-006 | Backups: nightly + hourly transaction log; 90-day retention; off-site mirror |
| UR-NFR-007 | RTO: 4 hours; RPO: 1 hour (see `runbooks/disaster-recovery.md`) |
| UR-NFR-008 | **AI non-determinism**: Outputs from the LLM are not reproducible. The system shall record the input prompt (scrubbed), model, and output, and provide human-review workflows for every AI-authored span before it enters a validated record (see §5.3 UR-DOC-003). |

## 7. Validation strategy

- **Installation Qualification (IQ)**: Verify environment prerequisites,
  binary versions, migration state, and dependency fingerprints — see `IQ-OQ-PQ.md`.
- **Operational Qualification (OQ)**: Exercise each state machine's boundaries
  and reject paths — see `IQ-OQ-PQ.md`.
- **Performance Qualification (PQ)**: End-to-end user flows per module
  mapped against the Acceptance Criteria doc — see `IQ-OQ-PQ.md`.

## 8. References

- `docs/architecture-implementation-plan.md` — build plan
- `docs/adr/` — architectural decisions
- `docs/demo/02-datamodel.md` — data model
- `docs/demo/03-api-contract.md` — API contracts
- `docs/demo/04-acceptance-criteria.md` — PQ-shaped acceptance criteria
