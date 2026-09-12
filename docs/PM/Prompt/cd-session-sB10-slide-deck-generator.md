# CD Session — sB10 · Slide Deck Generator
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sB10-slide-deck-generator.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/projects/:id/scientific-writing/publications/:pubId/slides`
**Phase:** Phase 2
**Accent colour:** Violet #7B3C9A
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sB10** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Violet #7B3C9A** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sB10 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sB10 — Slide Deck Generator

**File:** `aurora-sB10-slide-deck-generator.html`
**Route:** `/projects/:id/scientific-writing/publications/:pubId/slides`
**Module colour:** Violet `#7B3C9A`
**Current user:** Dr Elena Vasquez · Clinical Lead

**Layout:** Three-column. Left: source + settings (~280px). Centre: slide thumbnail strip + canvas. Right: slide editor + notes panel.

**Left panel:**

Header: "Slide Deck Generator" (violet accent)
Source document: "VELORA-301 Phase III CSR v1.0 — Manuscript" (linked chip)
Source selector (radio): Full manuscript (selected) · Abstract · Selected sections

Congress target (optional):
Input: "ESMO 2026" (filled)
Format requirements: "15 slides max · 16:9 · Required: disclosure slide"
Formatting gate active: "⚠ Slide limit: 15 · Currently: 18 slides — please remove or merge slides before export."

AI attribution:
"claude-sonnet-4-5 · generated 09 Sept 2026 14:30 UTC · grounded in VELORA-301 CSR v1.0"
AI footprint: `62% ✦`

"Regenerate ✦" button (violet primary)

**Centre panel:**

Slide thumbnail strip (vertical, 8 visible):
1. Title slide (active, violet left border highlight)
2. Key Message 1 — Primary PFS result
3. Methods Overview
4. Results — PFS Analysis
5. Results — Subgroup Consistency
6. Safety Summary
7. Conclusions
8. References

+ 10 more slides (collapsed — `{{ totalSlides }}` = 18)

**Active slide canvas (Title Slide):**
Violet header band · "VELORA-301 Phase III: Veloricept + Pembrolizumab in First-Line Advanced NSCLC"
Sub-title: "Primary PFS Results — ESMO 2026"
Client logo placeholder (top right): "[CLIENT LOGO]"
Disclosure footer: "Data on file — GenBioCa Sciences. For registered HCP use only."

**Right panel:**

Tab strip: Content · Notes · Figures

**Content tab (active):**
Slide title input: "Primary Efficacy Results: VELORA-301"
Body text area (editable): "Veloricept + pembrolizumab demonstrated statistically significant improvement in PFS vs pembrolizumab alone (HR 0.61; 95% CI 0.48–0.77; p<0.001)."

Insert figure button: "Insert figure from CSR →" (violet outline)
Figure panel: 3 thumbnails from CSR (Kaplan-Meier curve · Subgroup forest plot · Safety profile bar chart)

**Notes tab:**
Speaker notes textarea: "Emphasise the strength of the primary endpoint. Note interaction p-values for subgroups are non-significant."

**Export panel (bottom of right panel):**
Format: `.pptx` (selected) / `PDF`
Template: "GenBioCa Corporate v2.1 · client-branded" (applied)
Accessibility gate: "⚠ Figure 3 on Slide 6 is missing alt text. Alt text required before export."
Alt text field for Figure 3 (shown inline because gate is triggered)
"Export .pptx" button (violet primary — inactive while accessibility gate fails) · `{{ exportStyle }}`
"Export PDF" button (violet outline — inactive while gate fails)

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sB10-slide-deck-generator.md and execute.
Build Slide Deck Generator exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sB10-slide-deck-generator.html.
Run all 3 validation passes and report results before awaiting the next session.
```
