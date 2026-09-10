# Session E06 — Medical Affairs Approval
**Screen:** sE06 · Medical Affairs Approval
**Route:** `/projects/:projectId/ideation-publishing/projects/:ideationProjectId/ma-approval`
**Component:** `src/modules/ideation-publishing/screens/MedicalAffairsApproval.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/E/design/aurora-sE06-medical-affairs-approval.html`
**Data:** `src/data/ideationContentCards.json`, `src/data/kolContacts.json`
**Store:** `ideationStore`

---

## What to Build

Stage 4 — Medical Affairs Team Lead reviews KOL decisions and signs off all approved cards. Shows the KOL comment on c-003 alongside the Ideation Lead's resolution. Digital approval stamp — NOT a 21 CFR Part 11 e-signature (AC-E-011).

---

## Screen Anatomy

Two-column. Left: card list with KOL + MA status (~380px). Right: active card detail.

**Header:** "Medical Affairs Approval · Stage 4", "Approve all →" button (teal primary, active when all KOL decisions received).

**Left — Card list:**

All 3 cards show `ProvenanceChip` without interaction.

**c-001:** KOL `✓ Approved` (green) · MA `✓ Approved` (teal) · No comment
**c-002:** KOL `✓ Approved` (green) · MA `✓ Approved` (teal) · No comment
**c-003:** KOL `✓ Approved` (green, with comment icon) · MA `✓ Approved` (teal)

**Right — c-003 detail (selected — shows the KOL modification trail):**

KOL review section:
- "Prof. James Hartley · Professor of Oncology · Approved · 18 Oct 2026 14:32 UTC"
- KOL comment: "PD-L1 subgroup language — please ensure consistency with current ESMO guidelines."
  (from `kolContacts.json`.reviewDecisions[2].comment)

Ideation Lead resolution (AC-E-010 — must be visible to MA Lead):
- "Resolved by Ms Priya Nair (Ideation Lead) · 21 Oct 2026"
- "Current label thresholds confirmed with CMC Lead. Subgroup claim consistent with approved SmPC v1.0."

MA approval strip:
- "Dr Rebecca Morton · MA Team Lead · Digital approval stamp (not a regulatory e-signature)"
- "Approved · 19 Oct 2026 16:41 UTC"
- Note: "This is a digital approval record, not a regulatory e-signature." (AC-E-011)

`ProvenanceChip` on c-003: "Source: KOL Summary §3.4 → CSR v1.0 · Table 14.2.7.1 → Module A"
`ClaimCurrencyBadge` amber (potentially-superseded) still visible on c-003.

---

## Data Wiring

```typescript
const { cards } = useIdeationStore()
const [selectedCardId, setSelectedCardId] = useState('c-003')  // default to c-003 to show KOL comment

// KOL decisions from kolContacts.json
const kolDecisions = kolContact.reviewDecisions  // [{cardId, decision, comment}]

// MA approval (already done in demo — maApprovedAt is set in ideationProjects.json)
const maApproved = project.maApprovedAt != null
// ip-001.maApprovedAt = '2026-10-22T11:45:00Z' → show approved state

// MA sign-off action (not 21 CFR Part 11)
const handleMAApprove = (cardIds: string[]) =>
  ideationPublishingApi.maApprove(ideationProjectId, cardIds)
// MSW: POST /api/ideation/ip-001/ma/approve
// Returns updated project with status: 'approved'
```

---

## Navigation

- "Approve all →" (when all approved) → advance to approved state → "Proceed to calendar →" link (sE07)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. **KOL outcome: 2 approved + 1 modification requested** (not all 3 approved). The header shows: "Prof. James Hartley · 18 Oct 2026 14:32 UTC · 2 approved · 1 modification requested". The modification requested card must show the KOL comment and the revision request flow alongside the MA approval. The "Approve all →" button is active (or shows "All approved" completed state since ip-001 is already approved).
2. c-003 right panel shows the KOL comment text in full: "PD-L1 subgroup language — please ensure consistency with current ESMO guidelines."
3. The Ideation Lead resolution is visible below the KOL comment: "Resolved by Ms Priya Nair · 21 Oct 2026."
4. The MA approval note reads "This is a digital approval record, not a regulatory e-signature." (AC-E-011).
5. `ProvenanceChip` is visible on all 3 cards without any interaction.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/E/CC/session-E06-medical-affairs-approval.md and execute.
Build MedicalAffairsApproval exactly as specified, run all 3 validation passes, and report results.
```
