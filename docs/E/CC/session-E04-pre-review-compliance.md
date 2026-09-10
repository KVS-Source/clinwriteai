# Session E04 — Pre-Review Compliance Screen
**Screen:** sE04 · Pre-Review Compliance Screen
**Route:** `/projects/:projectId/ideation-publishing/projects/:ideationProjectId/compliance`
**Component:** `src/modules/ideation-publishing/screens/PreReviewComplianceScreen.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/E/design/aurora-sE04-pre-review-compliance.html`
**Data:** `src/data/ideationContentCards.json`, `src/data/atomisedContent.json`
**Store:** `atomisationStore`

---

## What to Build

Stage 2 (pre-KOL) — compliance screening of atomised content before it reaches the KOL. Shows Must Fix issues (block KOL submission) and Advisory issues (informational only). Demo: c-001 LinkedIn adaptation had one Must Fix (already resolved — compliance fix applied), resulting in Must Fix: 0, Advisory: 1. Gate is open.

---

## Screen Anatomy

Two-column. Left: card list with compliance status (~340px). Right: active card compliance detail.

**Left — Card compliance list:**
Three cards from `ideationContentCards.json`.

- c-001 "Primary PFS Efficacy Result" · `✓ 0 Must Fix · 1 Advisory` · green status pill
- c-002 "Safety Profile" · `✓ 0 Must Fix · 0 Advisory` · green
- c-003 "Subgroup Consistency" · `✓ 0 Must Fix · 0 Advisory` · green · amber `ClaimCurrencyBadge` (potentially-superseded) still visible

**Compliance structure (from sE04 design — differs from original brief):**
- **1 Must Fix** issue exists on c-001 LinkedIn BUT it has been **Resolved** — the gate opens when resolved Must Fix count = 0, not when no Must Fix was ever raised.
- Must Fix: **IFPMA Code §5.2** violation — phrase "reinforces the clinical benefit" is promotional comparative framing without cited source. Suggested fix: replace with "demonstrated a hazard ratio of 0.61 (95% CI 0.48–0.77; p<0.001)". Resolution note: "Resolved · Ms Priya Nair, Ideation Lead · 09 Nov 2026 10:31 UTC".
- **2 Advisory** items (not 1): fair-balance recommendation on c-001 LinkedIn + one other. Both acknowledged.
- **"Submit to KOL Review →"** button: **active** (green/teal) — resolved Must Fix count = 0.

**Right — c-001 detail:**

**LinkedIn channel (ac-001):**
Compliance fix chip (amber, resolved): "1 fix applied · 'transformative' removed"
Advisory section (teal info, does not block):
- "Abbreviation 'HR' unexpanded on first use. Expand to 'hazard ratio (HR)' for general audience clarity."
- "Advisory findings cannot block a gate."

**Blog, HCP, Email channels:** Clean — no issues.

`ProvenanceChip` visible on c-001 without interaction:
`"Source: KOL Summary §3.2 → CSR v1.0 · Table 14.2.1 → Module A · Clinical Writing"`

---

## Data Wiring

```typescript
const { adaptations } = useAtomisationStore()
const { cards } = useIdeationStore()

// Compliance results from atomisedContent.json
// ac-001: complianceFixes has 1 fix applied, complianceScreenPassed = true
// All cards: complianceScreenPassed = true

// Gate: block KOL if any must-fix unresolved
const mustFixTotal = cards.reduce((n, card) => {
  const cardAdaptations = Object.values(adaptations)
    .filter(a => a?.ideationContentCardId === card.id)
  const unresolvedMustFix = cardAdaptations.some(
    a => a && !a.complianceScreenPassed
  )
  return n + (unresolvedMustFix ? 1 : 0)
}, 0)
// mustFixTotal = 0 → "Submit to KOL Review →" active
```

---

## Navigation

- "Submit to KOL Review →" → triggers KOL invite API (AC-E-011: this triggers the invite, not a regulatory e-signature) → navigate to `ma-approval` (sE06) for tracking — KOL reviews async at their own link

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. c-001 LinkedIn shows the Must Fix issue in **Resolved** state: "Resolved · Ms Priya Nair, Ideation Lead · 09 Nov 2026 10:31 UTC." The `mustFixCount` chip shows "0 Must fix blocks KOL submission." Gate is open. "Submit to KOL Review →" is active.
2. c-001 LinkedIn shows the resolved compliance fix chip: "'transformative' removed per MLR guidance §4.2".
3. The Advisory note on c-001 LinkedIn is shown in a teal/informational style (not amber). The text "Advisory findings cannot block a gate." is visible.
4. `ProvenanceChip` is visible on c-001 without any interaction.
5. c-003 still shows the amber `ClaimCurrencyBadge` (potentially-superseded) alongside its green compliance status.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/E/CC/session-E04-pre-review-compliance.md and execute.
Build PreReviewComplianceScreen exactly as specified, run all 3 validation passes, and report results.
```
