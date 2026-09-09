# CD Prompt — sD02 Submission Setup & Strategy
**Module:** D — Regulatory Writing · Crimson `#B0200D`  
**PRD refs:** FR-D-001, FR-D-002, FR-D-003, FR-D-004, FR-D-005  
**Screen code:** sD02  
**Output file:** `aurora-sD02-submission-setup-strategy.html`

---

## Screen Purpose

Stage 1 of the Module D workflow. The regulatory affairs lead sets up a new submission: links the Module A source project, selects submission type and target HAs, configures eCTD version, and acknowledges the CMC Data Readiness Report before Stage 2 authoring begins.

---

## Layout

Two-column layout with breadcrumb header. Left column: setup form (wider, ~60%). Right column: live eCTD Granularity Map preview + CMC Readiness panel (~40%).

**Breadcrumb:** Regulatory Writing / Veloricept NDA / Submission Setup

**Header:** "Submission Setup & Strategy" (h1), "Stage 1 of 6 · Strategic Input", stage dot indicator (dot 1 active, crimson), "Proceed to Stage 2 →" button (inactive until readiness gate passes).

---

## Left Column — Setup Form

### Source Documents Panel
- Label: "Source Documents · Module A"
- Source project chip: "VELORA-301 · Module A ✓" (green chip) with "Linked CSR v1.0, IB v3.0, SAP v1.1, TLF Package v1.0"
- Each document shown as a verified chip (green check mark)
- External sources upload section: "External CMC/Nonclinical Data" — drag-and-drop upload area. Shows: "Module 3 CMC Data (3 files uploaded ✓)" and "Module 4 Nonclinical Reports (2 files uploaded ✓)"
- "Canonical JSON layer" status: "Indexing complete · 847 data points extracted · Logged to audit trail" in IBM Plex Mono green

### Submission Strategy Panel
- **Submission type selector:** 7 card options in a 2-column grid. Each card: icon + label. Types: IND / NDA/MAA / PSUR/PBRER / RMP/REMS / HA Response / CER / Orphan Drug Designation. Selected card (NDA/MAA) = crimson border + `#FFF5F5` background.
- **Target HA multi-select:** checkbox chips for FDA / EMA / MHRA / CDSCO / PMDA. FDA and EMA checked (crimson chip when checked). MHRA shown with tooltip "Priority 4 — API procurement required before production."
- **Submission timeline:** date picker. Target: 15 Jan 2027.
- **eCTD version:** radio toggle. "v3.2.2 (default)" selected. "v4.0" option shown greyed with tooltip "Required for PMDA; EMA/Health Canada phasing in. Admin-selectable."
- **TA tag:** "Oncology" selected (mandatory, cannot save without this).

### Stage 1 Readiness Checklist
Six items with pass/fail dots:
- Module A source project linked ✓
- External CMC/nonclinical data uploaded ✓
- Submission type selected ✓
- Target HA(s) selected ✓
- TA tag set ✓
- CMC Readiness Report acknowledged ✗ (blocks proceed)

"Proceed to Stage 2 →" inactive until all six pass.

---

## Right Column — eCTD Granularity Map Preview

Header: "eCTD Granularity Map" with "View full map →" link (→ sD03).

Compact tree showing the ICH CTD structure at high level. Each row: module label + status dot:

```
Module 1 — Regional Admin       ○ Not started
Module 2.1 — TOC                ◉ System-generated
Module 2.2 — Introduction       ◉ System-generated  
Module 2.3 — QOS                ○ Not started
Module 2.4 — Nonclinical Ovw   ○ Not started
Module 2.5 — Clinical Overview  ● In authoring
Module 2.6 — Nonclinical Sum   ○ Not started
Module 2.7 — Clinical Summary   ● In authoring
Module 3 — CMC                  ▲ Data received — pending finalisation
Module 4 — Nonclinical          ▲ Data received — pending finalisation
Module 5 — Clinical (from A)    ✓ Imported · Read-only
```

Legend: ○ Not started · ● In authoring · ▲ Pending · ✓ Complete · ◉ Auto-generated

Dossier completeness chip: "38% complete" with crimson progress bar.

---

## CMC Data Readiness Panel

Header: "CMC Data Readiness · Completeness Score: 84%"

Score ring: 84% filled crimson arc, percentage in centre.

Status breakdown:
- 3.2.S (Drug Substance): ✓ Complete
- 3.2.P (Drug Product): ✓ Complete  
- 3.2.A (Appendices): ⚠ Missing: stability data batches 3 and 4
- 3.3 (Literature): ✓ Complete
- 3.4 (Regional): ✓ Complete

Missing items in amber:
- "Stability data — batches 3 and 4 — required before Stage 3 CMC finalisation"

"Acknowledge CMC Readiness Report" button (amber, not crimson — this is a risk acknowledgement):
- When clicked: shows inline confirmation: "I acknowledge this report. Partial readiness (84%) is accepted with the following risk note: [text field for risk note]." Confirm & log to audit trail.
- After acknowledgement: checklist item 6 flips to ✓ and proceed button activates.

---

## Interactions

- "Proceed to Stage 2 →" → advance stage → sD04 CTD Module 2 Editor
- "View full map →" → sD03 eCTD Granularity Map
- Submission type card selection → triggers eCTD map preview to update granularity
- HA selection → triggers regional flag indicators throughout the form

---

## Design Notes

- The eCTD Granularity Map preview in the right column is live — it updates as the user configures the submission type and HA targets. The full interactive map is sD03.
- CMC Readiness acknowledgement uses amber (risk/warning colour) — never crimson. The user is accepting a known gap, not completing a positive gate.
- Module 5 row in the eCTD map must show "Read-only" badge — critical to communicate DD-D-001.
- "Canonical JSON layer · 847 data points extracted" is a key demo moment — show it prominently in the source documents panel in IBM Plex Mono green text.


> **Design note — track change:** If the submission type needs to change after Stage 1 is complete, the submission must be archived and a new one created. This mirrors the Module C compliance track lock. Use the word 'archive' not 'close' throughout — consistent with DD-D-006.
