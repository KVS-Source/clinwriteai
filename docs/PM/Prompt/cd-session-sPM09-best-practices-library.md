# CD Session — sPM09 · Best Practices Library
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM09-best-practices-library.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/library/best-practices`
**Phase:** Phase 4
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM09** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM09 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM09 — Best Practices Library

**File:** `aurora-sPM09-best-practices-library.html`
**Route:** `/library/best-practices`
**Current user:** Alex Thornton · Super Admin

**Layout:** Left module tab strip + main content area.

**Module tabs (horizontal):** All · Module A · Module B · Module C · Module D · Module E · Platform-Wide
**Currently active:** Module D

**Content area — Module D best practices:**
Header: "Module D · Regulatory Writing Best Practices · 4 items"
"+ New best practice" button (navy primary, visible to Super Admin only)

**Item cards (full width, stacked):**

Card 1:
Name: `Module-D-CTD-Authoring-v1.2-2026-01`
Category: CTD Authoring
Guidance: "Use the canonical JSON data layer as the single source of truth for all efficacy claims in CTD Module 2.5 and 2.7. Never transcribe values manually — always pull from the indexed data layer to eliminate transcription error and maintain full provenance."
Applicable doc types: NDA · IND · MAA
Framework references: ICH M4E(R2) · ICH E3
Effective: 01 Jan 2026 · Valid until: 31 Dec 2026
"Updated: 01 Jan 2026 by Alex Thornton"

Card 2:
Name: `Module-D-SuperReview-v1.0-2026-03`
Category: Super Review
Guidance: "All six RACI roles must sign off before Stage 5. The 21 CFR Part 11 inline form captures signatory name, role, meaning of signature, and timestamp for each sign-off. Do not use a separate e-signature system."
Framework references: 21 CFR Part 11 · ICH M4E(R2)
Effective: 15 Mar 2026 · Valid until: 31 Dec 2026

Card 3 (⚠ review due — amber left border):
Name: `Module-D-MHRA-OQ-D-008-v1.0-2026-01`
Category: MHRA Configuration
Guidance: "MHRA API procurement is required before production. Include MHRA in all prototype UI designs as Priority 4 (disabled state). OQ-D-008 is resolved for prototype purposes."
Effective: 01 Jan 2026 · Valid until: 31 Dec 2026 · **Review due** (91 days old — amber chip "Review due · quarterly refresh")

Naming convention note (always visible, top of page):
"Best Practice items must follow the naming convention: `[Module]-[Category]-[Version]-[Date]`. Example: `Module-D-CTD-Authoring-v1.2-2026-01`"

**Template variables (CC wires these):**
`{{ items }}` — best practice cards beyond the 3 hard-coded ones · `{{ i.name }}` / `{{ i.category }}` / `{{ i.guidance }}` / `{{ i.frameworks }}` / `{{ i.validUntil }}` / `{{ i.reviewDue }}` — per-item data
`{{ activeTab }}` — selected module tab (A / B / C / D / E / Platform-Wide)
`{{ itemCount }}` — count in header · `{{ newItem }}` — new best practice form state (Super Admin only)

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM09-best-practices-library.md and execute.
Build Best Practices Library exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM09-best-practices-library.html.
Run all 3 validation passes and report results before awaiting the next session.
```
