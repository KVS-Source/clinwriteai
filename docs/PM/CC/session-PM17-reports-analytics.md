# Session PM05 — Reports & Analytics
**Screen:** sPM16 · Reports & Analytics
**Route:** `/reports`
**Component:** `src/platform/screens/ReportsAnalytics.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM16-reports-analytics.html`
**Data:** `reports.json`, `moduleHealthScores.json`, `subscription.json`
**Store:** `platformStore`
**Access:** `<AdminGuard>`

---

## What to Build

Left nav (report types) + main content area (dashboard + generate panel). Current user: Dr James Hartley · Admin. Date range 01–09 Sept 2026.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Left nav — `{{ navItems }}` loop:**
Dashboard (default active) · Project Summary · Module Activity · AI Usage · User Activity · Compliance · Publishing Performance
`{{ n.label }}` per item · `{{ heading }}` = active item label

**Dashboard section — date range: "01 Sept 2026 → 09 Sept 2026 · GenBioCa Sciences"**

**Discipline health — `{{ scores }}` loop from `moduleHealthScores.json`:**
`{{ s.label }}` · `{{ s.score }}` health score · `{{ s.detail }}` completion rate · `{{ s.flag }}` (flag if overdue)
6 score cards (A B C D E + Platform Overall)

**Cost and productivity panel:**
- "Measured against the rate card in force for the reporting period."
- Tokens consumed: 1,847,200
- Platform cost: $9,236
- Market value saving: **$184,720**
- **Effective multiple: 20.0×** ← derived: $184,720 / $9,236 = 20.0×
- "Rate card v1.1 · Alex Thornton · effective 01 Jul 2026"
- "Market value savings are calculated using Rate Card v1.1 (Alex Thornton · 01 Jul 2026) against standard consultancy hourly rates for equivalent output."

**Generate report panel:**
- Report type: `{{ reportType }}` dropdown from `reports.json`
- Date range: From · To
- Format: `{{ formats }}` — `{{ f.label }}` radio (PDF / CSV)
- `{{ generateLabel }}` button (navy primary)
- "For datasets over 30 days the report is emailed to j.hartley@genbioca.com on completion, as a secure link that expires after 24 hours."

---

## Data Wiring

```typescript
const { scores, reports, subscription } = usePlatformStore()
// MSW: GET /api/reports/health-scores → moduleHealthScores.json
// MSW: GET /api/reports/available → reports.json
// MSW: POST /api/reports/generate → { queued: true } | binary PDF

// navItems: prepend Dashboard to reports.json array
const navItems = [
  { id: 'dashboard', label: 'Dashboard' },
  ...reports.map(r => ({ id: r.type, label: r.label }))
]

// Effective multiple — computed in store
const effectiveMultiple = (subscription.marketValueSavings.total /
  subscription.currentPeriod.estimatedSpend).toFixed(1) + '×'  // "20.0×"

// generateLabel = dateRangeExceeds30Days ? 'Queue report →' : 'Generate PDF'
// reportType = selected report from reports.json
// formats = ['PDF','CSV'] as radio options
```

---

## Implementation Notes (from design review)

- `{{ navItems }}` = "Dashboard" prepended to `reports.json` array — 7 items total; `{{ heading }}` = active nav item label
- `{{ scores }}` wires from `moduleHealthScores.json` — 6 cards including Platform Overall
- **"Effective multiple: 20.0×"** = `marketValueSavings.total / currentPeriod.estimatedSpend` — computed in store, not in fixtures
- `{{ generateLabel }}` = "Generate PDF" for short ranges / "Queue report →" for >30 days (triggers email delivery)
- Email for large datasets is hard-coded to `j.hartley@genbioca.com` (current admin user)
- Rate card attribution line must match exactly: "Rate card v1.1 · Alex Thornton · effective 01 Jul 2026" — from `subscription.json` `marketValueSavings` fields

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Left nav shows 7 items: Dashboard + 6 from `reports.json`. Dashboard is active by default. (AC-PM-023)
2. Health scores panel shows 6 cards. Values match `moduleHealthScores.json`. (AC-PM-023)
3. Cost panel shows: Tokens 1,847,200 · Cost $9,236 · Saving $184,720 · **Effective multiple 20.0×**. Rate card attribution "Rate card v1.1 · Alex Thornton · effective 01 Jul 2026" is visible.
4. Report type dropdown shows all 6 types from `reports.json`. (AC-PM-024)
5. Selecting a date range >30 days changes `generateLabel` to "Queue report →" and shows the email delivery note. (AC-PM-024)

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM17-reports-analytics.md and execute.
Build ReportsAnalytics exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM16-reports-analytics.html.
Run all 3 validation passes and report results before completing all PM sessions.
```
