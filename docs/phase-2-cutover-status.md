# Phase 2 cutover — current status

As of 2026-10-06. Status snapshot — single source of truth lives in
`apps/web/.env.demo` and `git log`.

## Toggle state (`apps/web/.env.demo`)

| Toggle | State | Shipped in |
|---|---|---|
| `VITE_MOCK_AUTH` | **on** | gated on IdP tenant procurement — see `docs/sso-e2e-runbook.md` |
| `VITE_MOCK_PROJECTS` | off | Batch 37 |
| `VITE_MOCK_MODULE_A` | off | Batch 41 |
| `VITE_MOCK_MODULE_B` | off | Batch 38 |
| `VITE_MOCK_MODULE_C` | off | Batch 39 |
| `VITE_MOCK_MODULE_D` | off | Batch 40 |
| `VITE_MOCK_MODULE_E` | off | Batch 42 |

Six of seven groups now consume the real API from `api.clinwrite.ai`.

## Shape mappers added (batches 37-48)

Every API list / detail / create route for a cutover module now shapes
its response to match the UI's packages/types interface. Zero bare-Prisma
rows reach the browser.

| Entity | Batch | Pattern |
|---|---|---|
| Project | 37 | +team array from teamMembers relation |
| Publication | 38 | +ownerInitials, +project name, +due alias, nulls for computed-elsewhere (doi/gpp2022/aiLabel/warning) |
| MedContentItem | 39 | field aliases (tierOverriddenBy→reviewTierOverriddenBy, sourceModuleBPubId→sourceModuleBPublicationId); aiFootprintPct default 0 |
| RegulatorySubmission | 40 | targetHas→targetHAs casing; synthesised title/compound/indication from Module A src |
| Document + Section | 41 | flatten currentVersion.sections; section aliases (sectionNumber→number, sectionTitle→title, ichStatus→status); meta vs full shapes |
| IdeationProject | 42 | enum variant master_library→master-library; stage derived from status; 4 count aggregates |
| Comment | 43 | +reviewerName/Initials, +age formatted string |
| AtomisedContent | 44 | +channelLabel, +characterCount, +wordCount |
| IdeationContentCard | 45 | +ideationProjectId from parent artefact |
| VoiceNote | 46 | field aliases (authorId→actorId, audioBlobKey→audioRef, durationSeconds→duration); +actorName |
| CRMMeeting | 47 | docTitle/version from Document; chair/attendees as TeamMember[] via User lookups; commentIds/resolvedIds/pendingIds from comments relation |
| TLFItem (doc-view) | 48 | itemType→type; id uses referenceId; +linkedSections[] grouped |

## Shape audits that found no gaps

- **ChecklistInstanceItem** — 1:1 with UI's ChecklistItem
- **PublicationAuthor** — already flattens icmjeAcknowledgements correctly (avatarBg/Fg are UI-side derivations)
- **Signatures + Presence routes** — hand-written client types in Batch 35 match the API shape

## Known remaining sub-resources (not yet audited)

These return bare Prisma rows. Audit when the specific UI flow is
exercised and surfaces a mismatch. Pattern is well-established — add a
`*Shape()` helper, apply in list + mutation returns, done.

- SubmissionCheck (Module B)
- PeerReviewRound + ReviewerComment (Module B)
- KolContact + MaContact (Module E)
- PreMlrCheckResult + PreMlrIssue (Module C)
- MlrComment + MlrDecisionRecord (Module C)
- HaCorrespondence + HaLoqQuestion + HaResponseDraft (Module D)
- AggregateSafetyReport (Module D)
- OddAssessment (Module D)
- CalendarEntry + PublishRecord (Module E)
- RegulatoryAlert (platform)

## Pre-cutover plumbing (batches 35-36)

- `BYPASS_AUTH` env-driven toggle on AuthGuard.tsx (`VITE_BYPASS_AUTH=false` in demo)
- `SESSION_COOKIE_DOMAIN=.clinwrite.ai` env var for cross-subdomain cookie flow
- `.env.example` + `.env.demo` document the toggles + the api.clinwrite.ai target
- Seed script expanded — 1 doc + 3 sections + 1 pub + 1 author + 4 ICMJE
  criteria + 1 med-content + 1 submission + 1 ideation project + 1 artefact
  under PROJ-VELORA
- Per-domain API clients added: signatures, presence, reports, taxonomy
  (+ existing: projects, documents, crm, publications, meddra, auth)
- React Query hooks: useSignatures, usePresence, useReports, useTaxonomy
- Error-handling utility: `describeApiError(err)` → DescribedError (toast/
  inline/dialog with severity + fieldIssues + requestId)
- SkeletonCard component (4 variants)
- CI integration mode (`web-integration` job): postgres+redis+API container,
  seed, build with MSW off, Playwright smoke against live API
- `openapi-typescript` codegen pipeline verified end-to-end (7602 lines
  of generated types from the live API's /docs/json)
- Per-module cutover runbook: `docs/module-cutover-runbook.md`
- SSO E2E runbook: `docs/sso-e2e-runbook.md`

## Deploy sequence (operator)

Prerequisites (one-time):

1. `SESSION_COOKIE_DOMAIN=.clinwrite.ai` in `/opt/platform/env/api.env.enc`
2. `CORS_ORIGIN=https://demo.clinwrite.ai` in the same env file
3. DNS: `demo.clinwrite.ai` A record to the demo VPS, proxied through
   Cloudflare; `api.clinwrite.ai` already in place
4. Run `npm --workspace=apps/api run db:seed` on the demo DB (idempotent;
   adds the fixture set under PROJ-VELORA)

Per deploy:

1. Watch `.github/workflows/deploy-demo.yml` finish — picks up `.env.demo`
   automatically for the SPA build
2. `GET /ready` on `api.clinwrite.ai` returns 200
3. Walk the 10-flow smoke per `docs/module-cutover-runbook.md` for each
   module (recommended order: PROJECTS → MODULE_B → C → D → A → E)
4. On regression, flip the module's toggle back to `on` in `.env.demo`
   and redeploy. Open a GH issue naming the failing flow

## What blocks the AUTH cutover

Only item still gated on external procurement in the Phase 2 pre-work bundle.

- WorkOS tenant (free dev tier works for walkthrough)
- IdP connection (OIDC via Google/MS, or SAML against corporate IdP)
- Test user in that IdP
- Callback URL added to WorkOS allow-list
- WORKOS_API_KEY + WORKOS_CLIENT_ID in `/opt/platform/env/api.env.enc`
- Walk all 10 steps of `docs/sso-e2e-runbook.md`
- Flip `VITE_MOCK_AUTH=off` in `.env.demo`, redeploy

Only then is Phase 2 fully cut over.
