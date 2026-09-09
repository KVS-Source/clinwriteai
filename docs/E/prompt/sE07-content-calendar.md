# CD Prompt — sE07 Content Calendar
**Module:** E — Ideation & Publishing · Steel Blue `#005F8E`
**PRD refs:** FR-E-015, FR-E-016, FR-E-018, FR-E-020
**Screen code:** sE07
**Output file:** `aurora-sE07-content-calendar.html`

---

## Screen Purpose

The content calendar — monthly and weekly views for scheduling approved content cards to publishing dates and channels. Includes localisation workflow (FR-E-018) and publishing tracking. Managed by the Content Calendar Manager.

---

## Layout

Full-width calendar area with a right sidebar (~280px) for the unscheduled card queue.

**Header:** "Content Calendar · October 2026" with Month/Week toggle, "Previous month" / "Next month" navigation, channel filter (All Channels / LinkedIn / Blog / X/Twitter / HCP / Email / Medical Affairs), TA filter, "+ Schedule content" button (steel blue).

---

## Monthly Calendar View (default)

Standard monthly grid. October 2026.

**Days with content (three examples):**

**22 Oct (Tuesday):**
Steel blue dot (scheduled, not yet published).
Card chip: "Veloricept PFS Data · LinkedIn · C-001 · Dr S. Chen → Creative Team"
On hover: tooltip with full card title, channel, assigned Creative member, Medical Affairs reviewer.

**24 Oct (Thursday):**
Steel blue dot.
Card chip: "VELORA-301 Blog Post · Blog · C-002"
Second chip (amber): "⚠ Social listening alert on similar content — review before publishing"

**28 Oct (Monday):**
Two dots (two pieces of content).
"HCP Summary · HCP Channel · C-003" and "Localised: FR Version · Blog · C-002-FR (France) · Local MA pending"

**Overdue (past date with red-tinted `#FFF1F2` cell):**
Oct 18 — "Cardiometabolic Awareness Post · Facebook · OVERDUE · Not published" — amber outline, "Overdue · 24h alert sent"

---

## Right Sidebar — Unscheduled Queue

Header: "Approved — Ready to Schedule" (3 cards)

Three card tiles:
- "C-001 LinkedIn · Revised ✓ · MA Approved 19 Oct · Oncology"
- "C-002 Blog Post · MA Approved 19 Oct · Oncology"
- "C-003 HCP Summary · MA Approved 19 Oct · Oncology"

Drag-and-drop to calendar day to schedule. Or click "+ Schedule" on a card to open a date/channel picker.

When dragging a card to a calendar day: date picker and channel confirmation appear as a small overlay:
- Date: 22 Oct 2026
- Channel: LinkedIn (pre-selected from card)
- Assigned to: [Creative team member dropdown]
- Notification: "MA 3-day advance notice: 19 Oct — sent automatically"

---

## Localisation Panel (FR-E-018) — accessible via "🌐 Localise" button on scheduled card

Triggered from the 28 Oct Blog entry localised card.

**Parent card:** "C-002 Blog Post · English (Parent) · Approved ✓"

**Localised versions:**
- France (FR): "Local MA review pending · GenBioCa France · Assigned 19 Oct"
- Germany (DE): "Not yet started"
- Japan (JP): "Not yet started"

"Add locale" button → country + affiliate + local MA contact fields.

"Local MA review links sent by email to: GenBioCa France MA contact (localised PDF + instructions in French)."

Each localised version links to the parent approved card and shows: language / affiliate / status.

---

## Weekly View (toggle)

Same calendar content shown in 7-column week grid. Hours on Y-axis (optional — for Social scheduling this is relevant for optimal posting time).

Each content chip shows: time slot, channel icon, card title, Creative team member assigned.

---

## Notification Preview Strip (below calendar)

"Upcoming notifications (FR-E-020):" — four notification preview rows in IBM Plex Mono:
- "19 Oct · Email + SMS → Creative Team · LinkedIn post due 22 Oct (3-day advance)"
- "21 Oct · Email + SMS → Creative Team · Blog post due 24 Oct (3-day advance)"
- "24 Oct · Email → MA Team Lead · Social listening alert on 24 Oct post — review before publish"
- "KOL reminder system: if KOL review stalls > 3 days → Reminder 1 auto-sent. > 5 days → Reminder 2. > 7 days → Escalation to Ideation Lead + MA Lead. (FR-E-020 / P2-09 — shown in audit trail)"

---

## Design Notes

- The calendar is the emotional centre of Module E — it should feel visual and alive, not like a spreadsheet. Use subtle colour coding per channel (LinkedIn blue, Blog neutral, HCP teal-tinted, Email grey) with the steel blue accent for scheduled items.
- The "⚠ Social listening alert" chip on 24 Oct is the FR-E-017 auto-stop warning. It should be prominent but not alarming — amber, not red.
- Overdue items (past date, not published) use the `#FFF1F2` red-tinted background on the calendar cell — this is the only red element in Module E, consistent with the platform pattern (overdue/expired uses red-tinted).
- The localisation panel is accessible from any scheduled card — don't make it a separate screen. It's a slide-out from the calendar.


> **UTM parameters (FR-E-016):** When a Creative team member marks content as published, the system prompts for (or auto-generates) UTM parameters for digital posts and SEO metadata for blog/article content. UTM format: utm_source=[channel]&utm_medium=[social/organic]&utm_campaign=[project-code]-[month]. These are stored in the publish_record entity and reported in sE08.
