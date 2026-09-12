# CD Session — sPM17 · TA Tag Configuration
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM17-ta-tag-configuration.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/admin/taxonomy`
**Phase:** Phase 0
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM17** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM17 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM17 — TA Tag Configuration

**File:** `aurora-sPM17-ta-tag-configuration.html`
**Route:** `/admin/taxonomy`
**Current user:** Dr James Hartley · Admin

**Layout:** Full-width. Header + table + add tag panel.

**Header:** "Therapeutic Area Tags · 12 active"
Sub-label: "TA tags are mandatory on every project, document, and content artefact. Tags are available across all modules immediately after creation."
"+ Add tag" button (navy primary)

**Tag table (5 columns: Tag name · Abbreviation · Status · In use · Actions):**
| Tag name | Abbrev | Status | In use | Actions |
|----------|--------|--------|--------|---------|
| Oncology | ONC | `✓ Active` | 14 projects, 247 documents | Archive |
| Cardiometabolic | CARD | `✓ Active` | 4 projects, 38 documents | Archive |
| Neurology | NEURO | `✓ Active` | 2 projects, 11 documents | Archive |
| Rare Disease | RARE | `✓ Active` | 1 project, 6 documents | Archive |
| Immunology | IMMUNO | `✓ Active` | 0 projects | Archive · Delete |
| Dermatology | DERM | `⚠ Archived` (grey) | 2 projects (archived) | Restore |
| Respiratory | RESP | `⚠ Archived` (grey) | 1 project (archived) | Restore |

Archive note (inline on rows with >0 documents): "Cannot delete — tag is in use by 14 projects. Archive instead."
Delete only available when "In use" = 0 projects.

**Add tag panel (right drawer):**
Tag name: text input
Abbreviation: text input (max 6 chars) · "Auto-suggest" link
Validation rule (live): "Must match [TAG NAME] — letters only, max 30 chars"
"Save" button · "Cancel"

**Template variables (CC wires these):**
`{{ tags }}` — tag table rows beyond the 7 hard-coded ones · `{{ t.name }}` / `{{ t.abbrev }}` / `{{ t.status }}` / `{{ t.inUse }}` — per-tag data
`{{ tagCount }}` — "12 active" count · `{{ newTagName }}` / `{{ newTagAbbrev }}` — add tag drawer state

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM17-ta-tag-configuration.md and execute.
Build TA Tag Configuration exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM17-ta-tag-configuration.html.
Run all 3 validation passes and report results before awaiting the next session.
```
