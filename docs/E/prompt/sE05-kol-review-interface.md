# CD Prompt — sE05 KOL Review Interface
**Module:** E — Ideation & Publishing · Steel Blue `#005F8E`
**PRD refs:** FR-E-010, FR-E-011, FR-E-020
**Screen code:** sE05
**Output file:** `aurora-sE05-kol-review-interface.html`

---

## Screen Purpose

Stage 2–3 (Under Review → Reviewed) — the KOL reviewer's interface. Accessed via a secure one-time email link sent to the KOL. The KOL sees each content card alongside its source provenance and claim currency status, then approves, rejects, or requests modification per section.

---

## Layout

Simplified layout — the KOL is an external guest, not an Aurora user. The review interface is clean and uncluttered. No sidebar nav, no module chrome. Steel blue accent only.

**Top bar:** Aurora wordmark (left) + "KOL Review — Secure Session · Prof. James Hartley · VELORA-301 · Oncology" (centre) + "Review expires: 20 Oct 2026 · 7 days" (right, amber if <48h remaining).

**Progress indicator:** "Reviewing 3 content cards · 0 approved · 0 rejected · 3 pending"

---

## Main Content Area — Card-by-Card Review

One card at a time, with Previous/Next navigation.

**Card 1 of 3 — Efficacy Claim · LinkedIn Adaptation**

**Source provenance panel (top, read-only, steel blue left border):**
- "Source document: VELORA-301 KOL Session Summary · MLR Approved 20 Oct 2026 · Module C"
- "Original passage: §3.2 Efficacy Review — 'Veloricept plus pembrolizumab demonstrated clinically meaningful improvement in progression-free survival...'"
- "Claim currency: ✓ Current — supported by SmPC v2.1 §5.1"
- "Claim provenance: CSR v1.0 Table 14.2.1 → Module A"

**Content card (centre, editable view):**
Channel: "LinkedIn"
Content (read-only for KOL — review only, KOL cannot edit):
> "New data from the VELORA-301 Phase III trial reinforces the clinical benefit of combining veloricept with pembrolizumab in first-line advanced NSCLC. The hazard ratio of 0.61 across all PD-L1 subgroups supports a broad patient population benefit. Full data published in NEJM. #Oncology #NSCLC"

AI footprint indicator: "✦ AI-assisted adaptation" (small, steel blue-tinted chip)

**KOL Decision panel (below card):**
Three action buttons:
- "✓ Approve this section" (steel blue primary)
- "⟳ Request modification" (amber secondary — opens comment field)
- "✗ Reject this section" (neutral secondary — opens reason field)

When "Request modification" is clicked: comment field expands with placeholder "Describe the required change..."
Submit comment → section moves to "Modification requested" status.

**Navigation footer:**
"← Previous card" / "Next card →" / "Card 1 of 3"

---

## After All Cards Reviewed — Sign-Off Screen

Single-page sign-off after all three cards are reviewed:

**Summary:**
- Approved: 2 cards ✓
- Modification requested: 1 card (C-001 LinkedIn)
- Rejected: 0

**Digital sign-off (FR-E-014 — lighter than 21 CFR Part 11):**
"By submitting this review, I confirm I have reviewed all content cards listed above and my decisions are accurately recorded."
- Name (pre-filled, read-only): Prof. James Hartley
- Date/time: 18 Oct 2026 14:32 UTC (auto-populated)
- "Submit review & sign off" button (steel blue)

After submit: "Review submitted ✓ — The Ideation Lead has been notified. Your one-time session has ended."

---

## Notification (shown on sE01 for the Ideation Lead)
"KOL review submitted · Prof. James Hartley · 2 approved · 1 modification requested · 18 Oct 2026 14:32"

---

## Design Notes

- The KOL review interface is a guest interface — no Aurora account required. The design must be clean enough for a busy KOL to complete a review on mobile in 5 minutes.
- The source provenance panel is the most important differentiator in this interface — it is the only content repurposing tool that shows the KOL exactly where each claim came from. Keep it prominent, not collapsed.
- KOL cannot edit content — they approve, reject, or request modification. The editorial work is done by the Ideation Lead. This is consistent with DD-E-001.
- The session expiry timer (amber if <48h) is important UX — KOLs often delay review. Show the days remaining clearly.
- **KOL reminder escalation (FR-E-020 / P2-09):** If the KOL does not submit their review within 3 days, an automated reminder email + SMS is sent. A second reminder fires at 5 days. At 7 days with no response, an escalation alert goes to the Ideation Lead and Medical Affairs Team Lead. The review interface must surface this cadence in the session expiry area: "Reminder sent 3 days after invitation. Escalation to Ideation Lead after 7 days." This is visible to the Ideation Lead in sE01/sE06 — not shown to the KOL themselves.


> **Approval stamp note (FR-E-014 / PRD v0.2 §8.1):** The KOL sign-off here is a digital approval stamp (name, email, timestamp) — not a full 21 CFR Part 11 e-signature. This distinction must be communicated to the KOL in plain language on the sign-off screen: "This is a digital approval record, not a regulatory e-signature."
