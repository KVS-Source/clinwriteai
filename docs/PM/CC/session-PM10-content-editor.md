# Session PM07 — Content Editor (HCP Slide Deck) ⚠ UPDATE
**Screen:** sC04 · Content Editor — HCP Slide Deck
**Route:** `/projects/:projectId/medical-writing/content/:contentId/editor`
**Component:** `src/modules/medical-writing/screens/ContentEditor.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sC04-content-editor.html`
**Data:** `medContent.json`, `medClaims.json`, `medPreMLR.json`, `medMLRReviewers.json`
**Store:** `medicalWritingStore` (existing)
**Module colour:** Violet `#7C3AED`
**Access:** Medical Writer and above (Module C)

⚠ **This is an UPDATE to an existing build from a previous CC session. Do not rebuild from scratch. Apply the changes below to the existing ContentEditor component. This update adds the HCP Slide Deck content type with its slide navigator, slide canvas, properties panel, and all slide-specific features. Report which changes were applied vs what was already in place.**

---

## What Changed Since Previous Build

The design file shows the Content Editor in HCP Slide Deck mode — a content type that shares the base ContentEditor shell but adds slide-specific panels. Apply the following additions and updates:

1. **AI model string:** Update all attribution to `claude-sonnet-4-6` (not `claude-sonnet-4-5`).
2. **Slide navigator panel (left):** Vertical thumbnail strip, 26 slides, issue indicators per slide.
3. **Slide canvas (centre):** 16:9 slide with edit lock display, collaborative presence.
4. **Properties panel tabs:** Content · Patient Advocate · AI Auto-Suggest · Claims · FK Readability · Accessibility
5. **MLR footprint format:** `"${pct}% AI · ${100-pct}% Human"` — not a single percentage.
6. **WCAG 2.2 AA** in this screen (Module C platform interface standard — different from Module E sE10 which uses WCAG 2.1 AA).
7. **Accessibility tab at Stage 3 is advisory-only** — full gate activates at Stage 5 (sC07 Formatting & Accessibility).

---

## Screen Anatomy

Read the HTML file. Implement changes exactly as shown.

**Top nav strip:**
- "VELORA-301 · Medical Writing · Veloricept HCP Slide Deck · Stage 3 · Authoring"
- "v0.3 · Messaging framework: VELORA-301 v1.0 ✓ · Tier 2 Review"
- MLR footprint: "28% AI · 72% Human" (derive as `${pct}% AI · ${100-pct}% Human`)
- "+ New slide with AI" · "▶ Present" · `{{ exportBtnLabel }}` · "Submit for Pre-MLR →"
- **Export gate note (amber):** "⚠ Pre-MLR check has 1 must-fix · Slide 5 carries an unsubstantiated claim. Resolve the must-fix finding before exporting for MLR circulation."
- **Alt text gate note (amber):** "⚠ Alt text missing on Fig 1.1 · WCAG 2.2 AA requires alt text on every figure."
- "Export is disabled until the must-fix finding and the missing alt text are resolved."
- `{{ present }}` / `{{ submit }}` = state of Present and Submit buttons

**Left panel — slide navigator:**
- "Slide deck · 26 slides"
- `{{ sl.n }}` · `{{ sl.title }}` · `{{ sl.issue }}` / `{{ sl.issueCount }}` · `{{ sl.peer }}` · `{{ sl.mark }}`
- "Pre-MLR check · Last run: 09:10 UTC · 1 must-fix · 2 should-fix" · [Re-run] `{{ rerun }}`
- Collaborators: `{{ c.initials }}` / `{{ c.name }}` / `{{ c.state }}` — "In this deck now"
- "One editor per slide. Locks release after 5 minutes idle."

**Centre — Slide 4 canvas:**
- "Slide 4 of 26 · Study design · You hold the edit lock · released after 5 min idle"
- "VELORA-301 Phase III Study Design · Randomised, Double-Blind, Placebo-Controlled"
- Figure placeholder: "Study schema diagram (TLF Fig 1.1 · Module A) · Replace figure · alt text missing"
- "Dr Arjun Patel is editing this block"
- Body text with grounded attribution: "Grounded in SmPC v2.1 §4.2 and CSR v1.0 §6.1.1 · Module A"
- Claims matrix chip: "Claims matrix: approved ✓ · Source: CSR v1.0 Table 14.2.1"

**Right panel — Properties (tabbed):**

*Content tab:*
- Selected element dropdown + `{{ pt.icon }}` / `{{ pt.label }}` tools
- Slide title (editable) · Body text (editable) · `{{ refineToggleLabel }}`
- AI refine: "Refinement applies to this text block only. It cannot introduce values not in grounded sources."
- `{{ p.label }}` prompts · "Refine text ✦" · Proposed text: `{{ proposalText }}` · Prompt: `{{ appliedPrompt }}`
- "claude-sonnet-4-6 · grounded in SmPC v2.1 + CSR v1.0"
- Accept · Discard
- `{{ suggestResolved }}` / `{{ suggestResolvedMsg }}`
- Figure · "Alt text — mandatory · Missing alt text blocks export and is reported by the WCAG 2.2 AA check."

