# Session E08 — Publishing Monitor
**Screen:** sE08 · Publishing Monitor
**Route:** `/projects/:projectId/ideation-publishing/publishing`
**Component:** `src/modules/ideation-publishing/screens/PublishingMonitor.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/E/design/aurora-sE08-publishing-monitor-social-listening.html`
**Data:** `src/data/ideationCalendar.json`, `src/data/socialListeningAlerts.json`, `src/data/atomisedContent.json`
**Store:** `calendarStore`

---

## What to Build

Unified publishing monitor — list view of all scheduled/published/overdue content with sentiment tracking and the "Mark as published" human action (DD-E-005: no direct social API calls).

---

## Screen Anatomy

Two-column. Left: publishing queue list. Right: active entry detail.

**Header:** "Publishing Monitor · 2 overdue · 1 scheduled · 2 published" status chips.

**Left — Publishing queue (5 entries sorted overdue first):**

1. **cal-004 Safety HCP (OVERDUE 8 days):** Rose chip. "Safety Profile — HCP Summary · Alex Brennan · 18 Oct → overdue"
2. **cal-002 Blog PFS (OVERDUE 48h):** Rose chip + amber sentiment dot. "Primary PFS — Blog Post · Alex Brennan · 25 Oct → overdue"
3. **cal-005 LinkedIn Subgroup (SCHEDULED):** Teal chip. "Subgroup — LinkedIn · Alex Brennan · 5 Nov"
4. **cal-001 LinkedIn PFS (PUBLISHED ✓):** Green chip. "Primary PFS — LinkedIn · Published 22 Oct · sentiment 0.78"
5. **cal-003 HCP PFS (PUBLISHED ✓):** Green chip. "Primary PFS — HCP · Published 28 Oct"

**Right — cal-002 detail (active, overdue):**

Content preview from `atomisedContent.json` ac-002 (Blog Post):
Shows first 150 chars of `contentText`, read-only.

**Flagged comment (from sE08 design — verbatim):**
- Comment: `"The safety data for veloricept isn't as clean as this suggests — grade 3 AEs were higher than presented."` — **@HCP_UK** · LinkedIn · 25 Oct 2026 07:52 UTC
- Auto-categorised: **Safety concern · HCP audience**
- MA notification: Dr Rebecca Morton · 25 Oct 08:30 UTC
- MA review verdict: "Reviewed · no action required · Safety data are correctly presented per **SmPC v2.1 §4.8**. Measured: grade 3+ TRAEs **34.2%**. Threshold: SmPC §4.8 reported rate 34.2%. Verdict: consistent." · Dr Rebecca Morton · 25 Oct 2026 09:15 UTC
- UTM performance: `utm_campaign=VELORA-301-Oct26` · 234 sessions · 18 social referrals · avg session 3m 42s

**Sentiment alert panel (sla-001):**
- Alert: "Negative sentiment detected · score 0.36 · triggered 23 Oct 14:30"
- Threshold note: "Auto-stop threshold: 0.50 negative. Score 0.36 — notification sent, auto-stop not triggered."
- Resolution: "Resolved by Dr Rebecca Morton · 24 Oct 09:00 · 'One critical comment, off-label query. No label issue. Monitoring continues.'"
- Status: `✓ Resolved` (green)

**Auto-stop check note (AC-E-014):**
"A sentiment check will run before publishing future VELORA-301 content due to this alert."

**"Mark as published" button** (teal primary — DD-E-005):
"Publishing in v0.1 is human-executed. This button records the event — it does not call any social platform API."
UTM params field + SEO metadata field visible.

---

## Data Wiring

```typescript
const { entries, socialAlerts, markPublished } = useCalendarStore()

// Mark published (DD-E-005 — no social API call)
const handleMarkPublished = (entryId: string, utmParams: string, seoMetadata: object) =>
  ideationPublishingApi.markPublished(entryId, { publishedBy: 'user-cr', utmParams, seoMetadata })
// MSW: POST /api/ideation-calendar/:id/mark-published
// Records the event server-side — does NOT call LinkedIn/Twitter/etc

// Sentiment alert
const entryAlert = socialAlerts.find(a => a.calendarEntryId === 'cal-002')
// sla-001: resolved=true, score=0.36, autoStopTriggered=false
```

---

## Navigation

- Calendar icon → sE07

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Two overdue entries appear first in the list with rose chips. cal-002 shows both rose chip and amber sentiment dot.
2. cal-001 and cal-003 show green "✓ Published" chips with published dates.
3. The cal-002 detail panel shows the sentiment alert: score 0.36, "auto-stop not triggered", resolution by Dr Rebecca Morton.
4. The "Mark as published" button shows the note: "Content is published manually by the Creative Team following the platform notification. Direct channel publishing is not enabled in this release." (DD-E-005).
5. The auto-stop check note: "A sentiment check will run before publishing future VELORA-301 content due to this alert."

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/E/CC/session-E08-publishing-monitor.md and execute.
Build PublishingMonitor exactly as specified, run all 3 validation passes, and report results.
```
