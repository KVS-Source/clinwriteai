# CD Prompt — sD07 eCTD Publishing Monitor
**Module:** D — Regulatory Writing · Crimson `#B0200D`  
**PRD refs:** FR-D-014, FR-D-019, FR-D-020  
**Screen code:** sD07  
**Output file:** `aurora-sD07-ectd-publishing-monitor.html`

---

## Screen Purpose

Stage 5 — the continuous eCTD publishing monitor and validation screen. Implements the continuous publishing differentiator (FR-D-019): documents publish automatically into the eCTD package as they are locked — Stage 5 is a validation pass, not manual assembly. Also includes PPD/CCI Redaction (FR-D-014, moved to Stage 5 per v0.2 fix) and eCTD Validation (FR-D-020).

---

## Layout

Two-column layout. Left: eCTD package status tree + publishing log (~420px). Right: eCTD Validation results + PPD/CCI Redaction panel.

**Header:** "eCTD Publishing · Stage 5" breadcrumb, "47 of 62 sections compiled · 76%" progress bar (crimson), "Run eCTD validation ✦" primary button (crimson), "Proceed to Stage 6 →" gated button.

---

## Left Column — eCTD Package Status

**Publishing Monitor panel:**

Header: "Continuous Publishing Monitor · Auto-compiling as sections lock"
Sub-label in IBM Plex Mono: "eCTD v3.2.2 · Validator: EXTEDO EXTEDOpulse · Gateway: FDA ESG (Priority 1) + EMA CESP (Priority 2)"

Compact tree showing compiled status. Each leaf node = one eCTD document unit:

Status icons:
- ✓ Compiled (green)
- ● Auto-compiling (crimson animated dot — live)
- ○ Pending (grey)
- ⚠ Validation error (amber)

Example nodes:
```
Module 2
  ✓ 2.1-table-of-contents.xml
  ✓ 2.2-introduction.pdf
  ✓ 2.3-quality-overall-summary.pdf
  ✓ 2.4-nonclinical-overview.pdf
  ● 2.5-clinical-overview.pdf          ← auto-compiling now
  ○ 2.6-nonclinical-summaries.pdf
  ● 2.7-clinical-summaries.pdf

Module 3
  ✓ 3.2.S-drug-substance.pdf
  ✓ 3.2.P-drug-product.pdf
  ⚠ 3.2.A-appendices.pdf             ← validation error

Module 5 [READ-ONLY · Module A]
  ✓ 5.3.1-csr-velora301.pdf
```

**Publishing log (scrollable, IBM Plex Mono, small):**
```
15 Oct 2026 16:22 UTC  2.5-clinical-overview v0.4 → compiling
15 Oct 2026 16:20 UTC  2.7-clinical-summaries v0.3 → compiled ✓
15 Oct 2026 16:18 UTC  3.2.P v1.0 → compiled ✓
15 Oct 2026 14:03 UTC  5.3.1 CSR import → compiled ✓
```

---

## Right Column — Two panels stacked

**Top: PPD/CCI Redaction Panel (FR-D-014)**

Header: "PPD/CCI Anonymisation · Required for public disclosure (EMA Policy 0070/0043)"

Status summary:
- Personal Protective Data detected: "47 instances across 12 documents"
- CCI detected: "8 instances across 4 documents"

Redaction workflow (three-step):
1. "AI detection complete · 47 PPD + 8 CCI instances marked ✓"
2. "Human confirmation required: 23 of 55 confirmed · 32 remaining"
3. "Two versions: Original (restricted) · Public redacted copy"

Unconfirmed items list (first two shown):
- "§5.3.1 p.24: Patient ID 'PT-VELORA-301-004' → [REDACTED] · Confirm ✓ / Override ✗"
- "§5.3.1 p.47: Investigator name 'Dr. [Name]' → [REDACTED] · Confirm ✓ / Override ✗"

Warning strip (amber): "Redactions are irreversible after submission. Pre-redaction version retained under restricted access per DD-D-003."

**Bottom: eCTD Validation Panel (FR-D-020)**

Header: "eCTD Validation · EXTEDO EXTEDOpulse"

Gate requirement: "All critical and major errors must be resolved before Stage 6."

After validation run (300s), shows results:

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | ✓ None |
| Major | 1 | ⚠ Must fix |
| Minor | 3 | Advisory |

Major error card:
- Rule: "FDA v3.2.2 · M2-01: Module 2.3 QOS — file naming convention"
- "File named 'quality-overall-summary.pdf' — required: 'm2-3-quality-overall-summary.pdf'"
- "Fix instructions: rename file to conform with ICH M2 eCTD specification"
- "Fix automatically →" button

Minor errors shown as collapsed summary: "3 minor errors · advisory only · do not block submission."

**Gate logic:**
"Proceed to Stage 6 →" requires: Critical errors = 0 ✓ / Major errors = 0 ✗ (1 remaining) / All PPD/CCI confirmed ✗ (32 remaining).

---

## Design Notes

- The animated ● (auto-compiling) dot is the visual proof of continuous publishing — it should feel live, not static. Use CSS animation on the dots next to in-progress files.
- The file-naming validation error is deliberately mundane — it's the kind of error that trips up real eCTD submissions. It grounds the demo in realism.
- PPD/CCI redaction irreversibility warning must use amber (warning) not red (blocker) — it is an informational caution, not a gate failure.
- The IBM Plex Mono publishing log gives the screen an authentic regulatory operations feel. Keep it small and scrollable — it is ambient context, not primary UI.
