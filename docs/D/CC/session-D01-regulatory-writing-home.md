# Session D01 — Regulatory Writing Home
**Screen:** sD01 · Regulatory Writing Home
**Route:** `/projects/:projectId/regulatory-writing`
**Component:** `src/modules/regulatory-writing/screens/RegulatoryWritingHome.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/D/design/aurora-sD01-regulatory-writing-home.html`
**Data:** `src/data/regulatorySubmissions.json`, `src/data/regulatoryAlerts.json`, `src/data/ectdGranularityMap.json`
**Store:** `regulatorySubmissionStore`, `regulatoryIntelligenceStore`, `ectdStore`

---

## What to Build

The entry point for Module D. Equivalent in structure to Module C Medical Writing Home (sC01) but scoped to regulatory dossier submissions with crimson `#B0200D` accent. Three primary zones: metrics strip, submission card list, and right panel showing Regulatory Intelligence alerts and eCTD publishing mini-monitor.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Metrics strip** — four stat chips, crimson left border:
- Active submissions: count from `regulatorySubmissions.json` where `status !== 'submitted'` — shows **2**
- Super Review pending: count where `status === 'super-review'` — shows **1**
- Gateway submissions this quarter: count from `gatewaySubmissions.json` where `transmittedAt` is in Q4 2026 — shows **2**
- Regulatory alerts: count from `regulatoryAlerts.json` where `acknowledgedByIds` is empty — shows **2** with amber dot

**Submission card list:**

Card 1 — sub-001 VELORA-301 NDA (Stage 2):
- Tag chip: `NDA/MAA` (crimson `#FFF5F5`/`#B0200D`)
- Stage progress: 6-dot indicator, dot 2 active (crimson fill)
- Consistency chip: "Cross-module check: 2 contradictions flagged" (amber)
- Source chip: "Source: VELORA-301 CSR v1.0 · Module A ✓" (blue-grey, small)

Card 2 — sub-002 VELORA-301 PSUR (Stage 4 Super Review):
- Tag chip: `PSUR/PBRER`
- Stage 4 active
- Status chip: "Super Review — 3 of 6 roles signed" (amber)

Card 3 — sub-003 AURELIA-101 IND (Stage 6 Submitted):
- Tag chip: `IND`
- Stage 6 complete (green dots)
- ACK badge: "ACK2 ✓ — EMA CESP · 12 Oct 2026" (green)

**Right panel — Regulatory Intelligence:**
Two alert cards from `regulatoryAlerts.json`. Each card: amber left border, framework name, change summary (truncated to 2 lines), "View affected sections →" link, timestamp. "View all →" header link → navigates to sD11 route.

**eCTD Publishing Monitor mini-panel** (below RI alerts):
- "47 of 62 sections compiled ✓ · 15 pending"
- Derived from `ectdGranularityMap.json`: count `status === 'signed'` = compiled, remainder = pending
- Horizontal progress bar: crimson fill at 76%
- "View eCTD map →" link → sD03

---

## Data Wiring

```typescript
const { submissions, fetchSubmissions } = useRegulatorySubmissionStore()
const { alerts, fetchAlerts } = useRegulatoryIntelligenceStore()
const { nodes, fetchNodes } = useEctdStore()

useEffect(() => {
  fetchSubmissions(projectId)  // GET /api/projects/:id/regulatory-submissions
  fetchAlerts()                // GET /api/regulatory-alerts
  fetchNodes('sub-001')        // GET /api/regulatory-submissions/sub-001/ectd-map
}, [projectId])

// Metrics
const activeCount = submissions.filter(s => s.status !== 'submitted').length          // 2
const superReviewCount = submissions.filter(s => s.status === 'super-review').length  // 1
const alertCount = alerts.filter(a => a.acknowledgedByIds.length === 0).length        // 2
const compiled = nodes.filter(n => n.status === 'signed').length                      // 47 of 62 visible
```

---

## Navigation

- Click submission card → navigate to `submissions/${sub.id}` (sD02 for Stage 1/2, appropriate screen for others)
- "View all →" in RI panel → navigate to `intelligence` (sD11)
- "View eCTD map →" → navigate to `submissions/sub-001/ectd-map` (sD03)
- "+ New Submission" button → navigate to `submissions/new` (sD02 new flow)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`

**Pass 2:** `npm run build`

**Pass 3 — 5 smoke tests:**
1. Metrics strip shows 4 chips with crimson left border. Active submissions = 2, Alerts = 2 with amber dot.
2. sub-001 card shows "Cross-module check: 2 contradictions flagged" amber chip. sub-003 shows "ACK2 ✓ — EMA CESP · 12 Oct 2026" green badge.
3. RI panel shows exactly 2 alert cards with amber left borders. "View all →" link is present.
4. eCTD mini-panel shows "47 of 62 sections compiled ✓ · 15 pending" with a crimson progress bar.
5. Clicking sub-001 card navigates to the Stage 2 route. Clicking "View eCTD map →" navigates to the eCTD map route.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D01-regulatory-writing-home.md and execute.
Build RegulatoryWritingHome exactly as specified, run all 3 validation passes, and report results.
```
