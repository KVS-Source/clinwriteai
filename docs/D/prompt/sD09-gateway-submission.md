# CD Prompt — sD09 Gateway Submission
**Module:** D — Regulatory Writing · Crimson `#B0200D`  
**PRD refs:** FR-D-021, FR-D-023, FR-D-025, FR-D-027  
**Screen code:** sD09  
**Output file:** `aurora-sD09-gateway-submission.html`

---

## Screen Purpose

Stage 6 — the regulatory gateway submission screen. The Regulatory Affairs Lead and eCTD Specialist transmit the validated eCTD package to FDA ESG and/or EMA CESP, track ACK receipts, and monitor submission status. The most consequential action in the entire platform — submitting to a health authority.

---

## Layout

Two-column layout. Left: submission configuration and transmission (~55%). Right: ACK status tracker + HA correspondence log (~45%).

**Header:** "Gateway Submission · Stage 6" breadcrumb, stage dot 6 active (green — this is the success/approval stage, not crimson), "Master Library push ✓" badge (appears after ACK2), "View compliance provenance →" link.

---

## Left Column — Submission Configuration & Transmission

**Pre-submission checklist (top):**
All items must show ✓ before transmission:
- eCTD validation passed (Critical: 0, Major: 0) ✓
- PPD/CCI redaction confirmed (55/55) ✓
- All 6 Super Review sign-offs ✓
- e-signature on file — Reg Affairs Lead ✓
- Gateway credentials configured (Admin) ✓

Green "Ready for transmission" banner when all five ✓.

**Submission package summary:**
- Dossier: "Veloricept NDA v1.0 · 62 sections · eCTD v3.2.2"
- Submission type: "NDA/MAA · FDA (Priority 1) + EMA (Priority 2)"
- Package size: "847 MB · 62 document units"
- Hash (SHA-256): "a3f7c...d419" (IBM Plex Mono, truncated)

**Gateway selector (two rows):**

**Gateway 1 — FDA ESG (Priority 1):**
- Status: "Configured ✓ · Credentials on file (Admin)"
- "Transmit to FDA ESG →" large crimson primary button
- Warning: "This action is irreversible. The submission will be logged to the FDA Electronic Submissions Gateway. All transmission events are recorded in the immutable audit trail."
- After click → inline 21 CFR Part 11 confirmation (same pattern as Module C MLR decision):
  - Signatory: "Dr James Hartley · Reg Affairs Lead"
  - Meaning: "I authorise the transmission of this eCTD package to FDA ESG under 21 CFR Part 312/314."
  - Checkbox + "Confirm & transmit" button

**Gateway 2 — EMA CESP (Priority 2):**
- Status: "Configured ✓ · Credentials on file"
- "Transmit to EMA CESP →" (crimson, secondary priority — slightly smaller than FDA button)
- Same confirmation flow

**Gateway 3 — MHRA (Priority 4):**
- Status: "UI only — API procurement required before production. OQ-D-008 resolved: include in prototype."
- Button: "MHRA — Coming in production" (greyed, disabled)

---

## Right Column — ACK Status Tracker

**ACK receipt timeline (vertical):**

FDA ESG (transmitted 16 Oct 2026 14:22 UTC):
```
ACK1 ✓  Receipt confirmed · 16 Oct 14:28 UTC · 6 min
ACK2 ✓  Format validation passed · 16 Oct 16:47 UTC · 2h 25m
ACK3 ○  Accepted for review — pending (estimated 5–15 business days)
```

EMA CESP (not yet transmitted):
```
ACK1 ○  Pending transmission
ACK2 ○  Pending
ACK3 ○  Pending
```

Each ACK step: timestamp, elapsed time since transmission, and an event log icon.

**HA Correspondence Log (FR-D-023):**
Header: "HA Correspondence · Veloricept NDA"

Timeline (most recent first):
- "16 Oct 2026 · ACK2 received · FDA ESG · Format validation passed · Auto-parsed ✓"
- "16 Oct 2026 · ACK1 received · FDA ESG · Receipt confirmed · Auto-parsed ✓"
- "16 Oct 2026 14:22 · Submission transmitted · FDA ESG · Dr J. Hartley · e-signature on file"

"Upload incoming HA correspondence →" button (for Day 80/120/180 LoQ responses — links to sD10).

**Predictive timeline panel (FR-D-023):**
"Estimated submission readiness: Complete ✓"
"Next milestone: ACK3 from FDA (estimated: 31 Oct 2026 ± 5 business days)"
Small milestone calendar strip showing: Transmitted → ACK1 → ACK2 → ACK3 (estimated).

---

## After ACK2 — Master Library Push

After ACK2 confirmed, a green banner appears:
"ACK2 received ✓ — Dossier accepted for format review. Master Library push unlocked."

Master Library push summary (FR-D-027):
Cards to be pushed: CTD Module 2.5 (Clinical Overview) / CTD Module 2.7 (Clinical Summary) / Approved SmPC v1.0 / RMP Core Document / HA Response Templates
"Push [5] cards to Master Library →" button → triggers push, then shows "5 cards pushed ✓" with module chip "Available in: Regulatory Writing · D / Ideation & Publishing · E"

---

## Design Notes

- The transmission buttons are the highest-stakes action in the platform. They must feel consequential — use the full inline Part 11 confirmation step, not a simple "are you sure" modal.
- ACK1/2/3 status uses a clear timeline with elapsed times — regulatory teams track these obsessively. Elapsed time since transmission is critical information.
- The MHRA row must be present but clearly disabled — showing it demonstrates the feature scope even without a live API.
- The "irreversible action" warning before transmission should use neutral/informational language (steel blue info strip), not alarming red — the action is correct, not an error.
