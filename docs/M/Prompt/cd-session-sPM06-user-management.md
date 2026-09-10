# CD Session — sPM06 · User Management
**For:** Claude Design
**Read first:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CD/platform-module-brief.md`
**Output file:** `aurora-sPM06-user-management.html`
**Output location:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/`
**Route:** `/admin/users`
**Phase:** Phase 0
**Accent colour:** Navy #1A3C5E
**Classification:** Internal — GenBioCa Confidential

---

## Context

This is screen **sPM06** of the ClinWrite.AI Platform & Admin module. Build it after reading `platform-module-brief.md` in full. The design must be consistent with the Module D (sD01–sD12) and Module E (sE01–sE10) designs already built.

**Before designing this screen confirm:**
1. Accent colour is **Navy #1A3C5E** — never use a module-specific accent (crimson, teal, violet, blue) on any sPM screen except sPM10 (wizard inherits per-module colour).
2. The screen renders inside the standard ClinWrite.AI AppShell (sidebar + top nav). Sidebar shows the Platform nav section with sPM06 highlighted as active.
3. All structural text (headings, labels, notes, compliance copy) is hard-coded. All data rows, counts, timestamps, user-generated content, and state values use `{{ }}` template variables for CC.
4. The output is a single self-contained HTML file using the same bundling pattern as the Module D and E designs.

---

## sPM06 — User Management

**File:** `aurora-sPM06-user-management.html`
**Route:** `/admin/users`
**Current user:** Dr James Hartley · Admin

**Layout:** Full-width table with filter bar above and action drawer on right (hidden until user selected).

**Filter bar (above table):**
Search input (placeholder: "Search by name or email") · Role filter dropdown · Module access filter · Status filter (Active / Invited / Suspended) · "Invite user +" button (navy primary)

**User table (8 columns):**
Columns: Name · Email · Role · Modules · Status · Last active · Actions

Hard-coded rows (8 users):
| Name | Email | Role | Modules | Status | Last active |
|------|-------|------|---------|--------|-------------|
| Dr James Hartley | j.hartley@genbioca.com | Admin | All | `✓ Active` | Today 09:15 |
| Ms Priya Nair | p.nair@genbioca.com | Ideation Lead | E | `✓ Active` | Today 08:44 |
| Dr Sarah Chen | s.chen@genbioca.com | Regulatory Writer | D | `✓ Active` | Yesterday |
| Dr Rebecca Morton | r.morton@genbioca.com | MA Team Lead | C, E | `✓ Active` | Today 07:30 |
| Mr Daniel Okafor | d.okafor@genbioca.com | Content Calendar Mgr | E | `✓ Active` | 08 Sept 2026 |
| Dr Elena Vasquez | e.vasquez@genbioca.com | Clinical Lead | A | `✓ Active` | 07 Sept 2026 |
| Dr Arjun Patel | a.patel@genbioca.com | CMC Lead | D | `✓ Active` | 06 Sept 2026 |
| Ms Laura Kim | l.kim@genbioca.com | Author | A, B | `📧 Invited` (amber) | — |

**Row actions:** Edit role · Suspend · Resend invitation (if Invited) · View audit trail

**Invite user drawer (right panel, shown when "Invite user +" clicked):**
- Email field
- First / Last name
- Role selector (dropdown)
- Module access (checkbox multi-select: A B C D E)
- "Send invitation" button (navy primary)
- Note: "Invitation expires after 7 days. User must accept T&C on first sign-in."

**RACI impact preview (shown when role is changed):**
"Changing Dr Sarah Chen's role from Regulatory Writer to Reviewer will affect

**Template variables (CC wires these):**
`{{ users }}` — user table rows · `{{ u.name }}` / `{{ u.email }}` / `{{ u.role }}` / `{{ u.modules }}` / `{{ u.status }}` / `{{ u.lastActive }}` — per-user data
`{{ userCount }}` — count in header · `{{ raciImpact }}` — preview text when role changes · `{{ inviteRole }}` / `{{ inviteModules }}` — invite drawer state her RACI assignments in 2 active projects. Preview →"

---

---

## CC Prompt (use after CD delivers this file)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-sPM06-user-management.md and execute.
Build User Management exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM06-user-management.html.
Run all 3 validation passes and report results before awaiting the next session.
```
