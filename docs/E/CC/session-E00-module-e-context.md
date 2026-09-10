# Session E00 — Module E Context Brief
**Read this once before starting any Module E session (E01–E10).**
**Classification: Internal — GenBioCa Confidential**

---

## 0. What This Brief Is

One-time context handoff from planning to CC build for Module E — Ideation & Publishing. CC has no memory of prior sessions. Read completely before executing any E01–E10 session brief.

---

## 1. Project Root

```
C:/chetan/genBioCa/LifeSciences/
```

---

## 2. What Exists at the Start of Module E

### Engineering documents (all five modules)

| File | Version | Module E sections |
|------|---------|-------------------|
| `docs/Technical_Architecture.md` | v4.0 | §37–§43 |
| `docs/Data_Model.md` | v4.0 | §44–§49 |
| `docs/API_Contracts.md` | v4.0 | §56–§64 |
| `docs/Acceptance_Criteria.md` | v3.0 | §43–§50 |

### Modules A–D (complete)
- Module A: `src/modules/clinical-writing/`
- Module B: `src/modules/scientific-writing/`
- Module C: `src/modules/medical-writing/`
- Module D: `src/modules/regulatory-writing/` — includes `regulatoryWritingHandlers` in MSW
- All Module A–D JSON fixtures in `src/data/`

---

## 3. Module E Identity

| Property | Value |
|----------|-------|
| Module | Ideation & Publishing |
| Colour | Teal `#0D9488` |
| Tailwind tokens | `#0D9488` (teal-600), `#F0FDFA` (teal-50), `#CCFBF1` (teal-100), `#99F6E4` (teal-200) |
| PRD | `docs/E/PRD_E_Ideation_Publishing_v0_3.md` |
| Screens | sE01–sE10 (10 screens) |
| Design files | `docs/E/design/aurora-sE01-*.html` through `aurora-sE10-*.html` |
| Source path | `src/modules/ideation-publishing/` |
| Store path | `src/modules/ideation-publishing/store/` |
| API path | `src/modules/ideation-publishing/api/ideationPublishing.ts` |
| MSW handler | `src/mocks/handlers/ideationPublishing.ts` |
| MVP FRs | 20 (FR-E-001 through FR-E-019) |

---

## 4. Module E JSON Fixture Files

Eight fixture files must be present in `src/data/` before any Module E screen is built.

| File | Records | Primary screens |
|------|---------|----------------|
| `ideationProjects.json` | 3 | sE01, sE02, sE09 |
| `ideationArtefacts.json` | 3 | sE02, sE03 |
| `ideationContentCards.json` | 3 | sE03, sE04, sE05, sE06, sE09, sE10 |
| `atomisedContent.json` | 8 | sE03, sE04, sE08 |
| `claimCurrencyCheck.json` | 1 | sE02, sE03 |
| `ideationCalendar.json` | 5 | sE07, sE08 |
| `socialListeningAlerts.json` | 1 | sE07, sE08 |
| `kolContacts.json` | 1 | sE05, sE06 |

**Full JSON content:** `docs/E/aurora-module-e-data-files.md`

---

## 5. Module E TypeScript Types

All Module E types are appended to `packages/types/src/domain.ts` (Technical Architecture v4.0 §39). Key types:

```typescript
IdeationStage         // 'uploaded'|'under-review'|'reviewed'|'approved'
ContentCardStatus     // 'uploaded'|'under-review'|'reviewed'|'approved'|'rejected'
ChannelFormat         // 'linkedin'|'twitter'|'blog'|'email'|'hcp'|'medical-affairs'|'instagram'|'facebook'
ClaimCurrencyStatus   // 'current'|'potentially-superseded'|'conflicting'
SourceCurrencyStatus  // 'current'|'superseded'|'warned'|'external-confirmed'

IdeationProject       // id, projectId, sourceType, taTag, status, stage
IdeationArtefact      // id, ideationProjectId, sourceModule, approvalStatusCheck
IdeationContentCard   // id, overallStatus (denormalised), claimCurrencyStatus, provenance, provenanceChain
AtomisedContent       // id, channel, contentText, aiFootprintHash, complianceFixes
KOLContact            // id, reviewLinkToken (one-time JWT), signedOffAt, reviewDecisions
```

**`overallStatus` derivation rule** (enforced in MSW and UI):
- `kol=approved + ma=approved` → `approved`
- `kol=approved + ma=pending` → `reviewed`
- `kol=pending` → `under-review` or `uploaded`
- either `rejected` → `rejected`

---

## 6. Module E Zustand Stores

Four stores in `src/modules/ideation-publishing/store/` (Technical Architecture v4.0 §40):

