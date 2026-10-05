---
title: Functional Specification + Design Specification — ClinWrite.AI
status: draft
owner: Head of Engineering
reviewers: ["Compliance Lead", "External GAMP 5 Validator"]
effective_date: TBD
next_review: TBD
version: 0.1
supersedes: n/a
---

# Functional Specification (FS) + Design Specification (DS)

Combined document — the FS maps every URS requirement to a functional unit;
the DS describes the architecture that delivers it. Keep in sync with
`docs/architecture-implementation-plan.md` and the ADR series.

## 1. Architectural overview

### 1.1 Topology

```
┌─────────────────────┐    HTTPS    ┌──────────────────────┐
│  Browser (SPA)      │ ──────────> │  Fastify API         │
│  apps/web           │             │  apps/api            │
└─────────────────────┘             └──────────┬───────────┘
                                               │
                                       ┌───────┴───────┐
                                       │               │
                                       ▼               ▼
                                  Postgres 16     Redis (BullMQ)
                                  + pgcrypto      [queue backing]
                                  (+ pgvector     MinIO (S3-API)
                                    deferred)     [blob storage]
```

See ADR 0001 (Fastify), 0002 (Prisma + raw SQL split), 0003 (Postgres),
0004 (Anthropic LLM), 0005 (WorkOS SSO), 0006 (Secrets provider interface),
0007 (Standalone-first infra), 0008 (BullMQ queue), 0009 (Standalone stack).

### 1.2 Boundary services

| Service | Purpose | Deployment |
|---|---|---|
| `platform-api` | Fastify request handling | systemd unit on VPS |
| `platform-worker` | BullMQ consumer (notifications, expiry cron) | systemd unit on VPS |
| `postgres` | Primary data + audit trail | docker-compose on VPS; nightly off-site backup |
| `redis` | Queue + rate-limit state | docker-compose on VPS |
| `minio` | S3-API-compatible blob store (documents, voice, exports, eCTD) | docker-compose on VPS |
| `nginx` | TLS termination + routing | systemd on VPS; Cloudflare origin cert |
| `prom + grafana + loki` | Metrics + logs | docker-compose on VPS |

## 2. URS → FS mapping

### 2.1 Authentication (UR-AUTH-001..004)

| URS | FS | Implementation |
|---|---|---|
| UR-AUTH-001 | SSO over WorkOS; session cookie (httpOnly, Secure, SameSite=Lax) | `apps/api/src/auth/plugin.ts`, `apps/api/src/auth/sso.ts` |
| UR-AUTH-002 | MFA offloaded to WorkOS IdP; API does not store OTP secrets | WorkOS configuration — operational |
| UR-AUTH-003 | `requireAuth({roles,modules})` preHandler on every mutating route | `apps/api/src/auth/rbac.ts` |
| UR-AUTH-004 | On logout: Session.revokedAt = now; onRequest hook rejects revoked sessions | `apps/api/src/auth/routes.ts` + `plugin.ts` |

### 2.2 Audit Trail (UR-AUDIT-001..004)

| URS | FS | Implementation |
|---|---|---|
| UR-AUDIT-001 | Hook on every mutating request → audit_events INSERT; feature code also writes via `app.audit.append()` | `apps/api/src/audit/plugin.ts` + feature route handlers |
| UR-AUDIT-002 | DB triggers `audit_events_no_update` + `audit_events_no_delete` raise `insufficient_privilege` | migration `00000000000002_audit_trail` |
| UR-AUDIT-003 | `row_hash = sha256(prev_hash | canonical_json(row) | audit_secret)` | `apps/api/src/audit/hash.ts` + `postgres-repository.ts` |
| UR-AUDIT-004 | `GET /admin/compliance/verify-chain` (shipped in Phase 5 Batch 3) returns intact + firstBreakAt | `apps/api/src/modules/platform/compliance/routes.ts` |

### 2.3 Document Lifecycle (UR-DOC-001..004)

| URS | FS | Implementation |
|---|---|---|
| UR-DOC-001 | Section PATCH checks for content change; if changed, creates new DocumentVersion + section_contents in one tx | `apps/api/src/modules/clinical-writing/documents/service.ts` |
| UR-DOC-002 | content_hash = sha256 join of sections sorted by sectionId; frozen on write | same, `hashSections()` helper |
| UR-DOC-003 | AI-drafted PATCH requires `aiModel`; inserts ProvenanceRecord with model + accepted_by + ts | same |
| UR-DOC-004 | `canTransitionDocument(from, to)` enforced on explicit `/transition` endpoint; signed is terminal | `document-status.ts` |

### 2.4 Publication Lifecycle (UR-PUB-001..005)

