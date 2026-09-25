# Module E Enrichment — Built from cross-module SME evidence

**No dedicated SME batch was provided for Module E.** This enrichment reuses structural patterns captured in earlier SME batches (primarily Batch 2's Content Card Library sample from Medical Affairs, plus governance patterns from Batches 3 and 4) to close the loop on Module E fixtures.

## Sources reused

| Cross-module source | Applied to Module E as |
|---|---|
| `docs/OneDrive_2_9-25-2026/SCLC_Medical_Affairs_Content_Card_Library.docx` — 12-field card schema + card-ID convention (TA-TOPIC-NNN) + QC checklist | **New fixture** `apps/web/src/data/contentCardSchema.json` — canonical schema definition |
| Same 12-field schema | **Enriched** `ideationContentCards.json` — all 6 SPINE-TB cards (`c-tb-001` through `c-tb-006`) now carry a `canonicalCardId` (TB-EFF-001, TB-EFF-002, TB-SAF-001, TB-POS-001, TB-EDU-001, TB-EDU-002) plus a `schemaFields` object with the full 12 fields |
| `docs/OneDrive_2_9-25-2026/SCLC_KOL_Insights_Report_Sample.docx` — 5-axis MA implications taxonomy | Already applied at Module C (`mc-tb-006`); Module E cards link back via `provenance.sourceDoc` — the cross-module chain is complete: Insights Report → atomised content cards → publishing calendar |
| Batch 4 ICMJE COI attestation pattern (13 fields, no-limit vs 36-month timeframes) | Reused as the governance-attestation pattern on card `governanceMetadata` — the `approvedBy` + `approvedRole` + `approvedAt` + `expiryDate` + `retiringConditions` structure mirrors the ICMJE `attestation.certified` model |
| Batch 3 HA response 6-block logic (Question → Response → Rationale → Dossier Impact → Documents Updated → References → QC) | Available for future application if a Module E "Content Response to Query" fixture is needed (e.g. handling regulator queries about promotional claims) |

## What the 12-field schema adds beyond the current cards

Every SPINE-TB card previously had: id, ideationArtefactId, sourceSection, sourcePassage, claimCurrencyStatus, channelFormats, kolStatus, maStatus, overallStatus, provenance, provenanceChain, title, cardType.

The `schemaFields` block **adds**:
- **`canonicalCardId`** — TA-TOPIC-NNN format (TB-EFF-001, TB-SAF-001, etc.) alongside the existing internal id (kept for backwards-compat with calendar/KOL references)
- **`therapeuticArea`** — surfaced from parent project
- **`primaryAudience`** — explicit audience typing (HCP · TB Programme Physician, Payer, Patient, MSL, etc.)
- **`lifecycleStatus`** — Development / Approved / Superseded / Retired
- **`scientificObjective`** — the single scientific point the card exists to communicate
- **`coreScientificMessage`** — verbatim message text
- **`supportingEvidence`** — array of data points that substantiate the message
- **`contextLimitationsFairBalance`** — **compliance-critical**. Mandatory fair-balance framing (subgroup restrictions, comparator caveats, safety trade-offs). Currently missing from every prior card fixture — the biggest structural gap this enrichment closes.
- **`suggestedVisual`** — visualisation guidance (forest plot, timeline, infographic, etc.)
- **`potentialApprovedChannels`** — channels where the card can be deployed
- **`referenceFields.primarySource`** + **`.secondarySources`** — explicit primary/secondary citation split
- **`governanceMetadata`** — approver / expiry / retiring conditions / re-attestation cadence

## Where the structure lives in the codebase

- **`apps/web/src/data/contentCardSchema.json`** (new) — schema definition, card-ID convention, cardTypes enum, workflow, QC checklist, and a `blankTemplateCard`
- **`apps/web/src/data/ideationContentCards.json`** — 6 SPINE-TB cards now carry `canonicalCardId` + full `schemaFields` block

## Coverage after this pass

| SME batch | Module | Sample-doc rows covered |
|---|---|---|
| Batch 1 (OneDrive_1) | A | 7/7 |
| Batch 4 (OneDrive_4) | B | 6/7 (Response Letter deferred) |
| Batch 2 (OneDrive_2) | C | 7/8 (Content Card Library used here for Module E) |
| Batch 3 (OneDrive_3) | D | 10/10 (US REMS shape captured but not applied — natural VELORA fit) |
| **Batch 2 cross-applied** | **E** | **Content Cards → applied. All 6 SPINE-TB cards carry the 12-field schema.** |

## Not done (deliberately)

- **VELORA cards** (`c-001`, `c-002`, `c-003`) — kept with their original structure. They pre-date the schema; adding the 12 fields to them would be mechanical (same as what was done for TB cards) but adds 3× the JSON with limited demo value.
- **Card-ID renaming** — kept the existing `c-001` / `c-tb-001` internal ids to avoid breaking cross-references from `ideationCalendar.json` (calendar entries reference cards by internal id) and `kolContacts.json` (KOL review decisions reference cards by internal id). The `canonicalCardId` field carries the TA-TOPIC-NNN convention alongside.
- **Response letters / Ideation Response fixtures** — HA response 6-block logic is available in the Module D fixtures for reuse if the SME later requests a "content-query response" workflow in Module E.

## Regenerating

If the SME later provides a dedicated Module E batch:
1. Drop the zip in `Downloads`.
2. Extract into `docs/OneDrive_5_9-25-2026/` (or matching name).
3. Compare its structures against the schema in `contentCardSchema.json` and update the schema + card fixtures as needed.
4. Update this README with the new source citations.
