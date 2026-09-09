# Session D00 — Module D Context Brief
**Read this once before starting any Module D session (D01–D12).**
**Classification: Internal — GenBioCa Confidential**

---

## 0. What This Brief Is

This is the one-time context handoff from the planning and design phase to CC build for Module D — Regulatory Writing. CC has no memory of prior sessions. Read this file completely before executing any D01–D12 session brief.

---

## 1. Project Root

```
C:/chetan/genBioCa/LifeSciences/
```

---

## 2. What Exists at the Start of Module D

### Engineering documents (now covering Modules A, B, C, and D)

| File | Version | Module D sections |
|------|---------|-------------------|
| `docs/Technical_Architecture.md` | v4.0 | §30–§36 |
| `docs/Data_Model.md` | v4.0 | §36–§43 |
| `docs/API_Contracts.md` | v4.0 | §44–§55 |
| `docs/Acceptance_Criteria.md` | v3.0 | §35–§42 |

### Modules A, B, C (complete)
- Module A: `src/modules/clinical-writing/`
- Module B: `src/modules/scientific-writing/`
- Module C: `src/modules/medical-writing/` — includes MSW handler `src/mocks/handlers/medContent.ts`
- All Module A/B/C JSON fixtures in `src/data/`

---

## 3. Module D Identity

| Property | Value |
|----------|-------|
| Module | Regulatory Writing |
| Colour | Crimson `#B0200D` |
| Tailwind tokens | `#B0200D` (crimson-700), `#FFF5F5` (crimson-50), `#FFE0E0` (crimson-100), `#FFC5C5` (crimson-200) |
| PRD | `docs/D/PRD_D_Regulatory_Writing_v0_2.md` |
| Screens | sD01–sD12 (12 screens) |
| Design files | `docs/D/design/aurora-sD01-*.html` through `aurora-sD12-*.html` |
| Source path | `src/modules/regulatory-writing/` |
| Store path | `src/modules/regulatory-writing/store/` |
| API path | `src/modules/regulatory-writing/api/regulatoryWriting.ts` |
| MSW handler | `src/mocks/handlers/regulatoryWriting.ts` |
| MVP FRs | 27 (FR-D-001 through FR-D-027) |

---

## 4. Module D JSON Fixture Files

Twelve fixture files must be present in `src/data/` before any Module D screen is built.

| File | Records | Primary screens |
|------|---------|----------------|
| `regulatorySubmissions.json` | 3 | sD01, sD02, sD05, sD12 |
| `ectdGranularityMap.json` | 36 | sD01, sD03, sD04, sD07 |
| `cmcReadinessReport.json` | 1 | sD02, sD05 |
| `consistencyCheckResult.json` | 1 | sD04, sD06 |
| `regulatoryAlerts.json` | 2 | sD01, sD11 |
| `gatewaySubmissions.json` | 3 | sD09, sD12 |
| `haCorrespondence.json` | 4 | sD09, sD10 |
| `superReviewers.json` | 6 | sD06 |
| `ectdValidationResult.json` | 1 | sD07 |
| `redactionRecord.json` | 1 | sD07, sD08 |
| `regulatoryLibraryCards.json` | 5 | sD09, sD12 |
| `oddAssessment.json` | 1 | sD12 |

**Full JSON content:** `docs/D/aurora-module-d-data-files.md`

---

## 5. Module D TypeScript Types

All Module D types are appended to `packages/types/src/domain.ts` (Technical Architecture v4.0 §32). Key types:

```typescript
RegSubmissionType       // 'ind'|'nda-maa'|'psur-pbrer'|'rmp-rems'|'ha-response'|'cer'|'orphan-drug'
SubmissionStatus        // 'source-gathering'|'module2-authoring'|'finalisation'|'super-review'|'publishing'|'submitted'|'post-submission'
CTDModuleStatus         // 'not-started'|'in-authoring'|'in-review'|'signed'|'auto-generated'|'read-only'
GatewayTarget           // 'fda-esg'|'ema-cesp'|'cdsco'|'mhra'
GatewayACKStatus        // 'pending'|'ack1'|'ack2'|'ack3'|'nack'
ConsistencySeverity     // 'major'|'minor'
RedactionType           // 'ppd'|'cci'
```

Lookup constants also in `domain.ts`:
- `GATEWAY_PRIORITY` — priority, label, apiReady per gateway target (MHRA: `apiReady: false`)
- `CTD_STATUS_META` — symbol, colour, label per CTD module status

---

## 6. Module D Zustand Stores