| Store | Owns |
|-------|------|
| `ideationStore.ts` | Projects, active project, active artefact, cards, source gate result, claim currency result |
| `atomisationStore.ts` | Per-channel adaptations, generating-channels loading state, compliance results |
| `calendarStore.ts` | Calendar entries, view (month/week), publishing records, social alerts |
| `standardsStore.ts` | DOI records, Dublin Core metadata, ORCID verifications, WCAG results |

**Critical:** `atomisationStore` fires **one API call per channel** — never batch. Each channel has its own spinner that resolves independently (`AtomisationSpinner` component, DD-E-004).

---

## 7. Module E API Client

File: `src/modules/ideation-publishing/api/ideationPublishing.ts`

21 endpoints in API Contracts v4.0 §56–§63. Key latencies to simulate:

| Endpoint | Simulated latency | Reason |
|----------|------------------|--------|
| `POST .../source-gate` | 1,500ms | Approval status check across Module A–D |
| `POST .../claim-currency` | 3,000ms | Claims scan against current label |
| `POST .../atomise` (per channel) | 2,000ms each | One call per channel — visible per-channel spinner |
| `POST .../compliance-screen` | 2,000ms | Brand + compliance scan |

**KOL route is public — no auth header:**
```typescript
// POST /kol-review/:token/submit — no Authorization header
submitKOLReview: (token: string, decisions: object[]) =>
  fetch(`/api/kol-review/${token}/submit`, { method: 'POST', body: ... })
  // Not using the authenticated api client
```

---

## 8. Module E MSW Handler

File: `src/mocks/handlers/ideationPublishing.ts`

```typescript
// src/mocks/browser.ts — final registration order
import { ideationPublishingHandlers } from './handlers/ideationPublishing'
export const worker = setupWorker(
  ...documentHandlers, ...projectHandlers, ...aiHandlers,
  ...publicationHandlers, ...medContentHandlers,
  ...regulatoryWritingHandlers,
  ...ideationPublishingHandlers,  // ← Module E — last
)
```

---

## 9. Module E Routes

Replace the `ideation-publishing` stub route in `src/router/index.tsx` with the full tree (Technical Architecture v4.0 §38):

```typescript
{
  path: 'ideation-publishing',
  children: [
    { index: true,              element: <IdeationPublishingHome /> },     // sE01
    { path: 'calendar',         element: <ContentCalendar /> },            // sE07
    { path: 'publishing',       element: <PublishingMonitor /> },          // sE08
    {
      path: 'projects/:projectId',
      children: [
        { index: true,          element: <ArtefactUploadSourceCheck /> },  // sE02
        { path: 'tagging',      element: <ContentCardTagging /> },         // sE03
        { path: 'compliance',   element: <PreReviewComplianceScreen /> },  // sE04
        { path: 'ma-approval',  element: <MedicalAffairsApproval /> },    // sE06
        { path: 'final',        element: <FinalOutputPublishingRecord /> },// sE09
        { path: 'standards',    element: <StandardsMetadataDOI /> },      // sE10
      ],
    },
  ],
}
// PUBLIC — outside AppShell — add at router root level
{ path: 'kol-review/:token',  element: <KOLReviewInterface /> }           // sE05
```

**sE05 is the only public route.** No auth check, no redirect to login. KOL accesses via token link directly.

---

## 10. New Shared UI Components

Five new components added to `src/components/ui/` during E00 setup:

| Component | Props | Critical rule |
|-----------|-------|--------------|
| `ProvenanceChip.tsx` | `{ chain: string[] }` | Always visible without interaction — never collapsible |
| `ClaimCurrencyBadge.tsx` | `{ status: ClaimCurrencyStatus }` | Current=green · Potentially-superseded=amber · Conflicting=steel blue `#005F8E` |
| `ChannelAdaptationCard.tsx` | `{ adaptation: AtomisedContent; onEdit: () => void }` | Source doc always read-only (DD-E-001). Card text is editable |
| `SourceGateBlock.tsx` | `{ reason: string; originModule: string }` | Full-width block — no way past it without resolving source |
| `AtomisationSpinner.tsx` | `{ channels: ChannelFormat[]; completing: ChannelFormat[] }` | One spinner per channel — never a single shared spinner |

---

## 11. ESLint Boundary

Already present in `.eslintrc` from Module D setup:
```json
{ "group": ["*/modules/ideation-publishing/*"], "message": "Modules A–D must not import from Module E." }
```

---

## Colour Decision (resolved — apply before writing any token)

**Module E accent is `#0D9488` Teal.** Three documents listed three different values; the design files win:

- PRD §3.3 said `#005F8E` — overridden (steel blue is the cross-module blocking-state colour, cannot be module accent)
- Architecture Tailwind stub had `#E11D48` rose — overridden (rose = sE07/sE08 overdue/error colour)
- Design files sE01–sE10 implement `#0D9488` consistently — **adopted**

