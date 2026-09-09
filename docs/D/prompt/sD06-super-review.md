# CD Prompt — sD06 Super Review
**Module:** D — Regulatory Writing · Crimson `#B0200D`  
**PRD refs:** FR-D-015, FR-D-016, FR-D-017, FR-D-018  
**Screen code:** sD06  
**Output file:** `aurora-sD06-super-review.html`

---

## Screen Purpose

Stage 4 — the multi-disciplinary Super Review. All six RACI roles participate in resolving the Cross-Module Consistency Report, reviewing the aggregate safety report (PSUR/PBRER if applicable), and signing off the complete dossier before eCTD publishing. The most complex workflow gate in Module D.

---

## Layout

Three-column layout:
- Left (~280px): Reviewer panel + RACI sign-off status
- Centre (fills): Consistency Report / Safety Report / Comments
- Right (~300px): Dossier summary + gate status

**Header:** "Super Review · Stage 4" breadcrumb, "6 roles required · 2 of 6 signed" status chip (amber), "Submit to Stage 5 →" button (gated — requires all 6 sign-offs + zero unresolved contradictions).

---

## Left Panel — RACI Sign-off

**Six reviewer rows:**

| Role | Name | Status |
|------|------|--------|
| Regulatory Writer | Dr Sarah Chen | ✓ Submitted 15 Oct |
| Reg Affairs Lead | Dr James Hartley | ✓ Submitted 14 Oct |
| Clinical Lead | Dr Elena Vasquez | ○ In progress |
| PV/Risk Mgmt Lead | Dr Rebecca Morton | ○ Not yet |
| CMC/Nonclinical Lead | Dr Arjun Patel | ○ Not yet |
| eCTD Specialist | Mr David Chen | ○ Not yet |

Status pills: ✓ = green chip · ○ In progress = amber · ○ Not yet = grey.

Below: "2 of 6 signed · 4 pending. Submit to Stage 5 unlocks when all 6 sign and contradictions resolved."

"E-signature (21 CFR Part 11) required (21 CFR Part 11) for final sign-off. Each reviewer clicks 'Sign off my role' after completing their review."

---

## Centre — Tabbed Content

Three tabs: Consistency Report / Safety Report / Comments

**Tab 1 — Consistency Report (FR-D-016):**

Header: "Cross-Module Consistency Report · 2 contradictions · Last run: 15 Oct 2026 09:18 UTC · claude-sonnet-4-6 · Logged to audit trail"

"Run again ✦" button (amber).

Two contradiction cards (major/minor):

**Contradiction 1 — Major:**
- Red-left-border `#005F8E` (steel blue — not red per design rules)
- "2.5.4 Clinical Overview vs Module 5 · Table 14.2.1"
- Source value: "Hazard ratio: 0.61 (Module 2.5.4, paragraph 3)"
- Target value: "Hazard ratio: 0.63 (Module 5, Table 14.2.1, interim analysis)"
- Severity: Major · "Must resolve before Stage 5"
- Resolution field: "Note: Module 2.5.4 references final analysis (0.61); Table 14.2.1 is the interim. Resolved — Dr S. Chen · 15 Oct 2026 [Resolve ✓]"

**Contradiction 2 — Minor:**
- Amber left border
- "2.7.2.1 Clinical Summary vs Module 5 · Table 14.2.2"
- Source: "Median PFS: 9.7 months (2.7.2.1)"
- Target: "Median PFS: 9.4 months (Module 5 Table 14.2.2 — interim)"
- Severity: Minor · "Explain or correct"
- Resolution field: [empty — awaiting resolution]

Gate status: "1 Major resolved ✓ · 1 Minor unresolved — Super Review cannot proceed to Stage 5."

**Tab 2 — Safety Report:**
If submission includes PSUR/PBRER:
- "PSUR/PBRER Draft · Generated 15 Oct 2026 · ICH E2C(R2) · PV Lead review required"
- AI-generated badge with footprint indicator
- "Signal tables: 3 signals reviewed · 0 new signals since last PSUR"
- "PV Lead verification required: Dr Rebecca Morton ○ pending"

**Tab 3 — Comments:**
CRM-style comment thread (same Module A Session 18 pattern):
Two comments:
- "REG-D-001 · Dr Vasquez · Clinical Lead · 14 Oct: HR discrepancy in §2.5.4 — confirm which analysis version is cited."
- "REG-D-002 · Dr Hartley · Reg Affairs · 15 Oct: Cover letter for FDA needs updated submission date — 15 Jan 2027 not 01 Jan."

---

## Right Panel — Gate Status

**Dossier completeness:**
"62 sections · 47 compiled ✓ · 8 in authoring · 4 pending · 3 not started"
Crimson progress bar: 76%

**Gate requirements (checklist):**
- All 6 RACI roles signed ✗ (2/6)
- All Major contradictions resolved ✗ (1/1 resolved ✓)
- All Minor contradictions resolved or noted ✗ (0/1)
- PSUR/PBRER PV Lead sign-off ✗ (pending)
- PPD/CCI redaction scheduled ○

"Submit to Stage 5 →" locked. Sub-label: "4 of 5 gate requirements unmet."

---

## Design Notes

- Contradiction cards use steel blue `#005F8E` left border for Major — never red. This is consistent with the platform-wide no-red rule for blocking states.
- The RACI panel is the most important Module D-specific UI pattern — six roles is more complex than any previous module. Make the role label prominent, not just the name.
- "Run again ✦" for the consistency check should trigger a 120s loading state with a progress indicator.
- The inline resolution field on each contradiction card is key — reviewers resolve discrepancies in-context, not in a separate screen.


> **Design rule — DD-D-002:** The 'Submit to Stage 5 →' button must be blocked by a hard gate when any Major contradiction remains unresolved. DD-D-002 makes this a hard gate, not advisory. Show the specific blocking item: 'Major contradiction unresolved — must resolve before Stage 5.'


> **21 CFR Part 11 e-signature note:** Each of the six RACI roles signs off their contribution using the platform e-signature infrastructure (same as Module C MLR decision, Module A Stage 6). Signing requires credential re-entry. The combined six e-signatures form the Super Review sign-off record in the audit trail.
