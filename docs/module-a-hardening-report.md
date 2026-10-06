# Module A (Clinical Writing) — hardening + handover report

**Written 2026-10-06 as part of Arc 5 of [pivot-plan.md](pivot-plan.md).**

This is the single living document a Dev or QA lead should read before
owning Module A. Scope: what shipped, what's covered, what's known-stub,
and what's still blocked on external procurement.

---

## 1. Shipped surface — reality audit (Arc 5.1)

The `project_phase_3a_deferrals` memory called out several items as
"deferred". A code walk on 2026-10-06 confirmed those claims:

| Capability | Status | Location |
|---|---|---|
| Document + section CRUD, versions, ich_status | ✅ shipped | [apps/api/src/modules/clinical-writing/documents/routes.ts](../apps/api/src/modules/clinical-writing/documents/routes.ts) |
| S3 blob storage (MinIO on standalone, S3 on cloud) | ✅ shipped | [apps/api/src/modules/platform/blob/s3-storage.ts](../apps/api/src/modules/platform/blob/s3-storage.ts) |
| Diff engine on version_restore_jobs (`diff-match-patch`) | ✅ shipped | [apps/worker/src/jobs/restore-version.ts](../apps/worker/src/jobs/restore-version.ts) |
| Voice note upload + transcription stub (queue: `clinical.voice_transcribe`) | ✅ shipped | [voice-notes/routes.ts](../apps/api/src/modules/clinical-writing/voice-notes/routes.ts) |
| Section-level presence (REST layer + 2-min reaper) | ✅ shipped | [presence/routes.ts](../apps/api/src/modules/clinical-writing/presence/routes.ts) |
| Socket.io push + Redis adapter | ✅ shipped | [realtime/plugin.ts](../apps/api/src/modules/platform/realtime/plugin.ts) |
| Comments (per-doc + per-section) | ✅ shipped | [comments/routes.ts](../apps/api/src/modules/clinical-writing/comments/routes.ts) |
| CRM meetings + resolutions | ✅ shipped | [crm/routes.ts](../apps/api/src/modules/clinical-writing/crm/routes.ts) |
| TLF packages + items + section links | ✅ shipped | [tlf/routes.ts](../apps/api/src/modules/clinical-writing/tlf/routes.ts) |
| E-signature chain (Part 11, canonical JSON binding, re-auth + TOTP) | ✅ shipped | [signatures/routes.ts](../apps/api/src/modules/clinical-writing/signatures/routes.ts) |
| Checklist instances | ✅ shipped | [checklist/routes.ts](../apps/api/src/modules/clinical-writing/checklist/routes.ts) |

**Net:** Module A API surface is complete. Nothing in the memory's
"deferred" or "scope choice" buckets is actually open at the API layer.

The memory itself should be edited (next session) to mark the above as
"shipped, confirmed 2026-10-06".

---

## 2. Test coverage (Arc 5.3)

### API tests landed

Fast unit suite (`npm --workspace=apps/api test`): **101 passing**,
including:

- `rbac.test.ts` — 14 (incl. new `isModuleEnabled` tests from Arc 1)
- `audit/hash.test.ts` — 9 (hash chain correctness)
- `audit/repository.test.ts` — 4
- `auth/sso.test.ts` — 6
- `platform/ai-gateway/pii-scrub.test.ts` — 12
- `platform/ai-gateway/rate-card.test.ts` — 6
- `tenant-admin/shape.test.ts` — 8 (Arc 3.8)
- Module A: `document-status.test.ts` (6), `documents/service.test.ts` (5)
- Module B stage: `publication-stage.test.ts` (5)
- Module C stage: `content-stage.test.ts` (4), `card-status.test.ts` (6)
- Module D stage: `submission-stage.test.ts` (4)
- PDF rendering: `pdf-renderer.test.ts` x2 (4 + 3)
- Projects state machine (5)

### Module A coverage gaps (as of 2026-10-06)

The tests above exercise pure logic. The route handlers themselves
(upload-routes.ts, comments routes, voice-notes routes, presence,
signatures, crm, tlf) rely on the CI `web-integration` job for
coverage — that job boots the real API container + runs Playwright
against it with MSW off.

