# CD Session — sPM18 · Regulatory Framework Admin
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM18-regulatory-framework-admin.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/super-admin/frameworks`
**Phase:** Phase 3
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM18** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM18 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM18 — Regulatory Framework Admin

**File:** `aurora-sPM18-regulatory-framework-admin.html`
**Route:** `/super-admin/frameworks`
**Current user:** Alex Thornton · Super Admin

**Layout:** Full-width table + edit drawer on right.

**Header:** "Regulatory Framework Registry · 15 frameworks"
Sub-label: "Status changes automatically trigger regulatory intelligence alerts in all applicable modules. Frameworks cannot be deleted — only marked Superseded."
Read-only note: "Admins (client-level) see this registry in read-only mode at /admin/frameworks."

**"+ Add framework" button (navy primary, Super Admin only)**

**Framework table (6 columns: Code · Full name · Issuer · Scope · Status · Last updated · Actions):**
| Code | Full name | Issuer | Scope | Status | Updated |
|------|-----------|--------|-------|--------|---------|
| 21CFR11 | 21 CFR Part 11 | FDA | A B C D E | `✓ Current` (green) | Mar 2024 |
| 21CFR312 | 21 CFR Part 312 | FDA | D | `✓ Current` | 2012 |
| 21CFR314 | 21 CFR Part 314 | FDA | D | `⚠ Updated` (amber) | Sept 2026 |
| ICH-M4E-R2 | ICH M4E(R2) | ICH | D | `✓ Current` | Jun 2022 |
| ICH-M2-3.2.2 | ICH M2 v3.2.2 | ICH | D | `✓ Current` | 2008 |
| ICH-Q8 | ICH Q8–Q11 | ICH | D | `✓ Current` | 2009 |
| ICH-S1 | ICH S1–S9 | ICH | D | `✓ Current` | 2012 |
| ICH-E2C-R2 | ICH E2C(R2) PBRER | ICH | D | `⚠ Draft revision` (amber) | Nov 2012 |
| EU-726-2004 | EU Reg 726/2004 | EMA | D | `✓ Current` | 2004 |
| EU-GMP-A11 | EU GMP Annex 11 | EMA | A B C D | `✓ Current` | Feb 2011 |
| GSPR | GSPR (MDR/IVDR) | EU | D | `✓ Current` | 2017 |
| ICH-E2F | ICH E2F DSUR | ICH | D | `✓ Current` | Jul 2011 |
| ICH-E2A | ICH E2A | ICH | D | `✓ Current` | Oct 1994 |
| EMA-GVP-V | EMA GVP Module V | EMA | D | `✓ Current` | 2014 |
| GDPR | GDPR (EU) 2016/679 | EU | A B C D E | `✓ Current` | 2018 |

**Edit drawer (ICH-E2C-R2 selected):**
Fields: Full name · Issuer · Version · Effective date · Scope (checkboxes) · Status (dropdown) · Change summary (textarea)
Alert preview: "Changing status to 'Updated' will automatically trigger a regulatory intelligence alert in Module D (sD11) and push it to Module C."
"Save changes" (navy primary) · "Cancel"

**Template variables (CC wires these):**
`{{ frameworks }}` — framework table rows · `{{ f.code }}` / `{{ f.name }}` / `{{ f.issuer }}` / `{{ f.scope }}` / `{{ f.status }}` / `{{ f.updated }}` — per-framework data
`{{ selectedFramework }}` — row selected for edit drawer · `{{ editStatus }}` / `{{ editSummary }}` — edit drawer state
`{{ alertPreview }}` — alert preview text shown when status changes to Updated/Draft revision

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM18-regulatory-framework-admin.md and execute.
Build Regulatory Framework Admin exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM18-regulatory-framework-admin.html.
Run all 3 validation passes and report results before awaiting the next session.
```