| URS | FS | Implementation |
|---|---|---|
| UR-PUB-001 | `publication-stage.ts` with linear forward + reviewer/R&R bounce | `apps/api/src/modules/scientific-writing/publication-stage.ts` |
| UR-PUB-002 | 4 PubIcmjeCriterion rows auto-created per author on publication create | `publications/routes.ts` create handler |
| UR-PUB-003 | Each ack creates a new PubIcmjeAcknowledgement row (immutable history); route returns the latest | `authors/routes.ts` acknowledge handler |
| UR-PUB-004 | GET /citations enriches each row with a position-based label; soft-remove via removedAt | `citations/routes.ts` |
| UR-PUB-005 | DELETE citation 422s if `isSourceDocument=true` AND not already removed | same |

### 2.5 Medical Content (UR-MC-001..005)

| URS | FS | Implementation |
|---|---|---|
| UR-MC-001 | PATCH compliance_track → 422 when stage ≥ 2 (`complianceTrackIsLocked`) | `content/routes.ts` |
| UR-MC-002 | advance-stage 3→4 for patient-facing types checks `fkPassed=true` | same |
| UR-MC-003 | `/claims/adopt` 422 when similarityPct < 80 | `claims/routes.ts` |
| UR-MC-004 | advance-stage 4→5 refuses if latest PreMlrCheckResult.mustFixCount > 0 (not shipped yet — stub in `pre-mlr/routes.ts`) | TBD |
| UR-MC-005 | archive endpoint 422s when stage==6 and not already archived | `content/routes.ts` |

### 2.6 Regulatory Submission (UR-REG-001..005)

| URS | FS | Implementation |
|---|---|---|
| UR-REG-001 | PATCH /ectd-nodes/:id → 422 if `isReadOnly=true` | `submissions/routes.ts` |
| UR-REG-002 | PATCH /consistency/contradictions/:id/resolve → 400 for major without resolution_note | `consistency/routes.ts` |
| UR-REG-003 | POST /redactions → 422 when `stage >= 5` (via `redactionsLocked()`) | same |
| UR-REG-004 | advance-stage 3→4 checks consistencyResult.passed && cmcReport.acknowledgedBy | `submissions/routes.ts` |
| UR-REG-005 | advance-stage 5→6 checks ectdValidationResult.passed | same |

### 2.7 Ideation (UR-IDE-001..005)

| URS | FS | Implementation |
|---|---|---|
| UR-IDE-001 | `deriveOverallStatus({kolStatus, maStatus, wasSeen})` runs on every review PATCH | `card-status.ts` |
| UR-IDE-002 | POST /cards/:id/calendar → 422 card_not_approved if overallStatus != 'approved' | `publishing/routes.ts` |
| UR-IDE-003 | AtomisedContent model has UNIQUE(card, channel); POST 409s on collision | `atomised/routes.ts` |
| UR-IDE-004 | KolContact.reviewLinkToken = randomBytes(32).hex, expiry = now + 7d | `publishing/routes.ts` |
| UR-IDE-005 | artefact create computes age(pushDate); >90d → sourceCurrencyStatus='warned' | `routes.ts` |

### 2.8 AI Gateway (UR-AI-001..004)

| URS | FS | Implementation |
|---|---|---|
| UR-AI-001 | `app.aiGateway.chat()` is the only path; feature modules never call Anthropic SDK directly | `ai-gateway/plugin.ts` |
| UR-AI-002 | `scrubPii()` runs on every prompt before forward | `ai-gateway/pii-scrub.ts` |
| UR-AI-003 | `AiTenantQuota` lookup per call; cap=0 rejects; usage summed from AiCallRecord within rolloverDay window | `ai-gateway/service.ts` |
| UR-AI-004 | AiCallRecord written in `finally` block — success, failure, rate_limited all persist | same |

## 3. Design decisions

### 3.1 Multi-tenant isolation
Phase 1 uses shared schema with `tenantId` discriminator columns on
Project, LibrarySection, AiTenantQuota, and User.tenantId. Row-level
isolation is enforced at the service layer rather than Postgres RLS;
switching to RLS is a one-migration change if a customer requires it.

### 3.2 Enum storage
Enum values are stored as TEXT with Zod validation at the route edge
(see `docs/architecture-implementation-plan.md` §2). This permits iterating
on vocabularies without migrations. Migration to Postgres native ENUMs is
scheduled for Phase 6 production hardening.

### 3.3 Audit integrity
See `apps/api/src/audit/hash.ts` + `postgres-repository.ts`. Three defences:
1. Hash chain detects any post-hoc edit.
2. BEFORE UPDATE / BEFORE DELETE triggers raise `insufficient_privilege`.
3. Writes serialized by `pg_advisory_xact_lock` to prevent concurrent
   chain forks.

### 3.4 Deployment: standalone-first (ADR 0007 revised)
Year 1 ships on a single hosted VPS (docker-compose + systemd + sops+age
secrets). Cloud migration (AWS/Azure) is planned Year 2 with cloud-portable
interfaces (SecretsProvider, BlobStorage over S3 API, QueueProducer over
BullMQ).

## 4. Change control

Every schema or interface change goes through the ADR process. Compliance
reviews the ADR before `status: Accepted`. See `docs/adr/README.md`.
