# Session PM03 — RACI Matrix Viewer
**Screen:** sPM07 · RACI Matrix Viewer
**Route:** `/admin/raci` · `/projects/:projectId/raci`
**Component:** `src/platform/screens/RACIMatrix.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM07-raci-matrix-viewer.html`
**Data:** `raciMatrix.json`, `users.json`
**Store:** `adminStore`
**Access:** `<AdminGuard>` (edit) · all authenticated users (own assignments)

---

## What to Build

Two-column layout: left module/project selector (~240px) · right RACI matrix table. Current user: Dr James Hartley · Admin. Demo shows Module D for VELORA-301 Efficacy Suite.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Left panel:**
- Header: "RACI matrix"
- Project selector dropdown: "VELORA-301 Efficacy Suite" (selected)
- Module tab strip: A · B · C · D (active) · E

**Right panel:**
- `{{ heading }}` = "Module D — Regulatory Writing · VELORA-301 Efficacy Suite"
- "Default RACI template applied. Adjustments are project-specific and do not affect other projects."
- `{{ mineLabel }}` toggle button — "Show my tasks" / "Show all tasks"
- "Edit assignments →" button (navy outline)
- RACI table — `{{ roles }}` column headers · `{{ rows }}` row data
- `{{ row.task }}` · `{{ c.mark }}` per cell — letter chip styled by assignment type
- "R = responsible · A = accountable · C = consulted · I = informed" legend
- `{{ rowCount }}` count label
- **People panel** below table: "People in these roles"
  - `{{ people }}` loop: `{{ p.initials }}` avatar · `{{ p.name }}` · `{{ p.role }}`
- Module D tasks from `raciMatrix.json` (8 tasks): Submission setup (Stage 1) · CTD Module 2 authoring (Stage 2) · CMC/Nonclinical (Stage 3) · Super Review (Stage 4) · eCTD Publishing (Stage 5) · **Gateway Submission (Stage 6)** · HA Response Drafting · Regulatory Intelligence
- "Every assignment change is written to the audit trail with the acting Admin named and a UTC timestamp."

---

## Data Wiring

```typescript
const { raciMatrix, users } = useAdminStore()
// MSW: GET /api/raci/:projectId → raciMatrix.json (module D tasks)

// Assignment chip colours
const RACI_COLOURS = {
  R: { bg: '#FEF2F2', text: '#B0200D' },  // crimson
  A: { bg: '#FFFBEB', text: '#D97706' },  // amber
  C: { bg: '#EFF6FF', text: '#1A3C5E' },  // navy
  I: { bg: '#F8FAFC', text: '#94A3B8' },  // grey
}

// People panel — derive from active module assignments
const peopleInRoles = Object.values(
  raciMatrix.modules.D.tasks.flatMap(t => Object.keys(t.assignments))
    .reduce((acc, roleId) => {
      const user = users.find(u => u.role === roleId)
      if (user) acc[roleId] = { initials: initials(user.name), name: user.name, role: user.role }
      return acc
    }, {})
)

// My RACI toggle — filter rows to only those where currentUser.role has assignment
// mineCount renders as string: "3 tasks"
```

---

## Implementation Notes (from design review)

- **People panel** is a new panel below the matrix (not in CD brief) — derive unique users from active module RACI assignments, cross-reference `users.json`, render initials + name + role
- **`A` cell locks read-only** once `auditTrail.json` has `action: "SIGNATURE_APPLIED"` for that stage — "Edit assignments →" is disabled (not hidden) for locked rows. Check `auditTrail.json` on load.
- `{{ mineCount }}` renders as a string e.g. "3 tasks" — not a raw number
- `{{ mineLabel }}` toggles between "Show my tasks" and "Show all tasks" on click
- `{{ mineOn }}` is the boolean controlling which view is shown
- "Exactly one role is Accountable per task. Accountability cannot be reassigned after a stage is signed." — hard-code as a legend note

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Module D RACI table renders 8 rows from `raciMatrix.json`. Super Review (Stage 4) row shows R chips for Regulatory Writer, Clinical Lead, CMC Lead, QC Checker, E-Signatory — all 5 roles. (AC-PM-008)
2. "Show my tasks" toggle filters to rows where Dr James Hartley (Admin) holds an assignment. `mineCount` shows "X tasks" as a string. (AC-PM-009)
3. Assignment chips are colour-coded: R = crimson · A = amber · C = navy · I = grey.
4. People panel below matrix renders at least 5 distinct users with initials, name, and role.
5. Switching module tab from D to E updates the heading and re-renders the table with Module E tasks from `raciMatrix.json`.

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM06-raci-matrix-viewer.md and execute.
Build RACIMatrix exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM07-raci-matrix-viewer.html.
Run all 3 validation passes and report results before awaiting Session PM07.
```
