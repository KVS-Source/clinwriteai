# Session D06 — Super Review
**Screen:** sD06 · Super Review
**Route:** `/projects/:projectId/regulatory-writing/submissions/:submissionId/super-review`
**Component:** `src/modules/regulatory-writing/screens/SuperReview.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/D/design/aurora-sD06-super-review.html`
**Data:** `src/data/superReviewers.json`, `src/data/consistencyCheckResult.json`
**Store:** `superReviewStore`

---

## What to Build

Stage 4 — the multi-disciplinary Super Review. Six RACI roles sign off. The Cross-Module Consistency Report must show all Major contradictions resolved before Stage 5. Most complex workflow gate in Module D.

---

## Screen Anatomy

Three-column layout: Left (~280px) reviewer panel · Centre tabbed content · Right (~300px) gate status.

**Header:** "Super Review · Stage 4 · 2 of 6 signed" status chip (amber). "Submit to Stage 5 →" gated button.

**Left — RACI Sign-off panel:**
Six rows from `superReviewers.json`. Each: avatar initials / name / role / status pill. Use pill colours from fixture data:
- sr-001 Dr Sarah Chen — "✓ Submitted 15 Oct" (green pill)
- sr-002 Dr James Hartley — "✓ Submitted 14 Oct" (green pill)
- sr-003 Dr Elena Vasquez — "○ In progress" (amber pill)
- sr-004 Dr Rebecca Morton — "○ Not yet" (amber pill)
- sr-005 Dr Arjun Patel — "○ Not yet" (amber pill)
- sr-006 Mr David Chen — "○ Not yet" (crimson border pill — eCTD Specialist avatar)

Sub-label: "2 of 6 signed · waiting for Dr Vasquez, Dr Morton, Dr Patel, Mr Chen"
"E-signature (21 CFR Part 11) required for final sign-off." The sign-off action uses the `PartElevenConfirm` component — same inline expansion pattern as sD09 gateway transmission.

**Centre — 3 tabs: Consistency Report · Safety Report · Comments**

**Tab 1 — Consistency Report (default):**
Header: "Cross-Module Consistency Report · 2 contradictions · Last run: 15 Oct 2026 09:18 UTC · claude-sonnet-4-6 · Logged to audit trail" + "Run again ✦" amber button.

Two `ConsistencyContradictionCard` components from `consistencyCheckResult.json`:

**con-001 — Major — RESOLVED:**
- Steel blue `#005F8E` left border (Major blocking colour — not red per design rule 1)
- "2.5.4 Clinical Overview vs Module 5 · Table 14.2.1"
- Source: "HR: 0.61 (Module 2.5.4, final analysis)"
- Target: "HR: 0.63 (Module 5 Table 14.2.1, interim analysis)"
- Resolution note displayed: `con-001.resolutionNote` (the full text from fixture)
- Green "✓ Resolved · Dr S. Chen · 15 Oct 2026" badge

**con-002 — Minor — UNRESOLVED:**
- Amber left border
- "2.7.2.1 Clinical Summary vs Module 5 · Table 14.2.2"
- Source: "Median PFS: 9.7 months"
- Target: "Median PFS: 9.4 months (interim)"
- Resolution field: empty text input + "Resolve ✓" button
- No resolved badge

Gate status: "1 Major resolved ✓ · 1 Minor unresolved — Super Review can proceed to Stage 5 (Minor contradictions do not block, but must be noted)."

**Note on gate:** In demo data, con-001 (Major) is resolved. con-002 is Minor and does not block Stage 5. "Submit to Stage 5 →" is blocked only because 4 of 6 reviewers have not signed — not because of contradictions.

**Tab 2 — Safety Report:**
PSUR/PBRER draft section. AI badge + footprint. "PV Lead verification required: Dr Rebecca Morton ○ pending."

**Tab 3 — Comments:**
Two comment rows:
- "REG-D-001 · Dr Vasquez · Clinical Lead · 14 Oct: HR discrepancy in §2.5.4 — confirm which analysis version is cited."
- "REG-D-002 · Dr Hartley · Reg Affairs · 15 Oct: Cover letter for FDA needs updated submission date — 15 Jan 2027 not 01 Jan."

**Right — Gate Status panel:**
Dossier completeness: "62 sections · 47 compiled ✓" with crimson progress bar at 76%.
Gate checklist:
- All 6 RACI roles signed ✗ (2/6) — red `#005F8E` dot
- All Major contradictions resolved ✓ (1/1)
- All Minor noted or resolved ✗ (0/1)
- PV Lead PSUR sign-off ✗ (pending)

"Submit to Stage 5 →" shows sub-label: "4 of 5 gate items unmet — 4 reviewers still pending."

---

## Data Wiring

```typescript
const { reviewers, activeTab, setActiveTab, signOff, runConsistencyCheck }
  = useSuperReviewStore()

useEffect(() => {
  superReviewStore.fetchReviewers(submissionId)   // → superReviewers.json
  superReviewStore.fetchConsistency(submissionId) // → consistencyCheckResult.json
}, [submissionId])

// Gate logic (DD-D-002)
const allSigned = reviewers.every(r => !!r.signedAt)  // false — 4 unsigned
const unresolvedMajor = contradictions.filter(c => c.severity === 'major' && !c.resolved).length // 0
const canSubmit = allSigned && unresolvedMajor === 0
// In demo: canSubmit = false (allSigned = false)

// "Submit to Stage 5 →"
// When clicked: only fires if canSubmit === true
// Blocked state shows specific reason
```

---

## Navigation

- "Submit to Stage 5 →" (when gate passes) → advance stage → navigate to `submissions/${submissionId}/publishing` (sD07)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`

**Pass 2:** `npm run build`

**Pass 3 — 5 smoke tests:**
1. Left panel shows exactly 6 RACI reviewer rows. sr-001 and sr-002 show green pills. sr-003, sr-004, sr-005, sr-006 show pending/amber pills. Sub-label reads "2 of 6 signed".
2. con-001 `ConsistencyContradictionCard` has steel blue `#005F8E` left border (not red) and shows the full resolution note + green "✓ Resolved" badge.
3. con-002 shows amber left border with an empty resolution note input field and "Resolve ✓" button.
4. Right gate panel shows 4 of 5 gate items unmet. "Submit to Stage 5 →" is inactive.
5. "Run again ✦" consistency check button shows 5,000ms loading state then updates the report header timestamp.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D06-super-review.md and execute.
Build SuperReview exactly as specified, run all 3 validation passes, and report results.
```
