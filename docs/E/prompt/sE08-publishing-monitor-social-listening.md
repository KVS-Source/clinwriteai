# CD Prompt — sE08 Publishing Monitor & Social Listening
**Module:** E — Ideation & Publishing · Steel Blue `#005F8E`
**PRD refs:** FR-E-016, FR-E-017, FR-E-020
**Screen code:** sE08
**Output file:** `aurora-sE08-publishing-monitor-social-listening.html`

---

## Screen Purpose

Post-publishing tracking and social listening dashboard. Tracks whether content was published on schedule, captures UTM/SEO metadata, and monitors sentiment across published channels. The Medical Affairs Team Lead receives alerts when negative sentiment exceeds the configured threshold.

---

## Layout

Two-column layout. Left: publishing record log (~45%). Right: social listening panel per published piece (~55%).

**Header:** "Publishing Monitor · VELORA-301 · October 2026" with TA filter and channel filter. "Export publishing report" secondary button.

---

## Left Panel — Publishing Record Log

**Summary strip:** "5 pieces published · 2 on schedule · 1 early · 1 late · 1 overdue"

**Published entries list (chronological, most recent first):**

**Entry 1 — LinkedIn · 22 Oct 2026:**
- Title: "Veloricept PFS Data — LinkedIn Post"
- Status: "✓ Published on schedule · 22 Oct 09:00 UTC"
- Published by: "Alex Turner · Creative Team · Manually published per platform notification"
- UTM parameters: "utm_source=linkedin&utm_medium=social&utm_campaign=VELORA-301-PFS-Oct26"
- SEO: "N/A (social post)"
- Sentiment: "🟢 Positive · 47 engagements · 12 reposts"

**Entry 2 — Blog Post · 24 Oct 2026:**
- Title: "VELORA-301 Phase III — PFS Blog Post"
- Status: "⚠ Published 1 day late · 25 Oct 08:15 UTC (scheduled: 24 Oct)"
- Amber overdue chip: "Overdue alert sent 24 Oct 12:00 → MA Team Lead + Calendar Manager"
- UTM: "utm_source=blog&utm_medium=organic&utm_campaign=VELORA-301-Oct26"
- SEO metadata: "Title tag ✓ · Meta description ✓ · Canonical URL ✓"
- Sentiment: "🟡 Mixed · 234 page views · 3 comments · 1 negative comment flagged"

**Entry 3 — HCP Summary · 28 Oct 2026 (scheduled):**
- Status: "○ Scheduled · 3 days"
- "Social listening pre-check: ⚠ Negative sentiment on prior NSCLC content detected — review before publishing" (amber)
- Auto-stop check: "No auto-stop triggered (threshold: 40% negative. Current: 22%)"

---

## Right Panel — Social Listening Detail (Blog Post entry active)

**Header:** "Social Listening · VELORA-301 Phase III Blog Post · 24–26 Oct 2026"

**Sentiment Overview:**
Donut chart: 74% positive (steel blue) / 18% neutral (grey) / 8% negative (amber — below threshold of 40%)

**Engagement metrics:**
- Page views: 234
- Average time on page: 3m 42s
- Social shares: 18 (LinkedIn 12, X/Twitter 4, Facebook 2)
- Comments: 3

**Flagged negative comment (amber card):**
- "Comment on LinkedIn by @HCP_UK: 'The safety data for veloricept isn't as clean as this suggests — grade 3 AEs were higher than presented.'"
- Auto-categorised: "Safety concern — HCP audience"
- Notified: "MA Team Lead alerted 25 Oct 08:30 · Dr Rebecca Morton"
- Status: "✓ Reviewed by MA Lead · 25 Oct 09:15 · No action required — safety data correctly presented per SmPC v2.1 §4.8"

**Auto-stop assessment:**
"Future scheduled content on same topic (HCP Summary · 28 Oct): Auto-stop check run — negative sentiment 8% (threshold: 40%) — no auto-stop triggered. Calendar Manager notified for awareness."

**UTM Performance:**
IBM Plex Mono: "utm_campaign=VELORA-301-Oct26 · 234 sessions · 18 social referrals · Avg session 3m42s"

---

## Design Notes

- The social listening panel is about ambient awareness, not detailed analytics — keep metrics simple. The key action is the flagged negative comment + MA Lead notification + resolution record.
- The auto-stop assessment is the most regulatory-relevant feature in this panel: show clearly whether the threshold was breached and what action was taken.
- "Published manually per platform notification" (DD-E-005) is shown on every published entry — this communicates the v0.1 decision that publishing is human-executed, not direct API publishing. Phase 2 connectors will change this.
- Overdue entries use amber styling, not red — one day late in content scheduling is a process issue, not a clinical error.
