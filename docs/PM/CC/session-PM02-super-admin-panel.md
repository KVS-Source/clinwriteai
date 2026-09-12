# Session PM02 — Super Admin Panel
**Screen:** sPM05 · Super Admin Panel
**Route:** `/super-admin`
**Component:** `src/platform/screens/SuperAdminPanel.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM05-super-admin-panel.html`
**Data:** `platformConfig.json`, `users.json`, `auditTrail.json`
**Store:** `superAdminStore`
**Access:** `<SuperAdminGuard>` — Super Admin only

---

## What to Build

GenBioCa-internal panel. Alex Thornton · Super admin. Four sections: Client Management, Platform Analytics, AI Engines, Feature Flags + Platform Audit Log. Navy accent. The sidebar shows "SUPER ADMIN" section separately from the Admin section.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Left nav tabs:** Clients (default) · Platform Analytics · AI Engines · Feature Flags · Platform Audit Log

**Client Management tab:**
- "7 active clients · 1 suspended · 1 churned" header + "+ New client →" button
- `{{ clients }}` table loop — columns: Client name · Plan · Status · Admin contact · Created · Revenue to date · Actions
- `{{ c.name }}` / `{{ c.note }}` / `{{ c.plan }}` / `{{ c.status }}` / `{{ c.contact }}` / `{{ c.created }}` / `{{ c.revenue }}` / `{{ c.actions }}`
- Hard-coded client rows (5 visible):
  - GenBioCa Sciences (internal) · Enterprise · ✓ Active · Dr James Hartley · 01 Jan 2026 · £0 · View
  - MedPharma Ltd · Professional · ✓ Active · Sarah Okonkwo · 15 Mar 2026 · £24,800 · View / Suspend
  - GlobalClinicals Inc · Starter · ✓ Active · Mark Reeves · 01 Jun 2026 · £6,200 · View / Suspend
  - BioTherapeutics AG · Enterprise · ⚠ Suspended · Hans Müller · 12 Feb 2026 · £41,000 · Reactivate
  - DataRx Corp · Professional · ○ Churned · — · 10 Apr 2026 · £8,400 · View (read-only)
- "Suspension and reactivation are recorded against the client with the acting Super Admin named. A churned client account becomes read-only and cannot be deleted."

**Platform Analytics tab:**
- 4 stat cards: Total active users 247 · Active projects 34 · Documents created 1,847 (rolling 30 days) · AI tokens 4.2M (rolling 30 days)
- Revenue strip: MRR £18,400 · ARR £220,800 · Churn this quarter 1 client · Avg tokens/client/month 600K
- Wire from MSW-computed values (not a static fixture — compute in handler)

**AI Engines tab:**
- `{{ engines }}` table loop from `platformConfig.json` `aiEngine.availableEngines`
- `{{ e.name }}` / `{{ e.provider }}` / `{{ e.status }}` / `{{ e.action }}`
- "Removing an engine here removes it from every client's Admin panel. Sessions already run keep their recorded engine."

**Feature Flags tab:**
- `{{ flags }}` table loop from `platformConfig.json` `featureFlags`
- `{{ f.feature }}` / `{{ f.status }}` / toggle per row
- "Flags apply platform-wide and take effect on the next page load for every client."

**Platform Audit Log (always visible as final section):**
- 3 hard-coded entries from `auditTrail.json` filtered to `module: 'platform'` and `userId: 'user-sa'`
- "Audit records are immutable and cannot be edited, backdated or removed."

---

## Data Wiring

```typescript
const { clients, analytics, engines, flags, auditLog } = useSuperAdminStore()

// MSW: GET /api/super-admin/clients → computed client list
// MSW: GET /api/super-admin/analytics → { totalUsers: 247, activeProjects: 34, ... }
// MSW: GET /api/regulatory-frameworks used by PM18 — same store
// Platform audit log: filter auditTrail where module==='platform' && userId==='user-sa'
// → aud-015 (rate card), aud-018 (client created)

// Client table — no static fixture; MSW returns computed array
// Status chip colours: Active=green, Suspended=amber, Churned=grey
```

---

## Implementation Notes (from design review)

- `{{ clients }}` is not a static fixture — Super Admin sees all clients across the platform. MSW returns a computed array with the 5 hard-coded client rows shown in the design
- `{{ c.note }}` = small sub-label under client name (e.g. "(internal)" for GenBioCa Sciences)
- Platform Audit Log derives from `auditTrail.json` filtered to `module: 'platform'` + `userId: 'user-sa'` — shows aud-015, aud-018
- The note "GenBioCa-internal. Super Admin governs every client organisation; Admin governs a single client account." must be visible on the screen — hard-code it as a sub-header
- Revenue strip uses GBP (£) — this is platform-level revenue data, not client billing data — keep GBP here even though client-side screens use USD
- Active projects count: 34 — hard-code in MSW analytics handler

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Client Management tab shows "7 active clients · 1 suspended · 1 churned". BioTherapeutics AG shows amber "⚠ Suspended" chip. DataRx Corp shows grey "○ Churned" chip. (AC-PM-005)
2. Platform Analytics tab shows: Total active users 247 · Active projects 34 · Documents created 1,847 · AI tokens 4.2M.
3. AI Engines tab shows 4 engines from `platformConfig.json`. Claude Sonnet 4.6 shows "Active". (AC-PM-004)
4. Feature Flags tab shows 4 flags. "Best Practices API" shows "○ Beta" status.
5. Platform Audit Log shows 3 immutable entries with "Audit records are immutable" note visible.

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM02-super-admin-panel.md and execute.
Build SuperAdminPanel exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM05-super-admin-panel.html.
Run all 3 validation passes and report results before awaiting Session PM03.
```
