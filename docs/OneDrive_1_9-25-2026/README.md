# SME Sample Documents — Provenance

Source documents provided by SMEs on 25 Sep 2026 via OneDrive. Used to enrich the prototype's mock fixtures with realistic clinical/regulatory document structures.

## Files and how they map to the prototype

| SME document | Structure applied to |
|---|---|
| `DSUR ICH E2F Template.pdf` | `DOC-006` (VELORA DSUR Year 2) · `DOC-104` (SPINE-TB DSUR Year 2) — 20-section ICH E2F structure |
| `CSR+Synopsis_Sample.pdf` (AstraZeneca SEROQUEL 5077US/0049) | `DOC-001` / `DOC-101` (CSRs) · `DOC-002` / `DOC-102` (CSR Synopses) — ICH E3 numbering |
| `Informed Consent Form_Sample.pdf` (NCI/CTEP #10268, Topotecan + M6620 SCLC) | `DOC-008` (VELORA ICF) · `DOC-107` (SPINE-TB ICF) — NCI/CTEP question-headed structure |
| `Protocol+Synopsis_Sample.pdf` (Roche SKYSCRAPER-02 / GO41767, atezo + tira + CE in ES-SCLC) | `DOC-003` (VELORA Protocol) — industry-sponsored protocol template |
| `Protocol_Abbvie_SCLC_Sample.pdf` (AbbVie TAHOE M16-289, Rova-T vs topotecan) | Reference for industry Phase 3 SCLC pattern |
| `Protocol_CRAB_SCLC_Sample.pdf` (CRAB 11-001, carfilzomib + irinotecan) · `Protocol+Synopsis_Colombia University_SCLC_Sample.pdf` (Columbia AAAT0174) · `Protocol+Synopsis_YmAbs_Sample.pdf` (Y-mAbs Trial 402, nivatrotamab) | `DOC-103` (SPINE-TB Protocol) — investigator-initiated protocol template |
| `SAE_Patient_Narrative_Sample.docx` (fictional NV-301 hepatocellular injury training template) | `DOC-005` / `DOC-105` (SAE Narratives) — 8-section case-narrative structure |
| `Patient_Narrative_Compendium_Sample.docx` (fictional NV-301 multi-case compendium) | `DOC-106` (SPINE-TB Patient Narrative Compendium) — index + per-case pattern |
| `cdc_45406_DS1.pdf` (Chapman et al., AJOB Empirical Bioethics 2015 — TBTC #29 ICF assessment) | Reference only — real-world ICF quality benchmarking article |

## Where the structure lives in the codebase

- `apps/web/src/data/documents.json` — each fixture document carries a `structureSource` field pointing back to the SME template it mirrors, and a populated `sections[]` array based on that template.

## Note on the SCLC protocols

All four sponsor protocols in this set are **Small-Cell Lung Cancer** studies (SKYSCRAPER-02, TAHOE, AAAT0174, Trial 402). The prototype's oncology exemplar (VELORA-301) is currently **Non-Small-Cell Lung Cancer**. If a future demo needs true SCLC alignment with these SME samples, VELORA-301 metadata can be retagged (or a new SCLC study added) — see conversation notes for the option we discussed but did not apply.

## Regenerating

If the SME provides an updated set:
1. Drop the new zip in `Downloads`.
2. Extract into `docs/<new-folder>/`.
3. Re-run the structure extraction and update the affected fixture `sections[]` arrays.
4. Update this README's mapping table.
