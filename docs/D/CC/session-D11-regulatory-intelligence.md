# Session D11 — Regulatory Intelligence
**Screen:** sD11 · Regulatory Intelligence
**Route:** `/projects/:projectId/regulatory-writing/intelligence`
**Component:** `src/modules/regulatory-writing/screens/RegulatoryIntelligence.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/D/design/aurora-sD11-regulatory-intelligence.html`
**Data:** `src/data/regulatoryAlerts.json`
**Store:** `regulatoryIntelligenceStore`

---

## What to Build

Cross-stage regulatory framework monitoring dashboard. Live feed of framework changes from `regulatoryAlerts.json`. Cross-functional trigger log (Module A CSR update trigger, safety signal trigger). Demonstrates DD-D-005: Regulatory Intelligence as a cross-module shared service.

---

## Screen Anatomy

Two-column. Left: alert feed + framework monitor (~420px). Right: affected sections + trigger log.

**Header:** "Regulatory Intelligence · Live Monitoring" with "2 unread alerts" amber badge. "Mark all read" secondary button. "Configure monitoring →" (Admin only — disabled for non-Admin users).

**Left — Active Alerts:**
Two alert cards from `regulatoryAlerts.json`. Alert card style: 3px amber `#D97706` left border on white background (NOT crimson — RI alerts are platform-level warnings, not module-branded).

**alert-001:**
- Framework: "ICH E2C(R2) — PBRER · Draft revision"
- Issuer + date: "ICH · Published 04 Sept 2026"
- Effective: "Q1 2027 (estimated)"
- Summary: first 120 chars of `alert-001.changeSummary`
- Affected sections chip: "2 sections · Veloricept NDA" (amber)
- "View affected sections →" link → loads right panel
- Cross-module chip: "Affects: Regulatory Writing · D + Medical Writing · C" (from `alert-001.affectedModules`)
- "Acknowledge ✓" button → `PATCH /regulatory-alerts/alert-001/acknowledge`
- Timestamp: "Detected 04 Sept 2026"

**alert-002:**
- Framework: "FDA 21 CFR Part 314 — eCTD v4.0 format guidance update"
- Effective: "Immediately (01 Jan 2027)"
- Cross-module chip: "Affects: Regulatory Writing · D only"
- "Acknowledge ✓" button
- Timestamp: "Detected 05 Sept 2026"

**Monitoring status strip (IBM Plex Mono small grey):**
"Monitoring 17 frameworks · Last scan: 08 Sept 2026 06:00 UTC · Next scan: 09 Sept 2026 06:00 UTC"

**Left — Framework Monitor table:**
10 rows (compact). Columns: Framework · Issuer · Last updated · Status.

| Framework | Issuer | Last updated | Status |
|-----------|--------|-------------|--------|
| 21 CFR Part 11 | FDA | Mar 2024 | ✓ Current |
| 21 CFR Part 314 | FDA | Sept 2026 | ⚠ Updated |
| ICH M4E(R2) | ICH | Jun 2022 | ✓ Current |
| ICH M2 v3.2.2 | ICH | 2008 | ✓ Current |
| ICH E2C(R2) | ICH | Nov 2012 | ⚠ Draft revision |
| ICH E2F (DSUR) | ICH | Jul 2011 | ✓ Current |
| ICH E2A | ICH | Oct 1994 | ✓ Current |
| EU Reg 726/2004 | EMA | 2019 | ✓ Current |
| EMA GVP Module V | EMA | 2014 | ✓ Current |
| GDPR (EU) 2016/679 | EU | 2018 | ✓ Current |

"Show all 17 →" collapsed footer link.

**Right — Affected Sections (for alert-001):**
Header: "ICH E2C(R2) — Sections affected in Veloricept NDA"

Two section rows from `alert-001.affectedDossierSections`:
- "2.7.6 — Safety Summary · Last reviewed: 15 Oct 2026 · Regulatory basis: ICH E2C(R2) ⚠" — "Flag for re-review →" button
- "PSUR/PBRER draft · Benefit-risk section · Regulatory basis: ICH E2C(R2) ⚠" — "Flag for re-review →" button

**Right — Cross-Functional Triggers (FR-D-025):**
Header: "Cross-Functional Triggers · Active"

Three trigger cards (static demo data — not from JSON files, rendered as static content):

**Trigger 1 (CSR update):**
- Event: "Module A CSR updated — VELORA-301 CSR v1.1 (interim OS data added)"
- Triggered: 10 Oct 2026
- Affected: "Module 2.5 §2.5.4 · Module 2.7 §2.7.2.1 · 3 cross-references"
- Status: "⚠ Review sign-off required — Dr Sarah Chen"
- "Review affected sections →" link → navigate to sD04

**Trigger 2 (new publication):**
- Event: "Module B publication — new manuscript from VELORA-301 source project"
- Triggered: 08 Oct 2026
- Status: "✓ Acknowledged — Dr J. Hartley · 09 Oct"

**Trigger 3 (safety signal + label update — FR-D-025 key demo):**
- Event: "Safety signal flagged — potential hepatotoxicity signal. Label update task auto-created: SmPC §4.4 Special Warnings."
- Triggered: 05 Oct 2026
- Status: "● In progress — Dr R. Morton"

---

## Data Wiring

```typescript
const { alerts, unreadCount, fetchAlerts, acknowledgeAlert } = useRegulatoryIntelligenceStore()

useEffect(() => { fetchAlerts() }, [])
// MSW: GET /api/regulatory-alerts → regulatoryAlerts.json (2 alerts)

const handleAcknowledge = (alertId: string) => acknowledgeAlert(alertId)
// MSW: PATCH /api/regulatory-alerts/:id/acknowledge
// Updates acknowledgedByIds array, alert card loses "unread" styling

// Cross-functional triggers are static content for prototype (no JSON file)
// Render as static JSX per the three trigger cards described above
```

---

## Navigation

- "Review affected sections →" on Trigger 1 → navigate to `submissions/sub-001/module2-editor` (sD04)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`

**Pass 2:** `npm run build`

**Pass 3 — 5 smoke tests:**
1. Two alert cards show amber `#D97706` left borders on white backgrounds (not crimson). Cross-module chips show correct affected modules from `regulatoryAlerts.json`.
2. alert-001 shows "Affects: Regulatory Writing · D + Medical Writing · C". alert-002 shows "Affects: Regulatory Writing · D only".
3. Monitoring status strip renders in IBM Plex Mono: "Monitoring 17 frameworks · Last scan: 08 Sept 2026..."
4. Framework monitor table shows exactly 10 rows with "⚠ Updated" on ICH E2C(R2) and "⚠ Updated" on 21 CFR Part 314.
5. Trigger 3 card shows the safety signal event text and "Label update task auto-created: SmPC §4.4 Special Warnings." This card's presence demonstrates the FR-D-025 cross-module trigger functionality.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D11-regulatory-intelligence.md and execute.
Build RegulatoryIntelligence exactly as specified, run all 3 validation passes, and report results.
```
