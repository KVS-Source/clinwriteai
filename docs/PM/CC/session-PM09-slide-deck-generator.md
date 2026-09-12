# Session PM05 — Slide Deck Generator ⚠ UPDATE
**Screen:** sB10 · Slide Deck Generator
**Route:** `/projects/:projectId/scientific-writing/publications/:publicationId/slides`
**Component:** `src/modules/scientific-writing/screens/SlidedeckGenerator.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sB10-slide-deck-generator.html`
**Data:** `slidedeckJob.json`
**Store:** `scientificWritingStore` (existing)
**Module colour:** Violet `#7B3C9A`
**Access:** Author and above (Module B) · Reviewer (read-only)

⚠ **This is an UPDATE to an existing build from a previous CC session. Do not rebuild from scratch. Apply the changes below to the existing SlidedeckGenerator component. Report which changes were applied vs what was already in place.**

---

## What Changed Since Previous Build

The design has been confirmed from the uploaded HTML file. The following items must be checked and updated if not already implemented:

1. **AI model string:** Must be `claude-sonnet-4-6` (not `claude-sonnet-4-5`). Update all attribution labels and MSW handler model strings.
2. **Collaborative editing strip:** 3 users — Dr Elena Vasquez (you) · Dr Rebecca Morton (viewing) · Mr David Chen (editing slide 06). `user-dc` is now in `users.json`.
3. **Congress gate wording:** "⚠ 18 of 15 slides — over congress limit" — verify exact wording matches design.
4. **Accessibility gate:** Figure 3 on slide 6 missing alt text — `slidedeckJob.json` `accessibilityGate.missingAltText[0]` = `{ slideId: 'slide-006', figureId: 'fig-003' }`. Alt text inline field appears specifically for this figure.
5. **Regenerate rule:** "Regenerating replaces every slide that has not been accepted. Accepted slides are kept." — verify this rule is enforced in the store.

---

## Screen Anatomy

Read the HTML file. Implement changes exactly as shown.

**Left panel:**
- Source: "VELORA-301 Phase III CSR v1.0 — Manuscript" + ESMO 2026 congress target
- "⚠ 18 of 15 slides — over congress limit"
- AI footprint: "62% ✦ · claude-sonnet-4-6 · generated 09 Sept 2026 14:30 UTC"
- "+ Create slide deck with AI" · "Regenerate ✦" · "▶ Present"
- Generate from: `{{ sources }}` radio — Full manuscript / Abstract / Selected sections
- Congress target: ESMO 2026 · 15 slides max · 16:9

**Centre panel:**
- `{{ thumbs }}` thumbnail strip — 18 slides total (8 visible + "+ 10 more slides")
- Collaborative editing: "Dr Elena Vasquez (you) · Dr Rebecca Morton viewing · Mr David Chen editing slide 06"
- Title slide canvas: VELORA-301 PFS results — ESMO 2026
- Active slide: "Slide `{{ activeNum }}` of 18 · 16:9" · `{{ lockLabel }}`

**Right panel — tabbed (Content / Notes / Figures):**
- Content tab: Slide title · Body text with underlined traced values · "Insert figure from CSR →"
- AI refine: `{{ refineToggleLabel }}` · proposal text · `{{ appliedPrompt }}` · Accept / Discard
- Notes tab: Speaker notes textarea
- Figures tab: Figure 1 ✓ · Figure 2 ✓ · Figure 3 ⚠ Missing

**Export panel:**
- Format: .pptx / PDF · Template: GenBioCa Corporate v2.1
- `{{ altGate }}`: "⚠ Accessibility check failed · Figure 3 on slide 6 is missing alt text."
- Alt text field for fig-003 (inline, mandatory)
- `{{ resolveAlt }}` = "Save alt text" button
- "⚠ Slide limit exceeded · 18 slides against 15-slide limit."
- Export .pptx → · Export PDF → (both inactive until both gates clear)
- `{{ exportNote }}` = note about gate status

---

## Data Wiring Updates

```typescript
// MSW: GET /api/publications/:id/slides/:jobId → slidedeckJob.json
// Update slidedeckJob.json aiModel: "claude-sonnet-4-6"

// sources = ['Full manuscript','Abstract','Selected sections']
// thumbs = slidedeckJob.slides array (18 items from fixture)

// altGate = slidedeckJob.accessibilityGate.active  (true)
// resolveAlt — triggered by saving alt text for fig-003
// Once alt text saved: accessibilityGate.active → false, export unblocked (if slide count also resolved)

// Collaborative editing — wire from presence store
// user-dc (Mr David Chen) now exists in users.json
```

---

## Implementation Notes (from design review)

- `{{ altGate }}` / `{{ resolveAlt }}` wire from `slidedeckJob.json` `accessibilityGate` — gate is active, fig-003 on slide 6 missing alt text
- `{{ sources }}` = source selector radio: Full manuscript / Abstract / Selected sections
- `{{ thumbs }}` = thumbnail strip — wire from `slidedeckJob.json` `slides` array (18 total)
- `{{ setPrompt }}` / `{{ appliedPrompt }}` / `{{ accept }}` = AI refine panel state
- Collaborative editing strip: Dr Elena Vasquez (you) · Dr Rebecca Morton (viewing) · Mr David Chen (editing slide 06) — `user-dc` is now in `users.json`
- "Regenerating replaces every slide not yet accepted. Accepted slides are kept." — enforce in store: `acceptedSlideIds` set; regenerate skips those IDs

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Congress gate shows "⚠ 18 of 15 slides — over congress limit" and both export buttons are inactive. (AC-B-010)
2. Figures tab shows Figure 3 with "⚠ Missing" alt text. Inline alt text field renders for fig-003 only. Entering and saving alt text clears the gate. (AC-B-011)
3. Export .pptx button becomes active only after BOTH gates are cleared (alt text + slide count within limit). (AC-B-010, AC-B-011)
4. Collaborative editing strip shows all 3 users: Dr Elena Vasquez (you) · Dr Rebecca Morton viewing · Mr David Chen editing slide 06. (AC-B-012)
5. AI attribution shows "claude-sonnet-4-6" (not claude-sonnet-4-5).

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM17-slide-deck-generator.md and execute.
This is an UPDATE to the existing SlidedeckGenerator component from a previous session.
Apply all specified changes to the existing build. Do not rebuild from scratch.
Use the HTML design at C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sB10-slide-deck-generator.html.
Report which changes were applied vs what was already in place.
Run all 3 validation passes and report results before awaiting Session PM10.
```