Five stores in `src/modules/regulatory-writing/store/` (Technical Architecture v4.0 §33):

| Store | Owns |
|-------|------|
| `regulatorySubmissionStore.ts` | Submission list, active submission, panel state |
| `ectdStore.ts` | Live eCTD map nodes, publishing log, compilation state |
| `superReviewStore.ts` | 6-role RACI reviewers, comments, consistency result, active tab |
| `gatewayStore.ts` | Gateway records, `confirmingTransmission` boolean gate |
| `regulatoryIntelligenceStore.ts` | Alerts, unread count |

**Critical:** `gatewayStore.confirmingTransmission` must be `true` before the gateway transmit API call fires. The `PartElevenConfirm` component manages this state. Never bypass it.

---

## 7. Module D API Client

File: `src/modules/regulatory-writing/api/regulatoryWriting.ts`

32 endpoints in API Contracts v4.0 §44–§55. Key latencies to simulate:

| Endpoint | Simulated latency | Reason |
|----------|------------------|--------|
| `POST .../canonical-json/index` | 2,000ms | AI indexing across Module A documents |
| `POST .../consistency-check/run` | 5,000ms | Cross-module data scan (120s real; use 5s for prototype) |
| `POST .../ectd-validation/run` | 3,000ms | EXTEDO validator call |
| `POST .../ha-response/:questionId/generate` | 3,000ms | AI response drafting from canonical JSON |

---

## 8. Module D MSW Handler

File: `src/mocks/handlers/regulatoryWriting.ts`

```typescript
// src/mocks/browser.ts — add after medContentHandlers
import { regulatoryWritingHandlers } from './handlers/regulatoryWriting'
export const worker = setupWorker(
  ...documentHandlers, ...projectHandlers, ...aiHandlers,
  ...publicationHandlers, ...medContentHandlers,
  ...regulatoryWritingHandlers,  // ← Module D
)
```

---

## 9. Module D Routes

The `regulatory-writing` stub route in `src/router/index.tsx` must be replaced with the full tree (Technical Architecture v4.0 §31):

```typescript
{
  path: 'regulatory-writing',
  children: [
    { index: true,                        element: <RegulatoryWritingHome /> },     // sD01
    { path: 'intelligence',               element: <RegulatoryIntelligence /> },    // sD11
    {
      path: 'submissions/:submissionId',
      children: [
        { index: true,                    element: <SubmissionSetupStrategy /> },   // sD02
        { path: 'ectd-map',              element: <ECTDGranularityMap /> },         // sD03
        { path: 'module2-editor',        element: <CTDModule2Editor /> },           // sD04
        { path: 'finalisation',          element: <CMCNonclinicalFinalisation /> }, // sD05
        { path: 'super-review',          element: <SuperReview /> },                // sD06
        { path: 'publishing',            element: <ECTDPublishingMonitor /> },      // sD07
        { path: 'redaction',             element: <PPDCCIRedactionTool /> },        // sD08
        { path: 'gateway',               element: <GatewaySubmission /> },          // sD09
        { path: 'ha-response',           element: <HAResponseDrafting /> },         // sD10
        { path: 'final',                 element: <FinalOutputPortfolio /> },       // sD12
      ],
    },
  ],
}
```

---

## 10. New Shared UI Components

Six new components added to `src/components/ui/` during Module D C00 setup:

| Component | Props | Critical rule |
|-----------|-------|--------------|
| `ECTDStatusDot.tsx` | `{ status: CTDModuleStatus }` | Symbol + colour from `CTD_STATUS_META` |
| `ConsistencyContradictionCard.tsx` | `{ contradiction: ConsistencyContradiction }` | Show source/target values as diff |
| `GatewayACKTimeline.tsx` | `{ record: GatewaySubmissionRecord }` | Show elapsed time on each received ACK |
| `PartElevenConfirm.tsx` | `{ onConfirm: () => void; meaning: string }` | **Sets `confirmingTransmission = true`. Inline expand — never a modal.** |
| `CTDReadOnlyBanner.tsx` | none | Full-width steel blue banner for Module 5 sections (DD-D-001) |
| `DataObjectivityFlag.tsx` | `{ text: string; suggestion: string }` | Purple dashed underline + tooltip in Module 2 editor |

---

## 11. ESLint Boundary

Add to `.eslintrc` (Technical Architecture v4.0 §36):
```json
{ "group": ["*/modules/regulatory-writing/*"], "message": "Modules A, B, and C must not import from Module D." }
```

---

