# CD Prompt — sD04 CTD Module 2 Editor
**Module:** D — Regulatory Writing · Crimson `#B0200D`  
**PRD refs:** FR-D-006, FR-D-007, FR-D-008, FR-D-009, FR-D-016  
**Screen code:** sD04  
**Output file:** `aurora-sD04-ctd-module2-editor.html`

---

## Screen Purpose

Stage 2 — the primary authoring screen for CTD Module 2 summaries (2.3–2.7) and SmPC/USPI label drafting. The AI drafting differentiator (FR-D-007) is the centrepiece: AI generates section drafts directly from the canonical JSON layer of the linked Module A CSR and nonclinical data. Every AI suggestion is cited to its exact source data point.

---

## Layout

Three-panel layout (same pattern as Module A/B/C editors):
- **Left:** Section navigator (~240px)
- **Centre:** Document canvas (fills remaining width)
- **Right:** Tabbed panel — AI Suggest / Cross-Ref / Consistency / Audit (~320px)

**Editor header bar:**
- Breadcrumb: Regulatory Writing / Veloricept NDA / CTD Module 2 Editor
- Source chip: "Drafted from: VELORA-301 CSR v1.0 · Module A" (blue-grey, compact)
- AI footprint chip: "AI footprint · 42% ✦" (persistent, crimson-tinted `#FFF5F5`)
- "Run consistency check ✦" button (amber) — triggers FR-D-016
- "Submit for Super Review →" primary button (crimson) — active after section sign-off

---

## Left Panel — Section Navigator

CTD Module 2 sections as a collapsible list. Each section shows status indicator:

```
◉ 2.1 Table of Contents         [auto]
◉ 2.2 Introduction              [auto]
▲ 2.3 QOS
▲ 2.4 Nonclinical Overview
● 2.5 Clinical Overview         [active — crimson]
  ├ 2.5.1 Background
  ├ 2.5.2 Overview of Bioavailability
  ├ 2.5.3 Overview of Pharmacokinetics
  ├ 2.5.4 Overview of Efficacy     ⚠ [warn — consistency flag]
  ├ 2.5.5 Overview of Safety
  ├ 2.5.6 Benefits and Risks
  └ 2.5.7 Conclusions
○ 2.6 Nonclinical Summaries
● 2.7 Clinical Summaries
```

Section 2.5.4 shows amber warn indicator: "1 consistency flag — HR value discrepancy."

---

## Centre — Document Canvas

Active section: **2.5.4 Overview of Efficacy**

Content area shows draft text with inline formatting. Key UI elements:

**AI-generated paragraph (highlighted):**
> Background tint `#FFF5F5` (crimson-tinted) on AI-generated text blocks.
> "Veloricept plus pembrolizumab demonstrated statistically significant improvement in progression-free survival (hazard ratio 0.61; 95% CI 0.48–0.77; p<0.001) [Source: VELORA-301 CSR v1.0 · Table 14.2.1]."
> Small source citation chip inline: "CSR v1.0 · Table 14.2.1" in IBM Plex Mono.

**Consistency warning inline:**
Amber underline on "hazard ratio 0.61" with tooltip: "⚠ Consistency flag: Module 5 Table 14.2.1 shows 0.63 in the interim analysis. Verify source version. Run full check ✦."

**Human-authored paragraph (no tint):**
"The clinical benefit was consistent across all pre-specified subgroups including PD-L1 expression and histology (Section 2.7.3.3)."
Cross-reference chip: "→ 2.7.3.3 ✓ verified" (green).

**Data objectivity flag (FR-D-007):**
One sentence is flagged with a purple dashed underline:
"These results establish veloricept as a best-in-class treatment option."
Tooltip: "⚠ Data objectivity check: comparative superlative — 'best-in-class' requires substantiated head-to-head evidence. PRD v4.1 §12.4 Rule 1: avoid language that overstates efficacy. Suggested revision: 'These results demonstrate a clinically meaningful improvement in PFS for veloricept plus pembrolizumab.'"

---

## Right Panel — Tabbed

**Tab 1 — AI Suggest ✦**
Current suggestion card:
- "Suggested addition · Section 2.5.5 Safety Overview"
- "Overall safety profile: grade ≥3 treatment-related AEs occurred in 52% of patients in the veloricept arm versus 44% in the control arm [Source: VELORA-301 CSR v1.0 · Table 14.3.1.1 · §4.8 SmPC v2.1]."
- Source citations: two chips — "CSR v1.0 · Table 14.3.1.1" and "SmPC v2.1 · §4.8"
- Attribution: "Generated 09:22 UTC · claude-sonnet-4-6 · Logged to audit trail"
- AI footprint: "AI footprint recalculates on accept"
- Actions: "Accept ✓" / "Discard ✗" / "Suggest again ✦"
- Note: "All AI suggestions grounded in canonical JSON layer (FR-D-001). Module A data only — no hallucinated data points."

**Tab 2 — Cross-Ref**
List of cross-references in the active section:
- "→ 2.7.3.3 ✓ verified · Primary endpoint subgroup analysis"
- "→ Module 5 · Table 14.2.1 ⚠ check version — 0.61 vs 0.63"
- "→ Module 5 · Figure 14.2.1-1 ✓ verified"
"Run full cross-module check ✦" button at bottom.

**Tab 3 — Consistency**
Summary of FR-D-016 last run:
"Last run: 15 Oct 2026 09:18 UTC · 2 contradictions found"
Two items:
- "2.5.4 HR 0.61 vs Module 5 Table 14.2.1 (0.63) — Severity: Major · Must resolve before Super Review"
- "2.7.2.1 Median PFS 9.7 months vs Module 5 Table 14.2.2 (interim 9.4 months) — Severity: Minor"

**Tab 4 — Audit**
Recent audit entries for this section in IBM Plex Mono:
- "09:22 UTC · AI suggestion accepted · Section 2.5.4 · Dr S. Chen"
- "09:18 UTC · Consistency check run · 2 contradictions · Logged"
- "09:10 UTC · Section opened for editing · Dr S. Chen"

---

## Interactions

- Accept AI suggestion → AI footprint chip updates, audit entry created
- "Run consistency check ✦" → 120s check → updates Consistency tab → if contradictions, warns before Super Review submit
- "Submit for Super Review →" → blocked if unresolved consistency contradictions remain (gate per DD-D-002)
- Section navigator click → loads that section in canvas
- Section 2.1 / 2.2 nodes → read-only view "System-generated — not editable"

---

## Design Notes

- The data objectivity check (purple dashed underline) is unique to Module D — no equivalent in other modules. It enforces PRD v4.1 §12.4 Rule 1 directly in the editor.
- AI-generated text blocks use crimson tint `#FFF5F5` — same as Module D accent. Non-AI authored text has no tint (white background).
- Consistency warning uses amber inline underline — never crimson or red — consistent with the platform warning colour system.
- The inline source citation chips (e.g., "CSR v1.0 · Table 14.2.1") are the most important demo element in this screen. They prove the canonical JSON layer grounding claim.
