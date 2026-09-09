# Session D07 — eCTD Publishing Monitor
**Screen:** sD07 · eCTD Publishing Monitor
**Route:** `/projects/:projectId/regulatory-writing/submissions/:submissionId/publishing`
**Component:** `src/modules/regulatory-writing/screens/ECTDPublishingMonitor.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/D/design/aurora-sD07-ectd-publishing-monitor.html`
**Data:** `src/data/ectdGranularityMap.json`, `src/data/ectdValidationResult.json`, `src/data/redactionRecord.json`
**Store:** `ectdStore`

---

## What to Build

Stage 5 — continuous eCTD publishing monitor and validation screen. Left: live eCTD package status tree with publishing log. Right (two stacked panels): PPD/CCI Redaction summary and eCTD Validation results. The animated ● dots (auto-compiling) are the visual proof of continuous publishing.

**sD07 → sD08 link:** The PPD/CCI summary panel in sD07 has a "Review all [N] instances →" link that navigates to sD08 (the full redaction tool). Build sD07 first, sD08 next session.

---

## Screen Anatomy

Two-column. Left: eCTD package status tree + log (~420px). Right: two stacked panels.

**Header:** "eCTD Publishing · Stage 5 · Veloricept NDA", "47 of 62 sections compiled · 76%" crimson progress bar. "Run eCTD validation ✦" primary crimson button. "Proceed to Stage 6 →" gated button.

**Left — eCTD Package Status:**

Header: "Continuous Publishing Monitor · Auto-compiling as sections lock" in IBM Plex Mono.
Sub-label: "eCTD v3.2.2 · Validator: EXTEDO EXTEDOpulse · Gateway: FDA ESG (Priority 1) + EMA CESP (Priority 2)"

Tree built from `ectdGranularityMap.json`. File-level nodes, not section-level. Status icons:
- ✓ green = `status === 'signed'`
- ● crimson animated = `status === 'in-authoring'` (CSS pulse animation)
- ○ grey = `status === 'not-started'`
- ⚠ amber = node `id === 'nd-033'` (3.2.A stability gap)
- ◉ steel blue = `isSystemGenerated === true`

Show key nodes:
```
Module 2
  ◉ 2.1-table-of-contents.xml       [auto]
  ◉ 2.2-introduction.pdf             [auto]
  ✓ 2.3-quality-overall-summary.pdf
  ✓ 2.4-nonclinical-overview.pdf
  ● 2.5-clinical-overview.pdf        [← animated, in-authoring]
  ○ 2.6-nonclinical-summaries.pdf
  ● 2.7-clinical-summaries.pdf       [← animated]

Module 3
  ✓ 3.2.S-drug-substance.pdf
  ✓ 3.2.P-drug-product.pdf
  ⚠ 3.2.A-appendices.pdf            [← amber, stability gap]

Module 5 [READ-ONLY · Module A]
  ✓ 5.3.1-csr-velora301.pdf
```

Publishing log (scrollable, IBM Plex Mono small, grey):
```
15 Oct 2026 16:22 UTC  2.5-clinical-overview v0.4 → compiling
15 Oct 2026 16:20 UTC  2.7-clinical-summaries v0.3 → compiled ✓
15 Oct 2026 16:18 UTC  3.2.P v1.0 → compiled ✓
15 Oct 2026 14:03 UTC  5.3.1 CSR import → compiled ✓ [Module A]
```

**Right top — PPD/CCI Redaction summary:**
From `redactionRecord.json`:
- Header: "PPD/CCI Anonymisation · Required for public disclosure (EMA Policy 0070/0043)"
- "AI detection complete · 47 PPD + 8 CCI instances marked ✓"
- Progress: "23 of 55 confirmed · 32 remaining"
- Two unconfirmed example rows (from `redactionRecord.json`.documents[0].ppdItems — ppd-002, ppd-003)
- Warning strip (amber): "Redactions are irreversible after submission. Pre-redaction version retained under restricted access per DD-D-003."
- "Review all 32 remaining instances →" link → navigates to `submissions/${submissionId}/redaction` (sD08)

**Right bottom — eCTD Validation:**
From `ectdValidationResult.json`:
- Header: "eCTD Validation · EXTEDO EXTEDOpulse"
- Counts table: Critical 0 ✓ / Major 1 ⚠ / Minor 3 (advisory)
- Major error card (ve-001): Rule "FDA v3.2.2 · M2-01", description, fix instruction, "Fix automatically →" button
- Minor errors: "3 minor errors · advisory only · do not block submission." (collapsed)
- Gate: Major = 1 → "Proceed to Stage 6 →" blocked. Sub-label: "1 major validation error must be resolved."

**Proceed to Stage 6 gate:**
Requires: Critical = 0 ✓ / Major = 0 ✗ (1 remaining) / All PPD/CCI confirmed ✗ (32 remaining).

---

## Data Wiring

```typescript
const { nodes, publishingLog } = useEctdStore()
// MSW: GET /api/regulatory-submissions/sub-001/ectd-map → ectdGranularityMap.json

const { data: validationResult } = useQuery(['ectd-validation', submissionId],
  () => regulatoryWritingApi.getECTDValidation(submissionId))
// MSW: GET → ectdValidationResult.json

const { data: redactionData } = useQuery(['redaction', submissionId],
  () => regulatoryWritingApi.getRedaction(submissionId))
// MSW: GET → redactionRecord.json

// Gate
const majorErrors = validationResult?.majorCount ?? 1  // 1 — blocks
const allRedacted = redactionData
  ? (redactionData.confirmedPPD + redactionData.confirmedCCI) ===
    (redactionData.totalPPD + redactionData.totalCCI)
  : false  // false — 32 remaining

const canProceedStage6 = majorErrors === 0 && allRedacted
// canProceedStage6 = false in demo

// Run validation (3000ms simulated)
const handleRunValidation = () => regulatoryWritingApi.runECTDValidation(submissionId)

// Auto-fix major error
const handleAutoFix = () => {
  // Flash: "File renamed to 'm2-3-quality-overall-summary.pdf' — major error resolved. Re-run validation to confirm."
}
```

---

## Navigation

- "Review all 32 remaining instances →" → navigate to `submissions/${submissionId}/redaction` (sD08)
- "Proceed to Stage 6 →" (when gate passes) → navigate to `submissions/${submissionId}/gateway` (sD09)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`

**Pass 2:** `npm run build`

**Pass 3 — 5 smoke tests:**
1. The "2.5-clinical-overview" and "2.7-clinical-summaries" nodes show an animated ● crimson dot (CSS pulse). The "3.2.A-appendices" node shows amber ⚠.
2. The publishing log shows 4 entries in IBM Plex Mono small grey text, most recent first.
3. PPD/CCI summary shows "23 of 55 confirmed · 32 remaining" with the amber irreversibility warning strip.
4. The "Review all 32 remaining instances →" link is present and navigates to the redaction route (sD08).
5. eCTD validation panel shows 1 major error card (ve-001 file naming) with an "Fix automatically →" button. "Proceed to Stage 6 →" is inactive.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D07-ectd-publishing-monitor.md and execute.
Build ECTDPublishingMonitor exactly as specified, run all 3 validation passes, and report results.
Note: sD07 must be complete before starting sD08. The "Review all instances →" link in sD07 navigates to the sD08 redaction route.
```
