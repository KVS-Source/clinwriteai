# Session D02 — Submission Setup & Strategy
**Screen:** sD02 · Submission Setup & Strategy
**Route:** `/projects/:projectId/regulatory-writing/submissions/:submissionId` (index)
**Component:** `src/modules/regulatory-writing/screens/SubmissionSetupStrategy.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/D/design/aurora-sD02-submission-setup-strategy.html`
**Data:** `src/data/regulatorySubmissions.json`, `src/data/cmcReadinessReport.json`
**Store:** `regulatorySubmissionStore`

---

## What to Build

Stage 1 — submission setup. The regulatory affairs lead links Module A source, selects submission type and HA targets, configures eCTD version, and acknowledges the CMC Data Readiness Report before Stage 2 authoring begins. Primary demo: sub-001 VELORA-301 NDA, CMC 84% acknowledged.

---

## Screen Anatomy

Two-column layout. Left (~60%): setup form. Right (~40%): eCTD Granularity Map preview + CMC Readiness panel.

**Header:** "Submission Setup & Strategy · Stage 1 of 6", stage dot 1 (crimson), "Proceed to Stage 2 →" button (gated).

**Left — Source Documents panel:**
- "Source Documents · Module A"
- Module A project chip: "VELORA-301 · Module A ✓" (green)
- Linked documents: "CSR v1.0 ✓", "IB v3.0 ✓", "SAP v1.1 ✓", "TLF Package v1.0 ✓" — four green chips
- Canonical JSON status (IBM Plex Mono, green): "Indexing complete · 847 data points extracted · Logged to audit trail"
- External CMC data: "Module 3 CMC Data (3 files uploaded ✓)" and "Module 4 Nonclinical Reports (2 files uploaded ✓)"

**Left — Submission strategy:**
- Submission type: 7 card grid. `nda-maa` selected → crimson border + `#FFF5F5`
- Target HA checkboxes: FDA ✓, EMA ✓, MHRA greyed with tooltip "Priority 4 — API procurement required before production"
- eCTD version: "v3.2.2 (default)" selected. v4.0 greyed.
- TA tag: "Oncology" (mandatory)
- Timeline date: 15 Jan 2027

**Left — Stage 1 readiness checklist (6 items):**
All from `sub-001` data:
- Module A source project linked ✓
- External CMC/nonclinical data uploaded ✓
- Submission type selected ✓
- Target HA(s) selected ✓
- TA tag set ✓
- CMC Readiness Report acknowledged ✓ (from `cmcReadinessReport.json`.acknowledgedBy = "user-jh")

"Proceed to Stage 2 →" is **active** because all 6 Stage 2 readiness items are met in the demo data.

**Right — eCTD Granularity Map preview:**
Compact tree from `ectdGranularityMap.json` filtered to `submissionId === 'sub-001'`. Show top-level modules only (not sub-sections). Each row: section label + status dot using `CTD_STATUS_Dot` component. Module 5 nodes show lock icon. Completeness: "38% complete" at preview start. "View full map →" link → sD03.

**Right — CMC Data Readiness panel:**
From `cmcReadinessReport.json`:
- Score ring: 84% crimson arc, "84%" centred
- Status rows: 3.2.S ✓, 3.2.P ✓, 3.2.A ⚠ (amber — stability gap), 3.3 ✓, 3.4 ○
- Missing items in amber: "Stability data — batches 3 and 4 — required before Stage 3 CMC finalisation"
- Acknowledged state (since `acknowledgedBy` is set): "Acknowledged · Dr James Hartley · 08 Oct 2026 · Risk note on file" (green banner). "Acknowledge CMC Readiness Report" button is replaced by the confirmation.

---

## Data Wiring

```typescript
const { activeSubmission, fetchSubmissions } = useRegulatorySubmissionStore()
// MSW: GET /api/projects/:id/regulatory-submissions → regulatorySubmissions.json
// Filter to sub-001 for the active submission

const { data: cmcReport } = useQuery(
  ['cmc-readiness', submissionId],
  () => regulatoryWritingApi.getCMCReadiness(submissionId)
)
// MSW: GET /api/regulatory-submissions/sub-001/cmc-readiness → cmcReadinessReport.json

// Readiness gate
const allReady = linkedSourceProject && cmcData.uploaded && typeSelected
  && hasSelected && taSet && cmcReport?.acknowledgedBy != null

// Proceed
const handleProceed = () => regulatoryWritingApi.advanceStage(submissionId)
  .then(() => navigate(`../module2-editor`))
```

---

## Navigation

- "Proceed to Stage 2 →" → advance stage → navigate to `submissions/${submissionId}/module2-editor` (sD04)
- "View full map →" → navigate to `submissions/${submissionId}/ectd-map` (sD03)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`

**Pass 2:** `npm run build`

**Pass 3 — 5 smoke tests:**
1. Source documents panel shows "Indexing complete · 847 data points extracted · Logged to audit trail" in IBM Plex Mono green.
2. CMC Readiness ring shows 84% with crimson arc. The acknowledged confirmation banner is shown ("Acknowledged · Dr James Hartley · 08 Oct 2026") instead of the acknowledge button.
3. MHRA HA checkbox is greyed with a tooltip "Priority 4 — API procurement required before production."
4. All 6 checklist items show ✓. "Proceed to Stage 2 →" is active.
5. CMC section 3.2.A shows amber ⚠ status with missing items text: "Stability data — batches 3 and 4 — required before Stage 3 CMC finalisation."

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D02-submission-setup-strategy.md and execute.
Build SubmissionSetupStrategy exactly as specified, run all 3 validation passes, and report results.
```
