# CD Session — sPM11 · Services Dashboard
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM11-services-dashboard.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/services`
**Phase:** Phase 4
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM11** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM11 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM11 — Services Dashboard

**File:** `aurora-sPM11-services-dashboard.html`
**Route:** `/services`
**Current user:** Dr James Hartley · Admin

**Layout:** Full-width. Header strip + 3-column stat cards + breakdown table below.

**Header:** "Services · September 2026"
Sub-label: "Token consumption and cost for your organisation. Renewal date: 01 Oct 2026."

**Top stat cards (5 cards, horizontal strip):**
- Total tokens consumed (Sept): `1,847,200`
- Remaining balance: `2,152,800` (green chip "58% remaining")
- Estimated spend (Sept): `£9,236`
- Contracted amount: `£15,000 / month`
- Renewal: `01 Oct 2026` (22 days)

**Per-module breakdown table:**
Columns: Module · Tokens consumed · Cost · % of total · Burn rate · Status

| Module | Tokens | Cost | % | Burn rate | Status |
|--------|--------|------|---|-----------|--------|
| A Clinical Writing | 412,000 | £2,060 | 22% | On track | `✓ Healthy` |
| B Scientific Writing | 188,000 | £940 | 10% | On track | `✓ Healthy` |
| C Medical Writing | 537,000 | £2,685 | 29% | ⚠ High | `⚠ Monitor` (amber) |
| D Regulatory Writing | 621,000 | £3,105 | 34% | ⚠ High | `⚠ Monitor` (amber) |
| E Ideation & Publishing | 89,200 | £446 | 5% | Low | `✓ Healthy` |

"Top up" button (navy primary, below table): launches sPM13 prefilled with deficit.
"Export CSV" button (grey outline).

**Template variables (CC wires these):**
`{{ moduleRows }}` — per-module breakdown table rows · `{{ m.tokens }}` / `{{ m.cost }}` / `{{ m.pct }}` / `{{ m.burnRate }}` / `{{ m.status }}` — per-module data
`{{ totalTokens }}` / `{{ remainingBalance }}` / `{{ estimatedSpend }}` / `{{ contracted }}` / `{{ renewalDate }}` — summary stats

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM11-services-dashboard.md and execute.
Build Services Dashboard exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM11-services-dashboard.html.
Run all 3 validation passes and report results before awaiting the next session.
```
