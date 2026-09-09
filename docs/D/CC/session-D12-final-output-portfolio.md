# Session D12 — Final Output & Portfolio
**Screen:** sD12 · Final Output & Portfolio
**Route:** `/projects/:projectId/regulatory-writing/submissions/:submissionId/final`
**Component:** `src/modules/regulatory-writing/screens/FinalOutputPortfolio.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/D/design/aurora-sD12-final-output-portfolio.html`
**Data:** `src/data/regulatorySubmissions.json`, `src/data/gatewaySubmissions.json`, `src/data/regulatoryLibraryCards.json`, `src/data/oddAssessment.json`
**Store:** `regulatorySubmissionStore`, `gatewayStore`

---

## What to Build

Two-tab screen: (1) Final Output — the compliance provenance record for VELORA-301 NDA (ACK2 confirmed), Master Library push confirmation, predictive timeline. (2) Submission Portfolio — cross-project kanban of all three submissions, plus the Orphan Drug Eligibility Tool panel for AURELIA-101.

---

## Screen Anatomy

Top-level tab toggle: "Final Output" (default) / "Submission Portfolio"

---

## TAB 1 — Final Output

**ACK banner (green, full-width):**
"ACK2 ✓ — Format validation passed. FDA ESG accepted the submission package. Estimated review period: 10 months (PDUFA date: 16 Aug 2027)." — from `gatewaySubmissions.json` gw-001.ack2At.

**Left column (~55%):**

**Submission Record:**
From sub-001 and gw-001:
- "Veloricept NDA v1.0 · 62 sections · eCTD v3.2.2 · 847 MB"
- "Reg Affairs Lead e-signature: Dr James Hartley · 16 Oct 2026 14:22 UTC · 21 CFR Part 11 compliant" — from gw-001.partEleven
- "Download submission package (.zip)" crimson button
- "View eCTD package →" link

**Compliance Provenance Chain (fully visible without interaction):**
```
Module A — Clinical Writing (Source)
  VELORA-301 CSR v1.0 · Signed 28 Oct 2026
  IB v3.0 · Signed 15 Sept 2026
  847 canonical JSON data points extracted

Module D — Regulatory Writing (Submission)
  Stage 1 briefing — 01 Oct 2026 · Dr S. Chen
  Stage 2 Module 2 authoring — 01–15 Oct 2026
  Stage 3 CMC/Nonclinical finalisation — 14 Oct 2026
  Stage 4 Super Review — 15 Oct 2026 · 2 of 6 roles signed (partial)
  Stage 5 eCTD validation passed — 15 Oct 2026 · EXTEDO ✓
  Stage 6 Transmitted — 16 Oct 2026 14:22 UTC · FDA ESG

Regulatory Frameworks Applied:
  21 CFR Part 11 / 21 CFR Part 314 / ICH M4E(R2) / ICH E2C(R2)
  EMA Regulation 726/2004 / GDPR (EU) 2016/679 / eCTD v3.2.2
```
This chain must be fully visible without any click or expand action.

**Regulatory Disclaimer row (neutral grey):**
"Aurora regulatory disclaimer is included as page 1 of all exported PDFs and is recorded in the distribution package."

**Right column (~45%):**

**Master Library push confirmation:**
From `regulatoryLibraryCards.json` (5 cards). "5 cards pushed ✓" green badge.
Each of rlc-001 through rlc-005 listed with: card type chip, name, tags, module availability chips ("Regulatory Writing · D", "Ideation & Publishing · E").

**Predictive timeline:**
From gw-001:
- ✓ Transmitted: 16 Oct 2026
- ✓ ACK1: 16 Oct 2026 (6 min)
- ✓ ACK2: 16 Oct 2026 (2h 25m)
- ○ ACK3: estimated 31 Oct 2026
- ○ PDUFA date: estimated 16 Aug 2027

PDUFA date is the most prominent item — bold, large text.

---

