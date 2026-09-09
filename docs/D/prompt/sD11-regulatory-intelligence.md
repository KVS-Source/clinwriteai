# CD Prompt — sD11 Regulatory Intelligence
**Module:** D — Regulatory Writing · Crimson `#B0200D`  
**PRD refs:** FR-D-024, FR-D-025, DD-D-005  
**Screen code:** sD11  
**Output file:** `aurora-sD11-regulatory-intelligence.html`

---

## Screen Purpose

The Regulatory Intelligence panel — a live monitoring dashboard for changes to the regulatory frameworks that govern Module D submissions. Alerts the Regulatory Affairs Lead when guidance updates affect in-progress or submitted dossiers. Designed as a cross-module shared service (DD-D-005) with Module D as primary owner — alerts are also pushed to Modules A/B/C in their relevant contexts.

---

## Layout

Two-column layout. Left: alert feed + framework monitor (~420px). Right: affected dossier sections + cross-functional trigger log.

**Header:** "Regulatory Intelligence · Live Monitoring" with "2 unread alerts" amber badge. "Mark all read" secondary button. "Configure monitoring →" link (Admin only).

---

## Left Column — Alert Feed

**Active Alerts section:**

Two alert cards (amber left border `#FFF5F5`... wait — amber border on amber background is wrong. Use amber left border `#D97706` 3px on white `#FFFFFF` background, not the module crimson):

**Alert 1 — Unread:**
- Framework: "ICH E2C(R2) — PBRER · Draft revision"
- Issuer: "ICH · Published 04 Sept 2026"
- Effective: "Q1 2027 (estimated)"
- Summary: "Draft revision proposes changes to the benefit-risk evaluation framework structure (Section 8) and signal assessment methodology (Section 7). Public consultation open until 15 Dec 2026."
- Affected dossier sections chip: "2 sections · Veloricept NDA" (amber)
- "View affected sections →" → loads right panel
- "Acknowledge ✓" button
- Pushes to: "Module D (primary) · Module C — MLR regulatory code updates (alerted)"

**Alert 2 — Unread:**
- Framework: "FDA 21 CFR Part 314 — eCTD v4.0 format guidance update"
- Issuer: "FDA · Published 05 Sept 2026"
- Effective: "Immediately"
- Summary: "Updated electronic submission format requirements for eCTD v4.0 pathways. New requirements apply to submissions filed on or after 01 Jan 2027."
- Affected dossier sections chip: "1 section · Veloricept NDA — eCTD structure"
- "Acknowledge ✓" button
- Pushes to: "Module D only"

**Monitoring status strip (below alerts):**
IBM Plex Mono: "Monitoring 17 frameworks · Last scan: 08 Sept 2026 06:00 UTC · Next scan: 09 Sept 2026 06:00 UTC"

---

**Framework Monitor (table):**
Compact table of all monitored frameworks. Columns: Framework / Issuer / Last updated / Status.

| Framework | Issuer | Last updated | Status |
|-----------|--------|-------------|--------|
| 21 CFR Part 11 | FDA | Mar 2024 | ✓ Current |
| 21 CFR Part 314 | FDA | Sept 2026 | ⚠ Updated |
| ICH M4E(R2) | ICH | Jun 2022 | ✓ Current |
| ICH M2 v3.2.2 | ICH | 2008 | ✓ Current |
| ICH E2C(R2) | ICH | Nov 2012 | ⚠ Draft revision |
| ICH E2F | ICH | Jul 2011 | ✓ Current |
| ICH E2A | ICH | Oct 1994 | ✓ Current |
| EU Reg 726/2004 | EMA/EU | 2019 (amend.) | ✓ Current |
| EMA GVP Module V | EMA | 2014 (rev.) | ✓ Current |
| GDPR | EU | 2018 | ✓ Current |

(Remaining 7 frameworks collapsed: "Show all 17 →")

---

## Right Column — Affected Sections + Triggers

**Affected Dossier Sections panel (for ICH E2C(R2) alert):**

Header: "ICH E2C(R2) — Sections affected in Veloricept NDA"

Two section rows:
- "2.7.6 — Safety Summary · Last reviewed: 15 Oct 2026 · Regulatory basis: ICH E2C(R2) ⚠ Updated since last review"
  Action: "Flag for re-review →" button
- "PSUR/PBRER draft · Stage 4 · Benefit-risk section · Regulatory basis: ICH E2C(R2) ⚠"
  Action: "Flag for re-review →"

---

**Cross-Functional Data Sync Triggers (FR-D-025):**

Header: "Cross-Functional Triggers · Active"

Three trigger cards:

**Trigger 1:**
- Event: "Safety signal flagged — potential hepatotoxicity signal. Label update task created: SmPC §4.4 Special Warnings."

**Trigger 1 (revised):**
        - Event: "Module A CSR updated — VELORA-301 CSR v1.1 (interim OS data added)"
- Triggered: 10 Oct 2026
- Affected sections: "Module 2.5 §2.5.4 · Module 2.7 §2.7.2.1 · 3 cross-references"
- Status: "⚠ Review sign-off required — Dr Sarah Chen"
- "Review affected sections →" link

**Trigger 2:**
- Event: "Module B publication — new manuscript from VELORA-301 source project"
- Triggered: 08 Oct 2026
- "New publication may need to be cited in the regulatory submission"
- Status: "✓ Acknowledged — Dr J. Hartley · 09 Oct"

**Trigger 3 — Safety signal & label update (FR-D-025):**
- Event: "Safety signal flagged by PV Lead — potential hepatotoxicity signal. Label update task auto-created."
- Triggered: 05 Oct 2026
- "Label update task created: SmPC §4.4 Special Warnings — review required"
- Status: "● In progress — Dr R. Morton"

---

## Design Notes

- Alert cards use amber left border on white background — not crimson, not module-tinted. Regulatory intelligence alerts are platform-level warnings, not module-branded.
- The "Pushes to: Module D (primary) · Module C alerted" chip on Alert 1 demonstrates the cross-module shared service architecture (DD-D-005). This is a unique capability — no competitor offers this.
- The cross-functional trigger log (FR-D-025) is where the CSR update trigger lives — showing a Module A CSR revision automatically flagging Module D sections is a powerful demo moment.
- IBM Plex Mono for the monitoring status strip and timestamps gives the screen an authentic regulatory intelligence feel — this is data infrastructure, not a narrative UI.


> **Safety signal → label update trigger (FR-D-025):** When the PV Lead flags a new safety signal in the Module D submission record, the platform automatically creates a label-update task (SmPC/USPI §4.4 Special Warnings change required) and notifies the Reg Affairs Lead. This trigger — safety signal detected → label update task created — is the primary cross-functional data sync demo moment in Module D. Ensure this workflow is visible in the Trigger 3 card on sD11.
