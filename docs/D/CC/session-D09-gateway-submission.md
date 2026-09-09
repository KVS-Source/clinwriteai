# Session D09 — Gateway Submission
**Screen:** sD09 · Gateway Submission
**Route:** `/projects/:projectId/regulatory-writing/submissions/:submissionId/gateway`
**Component:** `src/modules/regulatory-writing/screens/GatewaySubmission.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/D/design/aurora-sD09-gateway-submission.html`
**Data:** `src/data/gatewaySubmissions.json`, `src/data/haCorrespondence.json`, `src/data/regulatoryLibraryCards.json`
**Store:** `gatewayStore`

---

## What to Build

Stage 6 — gateway submission and ACK tracking. The `PartElevenConfirm` component is the most critical element: it must expand inline before any transmission API call fires. `confirmingTransmission` boolean in `gatewayStore` gates the call. Primary demo: FDA ACK2 confirmed, EMA pending, MHRA disabled.

---

## Screen Anatomy

Two-column. Left: submission config + transmission (~55%). Right: ACK status + HA correspondence log (~45%).

**Header:** "Gateway Submission · Stage 6", stage dot 6 green (this is the success/approval stage). "View compliance provenance →" link. "Master Library push ✓" green badge (visible since gw-001 `masterLibraryPushedAt` is set).

**Left — Pre-submission checklist:**
Five items all ✓ (derived from prior stages complete in demo):
- eCTD validation passed (Critical: 0, Major: 0) ✓
- PPD/CCI redaction confirmed (55/55) ✓
- All 6 Super Review sign-offs ✓
- e-signature on file — Reg Affairs Lead ✓
- Gateway credentials configured (Admin) ✓
Green "Ready for transmission" banner when all five ✓.

**Left — Submission package summary:**
From `gatewaySubmissions.json` gw-001:
- Dossier: "Veloricept NDA v1.0 · 62 sections · eCTD v3.2.2"
- Package size: "847 MB · 62 document units"
- Hash (IBM Plex Mono truncated): first 8 chars of `gw-001.packageHash`

**Left — Gateway rows:**

**FDA ESG (Priority 1) — Already transmitted:**
Shows gw-001 status (ACK2 confirmed). Transmission button replaced with: "Transmitted · 16 Oct 2026 14:22 UTC · Dr James Hartley" (green, locked). No re-transmit.

**EMA CESP (Priority 2) — Pending:**
Status: "Configured ✓ · Credentials on file"
"Transmit to EMA CESP →" large crimson primary button.
Warning strip: "This action is irreversible. The submission will be logged to the EMA Central Submission Portal."
On click → `gatewayStore.setConfirmingTransmission(true)` → `PartElevenConfirm` component expands inline (not modal):
```
Signatory: Dr James Hartley (read-only)
Role: Regulatory Affairs Lead (read-only)
Meaning: I authorise the transmission of this eCTD package to EMA CESP.
☐ I authorise the transmission of this eCTD package to EMA CESP under EU Regulation 726/2004.
[Confirm & transmit] button
```
Submitting without checkbox: blocked — show inline validation.

**MHRA (Priority 4):**
Status: "UI only — API procurement required before production. OQ-D-008 resolved: include in prototype."
Button: "MHRA — Coming in production" — greyed, disabled. No click action.

**Right — ACK Status Tracker:**
From `gatewaySubmissions.json`:

**FDA ESG (gw-001):**
```
ACK1 ✓  Receipt confirmed · 16 Oct 14:28 UTC · 6 min
ACK2 ✓  Format validation passed · 16 Oct 16:47 UTC · 2h 25m
ACK3 ○  Accepted for review — pending (estimated 31 Oct 2026)
```
Use `GatewayACKTimeline` component.

**EMA CESP (gw-002):**
```
ACK1 ○  Pending transmission
ACK2 ○  Pending
ACK3 ○  Pending
```

**HA Correspondence Log:**
From `haCorrespondence.json` filtered to sub-001, sorted by receivedAt DESC:
- "16 Oct 2026 · ACK2 received · FDA ESG · Auto-parsed ✓"
- "16 Oct 2026 · ACK1 received · FDA ESG · Auto-parsed ✓"
- "16 Oct 2026 14:22 · Submission transmitted · FDA ESG · Dr J. Hartley · e-signature on file"

"Upload incoming HA correspondence →" button (links to sD10).

**Predictive timeline panel:**
Next milestone: "ACK3 from FDA (estimated: 31 Oct 2026 ± 5 business days)"
Linear milestone strip: Transmitted ✓ → ACK1 ✓ → ACK2 ✓ → ACK3 ○ (estimated)

**Master Library push section (visible since ACK2 received):**
Green banner: "ACK2 ✓ — Master Library push unlocked."
From `regulatoryLibraryCards.json`: "5 cards pushed ✓" with each card listed (rlc-001 through rlc-005). Module availability chips: "Regulatory Writing · D" and "Ideation & Publishing · E" per card.

---

## Data Wiring

```typescript
const { records, confirmingTransmission, setConfirmingTransmission, transmit }
  = useGatewayStore()

useEffect(() => {
  gatewayStore.fetchRecords(submissionId)  // → gatewaySubmissions.json
  // filter to sub-001: gw-001 (FDA ACK2), gw-002 (EMA pending)
}, [submissionId])

const handleTransmitEMA = () => {
  if (!confirmingTransmission) {
    setConfirmingTransmission(true)  // expands PartElevenConfirm inline
    return
  }
  // Only fires after PartElevenConfirm checkbox is checked
  transmit(submissionId, 'ema-cesp', { credentialHash: '...', meaning: '...' })
    .then(() => setConfirmingTransmission(false))
}

// ACK2 received check for Master Library push display
const fdaRecord = records.find(r => r.gateway === 'fda-esg')
const ack2Confirmed = fdaRecord?.status === 'ack2' || fdaRecord?.status === 'ack3'
// ack2Confirmed = true for gw-001 → show Master Library section
```

---

## Navigation

- "Upload incoming HA correspondence →" → navigate to `submissions/${submissionId}/ha-response` (sD10)
- "View compliance provenance →" → navigate to `submissions/${submissionId}/final` (sD12)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`

**Pass 2:** `npm run build`

**Pass 3 — 5 smoke tests:**
1. FDA ESG row shows the already-transmitted state (locked, no transmit button). EMA CESP row shows the active "Transmit to EMA CESP →" crimson button. MHRA row shows disabled "Coming in production" greyed button.
2. Clicking "Transmit to EMA CESP →" expands `PartElevenConfirm` inline — the button does NOT fire the API. The expansion shows signatory name (read-only), meaning text, checkbox, and "Confirm & transmit" button. Clicking "Confirm & transmit" without checking the box is blocked.
3. `GatewayACKTimeline` for FDA shows ACK1 ✓ (6 min elapsed), ACK2 ✓ (2h 25m elapsed), ACK3 ○ (estimated 31 Oct). EMA shows all three as ○ pending.
4. HA Correspondence Log shows 3 entries sorted most-recent-first. All entries are auto-parsed from `haCorrespondence.json`.
5. Master Library push section is visible (ACK2 confirmed). Shows "5 cards pushed ✓" with all 5 cards from `regulatoryLibraryCards.json` listed with their module availability chips.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D09-gateway-submission.md and execute.
Build GatewaySubmission exactly as specified, run all 3 validation passes, and report results.
```