*Patient Advocate tab (`{{ paoOn }}` toggle):*
- `{{ annotations }}` loop: `{{ an.n }}` · On "`{{ an.anchor }}`" · `{{ an.text }}` · `{{ an.author }}`
- "Patient Advocate annotations · advisory only"

*AI Auto-Suggest tab:*
- "Suggested addition · Slide 4 methods"
- Suggested text with SmPC v2.1 §5.1 + CSR v1.0 §9.2 citation
- "claude-sonnet-4-6 · Accepting logs to audit trail"
- `{{ accept }}` · Discard · `{{ suggestResolvedMsg }}` · "Suggest again ✦"
- `{{ aiFootprint }}` percentage

*Claims tab:*
- "3 tracked · 2 approved · 1 pending"
- `{{ claims }}` loop: `{{ cl.text }}` / `{{ cl.source }}` / `{{ cl.status }}`
- "Open full claims matrix →"

*FK Readability tab:*
- "Live scoring · Updated paragraph by paragraph"
- Grade 7.2 · Gate ≤8 · "Passes gate ✓"
- `{{ f.label }}` / `{{ f.score }}` section breakdown
- "1 section above FK 8 — advisory only (below FK 10 gate)."
- "Shown for the linked patient version. The active HCP slide deck is not FK-gated."

*Accessibility tab:*
- "WCAG 2.2 AA · slide-level checks"
- `{{ a.mark }}` / `{{ a.label }}` / `{{ a.detail }}` per check
- "Full remediation runs in Stage 5 — Formatting & Accessibility."

---

## Data Wiring

```typescript
// medContent.json — item of type 'hcp-slide-deck'
// medClaims.json — 3 claims on Slide 4: 2 approved, 1 pending
// medPreMLR.json — 1 must-fix (Slide 5 unsubstantiated claim) + 2 should-fix

// MLR footprint — render as split string
const aiPct = medContent.aiFootprintPct  // e.g. 28
const footprintLabel = `${aiPct}% AI · ${100-aiPct}% Human`

// Export gates — both must clear before export enabled
const canExport = mustFixCount === 0 && altTextComplete

// AI model string throughout: 'claude-sonnet-4-6'
```

---

## Implementation Notes (from design review)

- MLR footprint renders as **`"28% AI · 72% Human"`** — the `{{ aiFootprint }}` variable is the numeric value (28); derive display string in component
- **WCAG 2.2 AA** in sC04 is correct for Module C (platform interface standard). This is different from Module E sE10 which uses WCAG 2.1 AA for content output
- Accessibility tab at Stage 3 is **advisory-only** — the tab shows checks but export is NOT gated on WCAG at this stage. Full gate activates at Stage 5 (sC07)
- `{{ suggestResolved }}` / `{{ suggestResolvedMsg }}` = AI Auto-Suggest panel post-accept state — after accepting a suggestion, the panel shows a resolved state with "Suggest again ✦"
- `{{ rerun }}` = [Re-run] link that fires the pre-MLR check again — MSW returns same result for prototype
- `{{ paoOn }}` = boolean toggle for Patient Advocate annotations layer visibility

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Top nav shows "28% AI · 72% Human" MLR footprint (not a single %). Two gate notes are visible: must-fix and alt text. Export button is inactive. (AC-D-038 — compliance gate before export)
2. Properties panel has all 5 tabs: Content · Patient Advocate · AI Auto-Suggest · Claims · FK Readability · Accessibility. (AC-E-037 supplement — WCAG 2.2 AA platform interface standard)
3. AI Auto-Suggest shows "claude-sonnet-4-6" model attribution. Accept button logs to audit trail (MSW records action). `suggestResolvedMsg` shows after accepting.
4. FK Readability tab shows Grade 7.2 · "Passes gate ✓" · "Shown for the linked patient version. The active HCP slide deck is not FK-gated."
5. Accessibility tab shows "WCAG 2.2 AA · slide-level checks" and "Full remediation runs in Stage 5 — Formatting & Accessibility." (Not a hard gate at Stage 3.) (AC-PM-022 pattern — advisory at interim stages, full gate at final stage)

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM10-content-editor.md and execute.
This is an UPDATE to the existing ContentEditor component from a previous session.
Apply all specified changes to the existing build. Do not rebuild from scratch.
Use the HTML design at C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sC04-content-editor.html.
Report which changes were applied vs what was already in place.
Run all 3 validation passes and report results.
This is the final PM session. Confirm all 18 PM sessions are complete and the platform build is ready for integration testing.
```
