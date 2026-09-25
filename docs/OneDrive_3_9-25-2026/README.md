# SME Sample Documents — Module D (Regulatory Writing)

Source documents provided by SMEs on 25 Sep 2026 via OneDrive. Used to enrich the prototype's Module D fixtures with authoritative CTD/eCTD/RMP/REMS structures and citations.

## Files and how they map to the prototype

### Regulator guidelines (authoritative references)

| SME document | Applied as `guidelineRefs` citation on |
|---|---|
| `ICH E3_Guideline.pdf` | Every CSR fixture in `documents.json` |
| `E8-R1_Guideline.pdf` | Protocol fixtures |
| `E9-R1_Guideline.pdf` | Statistical-analysis sections (2.5.4, 2.7 in Module 2) |
| `CTD Module 2.4 (Nonclinical Overview)_Guideline.pdf` | `sub-tb-001` m2/24 node |
| `CTD Module 2.5 (Clinical Overview)__Guideline.pdf` (ICH M4E R2) | `sub-tb-001` m2/25 node |
| `M4S_R2_Non Clinical Summaries_Guideline.pdf` | `sub-tb-001` m2/26 node |
| `EU_RMP_GVP Module V.pdf` (EMA/838713/2011 Rev 2) | `sub-tb-002` (RMP contentStructure) |

### Templates and samples

| SME document | Fixture / structure applied |
|---|---|
| `CTD_Module_2_3_QOS_Fictional_Sample.docx` | `sub-tb-001` m2/23-qos node — full S.1–S.7 / P.1–P.8 / A / R structure |
| `CTD_eCTD_Regulatory_Submission_Cover_Letter_Template.docx` | `sub-tb-001` m1/cover-letter node — regional variants for EMA + CDSCO + SAHPRA + ANVISA |
| `Mock_eCTD_Submission_Package_0000/` (folder tree) | `sub-tb-001` — the entire `contentStructure: { type: "ectd-package", modules: {...} }` shape mirrors this folder tree with the ICH M4 `mN/NN-slug/leaf.docx` naming convention |
| `HA_Response_Package_Training/` (folder tree + guide DOCX) | `sub-tb-003` — the `type: "ha-response-package"` shape, 6-block response logic (Question → Response → Rationale → Dossier Impact → Documents Updated → References → QC), tracker CSV columns, folder tree, and sequence numbering (0000 initial → 0010 response) |
| `US_REMS_Sample.pdf` (Zyprexa Relprevv REMS NDA 022173) | **Structural pattern captured but not applied.** SPINE-TB-2 is unlikely to need a US REMS; this shape would fit better on VELORA-301 (immunotherapy) if/when we add a `type: "rems"` submission fixture there. The proposed shape is documented in the extraction report — 5 stakeholder classes × lifecycle phases (become-certified / before-use / maintenance / at-all-times / reporting). |
| `SMPC_Pakcage leafelt_Sample.pdf` | Same Tecentriq SmPC as Module C — no new structure to apply here; SmPC/PIL structure already lives in `medContent.json` `mc-tb-004` |

## Where the structure lives in the codebase

- `apps/web/src/data/regulatorySubmissions.json` — each SPINE-TB submission (`sub-tb-001`, `sub-tb-002`, `sub-tb-003`) carries `structureSource`, `guidelineRefs`, and `contentStructure` fields. The discriminant on `contentStructure.type` determines the shape (`ectd-package`, `rmp`, `ha-response-package`).
- `apps/web/src/data/ectdGranularityMap.json` — the 24 granularity nodes for `sub-tb-001` already use ICH M4 numbering (`1.1`, `2.3`, `2.5`, `3.2.S`, `5.3.5` etc.). No node-name changes were made in this pass — the folder-path convention (`m2/23-qos`) is expressed inside the `sub-tb-001.contentStructure.modules` tree, keeping node names human-readable.

## Cross-cutting patterns baked in

- **eCTD path convention**: `mN/NN-slug/leaf-name.docx` — lower-case, hyphens, initial sequence `0000`, HA response `0010`, lifecycle ops `new / replace / delete`.
- **CTD Module 2 canonical anchors**: `2.3.S.1`…`2.3.R`, `2.5.1`…`2.5.7`, `2.6.1`…`2.6.7`.
- **EU RMP nesting**: Roman-numeral Parts I–VII with named safety-spec modules SI–SVIII inside Part II.
- **US REMS matrix**: 5 stakeholder classes × 4–5 lifecycle phases — captured but awaiting an oncology REMS fixture.
- **HA Response 6-block logic**: Question → Response → Rationale → Dossier Impact → Documents Updated → References → QC — applied per-question in `sub-tb-003.contentStructure.questions[]`.

## Regenerating

If the SME provides an updated set:
1. Drop the new zip in `Downloads`.
2. Extract into `docs/<new-folder>/`.
3. Re-run the structure extraction and update the affected `contentStructure` / `guidelineRefs` on `regulatorySubmissions.json`.
4. Update this README's mapping table.