## 12. Crimson Tailwind Tokens

Add to `tailwind.config.ts`:
```typescript
colors: {
  crimson: {
    700: '#B0200D',
    50:  '#FFF5F5',
    100: '#FFE0E0',
    200: '#FFC5C5',
  }
}
```

---

## 13. Demo Data Narrative (for CC to understand what each screen shows)

**The primary demo submission is `sub-001` — VELORA-301 NDA, Stage 2 authoring.**

| Screen | What sub-001 shows |
|--------|-------------------|
| sD01 | 3 submission cards. sub-001 amber chip "2 contradictions flagged". eCTD mini-panel 76% complete. |
| sD02 | sub-001 source linked (VELORA-301 Module A). CMC 84% — acknowledged. Stage 2 ready. |
| sD03 | 36-node eCTD tree. 4 Module 5 nodes locked. 2.5/2.7/2.7.2.1 in-authoring. 2.5.4 consistency flagged. |
| sD04 | Section 2.5.4 open. HR 0.61 in draft. Consistency amber underline on "0.61". Data objectivity purple flag on superlative. |
| sD05 | Module 3 tab: 84% ring, 3.2.A amber gap. Module 5 tab: full-width read-only banner. |
| sD06 | 2 of 6 RACI signed. con-001 resolved (Major). con-002 unresolved (Minor) — blocks Stage 5. |
| sD07 | eCTD tree 76% compiled. val-001: 0 critical, 1 major (naming). PPD/CCI summary 23/55 confirmed. |
| sD08 | redactionRecord doc-5.3.1. ppd-001 confirmed, ppd-002 awaiting. cci-001 confirmed, cci-002 awaiting. |
| sD09 | gw-001 FDA ACK2 ✓ (6min ACK1, 2h25m ACK2). gw-002 EMA pending. MHRA disabled. |
| sD10 | haCorrespondence FDA Day 120 LoQ, 7 questions shown. q-001 responded with AI draft. q-003 in progress. |
| sD11 | alert-001 ICH E2C(R2). alert-002 FDA 21 CFR 314. CSR update trigger and safety signal trigger. |
| sD12 | Final Output (sub-001 ACK2 confirmed). ODD assessment (sub-003 AURELIA-101, 84% eligible). Kanban: 3 submissions. |

---

## 14. D00 Setup Checklist

Before starting D01, confirm all of the following:

- [ ] 1. 12 JSON fixtures in `src/data/` (all files listed in §4)
- [ ] 2. Module D type definitions appended to `packages/types/src/domain.ts`
- [ ] 3. Five Module D Zustand stores scaffolded in `src/modules/regulatory-writing/store/`
- [ ] 4. `regulatoryWritingApi` created at `src/modules/regulatory-writing/api/regulatoryWriting.ts`
- [ ] 5. `regulatoryWritingHandlers` created at `src/mocks/handlers/regulatoryWriting.ts`
- [ ] 6. `regulatoryWritingHandlers` registered in `src/mocks/browser.ts`
- [ ] 7. Full regulatory-writing route tree in `src/router/index.tsx`
- [ ] 8. Six shared UI components built in `src/components/ui/`
- [ ] 9. ESLint boundary rule added for Module D
- [ ] 10. Crimson colour tokens added to `tailwind.config.ts`
- [ ] 11. `npm run typecheck` passes
- [ ] 12. `npm run lint` passes
- [ ] 13. `npm run build` passes

---

## 15. Five Non-Negotiable Rules (apply to every screen)

1. **No red.** Blocking states use `#005F8E`. Only crimson is the module accent.
2. **Module 5 is always read-only.** Every Module 5 node shows lock icon + "Read-only · Module A". No edit controls. `CTDReadOnlyBanner` on every Module 5 view.
3. **Consistency check is a hard gate.** `Submit to Stage 5 →` inactive while any Major contradiction is unresolved. Show specific blocker: "Major contradiction unresolved — must resolve before Stage 5."
4. **Gateway requires inline Part 11 confirm.** `PartElevenConfirm` must expand before the API call. `confirmingTransmission` boolean gates the call. Never a modal.
5. **Redaction is irreversible after Stage 5.** Use word "redact" not "delete". Show the warning on sD08.

---

## 16. CC Prompt for D00

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D00-module-d-context.md
and execute. Report all 13 setup items completed and all 3 verification checks
(typecheck, lint, build) passing before awaiting Session D01.
```

---

*AURORA Module D CC Context Brief · v1.0 · September 2026 · GenBioCa Confidential*
