# Session E02 — Artefact Upload & Source Check
**Screen:** sE02 · Artefact Upload & Source Check
**Route:** `/projects/:projectId/ideation-publishing/projects/:ideationProjectId`
**Component:** `src/modules/ideation-publishing/screens/ArtefactUploadSourceCheck.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/E/design/aurora-sE02-artefact-upload-source-check.html`
**Data:** `src/data/ideationProjects.json`, `src/data/ideationArtefacts.json`, `src/data/claimCurrencyCheck.json`
**Store:** `ideationStore`

---

## What to Build

Stage 1 — three sequential checks run on the artefact before content cards can be tagged. Demo shows ip-001 (all checks passed, 90-day bypass active) and ip-003 (blocked at source gate). Primary view: ip-001 with all checks complete.

---

## Screen Anatomy

Two-column. Left: artefact + check results (~55%). Right: source document viewer (read-only, DD-E-001).

**Header:** "Artefact Upload & Source Check · Stage 1", "Proceed to tagging →" button (active for ip-001).

**Left — Artefact panel:**
From `ideationArtefacts.json` `ia-001`:
- "VELORA-301 KOL Advisory Board Summary · v1.0 · Module C · Final Output"
- Source chip: "Module C · Medical Writing · Final Output · Signed 15 Oct 2026"

**Check 1 — Source gate** (sequential — gate must pass before currency checks run):
- Status: `✓ Passed` · green
- "Document status: Final Output in Module C. Source gate passed."
- Master Library source chip: "Pushed to Master Library 15 Oct 2026 · within 90 days"
- "90-day currency check bypass active — source currency check skipped." (teal info note)

**Check 2 — Source currency** (skipped via 90-day rule — show bypassed state):
- Status: `○ Bypassed` · grey
- "Master Library card pushed 15 Oct 2026 — within 90 days. Lightweight currency check not required (FR-E-002 v0.3)."

**Check 3 — Claim currency** (ran after gate passed):
- Status: `⚠ 2 flags` · amber
- "14 claims extracted · 12 current · 1 potentially superseded · 1 conflicting · 0 clean conflicts"
- Claims checked against **SmPC v2.1** §4.1, §4.2, §5.1 and VELORA-301 CSR v1.0
- **Claim 07** (potentially superseded): "Veloricept approved for all NSCLC patients" — SmPC v2.1 §4.1 restricts indication to PD-L1 ≥1%. Acknowledge before proceeding.
- **Claim 11** (conflicting — do not use): "No dose adjustment required in hepatic impairment" — SmPC v2.1 §4.2 now requires dose reduction in moderate hepatic impairment. **This claim is blocked at the claim level — it must not be tagged as a content card.**
- Both flags acknowledged by Ms Priya Nair with resolution notes and timestamps

Note: The design uses **SmPC v2.1** (updated 01 Oct 2026) — not SmPC v1.0 as in earlier session briefs. Update `claimCurrencyCheck.json` to reference SmPC v2.1.
- "14 claims extracted · 12 current · 1 potentially superseded · 0 conflicting"
- Flag row: "cl-004 · PD-L1 subgroup claim — updated label threshold data published 01 Oct 2026."
- Flag acknowledged: "Acknowledged · Ms Priya Nair · 19 Oct 2026 · Current label thresholds confirmed with CMC Lead." (green)
- `ClaimCurrencyBadge` showing `potentially-superseded` (amber) on the flag row

**Source gate check (DD-E-002):** External uploads require explicit Ideation Lead confirmation — ia-002 shows `confirmed-external` state. `claimCurrencyStatus` is set on each content card after the claim currency check runs.

**ip-003 BLOCKED state** (visible when viewing ip-003):
`SourceGateBlock` component — full-width rose block:
- "Source content gate failed"
- "Document status is 'In Authoring' in Module A. Only Signed / Final Output / Submitted documents may enter the ideation pipeline."
- "Proceed to tagging →" button hidden/inactive
- Source currency and claim currency checks do not run (AC-E-021)

**Right panel — Source document (always read-only DD-E-001):**
- Label: "Source document — read-only"
- Document title: "VELORA-301 KOL Advisory Board Summary v1.0"
- Clicking anywhere in the document shows `+` tag affordance — no cursor/edit mode
- No edit controls anywhere on the right panel

---

## Data Wiring

```typescript
const { activeArtefact, sourceGateResult, claimCurrencyResult, runSourceGate, runClaimCurrency }
  = useIdeationStore()

useEffect(() => {
  ideationStore.fetchArtefact(ideationProjectId)  // → ideationArtefacts.json (ia-001 or ia-003)
}, [ideationProjectId])

// ia-001: approvalStatusCheck === 'passed' → gate passed
// ia-003: approvalStatusCheck === 'blocked' → show SourceGateBlock, stop here
const isBlocked = activeArtefact?.approvalStatusCheck === 'blocked'

// 90-day bypass (FR-E-002 v0.3)
const withinNinetyDays = activeArtefact?.withinNinetyDays === true
// ia-001: withinNinetyDays = true → source currency check skipped

// Claim currency from fixture
const claimCheck = claimCurrencyResult
// MSW: GET claimCurrencyCheck.json → 14 claims, 1 potentially-superseded, acknowledged
```

---

## Navigation

- "Proceed to tagging →" → navigate to `tagging` (sE03) — only active when gate passed
- ip-003 blocked → button absent/inactive, no navigation

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Source gate shows "✓ Passed" for ip-001. The "90-day currency check bypass active" teal info note is visible. Source currency shows "○ Bypassed".
2. Claim currency shows "⚠ 1 flag" with "14 claims extracted · 12 current · 1 potentially superseded". The acknowledged note ("Ms Priya Nair · 19 Oct 2026") is visible.
3. `ClaimCurrencyBadge` renders on the cl-004 flag row as amber (potentially-superseded).
4. The right panel source document shows "Source document — read-only" label. No edit controls appear. Clicking the document shows a `+` tag affordance, not a cursor.
5. When viewed for ip-003, `SourceGateBlock` renders full-width with the "In Authoring" reason. Source currency and claim currency check sections do not render.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/E/CC/session-E02-artefact-upload-source-check.md and execute.
Build ArtefactUploadSourceCheck exactly as specified, run all 3 validation passes, and report results.
```
