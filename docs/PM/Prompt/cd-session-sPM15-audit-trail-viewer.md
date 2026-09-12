# CD Session — sPM15 · Audit Trail Viewer
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM15-audit-trail-viewer.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/admin/audit`
**Phase:** Phase 0
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM15** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM15 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM15 — Audit Trail Viewer

**File:** `aurora-sPM15-audit-trail-viewer.html`
**Route:** `/admin/audit`
**Current user:** Dr James Hartley · Admin

**Layout:** Full-width. Filter bar + immutability banner + table + detail drawer.

**Immutability banner (always visible, top of content area — navy tint bg):**
"This audit trail is immutable. Entries cannot be edited, deleted, or reordered. Every entry was written at the time of the action it describes. Compliant with 21 CFR Part 11."

**Filter bar:**
Date range (From / To) · User dropdown · Action type dropdown · Module filter · "Export CSV" button (grey outline)

**Audit table (7 columns):**
Columns: Timestamp (UTC) · User · Action · Entity · Module · Details · IP

Hard-coded rows (20 total, 10 visible):
| Timestamp | User | Action | Entity | Module | Details | IP |
|-----------|------|--------|--------|--------|---------|-----|
| 09 Sept 2026 09:15:32 | Dr J. Hartley | SIGNATURE_APPLIED | VELORA-301 NDA sD06 | D | Stage 4 sign-off · Regulatory Affairs Lead | 192.168.1.1 |
| 09 Sept 2026 09:12:18 | Dr S. Chen | DOCUMENT_EDITED | VELORA-301 NDA §2.5.4 | D | v0.4 → v0.5 · AI draft accepted | 192.168.1.4 |
| 09 Sept 2026 08:44:02 | Ms P. Nair | ARTEFACT_UPLOADED | ia-001 KOL Summary | E | Source gate check triggered | 192.168.2.3 |
| 08 Sept 2026 16:47:21 | SYSTEM | ACK2_RECEIVED | sub-001 VELORA-301 NDA | D | FDA ESG · format validation passed | — |
| 08 Sept 2026 14:22:05 | Dr J. Hartley | SUBMISSION_TRANSMITTED | sub-001 VELORA-301 NDA | D | FDA ESG · 21 CFR Part 11 on file | 192.168.1.1 |
| 08 Sept 2026 11:30:44 | Dr R. Morton | MA_APPROVED | ip-001 VELORA-301 Efficacy | E | 3 cards approved for calendar | 192.168.3.1 |

Rows 7–10: `{{ auditRows }}`(CC wires remaining rows from `auditTrail.json`)

**Template variables (CC wires these):**
`{{ auditRows }}` — rows 7–10 · `{{ r.timestamp }}` / `{{ r.user }}` / `{{ r.action }}` / `{{ r.entity }}` / `{{ r.module }}` / `{{ r.details }}` / `{{ r.ip }}` — per-row data
`{{ selectedRow }}` — row selected for detail drawer · `{{ totalRows }}` — "20 entries" count
`{{ dateFrom }}` / `{{ dateTo }}` / `{{ userFilter }}` / `{{ actionFilter }}` — filter state (CC wires remaining)

**Detail drawer (row 1 selected, slide out from right):**
Full 21 CFR Part 11 record:
- Signatory: Dr James Hartley
- Role: Regulatory Affairs Lead
- Email: j.hartley@genbioca.com
- Meaning: "I certify that the content of this document is accurate and complete to the best of my knowledge"
- Document version hash: `a3f7c2e8d14b9f63…`
- Timestamp: 09 Sept 2026 09:15:32 UTC
- IP: 192.168.1.1
- Session ID: `sess_a3b7c2`

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM15-audit-trail-viewer.md and execute.
Build Audit Trail Viewer exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM15-audit-trail-viewer.html.
Run all 3 validation passes and report results before awaiting the next session.
```
