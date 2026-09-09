# CD Prompt — sE02 Artefact Upload & Source Currency Check
**Module:** E — Ideation & Publishing · Steel Blue `#005F8E`
**PRD refs:** FR-E-001, FR-E-002, FR-E-003, FR-E-004, FR-E-005
**Screen code:** sE02
**Output file:** `aurora-sE02-artefact-upload-source-check.html`

---

## Screen Purpose

Stage 1 (Uploaded) — the artefact ingestion screen. Two entry paths: file upload (Word/PDF) or Master Library pull. After ingestion the system runs source content gating (FR-E-003), source currency detection (FR-E-005), and claim currency verification (FR-E-004) before Stage 2 begins.

---

## Layout

Two-panel layout. Left: upload/pull form (~55%). Right: automated check results panel (~45%).

**Header:** "New Ideation Project · Stage 1" breadcrumb. "Stage 1 of 4" dot indicator (dot 1 active, steel blue). "Proceed to Stage 2 →" button (gated).

---

## Left Panel — Two Tabs: Upload File / Pull from Master Library

### Tab 1 — Upload File (default)

**Project details form:**
- Project name (text input): "VELORA-301 Ideation · Q4 2026"
- TA tag (required, validated against master taxonomy): "Oncology" selected
- Module of origin (optional): "Module C · Medical Writing"
- Document type selector: Original Research / Review / Medical Affairs Deck / KOL Meeting Summary / Press Release / Other
- Original author (text): "Dr Sarah Chen"
- Original approval date (date picker): 20 Oct 2026

**Upload area:**
Large drag-and-drop zone: "Upload Word (.docx) or PDF. Max 50 MB."
File shown after upload: "VELORA-301-KOL-Session-Summary.pdf · 2.4 MB · Uploaded ✓"

**Source type toggle (below upload):**
"Is this document from the Aurora platform?" — Yes / No radio.
When Yes: platform source check runs automatically (FR-E-003 hard gate).
When No (External): amber confirmation checkbox appears: "I confirm this document was formally approved via an external process. This confirmation is logged to the audit trail." Checkbox required before proceeding.

### Tab 2 — Pull from Master Library

Search bar: "Search Master Library by TA, module, content type, keyword..."
Filter chips: All Modules / Module A / Module B / Module C / Module D · All TAs · Date range.

Three result cards:
- "Veloricept PFS Claim · Module D · CTD 2.5 · Oncology · Pushed 05 Oct 2026 · 5 days ago ✓ Current"
- "Veloricept Safety Summary · Module C · MI Letter · Oncology · Pushed 28 Sept 2026 · 12 days ago ✓ Current"
- "Phase III Subgroup Analysis · Module B · Manuscript · Oncology · Pushed 15 Aug 2026 · 56 days ago ✓ Current (within 90 days)"

Each card: source module chip, TA chip, push date, currency status badge.
"Add to project" button on each card.

---

## Right Panel — Automated Check Results

Three check sections, each showing a running → complete state:

### Source Content Gate (FR-E-003) — Hard Gate
"Checking approval status in Module C..."
After check: "✓ Platform source · Module C Final Output · MLR Approved 20 Oct 2026 · Proceed permitted"
If failed: "✗ BLOCKED — Document status is 'In Authoring' in Module C. Only Final Output / MLR Approved documents may be used as ideation sources. Return to Module C to complete the approval workflow."

### Source Currency Detection (FR-E-005) — Warning
"Checking for newer versions and label updates..."
After check: One warning shown (amber):
- "⚠ Label Updated Since Source Approval — SmPC v2.1 was updated on 01 Oct 2026. This document references SmPC v2.0 (approved Sept 2026). Review the label differences before proceeding."
"Acknowledge label currency warning" checkbox with audit log note.

### Claim Currency Verification (FR-E-004) — Acknowledgement Gate
"Extracting and checking 14 substantive claims against current approved label..."
After check:
- 12 claims: "✓ Current — supported by SmPC v2.1"
- 1 claim: "⚠ Potentially Superseded — 'Veloricept approved for all NSCLC patients' — current label restricts to PD-L1 ≥1%. Acknowledge before proceeding."
- 1 claim: "✗ Conflicting — Do Not Use — 'No dose adjustment required in hepatic impairment' — SmPC v2.1 §4.2 now requires dose reduction. This claim must not be republished."

Acknowledge controls per flagged claim: text field for resolution note + "Acknowledge ✓" button.
"Acknowledge all with note" bulk option.

**Stage 1 Readiness (bottom of right panel):**
- Project details complete ✓
- Document uploaded ✓
- Source content gate: ✓ Passed
- Source currency: ⚠ 1 warning acknowledged ✓
- Claim currency: ✗ 1 conflicting claim — must acknowledge before proceeding
"Proceed to Stage 2 →" activates when all items resolved.

---

## Design Notes

- The three automated checks should run sequentially with visible progress — each check card shows a spinner then resolves. Source content gate runs first; if it fails, the other two checks are not run.
- The "Conflicting — Do Not Use" claim uses `#005F8E` steel blue border (module blocking colour) — it is a hard block on that specific claim's use, but not on proceeding. The Ideation Lead must acknowledge it.
- The External upload confirmation checkbox is an explicit audit record — make it visually distinct from a regular checkbox. Use a larger checkbox with the confirmation text in full, and an "⚠ I take responsibility" label.
- Master Library pull tab: cards older than 90 days show a "Lightweight currency check required" amber chip — this is the v0.2 fix to FR-E-002.
