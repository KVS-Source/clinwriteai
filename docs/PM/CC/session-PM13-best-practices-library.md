# Session PM05 — Best Practices Library
**Screen:** sPM09 · Best Practices Library
**Route:** `/library/best-practices`
**Component:** `src/platform/screens/BestPracticesLibrary.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM09-best-practices-library.html`
**Data:** `bestPractices.json`
**Store:** `superAdminStore`
**Access:** All users (read) · `<SuperAdminGuard>` (create/edit/delete)

---

## What to Build

Module tab strip + card list + new item drawer. Current user: Alex Thornton · Super admin. Naming convention note always visible at top. "⚠ 1 item due for quarterly review" amber chip.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Naming convention note (always visible):**
"Best practice items must follow the naming convention `[Module]-[Category]-[Version]-[Date]` — for example `Module-D-CTD-Authoring-v1.2-2026-01`"

**Module tab strip:** `{{ t.label }}` / `{{ t.count }}` — All · Module A · Module B · Module C · Module D · Module E · Platform-Wide
Active tab is Module D with count badge.

**"⚠ 1 item due for quarterly review"** amber chip below tabs when `reviewDue` items exist.

**Card list — `{{ cards }}` loop from `bestPractices.json` filtered by active tab:**
Each card: `{{ c.name }}` · `{{ c.category }}` · `{{ c.reviewLabel }}` · `{{ c.dates }}` (Effective → Valid until) · `{{ c.guidance }}` · Applicable doc types: `{{ c.docTypes }}` · Framework references: `{{ c.frameworks }}` · Last updated: `{{ c.updated }}`

bp-003 (MHRA) shows amber left border + "⚠ Review due · quarterly refresh" chip.

**"+ New best practice →" button** — visible only to Super Admin (`{{ canAuthor }}`).

**New best practice drawer:**
- Name field with live validation note (placeholder: "Module-D-Category-v1.0-2026-09")
- Discipline · Category · Guidance textarea
- Effective / Valid until dates
- "Publish best practice →" button
- "Published items are visible to every client account immediately. Superseding an item preserves the previous version in the audit trail."

---

## Data Wiring

```typescript
const { items, activeTab, canAuthor, createItem } = useSuperAdminStore()
// MSW: GET /api/library/best-practices → bestPractices.json
// MSW: POST /api/library/best-practices → 201 new item
// MSW: PATCH /api/library/best-practices/:id → archives old, creates new (supersede)

// canAuthor = currentUser.role === 'super-admin'
// Tab counts — derive from bestPractices.json grouped by module:
// A:1, B:0, C:1, D:3, E:2, Platform:1

// heading = active tab label + item count
// e.g. "Module D · Regulatory Writing Best Practices · 3 items"
```

---

## Implementation Notes (from design review)

- `{{ canAuthor }}` gates both the "+ New best practice →" button AND the publish form drawer — derive from `currentUser.role === 'super-admin'`
- Tab counts are computed from `bestPractices.json` grouped by `module` field — A:1, B:0, C:1, D:3, E:2, Platform:1 — compute in store, do not hardcode in component
- `PATCH /api/library/best-practices/:id` must archive old record with `supersededAt` timestamp before creating new — not overwrite
- bp-003 has `reviewDue: true` — renders amber left border and "⚠ Review due · quarterly refresh" chip
- `{{ heading }}` = label of active tab + discipline name + item count
- Live validation in new item drawer: name must match `[Module]-[Category]-[Version]-[Date]` pattern — validate on change, show error inline

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Naming convention note is always visible above the tabs. (AC-PM-013)
2. Module D tab shows 3 items. bp-003 (MHRA) shows amber left border and "⚠ Review due · quarterly refresh" chip. (AC-PM-012)
3. Tab counts are correct: A=1, B=0, C=1, D=3, E=2, Platform=1.
4. "+ New best practice →" button is visible for Alex Thornton (Super admin) and absent for Admin users.
5. Entering a name that does not match the convention shows a validation error below the field.

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM17-best-practices-library.md and execute.
Build BestPracticesLibrary exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM09-best-practices-library.html.
Run all 3 validation passes and report results before awaiting Session PM14.
```
