# Session PM08 — Regulatory Framework Admin
**Screen:** sPM18 · Regulatory Framework Admin
**Route:** `/super-admin/frameworks` (edit) · `/admin/frameworks` (read-only)
**Component:** `src/platform/screens/RegulatoryFrameworkAdmin.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM18-regulatory-framework-admin.html`
**Data:** `regulatoryFrameworks.json`
**Store:** `superAdminStore`
**Access:** `<SuperAdminGuard>` (edit) · `<AdminGuard>` (read-only)

---

## What to Build

Full-width framework table + edit drawer. Current user: Alex Thornton · Super admin. 15 frameworks, 2 with status changes.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Header:**
"Regulatory framework registry · 15 frameworks"
"Status changes automatically trigger regulatory intelligence alerts in every applicable discipline. Frameworks cannot be deleted — only marked superseded."
"+ Add framework →" (navy primary — Super Admin only)
"Client-level Admins see this registry in read-only mode. Only Super Admin can add a framework or change a status."

**Framework table — `{{ frameworks }}` loop from `regulatoryFrameworks.json`:**
Columns: Code · Full name · Issuer · Scope · Status · Updated
`{{ f.code }}` / `{{ f.name }}` / `{{ f.issuer }}` / scope dots / `{{ f.status }}` / `{{ f.updated }}`
"15 frameworks · 2 changed in the last 12 months"
"Scope dots name their discipline on hover"

Status chips: ✓ Current (green) · ⚠ Updated (amber) · ⚠ Draft revision (amber) · Superseded (grey)

**Edit drawer (rf-008 ICH E2C(R2) selected):**
- `{{ activeCode }}` · `{{ activeName }}` · `{{ activeIssuer }}` · `{{ activeUpdated }}`
- Scope: `{{ scopeOptions }}` checkboxes (A B C D E) · `{{ s.mark }}` / `{{ s.label }}`
- Status: `{{ statusOptions }}` dropdown
- Change summary: mandatory textarea
- "⚠ Alert will be triggered on save · `{{ alertText }}`"
- "Save changes →" · "Cancel"
- "Frameworks are never deleted. A framework replaced by a newer instrument is marked superseded and remains citable on historical submissions."

---

## Data Wiring

```typescript
const { frameworks, activeFramework, saveFramework } = useSuperAdminStore()
// MSW: GET /api/regulatory-frameworks → regulatoryFrameworks.json
// MSW: PATCH /api/regulatory-frameworks/:id → updated framework
// No DELETE endpoint — return 405 for any DELETE attempt

// Scope dots — colour per module accent
const SCOPE_COLOURS = {
  A: '#2563EB', B: '#7C3AED', C: '#7C3AED',
  D: '#D97706', E: '#0D9488', Platform: '#1A3C5E'
}

// alertText — generated client-side when status changes to Updated or Draft revision
const alertText = ['Updated','Draft revision'].includes(newStatus)
  ? `A regulatory intelligence alert will be sent to all users with active submissions in scope: ${activeFramework.scope.join(', ')} disciplines. Change summary will be included.`
  : ''  // empty — hide ⚠ warning

// statusOptions = ['Current','Draft revision','Updated','Superseded']
// scopeOptions = activeFramework.scope — checkboxes for A B C D E

// rf-003 (21CFR314) shows status: "Updated"
// rf-008 (ICH E2C(R2)) shows status: "Draft revision"
```

---

## Implementation Notes (from design review)

- Scope column uses **coloured dots** (not text) — one dot per module in `f.scope` array. On hover: tooltip with discipline name. Use module accent colours from `SCOPE_COLOURS` above
- `{{ alertText }}` is generated client-side when status changes to "Updated" or "Draft revision" — empty otherwise (hides the ⚠ warning banner)
- `{{ statusOptions }}` = `["Current", "Draft revision", "Updated", "Superseded"]`
- `{{ scopeOptions }}` = checkboxes A through E in edit drawer — pre-checked from `activeFramework.scope`
- "Frameworks are never deleted" — no DELETE endpoint; MSW returns 405. Change summary is mandatory before saving a status change
- Read-only mode for Admin (`/admin/frameworks`): table renders but no edit drawer, no "+ Add framework →", no Save button

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Table shows 15 rows. rf-003 (21CFR314) shows amber "⚠ Updated" chip. rf-008 (ICH E2C(R2)) shows amber "⚠ Draft revision" chip. All others show green "✓ Current". (AC-PM-026)
2. Scope dots for 21 CFR Part 11 (scope: A B C D E) shows 5 coloured dots. Hovering each dot shows the discipline name tooltip.
3. Selecting rf-008 and changing status to "Updated" shows: "⚠ Alert will be triggered on save · A regulatory intelligence alert will be sent to…" alertText is populated.
4. Changing status back to "Current" hides the ⚠ alert warning (alertText is empty).
5. DELETE request to /api/regulatory-frameworks/:id returns 405. No delete UI exists anywhere in the screen.

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM14-regulatory-framework-admin.md and execute.
Build RegulatoryFrameworkAdmin exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM18-regulatory-framework-admin.html.
Run all 3 validation passes and report results before awaiting Session PM12.
```
