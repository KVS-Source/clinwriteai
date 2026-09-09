# CD Prompt — sE01 Ideation & Publishing Home
**Module:** E — Ideation & Publishing (Add-On)
**Colour:** Steel Blue `#005F8E`
**Tailwind tokens:** steel-700 `#005F8E`, steel-50 `#F0F7FF`, steel-100 `#DBEAFE`, steel-200 `#BFDBFE`
**PRD refs:** FR-E-001, FR-E-002, FR-E-015, FR-E-017, FR-E-020
**Screen code:** sE01
**Output file:** `aurora-sE01-ideation-publishing-home.html`

---

## Screen Purpose

The entry point for Module E. Displays all ideation projects and content cards across all four workflow stages, a content calendar preview, and post-publish social listening alerts. Lighter and more visual than Modules A–D — this is a communications/marketing module, not a regulated authoring tool.

---

## Layout

Standard Aurora AppShell. Steel Blue (`#005F8E`) sidebar accent — left border on active item, `#F0F7FF` tint.

**Metrics strip** (four stat chips, steel blue left-border accent):
- Active ideation projects: 3
- Content cards awaiting approval: 4
- Scheduled this month: 7
- Social listening alerts: 1 (amber dot)

---

## Four-Stage Pipeline View (Kanban)

Below the metrics strip: a horizontal four-lane Kanban showing all content cards across stages. Lanes left to right:

**Uploaded** (grey header):
- "VELORA-301 KOL Session Summary · PDF · Oncology · Uploaded 12 Oct" — source chip "Module C ✓"
- "AURELIA-101 Phase I Results Brief · External upload · Cardiometabolic"

**Under Review** (steel blue header):
- "Veloricept PFS Data — LinkedIn Series · 3 cards · KOL: Prof. Hartley reviewing"
- Amber chip: "Review due 20 Oct · 2 days"

**Reviewed** (amber header):
- "Veloricept Safety Profile — HCP Article · KOL approved ✓ · MA review pending"

**Approved** (green header):
- "VELORA-301 Phase III — Blog Post Series · Approved ✓ · Scheduled 22 Oct"
- Green chip: "Scheduled · LinkedIn · 22 Oct"

Each card: content type chip, TA tag, stage status pill, source chip (Module A/B/C/D or External), assigned Creative team member avatar.

---

## Right Panel (narrow, ~280px)

**Content Calendar Preview** — compact monthly view. Current month. Days with scheduled content shown with steel blue dots. Three scheduled entries visible.

**Social Listening Alerts** — one amber card:
- "Veloricept PFS Blog · LinkedIn · Negative sentiment spike · 3 mentions · Action: review before 24 Oct post"
- "View full report →" link (→ sE08)

**Notification feed** — last three notifications in IBM Plex Mono small:
- "KOL review due · Prof. Hartley · VELORA-301 · 18 Oct"
- "MA approval reminder · Dr R. Morton · 19 Oct · 3 days advance"
- "Published · Veloricept Safety Profile · LinkedIn · 16 Oct ✓"

---

## Actions

- "+ New Ideation Project" primary button (steel blue) → sE02 Upload & Source Check
- "Pull from Master Library" secondary button → sE02 (Master Library pull flow)
- "Open Calendar →" → sE07 Content Calendar
- Click any card → relevant stage screen

---

## Design Notes

- Module E is visually lighter than Modules A–D. The four-stage Kanban is the primary UI metaphor — no document editor, no complex reviewer panels.
- Steel blue `#005F8E` is also used for platform-level blocking states in other modules — in Module E it is the module accent. Keep usage consistent: module accent only (sidebar, metrics border, Kanban lane header active). Blocking states in Module E still use `#005F8E` as the blocking colour — there is no conflict since Module E has no red anywhere.
- Cards in the Kanban should feel like sticky notes — compact, visual, with a TA colour tag strip at the top of each card.
