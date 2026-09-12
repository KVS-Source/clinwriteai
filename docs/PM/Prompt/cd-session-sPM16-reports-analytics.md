# CD Session — sPM16 · Reports & Analytics
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM16-reports-analytics.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/reports`
**Phase:** Phase 4
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM16** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM16 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM16 — Reports & Analytics

**File:** `aurora-sPM16-reports-analytics.html`
**Route:** `/reports`
**Current user:** Dr James Hartley · Admin

**Layout:** Left: report type nav (~220px). Right: report preview + generate panel.

**Left nav:**
- Dashboard (default/active)
- Project Summary
- Module Activity
- AI Usage
- User Activity
- Compliance
- Publishing Performance

**Right — Dashboard (default):**

**Module health scores (6 cards, 2×3 grid):**
- A Clinical Writing · `87` Health score · 94% completion rate · 12 active documents
- B Scientific Writing · `79` Health score · 82% completion rate · 6 active documents
- C Medical Writing · `91` Health score · 96% completion rate · 9 active documents
- D Regulatory Writing · `88` Health score · 91% completion rate · 12 active documents (1 overdue)
- E Ideation & Publishing · `94` Health score · 100% cards approved · 5 calendar entries
- Platform Overall · `88` composite

**Cost & productivity panel:**
- Total tokens consumed: 1,847,200 · Cost: £9,236
- Market value savings: £184,720 (vs standard hourly rates per rate card v1.1)
- Rate used: v1.1 · Super Admin Alex Thornton · effective 01 Jul 2026
- Report footnote: "Market value savings calculated using Rate Card v1.1 (Alex Thornton · 01 Jul 2026)"

**Generate report section:**
Report type: "Project Summary Report" (dropdown)
Date range: 01 Sept 2026 → 09 Sept 2026
Format: `PDF` (radio) / `CSV`
"Generate PDF" button (navy primary)

**Template variables (CC wires these):**
`{{ moduleScores }}` — module health score cards · `{{ m.score }}` / `{{ m.completion }}` / `{{ m.active }}` — per-module data
`{{ totalTokens }}` / `{{ totalCost }}` / `{{ marketSavings }}` / `{{ rateCardVersion }}` — cost/productivity numbers
`{{ selectedReportType }}` / `{{ dateFrom }}` / `{{ dateTo }}` — generate report panel state · "Export CSV" (grey outline)
Note: "For datasets over 30 days, the report is emailed to j.hartley@genbioca.com on completion (secure link, expires 24h)."

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM16-reports-analytics.md and execute.
Build Reports and Analytics exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM16-reports-analytics.html.
Run all 3 validation passes and report results before awaiting the next session.
```
