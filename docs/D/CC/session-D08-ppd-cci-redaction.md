# Session D08 — PPD/CCI Redaction Tool
**Screen:** sD08 · PPD/CCI Redaction Tool
**Route:** `/projects/:projectId/regulatory-writing/submissions/:submissionId/redaction`
**Component:** `src/modules/regulatory-writing/screens/PPDCCIRedactionTool.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/D/design/aurora-sD08-ppd-cci-redaction.html`
**Data:** `src/data/redactionRecord.json`
**Store:** none (local component state — redaction confirmation is per-item, not global)
**Prerequisite:** sD07 must be built and passing before this session. The "Review all instances →" link in sD07 navigates here.

---

## What to Build

Dedicated full-screen redaction confirmation tool. Left: document list + progress sidebar. Right: paginated document viewer with inline PPD (yellow highlight) and CCI (blue highlight) redaction overlays. The Regulatory Writer confirms each AI-detected instance one by one. Irreversible after Stage 5 (DD-D-003).

---

## Screen Anatomy

Two-panel. Left: document list + stats (~300px). Right: document viewer with redaction markup.

**Header:** "PPD/CCI Redaction · Stage 5", "23 of 55 confirmed · 32 remaining" amber chip. "Generate public copy →" gated button (active only when 55/55 confirmed). "Back to Publishing →" link → sD07.

**Left — Document list:**
From `redactionRecord.json`.documents. Two rows:

- "5.3.1 VELORA-301 Phase III CSR v1.0" · PPD: 38 · CCI: 6 · [14/44 confirmed]
  - Highlighted with crimson left border (active document)
- "5.3.1 Appendix — Patient Data Listings" · PPD: 9 · CCI: 0 · [9/9 confirmed ✓]
  - Green chip — all done

Below list: two output version labels:
- "Original (unredacted) — Restricted access · Regulatory Writer + Reg Affairs Lead only"
- "Public redacted copy — Generated after all instances confirmed"

**Jump to next unconfirmed →** — most prominent action in the left panel. Crimson text button. Jumps to the next unconfirmed item in the active document.

**Right — Document viewer:**

Page display: "Page 24 of 387" with prev/next and "Go to page" input.

Three instance types rendered as overlays:

**PPD confirmed (ppd-001):**
Black redaction bar over text: `████████████████████` with small green chip "✓ PPD · Confirmed · Dr S. Chen"

**PPD unconfirmed (ppd-002):**
Yellow highlight: `Dr. [Investigator Name], Memorial Cancer Institute`
Action bar below:
- "AI detected: Patient/Investigator name · Confirm redaction [✓ REDACT] or [✗ KEEP — requires justification]"

**CCI unconfirmed (cci-002):**
Blue highlight: `[Proprietary formulation process — step 7 excipient ratios]`
Action bar: "AI detected: CCI — Commercially Confidential · [✓ REDACT] or [✗ KEEP — requires justification]"

If KEEP is selected: justification text field appears, required before saving.

**Page footer (IBM Plex Mono):**
"Page 24: 2 instances · 1 confirmed · 1 remaining. [Confirm all on page →]" link

**Audit footer (full width, IBM Plex Mono small grey):**
"Redaction session · 15 Oct 2026 · Dr Sarah Chen · All confirmations logged to audit trail · Pre-redaction version retained under restricted access per DD-D-003."

**Colour rules:**
- Yellow highlight (#FDE68A) = PPD, unconfirmed
- Blue highlight (#BFDBFE) = CCI, unconfirmed
- Black bar = confirmed (any type)
- Never use word "delete" — always "redact"
- The irreversibility note must be in the audit footer, not as a warning banner

---

## Data Wiring

```typescript
// Load redaction data
const { data: redactionRecord } = useQuery(['redaction', submissionId],
  () => regulatoryWritingApi.getRedaction(submissionId))
// MSW: GET /api/regulatory-submissions/sub-001/redaction → redactionRecord.json

// Active document (default to first in list)
const [activeDocId, setActiveDocId] = useState('doc-5.3.1')
const activeDoc = redactionRecord?.documents.find(d => d.documentId === activeDocId)

// Confirm redaction
const confirmItem = (itemId: string, type: 'ppd' | 'cci') =>
  regulatoryWritingApi.confirmRedaction(submissionId, type, itemId)
// MSW: PATCH /api/regulatory-submissions/sub-001/redaction/ppd/ppd-002/confirm
// → returns updated item with confirmed: true

// Overall progress
const totalPPD = redactionRecord?.totalPPD ?? 47    // 47
const totalCCI = redactionRecord?.totalCCI ?? 8     // 8
const total = totalPPD + totalCCI                   // 55
const confirmed = (redactionRecord?.confirmedPPD ?? 23) + (redactionRecord?.confirmedCCI ?? 5)  // 28
const remaining = total - confirmed                 // 27

// Generate public copy gate
const canGenerate = remaining === 0                 // false in demo
```

---

## Navigation

- "Back to Publishing →" → navigate to `submissions/${submissionId}/publishing` (sD07)
- "Generate public copy →" (gated — only when 55/55 confirmed) → triggers generation, flash: "Public redacted copy generated. Both versions available in the final distribution package."

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`

**Pass 2:** `npm run build`

**Pass 3 — 5 smoke tests:**
1. Active document "5.3.1 VELORA-301 Phase III CSR" shows crimson left border. "5.3.1 Appendix" shows green "all done" chip.
2. ppd-001 renders as a black redaction bar with green "✓ PPD · Confirmed · Dr S. Chen" chip. ppd-002 renders as yellow highlight with the [✓ REDACT] / [✗ KEEP] action bar below.
3. cci-002 renders as a blue highlight (distinct from yellow PPD). The colour difference is clearly visible.
4. "Jump to next unconfirmed →" button is present and prominent in the left panel (crimson text button).
5. The audit footer renders in IBM Plex Mono with the DD-D-003 pre-redaction retention reference. The word "redact" is used throughout — "delete" does not appear anywhere on the screen.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D08-ppd-cci-redaction.md and execute.
Build PPDCCIRedactionTool exactly as specified, run all 3 validation passes, and report results.
```
