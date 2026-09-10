# Session E09 — Final Output & Publishing Record
**Screen:** sE09 · Final Output & Publishing Record
**Route:** `/projects/:projectId/ideation-publishing/projects/:ideationProjectId/final`
**Component:** `src/modules/ideation-publishing/screens/FinalOutputPublishingRecord.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/E/design/aurora-sE09-final-output-publishing-record.html`
**Data:** `src/data/ideationProjects.json`, `src/data/ideationContentCards.json`
**Store:** `ideationStore`

---

## What to Build

Final output record for ip-001 — all cards approved, publishing status summary, Master Library push record, provenance chain, and a link to the standards/metadata screen (sE10).

---

## Screen Anatomy

Single column with right sidebar.

**Header:** "Final output · completed **28 Oct 2026**" · Ms Priya Nair · Ideation Lead, "Export record →" secondary button.

**Main — Project summary:**
From `ideationProjects.json` ip-001:
- Status: `Approved` · teal badge
- TA: `Oncology`
- Compound: `Veloricept + Pembrolizumab`
- MA approval: "MA approved · Dr Rebecca Morton · 22 Oct 2026 11:45 UTC"
- "3 of 3 cards approved"

**Content card summary (3 rows):**

| Card | Channels | Published | Status |
|------|----------|-----------|--------|
| Primary PFS Efficacy | LinkedIn · Blog · HCP · Email | 2 published | ✓ Approved |
| Safety Profile | HCP · Medical Affairs | 0 published | ✓ Approved |
| Subgroup Consistency | LinkedIn · HCP | 0 published | ✓ Approved |

Each row shows `ProvenanceChip` without interaction.
c-003 shows amber `ClaimCurrencyBadge` (potentially-superseded).

**Master Library push record:**
From `ideationProjects.json` ip-001 (approval shows push is available):
"5 cards pushed to Master Library → from Module D" (shown as reference from Module D's push)
"Master Library push available from this project" — teal button "Push approved cards →"

**Compliance provenance section:**
- Source: "VELORA-301 KOL Advisory Board Summary v1.0 · Module C · Final Output"
- Source gate: "✓ Passed · 18 Oct 2026"
- Claim currency: "⚠ 1 flag acknowledged · 19 Oct 2026"
- KOL review: "✓ Prof. James Hartley · 18 Oct 2026 14:32 UTC"
- MA approval: "✓ Dr Rebecca Morton · 19 Oct 2026 16:41 UTC"
- "All events above are logged to the 21 CFR Part 11 compliant platform audit trail. The KOL and Medical Affairs sign-offs are **digital approval stamps**, not full Part 11 e-signatures, per the Ideation & Publishing compliance posture."

"This record is immutable. All events were written at the time of the action."

**Standards bridge (from sE09 design):**
"**C-002** blog post qualifies as a long-form article and is eligible for DOI registration, Dublin Core tagging and a WCAG 2.1 AA output check. Open standards & metadata for C-002 →" — this link navigates to sE10 with C-002 pre-selected. CC must wire this navigation.

**Sidebar — Quick links:**
- "View content calendar →" → sE07
- "View publishing monitor →" → sE08
- "Standards & metadata →" → sE10

---

## Content Card Details

From `ideationContentCards.json` for ip-001 — three cards:
- `c-001` Primary PFS Efficacy Result — approved · channels: LinkedIn, Blog, HCP, Email · provenance: KOL Summary §3.2 → CSR v1.0 Table 14.2.1 → Module A
- `c-002` Safety Profile — approved · channels: HCP, Medical Affairs · provenance: KOL Summary §4.1 → CSR v1.0 Table 12.2.4 → Module A
- `c-003` Subgroup Consistency — approved · amber `ClaimCurrencyBadge` (potentially-superseded) · channels: LinkedIn, HCP · provenance: KOL Summary §3.4 → CSR v1.0 Table 14.2.7.1 → Module A

All three show `ProvenanceChip` without interaction. c-003 shows amber badge alongside its approved status.

## Data Wiring

```typescript
const { activeProject, cards } = useIdeationStore()

// ip-001 from ideationProjects.json
// ip-001.status === 'approved'
// ip-001.maApprovedAt = '2026-10-22T11:45:00Z'
// ip-001.approvedCardCount = 3

// Cards for ip-001
const projectCards = cards.filter(c => c.ideationProjectId === 'ip-001')
```

---

## Navigation

- "Standards & metadata →" → navigate to `standards` (sE10)
- "View content calendar →" → navigate to `calendar` (sE07)
- "View publishing monitor →" → navigate to `publishing` (sE08)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Header shows "Final Output · VELORA-301 Efficacy Communications" with teal Approved badge.
2. MA approval stamp shows "Dr Rebecca Morton · 22 Oct 2026 11:45 UTC".
3. All 3 cards are listed with ✓ Approved status. `ProvenanceChip` visible without interaction on each.
4. c-003 shows amber `ClaimCurrencyBadge` alongside its approved status.
5. Compliance provenance section shows all 4 steps in order: source gate ✓ → claim currency ⚠ acknowledged → KOL ✓ → MA ✓. Immutability note present.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/E/CC/session-E09-final-output-publishing-record.md and execute.
Build FinalOutputPublishingRecord exactly as specified, run all 3 validation passes, and report results.
```