Recommended coverage additions (not blocking, but shrink the "could
drift silently" surface):

1. **documents/upload-routes.ts** — add a vitest covering the magic-
   byte heuristic classifier (CSR vs protocol vs IB) with 3 fixture
   buffers.
2. **signatures/routes.ts** — add a vitest covering the signature-
   chain-progress helper (what's required to advance stage N → N+1).
3. **crm/routes.ts** — add a vitest covering nextCrmRef sequence math.
4. **tlf/routes.ts** — add a vitest covering the sectionsByItem
   grouping used in the doc-view endpoint.

Each is a 10-30 LOC fixture + 2-3 asserts. Owner: Dev team on handover.

### Playwright integration

CI `web-integration` job (defined in `.github/workflows/ci.yml`) runs
postgres + redis + API container + web build with MSW off, then
Playwright smoke. The smoke script lives at `apps/web/e2e/` — scope
confirmed to cover the ten Module A flows per
[module-cutover-runbook.md](module-cutover-runbook.md). If a flow
regresses, that job turns red before merge.

---

## 3. Security review (Arc 5.6)

Walked the Module A route surface against a 10-item checklist. All
items pass as of 2026-10-06.

- **✓ Auth gate on every route.** Every `app.get/post/patch/delete` in
  the eight clinical-writing route files is wrapped with
  `requireAuth({ modules: ['A'] })`. No bare routes.
- **✓ Module kill-switch respected.** Routes return 503
  `module_disabled` when `FEATURE_MODULES_ENABLED` doesn't include 'A'
  (Arc 1.1 landed this; it fires before the auth check).
- **✓ Tenant isolation at the DB layer.** RLS policies on `projects`,
  `documents`, `publications`, `med_content_items`,
  `regulatory_submissions`, `ideation_projects` (plus the new
  `tenants`, `memberships`, `sso_connections` from Arc 2.6). Policies
  are permissive-by-default until `app.tenant_id` GUC is set — see
  migration 00000000000027 header for the activation checklist.
- **✓ PHI blob access control.** `/documents/:id/voice-notes/:nid/audio`
  issues a 300-second presigned URL per playback; URL is never
  persisted. Audit event `phi_voice_note_accessed` emitted on every
  issue.
- **✓ Audit chain append-only.** Writes go through
  `app.audit.append` which uses `pg_advisory_xact_lock` to serialise
  concurrent writers. ADR 0002 blocks `prisma.auditEvent.*` at the
  lint layer.
- **✓ Audit secret rotation locked.** `AUDIT_HASH_SECRET` must never
  rotate (would invalidate the chain). Documented in CLAUDE.md.
- **✓ Rate limiting.** `@fastify/rate-limit` with Redis-backed
  per-key counter, 100 req/min default, SSO callback exempted.
- **✓ CORS tight.** `CORS_ORIGIN` env var required (defaults to
  `http://localhost:5173` in dev). Not wildcard.
- **✓ Helmet enabled** (CSP intentionally off — SPA inline styles).
- **✓ Session cookie flags.** HttpOnly, SameSite=Lax, Secure in prod,
  cross-subdomain Domain attribute when `SESSION_COOKIE_DOMAIN` set.

### Known limitations acknowledged

- **No column-level encryption on PHI free-text.** `sections.content_html`,
  `voice_notes.audio_blob_key` (metadata), `comments.text` are plaintext
  in the DB. Covered by the Phase 5 compliance deferral — scheduled for
  SOC 2 / HIPAA audit prep. Not a Module A regression; the exposure
  model relies on DB access controls + full-disk encryption at the VPS
  layer.
- **No automated hard-delete.** Deprovisioning is a status flip; a
  cronned true-delete is in `project_phase_5_deferrals`. QA should
  verify no hard-deletes are expected before raising a defect.

---

## 4. Documentation pack (Arc 5.10–5.13)

### Operator runbook — see [module-cutover-runbook.md](module-cutover-runbook.md)

Covers the 10-flow smoke, per-module cutover toggles, deploy sequence,
rollback procedure.

### Deploy sequence — see [phase-2-cutover-status.md](phase-2-cutover-status.md) §Deploy sequence

Covers prerequisites (SESSION_COOKIE_DOMAIN, CORS_ORIGIN, DNS, DB seed)
and per-deploy steps.

### SSO E2E — see [sso-e2e-runbook.md](sso-e2e-runbook.md)

The ten-step WorkOS walkthrough that unblocks the AUTH cutover.

### Developer onboarding (new, below)

```bash
# One-time
git clone <repo>
cd LifeSciences
npm install
cp apps/api/.env.example apps/api/.env.local      # fill in DB + Redis URLs
cp apps/web/.env.example apps/web/.env.local

# DB setup (requires Postgres 16 + pgcrypto; migration 28 uses gen_random_uuid)
npm --workspace=apps/api exec prisma migrate deploy
npm --workspace=apps/api run db:seed              # seeds Acme tenant + 4 users

# Boot
npm --workspace=apps/api run dev     # API on :3001
npm --workspace=apps/web run dev     # web on :5173
npm --workspace=apps/worker run dev  # background job runner
```

### How to extend Module A

- **New document type**: add to the `MedContentType` enum in `packages/types`,
  add the Prisma enum, wire a classifier case in
  `documents/upload-routes.ts`, update the shape mapper if a new field
  is involved. See batch 41 (document shape mapper) for the pattern.
- **New sub-resource** (e.g. attachments on a comment): mirror
  `voice-notes` — add Prisma model + migration + routes file + add to
  server.ts registrations + optional shape mapper + inline in the
  parent entity's response if the UI expects it joined.
- **Audit event**: use `app.audit.append({ action: 'xxx.yyy', entityType,
  entityId, details, ipAddress, actorId })`. The hash chain + prev-hash
  are handled automatically. Never call `prisma.auditEvent.*` directly.

### API examples (curl)

```bash
# List documents for a project
curl -b cookie.txt https://api.clinwrite.ai/projects/PROJ-VELORA/documents

# Create a document
curl -b cookie.txt -X POST https://api.clinwrite.ai/projects/PROJ-VELORA/documents \
  -H 'Content-Type: application/json' \
  -d '{"type":"csr_full","title":"Study X CSR","stage":"reporting"}'

# Add a section
curl -b cookie.txt -X POST https://api.clinwrite.ai/documents/DOC-X/sections \
  -H 'Content-Type: application/json' \
  -d '{"sectionNumber":"11.1","sectionTitle":"Study design","contentHtml":"..."}'

# Attach a voice note (multipart)
curl -b cookie.txt -X POST \
  'https://api.clinwrite.ai/documents/DOC-X/voice-notes?sectionRef=11.1&durationSeconds=42' \
  -F 'audio=@note.mp3'

# Add a comment
curl -b cookie.txt -X POST https://api.clinwrite.ai/documents/DOC-X/comments \
  -H 'Content-Type: application/json' \
  -d '{"sectionRef":"11.1","text":"Reviewer note","tag":"Must Fix"}'

# Sign-off (requires MFA token in header)
curl -b cookie.txt -X POST https://api.clinwrite.ai/signature-records/REC-X/sign \
  -H 'Content-Type: application/json' \
  -d '{"credentialProof":"...","meaning":"I approve this document"}'
```

---

## 5. External blockers (Arc 5.8–5.9)

Not code work — tracking only. Status reviewed 2026-10-06.

- **ANTHROPIC_API_KEY** — procurement in motion (boss notified
  earlier). When the key lands:
  - Switch document classifier in `documents/upload-routes.ts` from
    filename heuristic to real Claude classification.
  - Wire voice-note transcription worker in
    `apps/worker/src/jobs/voice-transcribe.ts` to Anthropic audio API
    (handler interface stays the same).
  - Enable agentic MLR report (Module C — out of this pivot's scope).

- **MedDRA MSSO licence** — MSSO fee + distribution contract. When
  signed:
  - Replace stub table in `apps/api/prisma/seed.ts` (if present) /
    MedDRA panel in web with real distributed data.
  - No API changes required — the lookup shape is already in place.

---

## 6. Load / performance (Arc 5.5 — not run)

A proper load test needs a provisioned environment this plan can't
set up. Recommended rig when infra is available:

- 50 concurrent writers against one document, measure p99 of
  POST /documents/:id/sections and Socket.io presence fan-out latency.
- 10 concurrent voice-note uploads to measure multipart p99.
- 1000-document portfolio to measure the list endpoint's p99.

Scripts not written — deferring to Dev team's performance baseline
pass post-handover.

---

## 7. Accessibility (Arc 5.7 — spot audit only)

Grepped Module A screens for common WCAG anti-patterns:

- All `<button>` elements have text content or `aria-label` (`.tsx`
  grep returned no bare `<button />` without content).
- Interactive icons use `title` attributes (sidebar icons, module
  dots).
- Status chips use text + colour, not colour alone.
- Form inputs are inside `<label>` elements in the new tenant-admin
  screens.

Full WCAG 2.1 AA pass (contrast ratios, screen-reader walk, keyboard
nav) deferred to Dev team's a11y specialist on handover.

---

## 8. Handover checklist

- [ ] Dev team walkthrough of this document
- [ ] Dev team walkthrough of
  [docs/pivot-plan.md](pivot-plan.md) Arc 2–4 (Tenant Admin stack)
- [ ] QA team walkthrough of
  [module-cutover-runbook.md](module-cutover-runbook.md)
- [ ] QA team walkthrough of
  [sso-e2e-runbook.md](sso-e2e-runbook.md)
- [ ] Open a defect tracker (GH issues) for anything found in
  walkthroughs
- [ ] Resolve all P0 / P1 defects
- [ ] Pin "Module A frozen" in [CLAUDE.md](../CLAUDE.md) — further
  Module A changes go through the Dev team, not this assistant.

See Arc 6 in [pivot-plan.md](pivot-plan.md).
