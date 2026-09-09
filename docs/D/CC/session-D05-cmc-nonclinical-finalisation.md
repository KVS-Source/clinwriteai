# Session D05 — CMC & Nonclinical Finalisation
**Screen:** sD05 · CMC & Nonclinical Finalisation
**Route:** `/projects/:projectId/regulatory-writing/submissions/:submissionId/finalisation`
**Component:** `src/modules/regulatory-writing/screens/CMCNonclinicalFinalisation.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/D/design/aurora-sD05-cmc-nonclinical-finalisation.html`
**Data:** `src/data/cmcReadinessReport.json`, `src/data/ectdGranularityMap.json`
**Store:** `regulatorySubmissionStore`

---

## What to Build

Stage 3 — finalise Modules 1, 3, 4, and 5. Four tabs: Module 1 (Regional) / Module 3 (CMC) / Module 4 (Nonclinical) / Module 5 (Clinical — Read-Only). Default tab: Module 3. Gate: CMC Lead + Nonclinical Lead sign-off required before Stage 4.

---

## Screen Anatomy

**Header:** "Modules 1 & 3–5 Finalisation · Stage 3 of 6", stage dot 3 (crimson), "Submit to Super Review →" gated button.

**Module 3 (CMC) tab — default:**

CMC Readiness ring from `cmcReadinessReport.json`:
- 84% crimson arc, centred "84%"
- "CMC Lead sign-off required for all sections before proceeding"
- Acknowledged risk note: "Stability data batches 3 and 4 pending · Risk acknowledged by Dr R. Patel · 12 Oct 2026 · Logged to audit trail"

Section list (from `cmcReadinessReport.json`.sections):
| Section | Status | Action |
|---------|--------|--------|
| 3.2.S | ✓ Signed off — Dr R. Patel · 14 Oct | Locked |
| 3.2.P | ✓ Signed off — Dr R. Patel · 14 Oct | Locked |
| 3.2.A | ⚠ Stability gap — batches 3&4 pending | "Sign off with risk note" |
| 3.3 | ✓ Signed off | Locked |
| 3.4 | ○ Not started | "Start" |

ICH Q-series validation row: "3.2.S: Q11 ✓ · Q8 ✓ · 3.2.P: Q8 ✓ · Q9 ✓ · Q10 ✓"
Cross-reference: "Module 2.3 → Module 3: 12 cross-refs verified ✓ · 0 broken."

**Module 1 (Regional) tab:**
Cover letters: "FDA — System-generated ✓" and "EMA — System-generated ✓". Regional forms: "Form FDA 1571 — Auto-populated from project record." "Form FDA 1572 — Requires investigator e-signature." Country-specific label differences: 3 amber chips (§4.1, §4.4, §4.8).

**Module 4 (Nonclinical) tab:**
ICH S-series: "22 nonclinical study reports · ICH S1 ✓ · S4 ✓ · S6 ✓ · S7A ✓ · S8 ✓". Cross-refs verified. Sign-off row: "Nonclinical Lead: Dr A. Bhatt ○ Pending" — "Sign off Module 4" button (role-gated, Nonclinical Lead only).

**Module 5 tab — MANDATORY READ-ONLY ENFORCEMENT (DD-D-001):**
Full-width steel blue `#005F8E` info banner (use `CTDReadOnlyBanner` component):
> "Module 5 — Imported from Module A · Read-only in Module D. Any edits to clinical study reports must be made in Module A."

Imported documents list:
- "VELORA-301 Phase III CSR v1.0 · Signed 28 Oct 2026 · Module A · 'View in Module A →'" (external link chip)
- "Module 5 TOC: auto-generated from imported CSRs ✓"
Cross-reference status: "Module 2.5 → Module 5: 18 refs verified ✓ · 2 flagged ⚠ (resolve in sD04)"

**Sign-off summary strip (bottom):**
Four mini cards: Module 1 ("Pending — complete regional forms") / Module 3 ("⚠ Partial — stability gap acknowledged") / Module 4 ("Pending — Nonclinical Lead sign-off") / Module 5 ("✓ Imported from Module A")

Gate: "Submit to Super Review →" active only when Module 3 has risk note + Module 4 signed + Module 1 forms complete + Module 5 shows imported.

---

## Data Wiring

```typescript
const { data: cmcReport } = useQuery(['cmc', submissionId],
  () => regulatoryWritingApi.getCMCReadiness(submissionId))
// → cmcReadinessReport.json

const { nodes } = useEctdStore()
// Filter to Module 5 nodes (isReadOnly: true) for the Module 5 tab

// Sign-off gate
const gateItems = {
  module1: regionalFormsComplete,           // from local state
  module3: cmcReport?.acknowledgedBy != null, // risk note filed
  module4: nonclinicalLeadSigned,           // from local state
  module5: true,                            // always imported from Module A
}
const canSubmit = Object.values(gateItems).every(Boolean)
```

---

## Navigation

- "Submit to Super Review →" → advance stage → navigate to `submissions/${submissionId}/super-review` (sD06)
- "View in Module A →" on Module 5 tab → external link (opens in new tab, href = "#" for prototype)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`

**Pass 2:** `npm run build`

**Pass 3 — 5 smoke tests:**
1. Module 3 tab is the default. CMC readiness ring shows 84% crimson arc. The acknowledged risk note "Stability data batches 3 and 4 pending · Risk acknowledged by Dr R. Patel · 12 Oct 2026" is displayed.
2. Section 3.2.A shows amber ⚠ status. Sections 3.2.S, 3.2.P, 3.3 show ✓ Signed off status.
3. Module 5 tab shows the full-width `CTDReadOnlyBanner` steel blue info banner. No edit controls appear anywhere on the Module 5 tab.
4. The sign-off summary strip shows all four module status mini-cards at the bottom. Module 5 shows "✓ Imported from Module A" (green).
5. The "Submit to Super Review →" button gate is correctly evaluated from the sign-off strip state.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D05-cmc-nonclinical-finalisation.md and execute.
Build CMCNonclinicalFinalisation exactly as specified, run all 3 validation passes, and report results.
```
