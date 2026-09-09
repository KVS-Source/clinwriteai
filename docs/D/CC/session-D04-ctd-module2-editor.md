# Session D04 — CTD Module 2 Editor
**Screen:** sD04 · CTD Module 2 Editor
**Route:** `/projects/:projectId/regulatory-writing/submissions/:submissionId/module2-editor`
**Component:** `src/modules/regulatory-writing/screens/CTDModule2Editor.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/D/design/aurora-sD04-ctd-module2-editor.html`
**Data:** `src/data/ectdGranularityMap.json`, `src/data/consistencyCheckResult.json`
**Store:** `regulatorySubmissionStore`, `ectdStore`

---

## What to Build

Stage 2 — the primary CTD Module 2 authoring editor. Three-panel layout identical in structure to Module C Content Editor (sC04) but with: canonical JSON source citations on every AI suggestion, a data objectivity checker (purple dashed underline — unique to Module D), a cross-reference tab, and a consistency check tab. Active section: 2.5.4 Overview of Efficacy. Primary demo submission: sub-001 VELORA-301 NDA.

---

## Screen Anatomy

Three panels: Left navigator (~240px) · Centre canvas · Right tabs (~320px).

**Header bar:**
- Breadcrumb: Regulatory Writing / Veloricept NDA / CTD Module 2 Editor
- Source chip (blue-grey): "Drafted from: VELORA-301 CSR v1.0 · Module A"
- AI footprint chip (crimson `#FFF5F5`): "AI footprint · 51% ✦" — persistent, updates on accept/discard
- "Run consistency check ✦" button (amber)
- "Submit for Super Review →" (crimson primary — gated: disabled if unresolved Major contradictions)

**Left — Section navigator:**
CTD Module 2 sections from `ectdGranularityMap.json`. Status dot per node. Active: nd-018 (2.5.4, ● crimson). Nodes 2.1 and 2.2 show ◉ system-generated indicator — clicking shows "System-generated — not editable" inline message. DD-D-001: Module 5 nodes must remain read-only at all times even from within the Module 2 editor — no section in Module 5 is accessible for editing from this screen. nd-018 and nd-025 show amber ⚠ consistency flag.

**Centre — Document canvas (section 2.5.4):**

Two content block types:

**AI-generated block** (crimson tint `#FFF5F5` background):
> "Veloricept plus pembrolizumab demonstrated statistically significant improvement in progression-free survival (hazard ratio 0.61; 95% CI 0.48–0.77; p<0.001) [Source: VELORA-301 CSR v1.0 · Table 14.2.1]."
> Inline source citation chip: "CSR v1.0 · Table 14.2.1" in IBM Plex Mono.
> Amber consistency underline on "hazard ratio 0.61" — tooltip: "⚠ Consistency flag: Module 5 Table 14.2.1 shows 0.63 in the interim analysis. Verify source version."

**Data objectivity flag** (purple dashed underline — `DataObjectivityFlag` component):
On text: "These results establish veloricept as a best-in-class treatment option."
Tooltip: "⚠ Data objectivity check: comparative superlative — 'best-in-class' requires substantiated head-to-head evidence. PRD v4.1 §12.4 Rule 1. Suggested: 'These results demonstrate a clinically meaningful improvement in PFS.'"

**Human-authored block** (white background — no tint):
"The clinical benefit was consistent across all pre-specified subgroups including PD-L1 expression and histology (Section 2.7.3.3)."
Cross-reference chip: "→ 2.7.3.3 ✓ verified" (green).

**Right panel — 4 tabs:**

**Tab 1 — AI Suggest ✦:**
Suggestion card: "Suggested addition · Section 2.5.5 Safety Overview". Text with two source citation chips. Attribution line IBM Plex Mono: "Generated [timestamp] UTC · claude-sonnet-4-6 · Logged to audit trail". AI footprint note. Actions: "Accept ✓" / "Discard ✗" / "Suggest again ✦".

**Tab 2 — Cross-Ref:**
From `ectdGranularityMap.json` cross-reference data for active section:
- "→ 2.7.3.3 ✓ verified"
- "→ Module 5 · Table 14.2.1 ⚠ — check version (0.61 vs 0.63)"
- "→ Module 5 · Figure 14.2.1-1 ✓ verified"
"Run full cross-module check ✦" link at bottom.

**Tab 3 — Consistency:**
From `consistencyCheckResult.json`: "Last run: 15 Oct 2026 09:18 UTC · 2 contradictions found". Two contradiction cards using `ConsistencyContradictionCard` component. con-001: green resolved indicator. con-002: amber unresolved, resolution note field visible.

**Tab 4 — Audit:**
IBM Plex Mono small, last 3 events:
- "09:22 UTC · AI suggestion accepted · Section 2.5.4 · Dr S. Chen"
- "09:18 UTC · Consistency check run · 2 contradictions · Logged"
- "09:10 UTC · Section opened for editing · Dr S. Chen"

---

## Data Wiring

```typescript
// Active node from store
const { nodes, selectedNodeId } = useEctdStore()
const activeNode = nodes.find(n => n.id === (selectedNodeId ?? 'nd-018'))

// System-generated guard
const handleNavClick = (node: ECTDGranularityNode) => {
  if (node.isSystemGenerated) {
    showInlineMessage('System-generated — not editable')
    return
  }
  selectNode(node.id)
}

// Consistency result
const { data: ccResult } = useQuery(['consistency', submissionId],
  () => regulatoryWritingApi.getConsistencyCheck(submissionId))
// → consistencyCheckResult.json

// Submit for Super Review gate (DD-D-002)
const unresolvedMajor = ccResult?.contradictions
  .filter(c => c.severity === 'major' && !c.resolved).length ?? 0
const canSubmitSuper = unresolvedMajor === 0
// "Submit for Super Review →" disabled when canSubmitSuper === false
// Sub-label when blocked: "Resolve 1 Major contradiction before Super Review"
// In demo data: con-001 resolved ✓, con-002 minor unresolved → canSubmitSuper = true (no Major unresolved)
```

---

## Navigation

- Section navigator → `selectNode(id)` — stays on this screen
- "Submit for Super Review →" → advance stage → navigate to `super-review` (sD06)
- System-generated node click → inline message, no navigation

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`

**Pass 2:** `npm run build`

**Pass 3 — 5 smoke tests:**
1. AI-generated paragraph shows crimson tint background `#FFF5F5`. Human-authored paragraph has white background. Both in the same canvas view.
2. "hazard ratio 0.61" has an amber underline with tooltip referencing the 0.63 interim value. The `DataObjectivityFlag` purple dashed underline appears on the "best-in-class" phrase.
3. Source citation chip "CSR v1.0 · Table 14.2.1" renders inline in IBM Plex Mono within the AI-generated paragraph.
4. Consistency tab shows con-001 with green resolved indicator and con-002 with amber unresolved + empty resolution note field.
5. Clicking the 2.1 or 2.2 section in the navigator shows "System-generated — not editable" inline message and does not load the section for editing.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D04-ctd-module2-editor.md and execute.
Build CTDModule2Editor exactly as specified, run all 3 validation passes, and report results.
```
