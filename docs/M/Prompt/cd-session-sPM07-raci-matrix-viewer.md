# CD Session — sPM07 · RACI Matrix Viewer
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM07-raci-matrix-viewer.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/admin/raci`
**Phase:** Phase 1
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM07** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM07 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM07 — RACI Matrix Viewer

**File:** `aurora-sPM07-raci-matrix.html`
**Route:** `/admin/raci` (Admin view shown)
**Current user:** Dr James Hartley · Admin

**Layout:** Two-column. Left: project/module selector (~240px). Right: RACI matrix table.

**Left panel:**
Header: "RACI Matrix"
Project selector (dropdown): "VELORA-301 Efficacy Suite" (selected)
Module tab strip: A · B · C · D · E
Currently selected: D (Regulatory Writing)

**Right panel — Module D RACI (default view):**

Header: "Module D — Regulatory Writing · VELORA-301 Efficacy Suite"
Sub-label: "Default RACI template applied. Adjustments are project-specific and do not affect other projects."
"Edit assignments →" button (navy outline)

RACI table:
- Columns: Task · Reg. Affairs Lead · Reg. Writer · Clinical Lead · CMC Lead · QC Checker · E-Signatory
- Rows (hard-coded for Module D):

| Task | Reg. Affairs Lead | Reg. Writer | Clinical Lead | CMC Lead | QC Checker | E-Signatory |
|------|:-----------------:|:-----------:|:-------------:|:--------:|:----------:|:-----------:|
| Submission setup (Stage 1) | A | R | C | C | I | I |
| CTD Module 2 authoring (Stage 2) | A | R | C | I | I | I |
| CMC/Nonclinical (Stage 3) | A | C | I | R | I | I |
| Super Review (Stage 4) | A | R | R | R | R | R |
| eCTD Publishing (Stage 5) | A | R | I | I | C | I |
| Gateway Submission (Stage 6) | A | R | I | I | I | R |
| HA Response Drafting | A | R | C | C | I | I |
| Regulatory Intelligence | A | R | C | I | I | I |

RACI legend (bottom): R = Responsible · A = Accountable · C = Consulted · I = Informed
Colour coding: R = navy chip · A = amber chip · C = grey chip · I = light grey text

**"My RACI" toggle (top right):**

**Template variables (CC wires these):**
`{{ raciRows }}` — RACI table rows · `{{ r.task }}` / `{{ r.assignments }}` — per-row data
`{{ myRaciActive }}` — boolean controlling My RACI vs full matrix view
`{{ selectedProject }}` / `{{ selectedModule }}` — project and module filter state
When toggled: shows only rows where the current user has an assignment. Label changes to "Show full matrix →"

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM07-raci-matrix-viewer.md and execute.
Build RACI Matrix Viewer exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM07-raci-matrix-viewer.html.
Run all 3 validation passes and report results before awaiting the next session.
```
