# CD Prompt — sD01 Regulatory Writing Home
**Module:** D — Regulatory Writing  
**Colour:** Crimson `#B0200D`  
**Tailwind tokens:** crimson-700 `#B0200D`, crimson-50 `#FFF5F5`, crimson-100 `#FFE0E0`, crimson-200 `#FFC5C5`  
**PRD refs:** FR-D-002, FR-D-005, FR-D-018, FR-D-024  
**Screen code:** sD01  
**Output file:** `aurora-sD01-regulatory-writing-home.html`

---

## Screen Purpose

The entry point for Module D. Shows all regulatory submission projects for the current user, module-level KPIs, live regulatory intelligence alerts, and quick access to start a new submission. Equivalent in structure to Module A Clinical Writing Home and Module C Medical Writing Home — but scoped to regulatory dossier submissions with crimson accent.

---

## Layout

Standard Aurora AppShell:
- **Top navigation bar:** Aurora wordmark, module switcher (Module D active — crimson dot and label "Regulatory Writing"), user avatar, notification bell
- **Left sidebar:** narrow icon + label nav. Items: Home (active), Submissions, eCTD Monitor, Regulatory Intelligence, Master Library, Audit Trail. Crimson active state (left border + background tint `#FFF5F5`).
- **Main content area:** three-zone layout — metrics strip, submission list, right panel

---

## Metrics Strip

Four stat chips in a horizontal row below the top bar, crimson left-border accent:
- **Active submissions:** 3
- **Super Review pending:** 1
- **Gateway submissions this quarter:** 2
- **Regulatory alerts:** 2 unread (amber dot indicator)

Chip style: IBM Plex Mono uppercase label (10px), Plus Jakarta Sans bold number (28px), 3px crimson left border.

---

## Left Column — Submission List

Header: "Regulatory Submissions" with "+ New Submission" button (crimson primary, rounded).

Filter bar: submission type dropdown (All / IND / NDA-MAA / PSUR-PBRER / HA Response / RMP-REMS / Orphan Drug), HA target filter (All / FDA / EMA / MHRA / CDSCO), TA filter (six options).

Three submission cards:

**Card 1 — Active:**
- Tag: `NDA/MAA` chip (crimson `#FFF5F5`/`#B0200D`)
- Title: "Veloricept NDA — FDA + EMA Submission"
- Sub: "VELORA-301 · Oncology · v0.4 · Stage 3 Authoring"
- Source chip: "Source: VELORA-301 CSR v1.0 · Module A ✓" (small, blue-grey)
- Stage progress: 6-dot stage indicator, dot 3 active (crimson fill)
- Consistency check: "Cross-module check: 2 contradictions flagged" (amber chip)
- Owner avatar: SC

**Card 2 — In Super Review:**
- Tag: `PSUR/PBRER` chip
- Title: "Veloricept PSUR — Annual Safety Update"
- Sub: "VELORA-301 · Oncology · v1.0 · Stage 4 Super Review"
- Stage 4 active (crimson fill)
- Status chip: "Super Review — 3 of 6 roles signed" (amber)
- Owner avatar: RW

**Card 3 — Submitted:**
- Tag: `IND` chip
- Title: "AURELIA-101 IND — Phase I Safety"
- Sub: "AURELIA-101 · Cardiometabolic · v2.0 · Stage 6 Submitted"
- Stage 6 filled (green)
- ACK badge: "ACK2 ✓ — EMA CESP · 12 Oct 2026" (green)
- Owner avatar: RA

---

## Right Panel — Regulatory Intelligence & Alerts

Header: "Regulatory Intelligence" with "View all →" link.

Two alert cards (amber left border, `#FFFBEB` background):

**Alert 1:**
- Framework: "ICH E2C(R2) — PBRER"
- "Draft revision published · Effective Q1 2027 · Affects: PSUR/PBRER authoring (FR-D-015)"
- "2 dossier sections flagged for review" link
- Timestamp: "Detected 07 Sept 2026 · 2 days ago"

**Alert 2:**
- Framework: "FDA 21 CFR Part 314 — NDA Amendments"
- "Guidance update: electronic submission format requirements updated for eCTD v4.0 pathways"
- "1 dossier section flagged for review"
- Timestamp: "Detected 05 Sept 2026 · 4 days ago"

Below alerts: "eCTD Publishing Monitor" mini-panel showing the active NDA submission granularity: "47 of 62 sections compiled ✓ · 15 pending" with a horizontal progress bar (crimson fill).

---

## Colour & Typography Rules

- Module crimson `#B0200D` used for: active sidebar state, primary button, stage dot (active), card left-border accent (on active/in-review cards)
- Approved/complete states: green `#15803D` (same as all modules)
- Warning/pending: amber `#B45309` background `#FFFBEB`
- Regulatory Intelligence alerts: amber left border only — NOT crimson (alerts are not module-branded, they are platform-level warnings)
- Typography: Plus Jakarta Sans for all UI text, IBM Plex Mono for stage labels, FR codes, timestamps, and the metrics strip labels
- No red anywhere except the module crimson itself — blocking states use `#005F8E` steel blue

---

## Interactions

- Click submission card → navigate to that submission's current stage screen
- "+ New Submission" → sD02 Submission Setup & Strategy (new submission flow)
- Alert "2 dossier sections flagged for review" → sD11 Regulatory Intelligence screen
- "View all →" on RI panel → sD11
- "eCTD Publishing Monitor" progress → sD07

---

## Design notes

- The eCTD Publishing Monitor mini-panel in the right column is unique to Module D — no equivalent in Modules A/B/C. It reinforces the continuous publishing differentiator.
- The "Cross-module check: 2 contradictions flagged" chip on Card 1 is the first place a user sees the consistency checker — it should be clearly visible but not alarming (amber, not crimson/red).
- Keep the right panel narrow (~280px). It is an ambient awareness panel, not primary workflow.
