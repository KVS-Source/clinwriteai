# Phase 2 cutover — current status

> **Status after the 2026-10-06 pivot (see [docs/pivot-plan.md](pivot-plan.md)):**
> this document reflects the state of **shape-mapper work only**.
> Modules B/C/D/E are **frozen at runtime** by the
> `FEATURE_MODULES_ENABLED` + `VITE_MODULES_ENABLED` kill-switches
> landed in Arc 1. The code below stays merged — no revert — but no
> further B/C/D/E work ships until Arc 7. Treat this doc as the
> historical record of what was done, not the live roadmap.

As of 2026-10-06. Status snapshot — single source of truth lives in
`apps/web/.env.demo` and `git log`.

Batches 50-59 extended the shape-mapper sweep to every remaining
sub-resource with a UI counterpart. The "known remaining sub-resources"
section is now the audit log of what was done.

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
| SubmissionCheck | 50 | lastRunAt default (UI non-nullable); seed sets lastRunAt |
| ReviewRound + ReviewerComment | 51 | status vocab underscore→hyphen; +auditEntryId |
| KolContact | 52 | +title (''); +reviewDecisions ([] pending security route) |
| PreMlrCheckResult + Issue | 53 | severity vocab underscore→hyphen; +auditEntryId threaded from audit.append |
| MlrComment | 54 | +reviewerStamp from MlrReviewer.role; +tagBg/tagFg palette; +escalationAuditId |
| HaCorrespondence + HaQuestion | 55 | gateway from submission.targetHas[0]; questionRef→questionId+number; status vocab remap; category collapsed; +aiDraftGenerated/Pct from latest draft |
| OddAssessment | 57 | composite view: EU/US prevalence math, eligibilityScore/Label, benefitDraft merged, compound from source Module A project |
| CalendarEntry | 58 | +channelLabel, cardTitle from artefact, assignedCreativeName from User, utm/seo/sentiment from publishRecord, isOverdue/overdueHours computed |
| RegulatoryAlert | 59 | sourceUrl ''-coerce, +isEffectiveDateEstimate (false), +affectedDossierSections ([]), +actionRequired ('') |

## Shape audits that found no gaps

- **ChecklistInstanceItem** — 1:1 with UI's ChecklistItem
- **PublicationAuthor** — already flattens icmjeAcknowledgements correctly (avatarBg/Fg are UI-side derivations)
- **Signatures + Presence routes** — hand-written client types in Batch 35 match the API shape
- **MaContact** (Batch 52) — no UI counterpart in packages/types; raw Prisma rows pass through
- **AggregateSafetyReport** (Batch 56) — no UI counterpart; raw Prisma rows pass through
- **MlrDecisionRecord** (Batch 54) — no standalone UI type; MLRDecision info lives on the content item
- **HaResponseDraft** (Batch 55) — no standalone UI type; `aiDraftGenerated` + `aiFootprintPct` are denormed onto HAQuestion from the latest draft
- **PublishRecord** (Batch 58) — fields are consumed denormed on CalendarEntry

## Remaining gaps that need data-model expansion (not shape work)

Shape mappers default these fields safely, but a future data-model
batch should add real columns + plumb them end-to-end:

- `KolContact.title` + a `kol_review_decisions` child table (Batch 52)
- `pre_mlr_check_results.audit_entry_id` column + migration (Batch 53)
- `aggregate_safety_reports` → add UI type OR leave as pass-through until a dedicated sC-D06 PSUR workbench ships (Batch 56)
- `regulatory_alerts.is_effective_date_estimate` + `.action_required` + a `regulatory_alert_sections` cross-ref table (Batch 59)
- `calendar_entries.overdue_alert_sent_at` + MA advance notification columns (Batch 58)

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
