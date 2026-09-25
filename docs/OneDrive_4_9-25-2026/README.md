# SME Sample Documents — Module B (Scientific Writing)

Source documents provided by SMEs on 25 Sep 2026 via OneDrive. Used to enrich the prototype's Module B fixtures with real reporting-guideline structures (CONSORT 2025 + STROBE v4), the ICMJE Author COI form, and manuscript/abstract/poster content patterns from real published exemplars.

## Files and how they map to the prototype

### Reporting checklists → `apps/web/src/data/reportingGuidelines.json` (new catalog fixture)

| SME document | Guideline ID |
|---|---|
| `CONSORT  2025 editable checklist.docx` | `CONSORT-2025` — full 40-item checklist (30 numbered items with sub-items a/b/c/d) organised by section (Title & Abstract / Open Science / Introduction / Methods / Results / Discussion) |
| `STROBE-checklist-v4-cohort.pdf` | `STROBE-v4-cohort` — 22 items, notes stratified items (8, 13, 14, 15) and divergent items (6a, 6b, 12d, 14c, 15) |
| `STROBE-checklist-v4-case-control.pdf` | `STROBE-v4-case-control` — 22 items, cases-vs-controls variant |
| `STROBE-checklist-v4-cross-sectional.pdf` | `STROBE-v4-cross-sectional` — 22 items, cross-sectional variant |
| `STROBE-checklist-v4-combined-PlosMedicine.pdf` | Reference-only (identical 22 items with merged divergences) |
| `STROBE-checklist-conference-abstract-DRAFT.pdf` | `STROBE-abstract` — 12 abstract-length items |

### ICMJE COI Form → `apps/web/src/data/reportingGuidelines.json` and applied to `publicationAuthors.json`

| SME document | Applied as |
|---|---|
| `coi_disclosure.docx` | `coiForm.id = "ICMJE-COI-2021"` in reportingGuidelines.json with the full 13-item disclosure list (item 1 no-limit, items 2–13 36-month timeframe). Worked example populated on `author-tb-mw` in publicationAuthors.json (`icmjeCoi` field with all 13 items) — Marcus Webb declares support for the manuscript (item 1) + meeting/travel support (item 7), all others "None". |

### Worked exemplars → `contentStructure` on `publications.json`

| SME document | Fixture |
|---|---|
| `Manuscript_Sample.pdf` (JCO 2021 IMpower133 update, DOI 10.1200/JCO.20.01055) | `pub-tb-001` — modified IMRAD structure with CONTEXT box front-matter, structured abstract, 4 top-level sections with real subsection headings, rich back-matter (Prior Presentation, Support, Trial Info, References, Author Disclosures, CRediT Contributions, Acknowledgment) |
| `Abstract_Sample.pdf` (NEJM 2018 IMpower133 primary, DOI 10.1056/NEJMoa1809064) | `pub-tb-002` — structured abstract with BACKGROUND / METHODS / RESULTS / CONCLUSIONS headings, 250-word limit, trailing funding + registration disclosure |
| `Poster presentation_Sample.pdf` (AACR 2018 IMpower133 primary abstract CT199) | `pub-tb-003` — 3×3 grid layout, 9 panels in reading order (top-banner → col1-row1 through col3-row2 → bottom-banner). Real ESCMID-style poster/abstract numbering added. |
| — | `pub-tb-004` (PLS) — cross-references the fuller PLS structure already applied to `mc-tb-005` in Module C |

## Where the structure lives in the codebase

- **`apps/web/src/data/reportingGuidelines.json`** (new) — catalog of 5 reporting checklists (CONSORT-2025 + 4 STROBE variants) with 40 verbatim CONSORT items + ICMJE COI form definition
- **`apps/web/src/data/publications.json`** — each SPINE-TB publication carries `reportingGuidelineId`, `structureSource`, and `contentStructure` fields
- **`apps/web/src/data/publicationAuthors.json`** — `author-tb-mw` carries a full `icmjeCoi` worked example + `creditTaxonomy` field

## Cross-cutting patterns baked in

- **CONSORT 2025 item convention**: string item numbers (`"1a"`, `"16b"`, `"21c"`) instead of pure integers, since the 2025 revision uses sub-items extensively
- **STROBE stratification**: `stratifiedItems: ["8","13","14","15"]` flag on the cohort variant marks items requiring exposed-vs-unexposed reporting; the case-control variant uses cases-vs-controls
- **ICMJE COI timeframes**: item 1 is `"no-limit"` (support related to the present manuscript); items 2–13 are `"36-months"` (standard look-back)
- **Manuscript CONTEXT box**: JCO house style adds an editorial context summary (`keyObjective` / `knowledgeGenerated` / `relevance`) before the Introduction — reproduced in `pub-tb-001` `contentStructure.contextBox`
- **Poster panel taxonomy**: grid position labels (`col1-row1`, `bottom-banner`) instead of freeform section names — supports fixed grid layouts

## Not applied here

- **Point-by-point Response Letter** (last remaining Module B sample-doc row from the SME table) is a peer-review artefact tied to the `reviewRound.json` and `reviewComments.json` fixtures. Structure captured (6-block response logic from Module D HA response) but not applied to Module B peer-review yet — a future pass could add a `contentStructure: { type: "peer-review-response" }` to Module B peer-review-round records.

## Regenerating

If the SME provides an updated set:
1. Drop the new zip in `Downloads`.
2. Extract into `docs/<new-folder>/`.
3. Re-run the structure extraction and update `reportingGuidelines.json` + affected publications/authors.
4. Update this README's mapping table.
