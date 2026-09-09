# Session D03 — eCTD Granularity Map
**Screen:** sD03 · eCTD Granularity Map
**Route:** `/projects/:projectId/regulatory-writing/submissions/:submissionId/ectd-map`
**Component:** `src/modules/regulatory-writing/screens/ECTDGranularityMap.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/D/design/aurora-sD03-ectd-granularity-map.html`
**Data:** `src/data/ectdGranularityMap.json`, `src/data/consistencyCheckResult.json`
**Store:** `ectdStore`

---

## What to Build

Full-screen eCTD granularity map — the live dossier navigation hub. Left panel: collapsible CTD tree with status dots for all 36 nodes. Right panel: selected section detail with cross-reference status, AI footprint, and publishing state. Primary demo: sub-001, section 2.5.4 selected — shows the consistency flag.

---

## Screen Anatomy

Full-width. Left: CTD tree (~340px fixed). Right: section detail panel.

**Header:** "eCTD Granularity Map · Veloricept NDA · FDA + EMA", dossier completeness "47 of 62 sections ✓ · 76%" with crimson progress bar. Actions: "Export map (PDF)" secondary, "Run consistency check ✦" amber button → triggers FR-D-016.

**Left — CTD Tree:**
Render all 36 nodes from `ectdGranularityMap.json` where `submissionId === 'sub-001'`. Each node uses `ECTDStatusDot` component based on `status` field. Rules:
- `auto-generated` → ◉ steel blue — not clickable for editing
- `read-only` → 🔒 grey — `CTDReadOnlyBanner` on click, no edit controls (DD-D-001)
- `in-authoring` → ● crimson
- `signed` → ✓ green
- `in-review` → ▲ amber
- `not-started` → ○ grey

Nodes with `consistencyFlagged: true` (nd-014, nd-018, nd-025) show amber ⚠ badge. Active node (nd-018 · 2.5.4) highlighted with crimson left border.

**Right — Section Detail (2.5.4 active):**
- Section heading: "2.5.4 Overview of Efficacy"
- Status chip: "● In Authoring — v0.4 · Last edited 16 Oct 2026 by Dr Sarah Chen"
- AI footprint: "AI footprint · 51% ✦" (crimson-tinted)
- "Open in editor →" button (crimson) → sD04

**Source grounding panel:**
"Drafted from: VELORA-301 CSR v1.0 · Module A" source chip. "214 data points from canonical JSON layer · Indexed 12 Oct 2026."

**Cross-references panel:**
From `consistencyCheckResult.json` filtered to contradictions involving section 2.5.4:
- "Cross-references to Module 5: 18 verified ✓ · 2 flagged ⚠"
- Contradiction card: "§2.5.4 Efficacy → Table 14.2.1: HR 0.61 (final) vs 0.63 (interim)" — amber card
- "Run cross-module check ✦" link

**Publishing status:**
"Continuous publishing: section will compile automatically when locked. Not yet locked." Progress: "Sections drafted: 4 of 7 · 57%"

**Bottom strip (full width):**
IBM Plex Mono counts: Total 62 · Compiled 47 · In authoring 8 · In review 4 · Not started 3 · Auto-generated 4. "Last consistency check: 15 Oct 2026 · 2 contradictions found". "eCTD version: v3.2.2 · Validator: EXTEDO EXTEDOpulse". "Gateway: FDA ESG (Priority 1) · EMA CESP (Priority 2)".

---

## Data Wiring

```typescript
const { nodes, selectedNodeId, selectNode, fetchNodes } = useEctdStore()

useEffect(() => { fetchNodes(submissionId) }, [submissionId])
// MSW: GET /api/regulatory-submissions/sub-001/ectd-map → ectdGranularityMap.json

const selectedNode = nodes.find(n => n.id === selectedNodeId) ?? nodes.find(n => n.id === 'nd-018')

// Module 5 read-only guard (DD-D-001)
const handleNodeClick = (node: ECTDGranularityNode) => {
  if (node.isReadOnly) {
    // Show CTDReadOnlyBanner, do NOT navigate to editor
    return
  }
  selectNode(node.id)
}

// Consistency contradictions for selected section
const { data: ccResult } = useQuery(['consistency', submissionId],
  () => regulatoryWritingApi.getConsistencyCheck(submissionId))
// MSW: GET → consistencyCheckResult.json
const sectionContradictions = ccResult?.contradictions.filter(c =>
  c.sourceSection.includes('2.5.4') || c.targetSection.includes('2.5.4')) ?? []

// Bottom strip counts
const compiled = nodes.filter(n => n.status === 'signed').length          // 47 (of 36 shown — MSW returns subset)
const inAuthoring = nodes.filter(n => n.status === 'in-authoring').length
const autoGen = nodes.filter(n => n.isSystemGenerated).length
```

**Note on Module 5 enforcement:** Clicking any node where `isReadOnly === true` must show the `CTDReadOnlyBanner` and never open the editor. This is the hardest DD-D-001 rule — implement it unconditionally.

---

## Navigation

- "Open in editor →" → navigate to `submissions/${submissionId}/module2-editor` (sD04)
- "Run consistency check ✦" → triggers check (5,000ms simulated), updates contradiction panel
- Module 5 nodes → show CTDReadOnlyBanner only, no navigation to editor

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`

**Pass 2:** `npm run build`

**Pass 3 — 5 smoke tests:**
1. The CTD tree renders all visible nodes. Module 5 nodes (nd-050 through nd-053) show 🔒 grey status. Clicking any Module 5 node shows `CTDReadOnlyBanner` and does not open an editor.
2. Nodes nd-014, nd-018, nd-025 each show an amber ⚠ consistency flag badge next to their status dot.
3. The right panel section detail for nd-018 (2.5.4) shows: AI footprint "51% ✦", cross-references "18 verified ✓ · 2 flagged ⚠", and the HR contradiction card.
4. The bottom strip shows all six counts in IBM Plex Mono. "EXTEDO EXTEDOpulse" is named as the validator.
5. "Run consistency check ✦" shows a 5,000ms loading state, then updates the contradiction panel.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D03-ectd-granularity-map.md and execute.
Build ECTDGranularityMap exactly as specified, run all 3 validation passes, and report results.
```
