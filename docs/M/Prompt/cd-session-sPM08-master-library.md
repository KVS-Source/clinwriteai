# CD Session — sPM08 · Master Library
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM08-master-library.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/library`
**Phase:** Phase 4
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM08** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM08 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM08 — Master Library

**File:** `aurora-sPM08-master-library.html`
**Route:** `/library`
**Current user:** Dr Sarah Chen · Regulatory Writer

**Layout:** Three-column. Left: filter panel (~260px). Centre: results list (~340px). Right: item detail.

**Left — Filter panel:**
Search input (full-text, placeholder: "Search documents, sections, best practices…")
Filters:
- Module: All · A · B · C · D · E (checkbox)
- Item type: Document · Section · Best Practice (checkbox)
- Document type: NDA · CSR · SmPC · RMP · Publication… (multi-select)
- Therapeutic Area: Oncology · Cardiometabolic… (multi-select)
- Date range: From / To

Results count: "47 items"

**Centre — Results list:**
12 hard-coded item cards:
Card 1 (active): `CTD 2.5 Clinical Overview — Veloricept NDA v1.0` · Module D chip (crimson) · Oncology · NDA · Oct 2026 · "Pushed by Dr J. Hartley"
Card 2: `CTD 2.7 Clinical Summary — Veloricept NDA v1.0` · Module D · Oncology
Card 3: `VELORA-301 CSR v1.0` · Module A · Oncology · `🔒 Archived` (grey — closed project)
Card 4: `SmPC v1.0 — Veloricept` · Module D · Oncology · EU label
Card 5: `VELORA-301 KOL Session Summary` · Module C · Oncology
Card 6: `Primary PFS Efficacy Blog Post` · Module E · Oncology · Teal chip
Card 7: `RMP Core Document v1.0` · Module D
Card 8: `AURELIA-101 Phase I Brief` · Module B · Cardiometabolic
Cards 9-12: `{{ items }}` — templated (CC wires)

**Right — Item detail (CTD 2.5 Clinical Overview active):**
Title: "CTD 2.5 Clinical Overview — Veloricept NDA v1.0"
Module: D chip · Doc type: NDA · TA: Oncology · Version: v1.0
Pushed: "16 Oct 2026 by Dr James Hartley · Regulatory Affairs Lead"
Project: "VELORA-301 Efficacy Suite"
Tags: `NDA` · `FDA + EMA` · `Oct 2026` · `Regulatory Writing`

Provenance chain:
- "Source: Module A · VELORA-301 CSR v1.0 → Module D · Regulatory Writing Stage 6 → Master Library 16 Oct 2026"

"Pull into document →" button (navy primary)

**Template variables (CC wires these):**
`{{ items }}` — remaining library result cards (9–12) · `{{ i.name }}` / `{{ i.module }}` / `{{ i.docType }}` / `{{ i.ta }}` / `{{ i.pushed }}` — per-item data
`{{ resultCount }}` — "47 items" count · `{{ versionHistory }}` — version rows for active item
`{{ searchQuery }}` / `{{ activeFilters }}` — filter state
"Download PDF" button (navy outline)
Version history: v1.0 (current) · "No previous versions"

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM08-master-library.md and execute.
Build Master Library exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM08-master-library.html.
Run all 3 validation passes and report results before awaiting the next session.
```
