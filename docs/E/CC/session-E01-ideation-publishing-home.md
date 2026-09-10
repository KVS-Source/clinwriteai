# Session E01 — Ideation & Publishing Home
**Screen:** sE01 · Ideation & Publishing Home
**Route:** `/projects/:projectId/ideation-publishing`
**Component:** `src/modules/ideation-publishing/screens/IdeationPublishingHome.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/E/design/aurora-sE01-ideation-publishing-home.html`
**Data:** `src/data/ideationProjects.json`
**Store:** `ideationStore`

---

## What to Build

Entry point for Module E. Three project cards showing the lifecycle: ip-001 Approved (fully worked example), ip-002 Under Review, ip-003 Uploaded with BLOCKED badge (source gate failed). Teal `#0D9488` accent throughout.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Metrics strip** — four stat chips, teal left border:
- Active projects: 3 (all projects where `status !== 'uploaded'` that are not blocked)
- Approved content cards: 3 (sum of `approvedCardCount` across all projects)
- Published this month: 2 (count `ideationCalendar.json` entries where `status === 'published'`)
- Pending MA approval: 0 (ip-002 is under-review but MA not yet reached)

**Project card list — 3 cards from `ideationProjects.json`:**

**Card 1 — ip-001 VELORA-301 Efficacy (Stage 4 Approved):**
- Stage badge: `Approved` · teal `#F0FDFA`/`#0D9488`
- TA chip: `Oncology`
- Created by: "Ms Priya Nair (Ideation Lead)"
- "3 of 3 cards approved · 2 published · 1 scheduled"
- MA stamp: "MA approved · Dr Rebecca Morton (MA Team Lead) · 19 Oct 2026"
- Progress: 4-dot stage indicator, all dots filled teal

**Card 2 — ip-002 AURELIA-101 Phase I (Stage 2 Under Review):**
- Stage badge: `Under Review` · amber
- TA chip: `Cardiometabolic`
- "2 cards · KOL review pending"
- Progress: dot 2 active

**Card 3 — ip-003 VELORA-302 Pre-launch (Stage 1 Blocked):**
- Stage badge: `Blocked` · `#FFF1F2`/`#BE123C` (rose — source gate fail is a hard block, distinct from amber warning)
- TA chip: `Oncology`
- Block reason chip: "Source gate failed — document 'In Authoring' in Module A"
- Progress: dot 1 with block indicator

**"+ New Ideation Project" button** — teal primary.

---

## Data Wiring

// Personas (confirmed from design files):
// user-il = Ms Priya Nair (Ideation Lead)
// user-ma = Dr Rebecca Morton (MA Team Lead)
// user-ccm = Mr Daniel Okafor (Content Calendar Manager)

```typescript
const { projects, fetchProjects } = useIdeationStore()

useEffect(() => {
  fetchProjects(projectId)
}, [projectId])
// MSW: GET /api/projects/:id/ideation → ideationProjects.json

// Metrics
const approved = projects.reduce((n, p) => n + (p.approvedCardCount ?? 0), 0)  // 3
const active = projects.filter(p => p.status !== 'uploaded' && p.sourceGateStatus !== 'blocked').length
```

---

## Navigation

- Click ip-001 card → `projects/ip-001` (sE02)
- Click ip-002 card → `projects/ip-002` (sE02)
- Click ip-003 card → `projects/ip-003` (sE02 showing blocked state)
- "+ New Ideation Project" → `projects/new` (sE02 new flow)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Metrics strip shows 4 chips with teal left border. Approved content cards = 3.
2. ip-001 card shows teal "Approved" badge and "MA approved · Dr Rebecca Morton · 19 Oct 2026".
3. ip-003 card shows rose `#BE123C` "Blocked" badge and the source gate failure reason.
4. ip-002 card shows amber "Under Review" badge and "2 cards · KOL review pending".
5. Clicking ip-001 navigates to the ip-001 project route (sE02).

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/E/CC/session-E01-ideation-publishing-home.md and execute.
Build IdeationPublishingHome exactly as specified, run all 3 validation passes, and report results.
```
