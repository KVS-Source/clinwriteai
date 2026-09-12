# Session PM08 — Services Dashboard
**Screen:** sPM11 · Services Dashboard
**Route:** `/services`
**Component:** `src/platform/screens/ServicesDashboard.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM11-services-dashboard.html`
**Data:** `subscription.json`
**Store:** `platformStore`
**Access:** `<AdminGuard>`

---

## What to Build

Full-width. Header strip + 5 stat cards + breakdown table + burn rate alert panel. Current user: Dr James Hartley · Admin. September 2026 reporting period.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Header:** "Services · September 2026 · Token consumption and cost for GenBioCa Sciences. Renewal date: 01 Oct 2026."

**5 stat cards (horizontal strip):**
- Tokens consumed: 1,847,200 (September to date)
- Remaining balance: 58% · 2,152,800
- Estimated spend: $9,236 (September to date)
- Contracted amount: $15,000 (Per month)
- Renewal: 01 Oct 2026 · 22 days from today

**Breakdown table — `{{ rows }}` loop from `subscription.json` `moduleBreakdown`:**
Columns: Discipline · Tokens consumed · Cost · % of total · Burn rate · Status
`{{ r.module }}` / `{{ r.tokens }}` / `{{ r.cost }}` / `{{ r.pct }}` / `{{ r.burn }}` / `{{ r.status }}`
"Burn rate is measured against the same period last month."
Total row: 1,847,200 · $9,236 · 100%

**`{{ monitorLabel }}` burn rate alert panel (shown when `monitorOn === true`):**
"⚠ Two disciplines are above their expected burn rate"
`{{ monitorOn }}` = `subscription.burnRateAlert.active`
Alert text from `subscription.burnRateAlert.message`:
"Medical Writing and Regulatory Writing account for 63% of September consumption. At the current rate the contracted allowance is exhausted on 24 Sept 2026, six days before renewal."

**Actions:**
- "Top up tokens →" (navy primary) — navigates to sPM13 with `prefillAmount` = (contracted - consumed)
- "Export CSV" (grey outline)
- "Consumption figures are recalculated hourly and settle at 00:00 UTC on the renewal date. Settled periods cannot be adjusted."

---

## Data Wiring

```typescript
const { subscription } = usePlatformStore()
// MSW: GET /api/services/dashboard → subscription.json

// monitorOn = subscription.burnRateAlert.active  (true in demo)
// monitorLabel = "⚠ Two disciplines are above their expected burn rate"
// Alert text = subscription.burnRateAlert.message

// Status chips: healthy=green, monitor=amber
// Modules C and D from subscription.moduleBreakdown have status:"monitor"

// Top up navigation: /admin/subscription?prefill=152800
// (contracted 4,000,000 - consumed 1,847,200 = 2,152,800 remaining — pass deficit if projected exhaustion)
```

---

## Implementation Notes (from design review)

- `{{ monitorOn }}` maps to `subscription.json` `burnRateAlert.active` — true in demo
- `{{ monitorLabel }}` = "⚠ Two disciplines are above their expected burn rate" (the alert panel header)
- `{{ rows }}` wires from `subscription.json` `moduleBreakdown` array — 5 rows
- Currency is **USD** — all `cost` values in the breakdown display with `$` prefix
- "Top up tokens →" navigates to sPM13 — wire as `<Link to="/admin/subscription">` with prefill state
- Expired rate card blocks "Top up tokens →" button — check `ratecards.json` `validUntil`; if past today, show "A new rate card must be published before purchases can resume" and disable the button

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. 5 stat cards render with correct values: 1,847,200 tokens · 58% remaining · $9,236 spend · $15,000 contracted · 01 Oct 2026 renewal. (AC-PM-016)
2. Breakdown table shows 5 module rows + total row. Modules C and D show amber "⚠ Monitor" status chips.
3. Burn rate alert panel is visible (monitorOn=true). Alert text matches `subscription.burnRateAlert.message`.
4. "Top up tokens →" navigates to the subscription payment screen.
5. "Export CSV" button is present and triggers a mock CSV download.

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM14-services-dashboard.md and execute.
Build ServicesDashboard exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM11-services-dashboard.html.
Run all 3 validation passes and report results before awaiting Session PM15.
```