## TAB 2 — Submission Portfolio

**Header:** "Submission Portfolio" with "Export compliance report" crimson button. TA filter + submission type filter.

**Kanban (four lanes):**
From `regulatorySubmissions.json` — map each submission to lane:
- Authoring (Stage 1–3): none in demo
- Super Review (Stage 4): sub-002 VELORA-301 PSUR — amber chip "3/6 roles signed" (use `raciSignedCount` field)
- Publishing (Stage 5): none in demo
- Submitted / Approved: sub-001 VELORA-301 NDA — green "ACK2 ✓ · FDA + EMA (pending)" / sub-003 AURELIA-101 IND — green "ACK3 ✓ · EMA CESP · 12 Oct"

Card lane mapping: `status === 'super-review'` → Super Review · `status === 'submitted'` → Submitted · `status === 'module2-authoring'` → Authoring.

**Orphan Drug Eligibility Tool (right sidebar):**
From `oddAssessment.json`:
Header: "Orphan Drug Designation (ODD) Eligibility Tool" — spell out full name on first use.
- "AURELIA-101 · Cardiometabolic · Assessment 18 Oct 2026"
- EU: "3.2 per 10,000 ✓ (threshold: ≤5 per 10,000)" — green
- US: "~178,000 patients ✓ (threshold: <200,000)" — green
- Eligibility score: "84% — Likely eligible for ODD" — `oddAssessment.eligibilityScore`
- Medical plausibility: "Significant benefit draft — pending Clinical Lead sign-off" — `oddAssessment.benefitDraftStatus`
- "View full ODD assessment →" link

---

## Data Wiring

```typescript
const { submissions } = useRegulatorySubmissionStore()
const { records: gwRecords } = useGatewayStore()

// Sub-001 FDA ACK2 record
const fdaRecord = gwRecords.find(r => r.submissionId === 'sub-001' && r.gateway === 'fda-esg')
// fdaRecord.status === 'ack2' → show ACK2 banner

const { data: libCards } = useQuery(['reg-library', submissionId],
  () => regulatoryWritingApi.getLibraryCards(submissionId))
// → regulatoryLibraryCards.json (5 cards)

// ODD assessment
const { data: oddData } = useQuery(['odd', 'sub-003'],
  () => regulatoryWritingApi.getODDAssessment('sub-003'))
// → oddAssessment.json

// Portfolio kanban mapping
const kanbanLanes = {
  authoring:   submissions.filter(s => ['source-gathering','module2-authoring','finalisation'].includes(s.status)),
  superReview: submissions.filter(s => s.status === 'super-review'),
  publishing:  submissions.filter(s => s.status === 'publishing'),
  submitted:   submissions.filter(s => s.status === 'submitted'),
}
```

---

## Navigation

- All navigation read-only. Breadcrumb back to sD01.

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`

**Pass 2:** `npm run build`

**Pass 3 — 5 smoke tests:**
1. Final Output tab shows the ACK2 green banner with PDUFA date (16 Aug 2027) prominently displayed in the predictive timeline.
2. The Compliance Provenance Chain is fully visible without any interaction. Six Module D stage milestones are listed below the Module A source section.
3. Master Library section shows "5 cards pushed ✓" and lists all 5 cards from `regulatoryLibraryCards.json` with their module availability chips.
4. Submission Portfolio tab: sub-002 (PSUR) appears in Super Review lane with "3/6 roles signed" amber chip. sub-001 and sub-003 appear in Submitted lane.
5. Orphan Drug Eligibility Tool shows "Orphan Drug Designation (ODD) Eligibility Tool" as the header (full name, not abbreviated). EU and US thresholds both shown as ✓ with 84% eligibility score.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D12-final-output-portfolio.md and execute.
Build FinalOutputPortfolio exactly as specified, run all 3 validation passes, and report results.
This is the final Module D screen — confirm that npm run build passes clean for the complete module after D12.
```
