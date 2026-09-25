# SME Sample Documents — Module C (Medical Writing)

Source documents provided by SMEs on 25 Sep 2026 via OneDrive. Used to enrich the prototype's Module C fixtures with realistic medical-affairs deliverable structures.

## Files and how they map to the prototype

| SME document | Fixture / structure applied |
|---|---|
| `SCLC_Medical_Affairs_Plan_Sample.docx` | Referenced by `medicalAffairsPlanId: "map-spine-tb-2"` on every SPINE-TB med-content item. Chapter/objective taxonomy (5 canonical MA objectives: Evidence, Scientific Exchange, Education, Insights, Patient Focus) drives the KOL Insights Report's `maImplicationAxes` field. |
| `Disease dossier sample.pdf` (IQWiG A19-86, atezolizumab SCLC) | `mc-tb-001` `contentStructure` — HTA dossier with 2.1–2.6 chapter numbering, 4-item standard front matter, 52 pages. |
| `HCP slide deck_Sample.pdf` (Hem/Onc Best Practices Course, 416 slides across ~25 modules) | `mc-tb-002` `contentStructure` — multi-session HCP course with per-module intra-structure (title / disclosures / learning objectives / why-important / concept-slides / summary), section-divider watermarks. 64 slides across 3 sessions and 8 modules. |
| `CME module_Sample.pdf` (Combined-modality LS-SCLC teaching deck, 33 slides) | `mc-tb-003` `contentStructure` — single-topic CME with presenter/venue metadata, numbered learning objectives, trial-name-as-slide-title pattern, take-home messages block. |
| `Patient Insert leaflet_Sample.pdf` (Tecentriq SmPC + Labelling + PL, 175 pages) | `mc-tb-004` `contentStructure` — EMA QRD template: rigid 3-annex structure (SmPC / MA Conditions / Labelling + PL), regulatory-canonical numbering (4.1–4.9, 5.1–5.3, 6.1–6.6). Translations pending for Hindi, Portuguese, isiZulu, Tagalog. |
| `Plain Language Summary_Sample.pdf` (Taylor & Francis, DeLLphi-301 tarlatamab, 10 pages) | `mc-tb-005` `contentStructure` — patient-facing PLS with question-form headings ("What is this summary about?"), fixed narrative arc (about → disease → purpose → sponsor → treatment → results → safety → meaning → further-reading → disclosures), glossary sidebar. |
| `SCLC_KOL_Insights_Report_Sample.docx` | `mc-tb-006` `contentStructure` — KOL insights synthesis with 5-theme structure (each carrying a mandatory `questionsGenerated` sub-block), MA implications along the 5-axis taxonomy, standard appendices (Discussion Guide + Insight Capture Template). |
| `SCLC_Medical_Affairs_Content_Card_Library.docx` | **Not yet applied — Module E territory.** Will be used when we enrich the ideation content-card fixtures. The 12-field card schema (Card ID / Therapeutic Area / Primary Audience / Lifecycle Status / Scientific Objective / Core Scientific Message / Supporting Evidence / Context-Limitations-Fair-Balance / Suggested Visual / Potential Approved Channels / Reference Fields / Governance Metadata) is the target for `ideationContentCards.json`. |

## Where the structure lives in the codebase

- `apps/web/src/data/medContent.json` — each `mc-tb-*` fixture carries a `structureSource` field pointing back to the SME template and a `contentStructure` object with the discriminated-union shape appropriate to that doc type (`hta-dossier`, `hcp-slide-deck`, `cme-module`, `spc-leaflet`, `plain-language-summary`, `kol-insights-report`).

## Consistent shape across doc types

Every `contentStructure` object carries a `type` discriminator that maps 1:1 to `MedContentType` in `packages/types/src/domain.ts`. This lets a future UI render each doc type with an appropriate structural view (dossier chapters, slide-deck outline, SmPC annex tree, PLS question list, etc.) without changing the fixture shape.

## Cross-cutting taxonomies shared with the MA Plan sample

Two enums recur across multiple SME documents and are baked into the fixtures:

- **The 5-objective Medical Affairs taxonomy** — Evidence · Scientific Exchange · Education · Insights · Patient Focus. Appears in the MA Plan objectives, the KOL Report's `maImplicationAxes`, and the Publishing calendar's channel selection.
- **The 12-field Content Card schema** — awaiting application in Module E when we enrich `ideationContentCards.json` from the Content Card Library sample.

## Regenerating

If the SME provides an updated set:
1. Drop the new zip in `Downloads`.
2. Extract into `docs/<new-folder>/`.
3. Re-run the structure extraction and update the affected `contentStructure` objects in `medContent.json`.
4. Update this README's mapping table.
