---
title: IQ / OQ / PQ Protocols — ClinWrite.AI
status: draft
owner: Compliance Lead
reviewers: ["Head of Engineering", "External GAMP 5 Validator"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# Installation / Operational / Performance Qualification Protocols

Every test here produces a dated artefact that goes into the validation
binder. The validator witnesses the OQ + PQ runs; IQ is a repeatable
engineering checklist.

## 1. Installation Qualification (IQ)

**Purpose:** Prove the system is installed per the Design Spec on a known
environment.

### 1.1 Prerequisites checklist

Executed on the target environment (QA VPS, production VPS, or validation
server). Each row has a pass/fail/evidence column.

| # | Check | Expected | Verification |
|---|---|---|---|
| IQ-01 | OS version | Ubuntu 22.04 LTS or later | `cat /etc/os-release` |
| IQ-02 | Node.js version | 20.x LTS | `node --version` |
| IQ-03 | Docker version | 24.x+ | `docker --version` |
| IQ-04 | Docker Compose version | 2.20+ | `docker compose version` |
| IQ-05 | Postgres image | `postgres:16-alpine` running | `docker ps` + `pg_isready` |
| IQ-06 | pgcrypto extension loaded | `SELECT extname FROM pg_extension` includes `pgcrypto` | psql query |
| IQ-07 | Prisma migration state | Latest migration applied, no drift | `npx prisma migrate status` |
| IQ-08 | Audit triggers present | `audit_events_no_update`, `audit_events_no_delete` in `pg_trigger` | psql query |
| IQ-09 | sops+age key file | `/etc/platform/age.key` exists, mode 0600, owned by `platform` | `ls -la` |
| IQ-10 | nginx config | `platform` site enabled, `nginx -t` passes | `nginx -t` |
| IQ-11 | systemd units | `platform-api`, `platform-worker` active | `systemctl status` |
| IQ-12 | TLS cert | Valid Cloudflare origin cert, not expiring in <30d | `openssl x509 -enddate` |
| IQ-13 | Health endpoint | `GET /health` returns `{status:"ok"}` | curl |
| IQ-14 | Backup target reachable | Backblaze B2 bucket writable | smoke upload |

### 1.2 Dependency fingerprinting

- `package-lock.json` sha256 recorded in the binder.
- `prisma/schema/*.prisma` sha256 recorded.
- `apps/api/dist/` sha256 recorded post-build.
- All migration file hashes recorded.

### 1.3 Deliverable

A signed PDF of §1.1 + the §1.2 hashes, filed as `IQ-YYYY-MM-DD-<env>.pdf`.

---

## 2. Operational Qualification (OQ)

**Purpose:** Prove each boundary condition / reject path works as specified.
Executed via the existing integration test suites (automated OQ evidence)
plus witnessed manual runs for the compliance-critical paths.

### 2.1 Automated OQ (vitest)

| ID | URS tie | Test file | Must-prove |
|---|---|---|---|
| OQ-A-01 | UR-AUDIT-002 | `tests/integration/audit.test.ts` | DB-level UPDATE and DELETE on audit_events raise `insufficient_privilege` |
| OQ-A-02 | UR-AUDIT-003 | same | Chain integrity holds under 100 serial appends |
| OQ-A-03 | UR-AUDIT-004 | same | Forged row_hash (while triggers disabled) is detected by verifyChain |
| OQ-DOC-01 | UR-DOC-001 | `src/modules/clinical-writing/documents/service.test.ts` | Same-content PATCH does NOT create a new version |
| OQ-DOC-02 | UR-DOC-002 | same | content_hash is deterministic and section-order-insensitive |
| OQ-DOC-03 | UR-DOC-004 | `document-status.test.ts` | Signed is terminal; no transition out |
| OQ-PUB-01 | UR-PUB-001 | `publication-stage.test.ts` | Linear advancement; reviewer bounce allowed; skipping stages rejected |
| OQ-MC-01 | UR-MC-001 | content-stage.test.ts | `complianceTrackIsLocked(2)=true` |
| OQ-REG-01 | UR-REG-003 | `submission-stage.test.ts` | `redactionsLocked(5)=true` |
| OQ-IDE-01 | UR-IDE-001 | `card-status.test.ts` | All 6 derivation rules covered |
| OQ-AI-01 | UR-AI-002 | `pii-scrub.test.ts` | Email, SSN, phone, credit card all scrubbed; clean prompts untouched |
| OQ-AI-02 | UR-AI-003 | manual + CI | cap=0 rejects; sub-cent cap round-trips |
| OQ-AI-03 | UR-AI-004 | manual | Rate-limited and provider-err paths both write AiCallRecord |

Pass criterion: `npm --workspace=apps/api test` + `npm --workspace=apps/api
run test:integration` both exit 0 on the IQ-verified build. CI history is
the audit evidence.

### 2.2 Witnessed manual OQ

Compliance witnesses these scenarios in the QA environment. Each produces
a dated, signed test record.

| # | Scenario | Expected result |
|---|---|---|
| MOQ-01 | Admin invites a user, user accepts via SSO, admin assigns module A, user authors a section | Session issued, audit chain has user.invite + user.update + auth.login + section_edited events; `/admin/compliance/verify-chain` returns intact |
| MOQ-02 | Writer attempts to edit a Module 5 eCTD node | 422 `node_read_only`; audit event not written (route rejected pre-mutation) |
| MOQ-03 | Reviewer resolves a MAJOR consistency contradiction without a note | 400 `major_requires_note`; retry with note succeeds; audit event recorded |
| MOQ-04 | Super admin sets AI quota to $0 for tenant X; user in tenant X attempts /ai/chat | 429 `rate_limited`; AiCallRecord row persisted with errorCode='rate_limited', cost=0 |
| MOQ-05 | DBA attempts to DELETE a row from audit_events via psql | `ERROR: audit_events is append-only; insufficient_privilege` |

### 2.3 Deliverable

- CI run URL + commit SHA for §2.1.
- Signed manual-OQ record forms for §2.2.

---

## 3. Performance Qualification (PQ)

**Purpose:** Prove the full user-facing happy paths work end-to-end against
a representative production-like environment. Maps 1:1 to the existing
Acceptance Criteria doc (`docs/demo/04-acceptance-criteria.md`), which is
already PQ-shaped.

### 3.1 PQ scenarios (one per module)

| # | URS | Scenario summary |
|---|---|---|
| PQ-A | UR-DOC-* | Clinical Writer authors CSR §2.5 + §2.7 with AI assistance, submits for review, reviewer bounces back with comments, writer resolves, super-reviewer signs; audit chain intact end-to-end |
| PQ-B | UR-PUB-* | Scientific Writer creates a manuscript from CSR, adds 4 authors with ICMJE tracking, inserts 10 Vancouver citations, runs submission readiness, advances to published |
| PQ-C | UR-MC-* | Medical Writer creates a patient-facing PIL, harvests claims, adopts 3 library claims, achieves FK ≤ 8.0, runs pre-MLR clean, submits to MLR, reaches approved stage |
| PQ-D | UR-REG-* | Regulatory Writer builds an IND submission from CSR, indexes canonical JSON, runs consistency (resolves 1 major), acknowledges CMC readiness, runs validation clean, advances to submitted |
| PQ-E | UR-IDE-* | Ideation Lead pulls Master Library artefact, generates 3 content cards, atomises each for 3 channels, cards approved by KOL+MA, scheduled, published, DOI registered |

Each PQ run is scripted (Playwright or curl), executed in the QA
environment, witnessed by Compliance, and the resulting audit chain export
is attached as evidence.

### 3.2 Non-functional PQ

| # | NFR | Test |
|---|---|---|
| PQ-NFR-01 | UR-NFR-002 | Load test (k6/Artillery) 100 concurrent users hitting /auth/me + /projects + list routes; p95 ≤ 500ms |
| PQ-NFR-02 | UR-NFR-006 | Nightly backup script completes; restore from latest succeeds on a staging VPS; smoke test passes |
| PQ-NFR-03 | UR-NFR-007 | DR drill: simulate primary VPS failure, restore to secondary from latest backup within RTO (4h) |
| PQ-NFR-04 | UR-NFR-005 | SSL Labs score A on the production hostname |

### 3.3 Deliverable

- Playwright report HTML + screenshots per PQ-A..E.
- k6/Artillery output for PQ-NFR-01.
- Backup+restore log for PQ-NFR-02.
- DR drill after-action report for PQ-NFR-03.
- SSL Labs report for PQ-NFR-04.
- Signed PQ summary by Compliance Lead + external validator.

---

## 4. Validation state after this document

- **URS**: draft (Phase 5 Batch 1)
- **FS/DS**: draft (Phase 5 Batch 1)
- **IQ**: dry-runnable now via `infra/standalone/scripts/wait-for-health.sh` + `prisma migrate status`
- **OQ**: 75 automated unit tests already passing; integration suite exists
- **PQ**: existing Playwright smoke covers boot + 5 module screens; full PQ scripts land in Phase 6

Compliance sign-off requires all four documents at `status: approved` on
the production environment hash.