Tailwind config (already corrected in Architecture v5):
```typescript
teal: { 600: '#0D9488', 50: '#F0FDFA', 100: '#CCFBF1', 200: '#99F6E4' }
```

Module E blocking states use **amber, grey, rose, green** — never teal as a severity signal. `#005F8E` steel blue appears only in `ClaimCurrencyBadge` conflicting state.

## 12. Teal Tailwind Tokens

Add to `tailwind.config.ts`:
```typescript
colors: {
  teal: {
    600: '#0D9488',
    50:  '#F0FDFA',
    100: '#CCFBF1',
    200: '#99F6E4',
  }
}
```

---

## 13. Demo Data Narrative (what each screen shows)

**Primary demo project: `ip-001` — VELORA-301 Efficacy Communications · Stage 4 Approved**

| Screen | What ip-001 shows |
|--------|-------------------|
| sE01 | 3 project cards: ip-001 Approved (3/3 cards), ip-002 Under Review, ip-003 Uploaded (blocked badge) |
| sE02 | ip-003 BLOCKED — SourceGateBlock full-width. ip-001 source gate passed. 90-day rule bypass shown on ia-001. |
| sE03 | ia-001 artefact open. 3 content cards listed. c-003 shows amber `ClaimCurrencyBadge`. ProvenanceChain visible on all cards without interaction. |
| sE04 | c-001 pre-review. LinkedIn adaptation shown with compliance fix: 'transformative' removed. Must Fix: 0. Advisory: 1 (noted). |
| sE05 | KOL review interface for Prof. James Hartley (token: kol-tok-001-demo). 3 cards. c-003 shows KOL comment on PD-L1 language. |
| sE06 | MA approval: Dr Rebecca Morton. All 3 cards approved 19 Oct 2026. c-003 shows KOL comment + Ideation Lead resolution displayed to MA Lead. |
| sE07 | Calendar. cal-001 LinkedIn published ✓, cal-002 Blog overdue (red tint, 48h), cal-003 HCP published ✓, cal-004 Safety HCP overdue, cal-005 Subgroup LinkedIn scheduled 5 Nov. sla-001 sentiment alert badge on cal-002. |
| sE08 | Publishing monitor. cal-002 Blog in-progress. sla-001 sentiment alert (score 0.36, resolved). DD-E-005: "Mark as published" is human action — no direct API to social platforms. |
| sE09 | Final output for ip-001. All 3 cards approved. Master Library push record. |
| sE10 | Standards for c-001. DOI registration (long-form eligible). ORCID verify for Prof. Whitfield. Dublin Core 15 elements. WCAG 2.1 AA (not 2.2). Module E owns CrossRef/ORCID service note. |

---

## 14. Five Non-Negotiable Rules (all sessions)

1. **Source document is always read-only.** The artefact/source panel in sE02 and sE03 has no edit controls. `SourceGateBlock` renders when gate fails — no bypass. DD-E-001, DD-E-002.
2. **One atomisation call per channel.** Never batch. `AtomisationSpinner` shows individual per-channel spinners. DD-E-004.
3. **Provenance chain is always visible.** `ProvenanceChip` on every content card without any click or expand. FR-E-009.
4. **Conflicting claims block card tagging.** `ClaimCurrencyStatus === 'conflicting'` prevents the passage from being tagged as a content card. DD-E-003.
5. **sE05 KOL route has no Aurora auth.** No login redirect, no session check. Public route at router root level.

---

## 15. E00 Setup Checklist

- [ ] 1. 8 JSON fixtures in `src/data/`
- [ ] 2. Module E type definitions appended to `packages/types/src/domain.ts`
- [ ] 3. Four Module E Zustand stores scaffolded in `src/modules/ideation-publishing/store/`
- [ ] 4. `ideationPublishingApi` created at `src/modules/ideation-publishing/api/ideationPublishing.ts`
- [ ] 5. `ideationPublishingHandlers` created at `src/mocks/handlers/ideationPublishing.ts`
- [ ] 6. `ideationPublishingHandlers` registered in `src/mocks/browser.ts` (last in the list)
- [ ] 7. Full ideation-publishing route tree + public KOL route in `src/router/index.tsx`
- [ ] 8. Five shared UI components built in `src/components/ui/`
- [ ] 9. Teal colour tokens added to `tailwind.config.ts`
- [ ] 10. `npm run typecheck` passes
- [ ] 11. `npm run lint` passes
- [ ] 12. `npm run build` passes

---

## 16. CC Prompt for E00

```
Read C:/chetan/genBioCa/LifeSciences/docs/E/CC/session-E00-module-e-context.md
and execute. Report all 12 setup items completed and all 3 verification checks
(typecheck, lint, build) passing before awaiting Session E01.
```
