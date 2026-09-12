# Session PM03 — User Management
**Screen:** sPM06 · User Management
**Route:** `/admin/users`
**Component:** `src/platform/screens/UserManagement.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM06-user-management.html`
**Data:** `users.json`, `raciMatrix.json`
**Store:** `adminStore`
**Access:** `<AdminGuard>`

---

## What to Build

Full-width user table + filter bar + invite drawer (right) + role change panel. Current user: Dr James Hartley · Admin. "8 users · 7 active · 1 invited."

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Filter bar:** Search input · All roles dropdown · All modules dropdown · All statuses dropdown · "Invite user →" button (navy primary)

**User table — `{{ users }}` loop from `users.json`:**
Columns: Name (with initials avatar) · Email · Role · Modules · Status · Last active · Actions
`{{ u.initials }}` / `{{ u.name }}` / `{{ u.email }}` / `{{ u.role }}` / `{{ u.modules }}` / `{{ u.status }}` / `{{ u.lastActive }}` / `{{ u.actions }}`

Hard-coded status chips: ✓ Active (green) · 📧 Invited (amber for Ms Laura Kim)
"Suspending a user preserves every document, signature and audit record they created. User records are never deleted."

**Invite user drawer (right panel):**
- Client: GenBioCa Sciences (read-only)
- Email · First name · Last name · Role selector · Module access: `{{ moduleOptions }}` checkboxes (`{{ m.mark }}` / `{{ m.label }}` for A B C D E)
- "Send invitation →" (navy primary)
- "Invitation expires after 7 days. The user must accept the terms and conditions on first sign-in."

**Role change panel (appears when role edit clicked on a row):**
- `{{ selectedName }}` / `{{ selectedMeta }}` (role + module)
- Role: `{{ roleValue }}` (dropdown)
- RACI impact preview: "Changing {{ selectedName }} from {{ previousRole }} to Reviewer will affect their RACI assignments in 2 active projects: VELORA-301 NDA and AURELIA-101 IND."
- `{{ changeRole }}` = "Preview affected assignments →" link
- "Apply role change →" button (navy primary)
- Module access checkboxes + "View audit trail →" + "Suspend user" (destructive, crimson)
- "Suspension requires Admin role. The acting Admin is named in the audit record."

---

## Data Wiring

```typescript
const { users, inviteUser, changeRole } = useAdminStore()
// MSW: GET /api/admin/users → users.json (all 9 users)
// MSW: POST /api/admin/users/invite → 201 { id: 'user-new', status: 'invited' }
// MSW: PATCH /api/admin/users/:id/role → 200 updated user

// user-dc = Mr David Chen (Author · Module B) — now in users.json (9 users total)
// RACI impact preview — from raciMatrix.json raciImpactProjects
// "VELORA-301 NDA" (proj-velora-301) and "AURELIA-101 IND" (proj-aurelia-101)
// Hard-code the 2-project count for the demo

// Module chips: derive from u.modules array ['A','B','C','D','E']
// Colour each dot with module accent: A=#2563EB, B=#7C3AED, C=#7C3AED, D=#D97706, E=#0D9488
```

---

## Implementation Notes (from design review)

- RACI impact preview uses **VELORA-301 NDA** and **AURELIA-101 IND** — from `raciMatrix.json` `raciImpactProjects` — not VELORA-204
- `{{ roleChanged }}` = boolean that shows a success toast after role change is applied
- `{{ moduleOptions }}` / `{{ m.mark }}` / `{{ m.label }}` = invite drawer module checkboxes — derive from `['A','B','C','D','E']`
- "Role changes take effect at the user's next sign-in and are written to the audit trail." — hard-code this note
- Ms Laura Kim (`user-auth`) shows 📧 Invited status chip (amber) and "Resend invitation" in actions — no Last active date
- `{{ changeRole }}` = the "Preview affected assignments →" link that expands the RACI preview section

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. User table shows 9 rows. Ms Laura Kim shows amber "📧 Invited" chip and no Last active date. All other 8 users show green "✓ Active". (AC-PM-006)
2. "Invite user →" opens the drawer. All 5 module checkboxes render (A B C D E). "Send invitation →" is disabled until email and role are filled. (AC-PM-007)
3. Clicking "Edit role" on Dr Sarah Chen shows the role change panel with "Changing Dr Sarah Chen from {{ previousRole }} to Reviewer will affect their RACI assignments in 2 active projects: VELORA-301 NDA and AURELIA-101 IND."
4. "Suspend user" button is crimson (destructive). Clicking it shows a confirmation step before proceeding.
5. Filter by "Invited" status shows only Ms Laura Kim.

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM03-user-management.md and execute.
Build UserManagement exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM06-user-management.html.
Run all 3 validation passes and report results before awaiting Session PM04.
```
