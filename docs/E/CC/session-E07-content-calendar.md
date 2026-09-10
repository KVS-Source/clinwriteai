# Session E07 — Content Calendar
**Screen:** sE07 · Content Calendar
**Route:** `/projects/:projectId/ideation-publishing/calendar`
**Component:** `src/modules/ideation-publishing/screens/ContentCalendar.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/E/design/aurora-sE07-content-calendar.html`
**Data:** `src/data/ideationCalendar.json`, `src/data/socialListeningAlerts.json`
**Store:** `calendarStore`

---

## What to Build

October/November 2026 content calendar. 5 entries from `ideationCalendar.json`. Two overdue items shown with red tint cells. Sentiment alert badge on cal-002. Month view default.

---

## Screen Anatomy

**Current user:** Mr Daniel Okafor · Content Calendar Manager (confirmed from sE07 design)

**Header:** "Content Calendar · October 2026", month/week toggle, "Schedule content →" button (teal).

**Month grid — October 2026. Key dates:**

**Oct 18 — cal-004 HCP Safety (OVERDUE):**
- Cell background: `#FFF1F2` (rose tint)
- Content chip: "Safety Profile — HCP · OVERDUE · 8 days" (rose chip)
- `sla-001` alert not on this entry (alert is on cal-002)

**Oct 22 — cal-001 LinkedIn PFS (PUBLISHED ✓):**
- Cell: normal
- Content chip: "Primary PFS — LinkedIn · ✓ Published" (green)
- Sentiment: 0.78 positive — no alert shown

**Oct 25 — cal-002 Blog PFS (OVERDUE):**
- Cell background: `#FFF1F2` (rose tint)
- Content chip: "Primary PFS — Blog · OVERDUE · 48h" (rose chip)
- Sentiment alert badge on chip: amber dot from `socialListeningAlerts.json` sla-001 (score 0.36, resolved)
- Tooltip/detail: "Sentiment alert: 0.36 negative · Resolved by Dr Rebecca Morton · 24 Oct"

**Oct 28 — cal-003 HCP PFS (PUBLISHED ✓):**
- Content chip: "Primary PFS — HCP · ✓ Published" (green)

**Nov 5 — cal-005 LinkedIn Subgroup (SCHEDULED):**
- Content chip: "Subgroup — LinkedIn · Scheduled" (teal)
- MA 3-day advance notification badge: "MA notified 2 Nov ✓" (from `maAdvanceNotificationSent: true`)

**Overdue notification logic (AC-E-013):**
- Any scheduled item past its date shows red tint + "OVERDUE" chip
- Notification was sent to MA Lead and Calendar Manager within 24h of scheduled date

---

## Data Wiring

```typescript
const { entries, socialAlerts, scheduleCard } = useCalendarStore()

useEffect(() => {
  calendarStore.fetchEntries()        // → ideationCalendar.json (5 entries)
  calendarStore.fetchSocialAlerts()   // → socialListeningAlerts.json (1 alert for cal-002)
}, [])

// Overdue detection
const isOverdue = (entry: CalendarEntry) =>
  entry.status === 'overdue' || (entry.scheduledDate < today && entry.status !== 'published')

// Social alert badge
const alertForEntry = (entryId: string) =>
  socialAlerts.find(a => a.calendarEntryId === entryId)
// sla-001.calendarEntryId === 'cal-002' → badge on Oct 25 cell

// MA advance notification — cal-005
// maAdvanceNotificationSent: true → show "MA notified 2 Nov ✓" badge on Nov 5 cell
```

---

## Localisation Panel (New — from sE07 design review)

The scheduling screen includes a full localisation workflow not in the original CC brief. CC must build:

```typescript
// New component: LocalisationPanel
// Uses: LocaleRecord type (Data Model v5 §55)
interface LocaleRecord {
  id: string; ideationContentCardId: string; localeCode: string
  country: string; status: 'pending'|'in-review'|'approved'|'published'
  affiliateContactEmail: string; localPDFPath: string|null; detail: string
  parentCardApprovedAt: string
}
```

Panel shows: parent card name (e.g., "C-002 blog post · English parent"), approval date, locale rows (code, country, status, detail), "+ Add locale" action. Local MA review links sent by email to affiliate contact in local language. Every localised version links back to parent card record.

MSW: `GET /api/ideation-cards/:id/locales` → `LocaleRecord[]`
MSW: `POST /api/ideation-cards/:id/locales` → `LocaleRecord`

## Navigation

- Click calendar entry chip → opens entry detail drawer with content preview and action
- "Schedule content →" → opens scheduling modal

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Oct 18 and Oct 25 cells have `#FFF1F2` rose background. Both show "OVERDUE" in the content chip.
2. Oct 22 and Oct 28 show green "✓ Published" chips. No rose background.
3. Oct 25 (cal-002) shows an amber sentiment alert badge. Hovering/clicking shows "Sentiment alert: 0.36 negative · Resolved by Dr Rebecca Morton · 24 Oct".
4. Nov 5 (cal-005) shows "Scheduled" teal chip and "MA notified 2 Nov ✓" advance notification badge.
5. The calendar renders a correct October 2026 month grid with November dates visible.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/E/CC/session-E07-content-calendar.md and execute.
Build ContentCalendar exactly as specified, run all 3 validation passes, and report results.
```
