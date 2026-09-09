# CD Prompt — sE06 Medical Affairs Approval
**Module:** E — Ideation & Publishing · Steel Blue `#005F8E`
**PRD refs:** FR-E-012, FR-E-013, FR-E-014, FR-E-020
**Screen code:** sE06
**Output file:** `aurora-sE06-medical-affairs-approval.html`

---

## Screen Purpose

Stage 4 (Approved) — the Medical Affairs Team Lead reviews all KOL-approved content cards, resolves any KOL modification requests, and gives final sign-off before content enters the publishing calendar. The RACI matrix (FR-E-013) governs this stage.

---

## Layout

Two-column layout. Left: content card list with KOL review outcomes (~380px). Right: MA review workspace.

**Header:** "Medical Affairs Approval · Stage 4" breadcrumb, "VELORA-301 · Oncology · 3 cards · 2 ready · 1 modification needed" status, "Approve all & schedule →" primary button (gated — requires all cards reviewed and MA sign-off).

---

## Left Panel — Content Cards with KOL Outcomes

**KOL review summary strip:**
"KOL review complete · Prof. James Hartley · 18 Oct 2026 · 2 approved · 1 modification requested"

**Card list:**

**Card C-001 — LinkedIn Adaptation:**
- KOL status: "⟳ Modification requested — Prof. Hartley · 18 Oct"
- KOL comment: "The phrase 'reinforces the clinical benefit' should be replaced with the actual HR value for scientific precision."
- Action required: Ideation Lead to revise then resubmit for MA review
- Current state: "✓ Revised by Ideation Lead · 19 Oct · Ready for MA review"
- MA status: ○ Pending

**Card C-002 — Blog Post Adaptation:**
- KOL status: "✓ Approved · Prof. Hartley · 18 Oct"
- MA status: ○ Pending
- "Review →"

**Card C-003 — HCP Summary:**
- KOL status: "✓ Approved · Prof. Hartley · 18 Oct"
- MA status: "✓ Approved · Dr Rebecca Morton · 19 Oct"

---

## Right Panel — MA Review Workspace (Card C-002 active)

**Card content (read-only):**
"Blog Post" channel chip
Full blog excerpt (400 words). Key paragraph:
> "The VELORA-301 Phase III trial demonstrated that veloricept combined with pembrolizumab achieved a hazard ratio of 0.61 (95% CI 0.48–0.77; p<0.001) for progression-free survival, with benefit consistent across all PD-L1 expression subgroups. These results represent a clinically meaningful advance for patients with first-line advanced NSCLC."

**Pre-review compliance checklist** (from FR-E-008 output — working checklist for MA review):
- Non-compliant language: ✓ None detected
- Comparative claims: ✓ Substantiated (HR 0.61 cited)
- Fair-balance: ✓ Safety qualifier present in paragraph 3
- Brand guidelines: ✓ Approved terminology used
- Off-label language: ✓ None detected

**Claim provenance (below checklist):**
"Source: KOL Session Summary §3.2 → CSR v1.0 Table 14.2.1 · Module A"
"KOL reviewed and approved · Prof. Hartley · 18 Oct 2026"

**MA Review actions:**
- "✓ Approve for calendar scheduling" (steel blue primary)
- "⟳ Request Ideation Lead revision" (amber) — opens comment field
- "Channel assignment": LinkedIn ✓ Blog ✓ (confirm channels for this card before approving)

**RACI role indicator:**
"Your role: Medical Affairs Team Lead · R/A for this stage"

---

## MA Sign-Off Panel (appears after all cards approved)

**Summary:**
All 3 cards approved: C-001 ✓ (revised + approved), C-002 ✓, C-003 ✓

**Digital sign-off (FR-E-014):**
"By signing, I confirm all content cards are medically accurate, compliant, and approved for calendar scheduling."
- Name: Dr Rebecca Morton · Medical Affairs Team Lead
- Date: 19 Oct 2026 16:45 UTC
- Scope: "3 content cards — VELORA-301 Ideation Project · Oncology"
- "Sign off & approve for scheduling" button (steel blue)

After sign: "✓ Medical Affairs approval recorded · Content cards available for calendar scheduling · Logged to audit trail."

**Notification auto-triggered (FR-E-020):**
"Email + SMS sent to Content Calendar Manager · 3 cards approved for scheduling · 19 Oct 2026"

**KOL reminder escalation record (FR-E-020 / P2-09):**
If KOL review was delayed, this panel shows the escalation history: "Reminder 1 sent 3 days after invitation · Reminder 2 sent 5 days · No escalation triggered (KOL responded within 5 days)." If escalation was triggered (7-day no-response), show an amber chip: "⚠ Escalated to Ideation Lead + MA Lead on [date] — KOL review stalled." This gives the Ideation Lead and MA Lead full visibility of any review delays before approving content for scheduling.

---

## Design Notes

- The KOL modification request resolution is shown here — the Ideation Lead revised C-001 and it re-enters the MA review queue. This demonstrates the modification workflow loop without needing a separate screen.
- The compliance checklist from the pre-review screen reappears here as a working checklist — it is the MA reviewer's primary tool, not a freshly run check. Show it as a completed reference, not an active scan.
- The notification auto-trigger note at the bottom confirms that FR-E-020 fires automatically — the Calendar Manager does not need to check whether content is ready.
