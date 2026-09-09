# CD Prompt — sD03 eCTD Granularity Map
**Module:** D — Regulatory Writing · Crimson `#B0200D`  
**PRD refs:** FR-D-003, FR-D-006, FR-D-019  
**Screen code:** sD03  
**Output file:** `aurora-sD03-ectd-granularity-map.html`

---

## Screen Purpose

The full interactive eCTD granularity map — a real-time view of the entire CTD dossier structure showing which sections are compiled, in authoring, pending, or not started. The primary navigation hub for the complete dossier. Implements the continuous publishing differentiator (FR-D-019): sections compile automatically as they are locked — no manual assembly step.

---

## Layout

Full-width content area. Left: collapsible CTD tree (~340px fixed). Right: section detail panel (fills remaining width).

**Header:** "eCTD Granularity Map · Veloricept NDA · FDA + EMA" with dossier completeness indicator: "47 of 62 sections ✓ · 76% complete" and crimson progress bar. Secondary actions: "Export map (PDF)" and "Run consistency check ✦" (→ triggers FR-D-016 check, leads to Super Review sD06).

---

## Left Panel — CTD Tree

Collapsible hierarchical tree. Each node = one CTD section. Five status states:

| Symbol | State | Colour |
|--------|-------|--------|
| ✓ | Compiled & locked | Green `#15803D` |
| ● | In authoring | Crimson `#B0200D` |
| ▲ | In review / pending sign-off | Amber `#B45309` |
| ○ | Not started | Grey `#94A3B8` |
| ◉ | System-generated (auto) | Steel blue `#005F8E` |

Tree structure (top-level nodes, expandable):

```
▼ Module 1 — Regional Administrative
   ├ ◉ 1.1 Cover Letter (FDA) — System-generated
   ├ ◉ 1.1 Cover Letter (EMA) — System-generated
   ├ ○ 1.2 Regional Forms (FDA 1571/1572)
   └ ○ 1.3 Regional Labeling Documents

▼ Module 2 — Summaries
   ├ ◉ 2.1 Table of Contents — System-generated
   ├ ◉ 2.2 Introduction to the Dossier — System-generated
   ├ ▲ 2.3 Quality Overall Summary
   ├ ▲ 2.4 Nonclinical Overview
   ├ ● 2.5 Clinical Overview           ← active (crimson)
   ├ ○ 2.6 Nonclinical Summaries
   └ ● 2.7 Clinical Summaries           ← active (crimson)

▼ Module 3 — CMC
   ├ ✓ 3.2.S Drug Substance
   ├ ✓ 3.2.P Drug Product
   ├ ▲ 3.2.A Appendices (stability gap)
   └ ✓ 3.3 Literature References

▼ Module 4 — Nonclinical
   ├ ✓ 4.2 Non-Clinical Study Reports
   └ ✓ 4.3 Literature References

▼ Module 5 — Clinical [READ-ONLY · Module A]
   ├ ✓ 5.2 Tabular Listing of Clinical Studies
   ├ ✓ 5.3.1 CSR — VELORA-301 Phase III · IMPORTED
   └ ✓ 5.4 Literature References
```

Active section (2.5) is highlighted with crimson left border in the tree.

---

## Right Panel — Section Detail

Shows the selected section (2.5 Clinical Overview) in detail:

**Section header:**
- "2.5 Clinical Overview" (h2)
- Status chip: "● In Authoring — v0.4 · Last edited 16 Oct 2026 by Dr Sarah Chen"
- AI footprint chip: "AI footprint · 42% ✦" (crimson-tinted, same pattern as Modules B/C)
- "Open in editor →" button (crimson) → sD04 CTD Module 2 Editor

**Source grounding panel:**
"Drafted from: VELORA-301 CSR v1.0 · Module A" source chip (blue-grey).
Data points used: "214 data points from canonical JSON layer · Indexed 12 Oct 2026."

**Cross-references panel:**
- "Cross-references to Module 5: 18 verified ✓ · 2 flagged ⚠"
- Flagged refs in amber: "§2.5.4 Efficacy → Table 14.2.1: Hazard ratio discrepancy (0.61 vs 0.63)" — this is the consistency check finding.
- "Run cross-module check ✦" link.

**Publishing status:**
"Continuous publishing: section will compile automatically when locked. Not yet locked."
Progress bar showing section completeness: "Sections drafted: 4 of 7 · 57%"

**Sign-off requirements:**
RACI summary for this section: "Regulatory Writer: Dr Sarah Chen ● / Clinical Lead: Dr James Hartley ○"

---

## Bottom Strip — Dossier Summary Stats

Horizontal strip across full width:
- Total sections: 62 · Compiled: 47 · In authoring: 8 · Pending sign-off: 4 · Not started: 3
- "Last consistency check: 15 Oct 2026 · 2 contradictions found"
- "eCTD version: v3.2.2 · Validator: EXTEDO EXTEDOpulse"
- "Gateway: FDA ESG (Priority 1) · EMA CESP (Priority 2)"

---

## Interactions

- Click any tree node → loads section detail in right panel
- "Open in editor →" → sD04 (for Module 2 sections) or sD05 (for Module 3/4)
- "Run consistency check ✦" → launches check (120s), then shows results in sD06 Super Review
- Module 5 nodes: clicking opens the read-only CSR imported from Module A with a "View in Module A →" external link

---

## Design Notes

- Module 5 nodes must visually communicate read-only status — use a lock icon and "Module A" source chip on every Module 5 row. Clicking them never opens the Module D editor.
- System-generated sections (2.1, 2.2, cover letters) use steel blue ◉ not crimson — they are not authored by the user.
- The "2 contradictions flagged" amber warning in the cross-references panel is the visible hook that drives users to run the consistency check and proceed to Super Review.
- This screen is the navigation hub — it should feel like a control tower, not a document list.


> **Design rule — Module 5:** Every Module 5 node must show a lock icon and the label 'Read-only · Module A'. Clicking Module 5 nodes opens a panel showing the imported CSR summary, not the Module D editor. This communicates DD-D-001 visually without requiring the user to read documentation.
