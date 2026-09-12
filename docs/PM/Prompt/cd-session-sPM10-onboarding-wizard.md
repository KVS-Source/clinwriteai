# CD Session — sPM10 · Onboarding Wizard
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM10-onboarding-wizard.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/onboarding/:module`
**Phase:** Phase 1
**Accent colour:** Per-module colour
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM10** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Per-module colour** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM10 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM10 — Onboarding Wizard

**File:** `aurora-sPM10-onboarding-wizard.html`
**Route:** `/onboarding/:module` (`:module` = A, B, C, D, or E — shown for Module E as example)
**Current user:** Ms Priya Nair · Ideation Lead (first login)

**Layout:** Full-screen overlay (no AppShell sidebar, top nav only with progress dots). White background. Centred card 640px wide.

**Progress indicator:** 6 dots at top. Step 2 active (highlighted teal for Module E).

**Step 1 — Welcome (shown completed / dimmed as context):**
Module E colour banner (teal `#0D9488` strip across top of card).
"Welcome to Ideation & Publishing"
"This module takes approved artefacts from Medical Writing, tags key claims as content cards, and routes them through KOL and Medical Affairs approval into the publishing calendar."
4-dot stage strip: Uploaded → Under Review → Reviewed → Approved (all greyed/inactive for Step 1)

**Step 2 — Your Role (ACTIVE):**
"Your Role in This Module"
Role badge: "Ideation Lead" (teal chip)
RACI assignments table:
| Task | Your assignment |
|------|----------------|
| Artefact upload & source check | **R** Responsible |
| Content card tagging | **R** Responsible |
| Claim currency review | **R** Responsible |
| Pre-review compliance | **R** Responsible |
| KOL invitation | **R** Responsible |
| Content calendar scheduling | **C** Consulted |
| Publishing approval | **C** Consulted |
"R = you do this · A = you are accountable · C = you are consulted · I = you are informed"

**Step navigation (bottom):**
"← Back" (grey) · Step 2 of 6 · "Next →" (teal primary)
"Skip wizard" link (small, grey, bottom right)

**Template variables (CC wires these):**
`{{ activeModule }}` — current module (A/B/C/D/E) — drives colour, role name, stage count
`{{ activeStep }}` — current step number (1–6)
`{{ userRole }}` — logged-in user's role in this module
`{{ raciAssignments }}` — RACI rows for Step 2
`{{ moduleName }}` — full module name for Step 1 header

**Step 6 — Done (show as preview / next step indicator):**
"You're ready to start · Go to Ideation & Publishing Home →" (teal primary button)

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM10-onboarding-wizard.md and execute.
Build Onboarding Wizard exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM10-onboarding-wizard.html.
Run all 3 validation passes and report results before awaiting the next session.
```
