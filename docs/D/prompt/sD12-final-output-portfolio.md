# CD Prompt — sD12 Final Output & Portfolio
**Module:** D — Regulatory Writing · Crimson `#B0200D`  
**PRD refs:** FR-D-023, FR-D-026, FR-D-027  
**Screen code:** sD12  
**Output file:** `aurora-sD12-final-output-portfolio.html`

---

## Screen Purpose

Two complementary views on one screen, toggled by a top-level tab: (1) Final Output — the complete compliance provenance record for the submitted Veloricept NDA, Master Library push confirmation, and predictive timeline; (2) Submission Portfolio — a cross-project dashboard of all regulatory submissions across all projects, with a built-in Orphan Drug Eligibility tool panel. Module D equivalent of Module C sC09 + sC10 combined.

---

## Layout

Top-level tab toggle: "Final Output" (default) / "Submission Portfolio"

---

## TAB 1 — Final Output

**Header:** "Veloricept NDA · Final Output · ACK2 Confirmed · FDA ESG · 16 Oct 2026"

ACK banner (green, full-width): "ACK2 ✓ — Format validation passed. FDA ESG accepted the submission package. Estimated review period: 10 months (PDUFA date: 16 Aug 2027)."

**Left column (~55%):**

**Submission Record:**
- Dossier: "Veloricept NDA v1.0 · 62 sections · eCTD v3.2.2 · 847 MB"
- Submission type: "NDA/MAA · FDA (Priority 1) + EMA (Priority 2)"
- Reg Affairs Lead e-signature: "Dr James Hartley · 16 Oct 2026 14:22 UTC · 21 CFR Part 11 compliant"
- "Download submission package (.zip)" button (crimson)
- "View eCTD package →" link

**Compliance Provenance Chain:**
Cross-module audit trail — fully visible without interaction:

```
Module A — Clinical Writing (Source)
  VELORA-301 CSR v1.0 · Signed 28 Oct 2026
  IB v3.0 · Signed 15 Sept 2026
  847 canonical JSON data points extracted

Module D — Regulatory Writing (Submission)
  Stage 1 briefing — 12 Oct 2026 · Dr S. Chen
  Stage 2 Module 2 authoring — 12–15 Oct 2026
  Stage 3 CMC/Nonclinical finalisation — 14 Oct 2026
  Stage 4 Super Review — 15 Oct 2026 · All 6 RACI roles signed
  Stage 5 eCTD validation passed — 15 Oct 2026 · EXTEDO ✓
  Stage 6 Transmitted — 16 Oct 2026 14:22 UTC · FDA ESG

Regulatory Frameworks Applied:
  21 CFR Part 11 / 21 CFR Part 314 / ICH M4E(R2) / ICH E2C(R2)
  EMA Regulation 726/2004 / GDPR / eCTD v3.2.2
```

**Regulatory Disclaimer row:** "Aurora regulatory disclaimer included as page 1 of all exported PDFs."

**Right column (~45%):**

**Master Library Push (FR-D-027):**
"5 cards pushed ✓ — Available in Regulatory Writing (D) and Ideation & Publishing (E)"

Cards:
- CTD 2.5 Clinical Overview · Oncology · VELORA-301 · NDA 2026
- CTD 2.7 Clinical Summary · Oncology · VELORA-301 · NDA 2026
- Approved SmPC v1.0 · EU Label · Oncology
- RMP Core Document · EMA · Risk Management
- HA Response Template Bundle · FDA Day 120 · 12 questions

**Predictive Timeline (FR-D-023):**
Milestone calendar strip:
- ✓ Transmitted: 16 Oct 2026
- ✓ ACK1: 16 Oct 2026 (6 min)
- ✓ ACK2: 16 Oct 2026 (2h 25m)
- ○ ACK3 (estimated: 31 Oct 2026)
- ○ Day 74 Filing review complete (estimated: 29 Dec 2026)
- ○ PDUFA date (estimated: 16 Aug 2027)

---

## TAB 2 — Submission Portfolio

**Header:** "Submission Portfolio" with "Export compliance report" button (crimson) and TA filter + submission type filter.

**Kanban lanes (four columns):**
- Authoring (Stage 1–3)
- Super Review (Stage 4)
- Publishing (Stage 5)
- Submitted / Approved

Cards from the three demo submissions:
- Veloricept PSUR → Super Review lane (amber — "3/6 roles signed")
- Veloricept NDA → Submitted lane (green — "ACK2 ✓ · FDA + EMA")
- AURELIA-101 IND → Submitted lane (green — "ACK2 ✓ · EMA CESP · 12 Oct")

**Orphan Drug Eligibility Tool panel (right sidebar — FR-D-026):**

Header: "Orphan Drug Eligibility Tool" with "New ODD assessment →" button.

Mini-assessment card for AURELIA-101 (Cardiometabolic):
- Disease prevalence: "EU: 3.2 per 10,000 ✓ (threshold: ≤5 per 10,000)"
- US: "Est. 180,000 patients ✓ (threshold: <200,000)"
- Eligibility score: "84% — Likely eligible for ODD"
- Medical plausibility: "Significant benefit draft — pending Clinical Lead sign-off"
- "View full ODD assessment →"

**Right panel — HA Correspondence tracker:**
Compact log of all HA correspondence across all submissions (same data as sD09 tracker, consolidated):
- Veloricept NDA: ACK1 ✓ · ACK2 ✓ · Awaiting ACK3
- AURELIA-101 IND: ACK1 ✓ · ACK2 ✓ · ACK3 ✓ (accepted for review)
- PSUR: Not yet submitted

---

## Design Notes

- The Compliance Provenance Chain must be fully visible without scrolling or interaction — same rule as Module C sC09. This is the regulatory record that proves the platform's audit trail claim.
- The PDUFA date in the predictive timeline is the most emotionally significant data point for any pharmaceutical regulatory team — make it prominent in the milestone calendar.
- The Orphan Drug Eligibility Tool is unique to Module D — give it its own panel header with the ODD acronym spelled out: "Orphan Drug Designation (ODD) Eligibility Tool" — do not abbreviate on first use.
- The portfolio tab uses the same kanban pattern as Module C sC10 — consistent cross-module design but with Module D submission types in the lane cards.
