# CD Prompt — sE04 Pre-Review Compliance Screen
**Module:** E — Ideation & Publishing · Steel Blue `#005F8E`
**PRD refs:** FR-E-008, FR-E-009
**Screen code:** sE04
**Output file:** `aurora-sE04-pre-review-compliance-screen.html`

---

## Screen Purpose

Stage 2 (Under Review) — automated compliance screening of all atomised content cards before they proceed to KOL review. The Module E equivalent of Module C's pre-MLR check — adapted for communications content (brand, claim currency, fair-balance) rather than regulated promotional materials.

---

## Layout

Two-column layout. Left: content card list with screening status (~360px). Right: issue detail for selected card.

**Header:** "Pre-Review Compliance Screen · Stage 2" breadcrumb, "3 cards · 2 passed · 1 has issues" status chip (amber), "Submit to KOL Review →" primary button (gated — active only when all Must Fix resolved).

---

## Left Panel — Content Card Screening Results

**Screening summary strip:**
"Automated screening complete · 30 seconds · 3 cards checked"
- Must Fix: 1 (blocks KOL submission)
- Advisory: 2 (shown but do not block)
- Passed: 2 cards fully clean

**Card list:**

**Card C-001 — Efficacy Claim:**
- Status: "⚠ 1 Must Fix · 1 Advisory"
- Left border: `#005F8E` (module blocking colour — not red)
- "View issues →" → loads right panel

**Card C-002 — Safety Profile:**
- Status: "✓ Passed — 0 issues"
- Green chip

**Card C-003 — Subgroup Insight:**
- Status: "✓ 1 Advisory (acknowledged)"
- Green with small amber note

---

## Right Panel — Issue Detail (Card C-001 active)

**Card preview (top):** First 80 chars of the LinkedIn adaptation.

**Must Fix issue (steel blue border, blocking):**
- Label: "Must Fix — Comparative Efficacy Claim"
- Channel: "LinkedIn adaptation"
- Issue: "Phrase 'reinforces the clinical benefit' is a promotional comparative framing without a cited source. IFPMA Code §5.2 requires substantiation for comparative language in medical communications content."
- Suggested fix: "Replace 'reinforces the clinical benefit' with the specific cited outcome: 'demonstrated a hazard ratio of 0.61 (95% CI 0.48–0.77; p<0.001)' with source citation."
- "Apply suggested fix" → opens inline edit of the LinkedIn adaptation
- "Mark as resolved manually ✓" button

**Advisory issue (amber left border, non-blocking):**
- Label: "Advisory — Fair-Balance Recommendation"
- Channel: "LinkedIn adaptation"
- Issue: "The efficacy claim is presented without a safety qualifier. Best practice for HCP-facing content is to include a brief safety context. Not required for this channel — advisory only."
- "Acknowledge" button

**Provenance panel (below issues):**
"Claim provenance: Source: KOL Session Summary §3.2 → CSR v1.0 Table 14.2.1 → Module A"
"Approval status at card creation: MLR Approved · 20 Oct 2026"
"This provenance record is displayed to the KOL reviewer at Stage 3."

**Proceed gate (below right panel):**
"Card C-001: 1 Must Fix unresolved. Submit to KOL Review blocked until resolved."

---

## Design Notes

- The compliance screen is Module E's lightest review gate — lighter than Module C's pre-MLR (which has Must Fix / Should Fix / Note and blocks full MLR submission). Here: Must Fix blocks KOL submission; Advisory does not.
- The blocking colour for Must Fix is steel blue `#005F8E` (module accent) — consistent with the platform no-red rule. It looks different from a green pass but is not alarming — these are communications content issues, not clinical data errors.
- "Apply suggested fix" opens an inline edit of the specific atomised content — the only place in Module E where content can be edited directly (the source document is always read-only; only atomised channel adaptations are editable).
- The provenance panel at the bottom of the right panel is always visible — KOL reviewers will see exactly this provenance when they review, so showing it here prepares the Ideation Lead.
