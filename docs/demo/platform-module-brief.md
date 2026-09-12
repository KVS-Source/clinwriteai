# ClinWrite.AI — Platform & Admin Module (PM) + Module B Slide Deck
## Shared Brief for CD (Claude Design) and CC (Claude Code)
**Version:** v1.0 · September 2026
**Classification:** Internal — GenBioCa Confidential
**Applies to:** 15 Platform/Admin screens (sPM04–sPM18) + 1 Module B screen (sB10)

---

## 1. What This Brief Is

This is the shared context document for both CD and CC covering the 16 screens identified in the Missing Screens PRD (AURORA-PRD-MISSING-v1.0). Read it once before starting any design or build work on this set.

**CD reads this before designing any screen.**
**CC reads this before building any screen.**

---

## 2. ClinWrite.AI — Platform Identity Recap

| Property | Value |
|----------|-------|
| Product name | **ClinWrite.AI** |
| Platform | AI-native life sciences authoring |
| Five modules | A Clinical Writing · B Scientific Writing · C Medical Writing · D Regulatory Writing · E Ideation & Publishing |
| Project root | `C:/Chetan/GenBioCa/LifeSciences/` |
| Design files location | `docs/PM/design/` (all platform screens) · `docs/B/design/` (sB10) |
| CC session briefs | `docs/PM/CC/` · `docs/B/CC/` |
| Engineering docs | Architecture v5 · Data Model v5 · API Contracts v5 · Acceptance Criteria v4 |

---

## 3. Design System — Exact Tokens (CD must follow; CC must match)

### Typography
| Role | Font | Size | Weight |
|------|------|------|--------|
| UI sans-serif | Plus Jakarta Sans | — | — |
| Code / data / mono | IBM Plex Mono | — | — |
| Body text | 14px / 15px | 400 |
| Section headers | 15px–18px | 600–700 |
| Screen title | 20px–24px | 700 |
| Label / meta | 12px | 400–500 |

### Colour Palette
| Token | Hex | Used for |
|-------|-----|---------|
| `slate-900` | `#1E293B` | Primary text |
| `slate-700` | `#334155` | Secondary text |
| `slate-600` | `#475569` | Meta text, icons |
| `slate-500` | `#64748B` | Placeholder, disabled |
| `slate-400` | `#94A3B8` | Borders light, inactive |
| `slate-300` | `#CBD5E1` | Dividers |
| `slate-200` | `#E2E8F0` | Card borders, table rows |
| `slate-100` | `#F1F5F9` | Page background |
| `slate-50` | `#F8FAFC` | Panel backgrounds |
| `white` | `#FFFFFF` | Card surfaces |
| Green approved | `#15803D` / `#F0FDF4` | Active, verified, passed |
| Amber warning | `#D97706` / `#B45309` / `#FFFBEB` | Warning, advisory |
| Red / rose error | `#BE123C` / `#FFF1F2` | Error, blocked, overdue |
| Crimson | `#B0200D` | Module D accent only |

### Platform / Admin Module Accent
| Token | Hex | Used for |
|-------|-----|---------|
| **Navy** `navy-700` | `#1A3C5E` | All sPM04–sPM18 screens — primary accent, buttons, active states |
| `navy-50` | `#EFF6FF` | Navy tint — panel backgrounds, chip backgrounds |
| `navy-100` | `#DBEAFE` | Navy light — hover states |
| `navy-200` | `#BFDBFE` | Navy medium — borders, active nav items |
| **Module B accent (sB10)** | `#7B3C9A` Violet | Slide Deck Generator only |

### Layout System
- **Left sidebar (AppShell):** 224px fixed. Navy `#1A3C5E` background. White text/icons. Module nav items with active highlight `#2563EB` (blue).
- **Top nav bar:** 56px. White background. Breadcrumb left, user profile + notifications right.
- **Main content area:** remaining width, `#F8FAFC` background.
- **Card surfaces:** `#FFFFFF` with `#E2E8F0` border, `8px` border-radius, `box-shadow: 0 1px 3px rgba(0,0,0,0.08)`.
- **Standard two-column layout:** Left panel ~340px · Right panel remainder.
- **Standard three-column layout:** Left ~280px · Centre ~340px · Right remainder.
- **Data tables:** Row height 48px. Header `#F8FAFC` bg, `#E2E8F0` bottom border. Alternating row tint optional (`#FAFAFA`). Action column right-aligned.

### Spacing
- Section padding: `24px`
- Card padding: `20px`
- Row gap in lists: `12px`
- Chip padding: `4px 10px`

### Chip / Badge Patterns
- **Status chips:** `border-radius: 9999px`, `font-size: 12px`, `font-weight: 500`, `padding: 3px 10px`
- **Module chips:** Filled with module accent colour at 15% opacity, text in full module accent colour
- **Action buttons primary:** Navy `#1A3C5E` fill, white text, `border-radius: 8px`, `padding: 8px 16px`
- **Action buttons secondary:** White fill, navy `#1A3C5E` border and text
- **Destructive buttons:** `#B91C1C` fill, white text (for suspend/delete only)

### Icons
- Lucide React icon library throughout. Size: 16px inline, 20px standalone.
- No custom SVG icons except the ClinWrite.AI wordmark.

---

## 4. AppShell Structure for Platform Screens

All sPM screens render inside the standard AppShell. The sidebar nav for platform/admin screens adds a section below the five module nav items:

```
── PLATFORM (visible to Admin and above)
   ⚙  Admin Panel          /admin
   👥 User Management      /admin/users
   📊 RACI Matrix          /admin/raci
   📚 Master Library       /library
   📖 Best Practices       /library/best-practices
   🔔 Notifications        /notifications
   📈 Reports              /reports
   🗂  Services             /services
   💳 Subscription         /admin/subscription
   📋 Audit Trail          /admin/audit
   🏷  TA Tags              /admin/taxonomy

── SUPER ADMIN (visible to Super Admin only — coloured differently in sidebar)
   🔧 Super Admin          /super-admin
   💰 Rate Card            /super-admin/rate-card
   📜 Framework Registry   /super-admin/frameworks
```

**Onboarding Wizard (sPM10)** renders as a full-screen overlay on first module access — not in sidebar nav.

---

## 5. Screen Inventory

| Screen ID | Name | Route | Phase | Accent |
|-----------|------|-------|-------|--------|
| sPM04 | Admin Panel | `/admin` | 0 | Navy `#1A3C5E` |
| sPM05 | Super Admin Panel | `/super-admin` | 0 | Navy `#1A3C5E` |
| sPM06 | User Management | `/admin/users` | 0 | Navy `#1A3C5E` |
| sPM07 | RACI Matrix Viewer | `/admin/raci` | 1 | Navy `#1A3C5E` |
| sPM08 | Master Library | `/library` | 4 | Navy `#1A3C5E` |
| sPM09 | Best Practices Library | `/library/best-practices` | 4 | Navy `#1A3C5E` |
| sPM10 | Onboarding Wizard | `/onboarding/:module` | 1 | Per-module colour |
| sPM11 | Services Dashboard | `/services` | 4 | Navy `#1A3C5E` |
| sPM12 | Rate Card Admin | `/super-admin/rate-card` | 4 | Navy `#1A3C5E` |
| sPM13 | Subscription & Payment | `/admin/subscription` | 4 | Navy `#1A3C5E` |
| sPM14 | Notification Centre | `/notifications` | 1 | Navy `#1A3C5E` |
| sPM15 | Audit Trail Viewer | `/admin/audit` | 0 | Navy `#1A3C5E` |
| sPM16 | Reports & Analytics | `/reports` | 4 | Navy `#1A3C5E` |
| sPM17 | TA Tag Configuration | `/admin/taxonomy` | 0 | Navy `#1A3C5E` |
| sPM18 | Regulatory Framework Admin | `/super-admin/frameworks` | 3 | Navy `#1A3C5E` |
| sB10 | Slide Deck Generator | `/projects/:id/scientific-writing/publications/:pubId/slides` | 2 | Violet `#7B3C9A` |

---

## 6. What CD Must Deliver (per screen)

For each screen, CD produces a **single self-contained HTML file** named `aurora-[screenId]-[kebab-name].html` placed in `docs/PM/design/` (or `docs/B/design/` for sB10).

**Rules CD must follow (non-negotiable):**

1. **AppShell always present.** Every screen renders inside the standard sidebar + top nav. Sidebar shows ClinWrite.AI wordmark, module nav, and the platform nav section above. Active screen is highlighted in sidebar.
2. **Navy `#1A3C5E` as accent.** All primary buttons, active states, progress bars, and highlights use navy. Never use a module colour (crimson, violet, teal, amber/D) as a platform-level accent.
3. **No red for informational states.** Red/rose is for hard errors (failed payment, suspended account) only. Warnings use amber. Pending/inactive use grey.
4. **Immutability notes are always visible.** Audit trail, rate card archive, project closure — the "this record is immutable" or "cannot be backdated" note is always rendered, never behind a toggle.
5. **Role labels are precise.** Super Admin is GenBioCa-internal. Admin is client-organisation level. These must never be conflated in the UI.
6. **Template variables `{{ }}` for all data loops.** Hard-code all structural text (labels, headings, notes, compliance copy). Leave data rows, counts, timestamps, and user-generated content as `{{ }}` for CC to wire.
7. **Consistent with existing modules.** The design must feel like it belongs in the same product as sD01–sD12 and sE01–sE10. Same card style, same typography scale, same spacing, same AppShell chrome. Hard-code all structural text (labels, headings, notes, compliance copy). Leave data rows, counts, timestamps, and user-generated content as `{{ }}` for CC to wire.
7. **Consistent with existing modules.** The design must feel like it belongs in the same product as sD01–sD12 and sE01–sE10. Same card style, same typography scale, same spacing, same AppShell chrome.

---

## 7. What CC Must Deliver (per screen)

For each screen, CC builds a production-quality React component using the HTML design from CD as the visual specification.

**CC build rules (non-negotiable):**

1. **TypeScript strict.** All types from `packages/types/src/domain.ts`. No `any`.
2. **Tailwind only.** No custom CSS files. All tokens from `tailwind.config.ts`.
3. **MSW for all data.** Every API call is intercepted by MSW. No hardcoded data in components.
4. **Zustand stores.** Platform-level store: `src/platform/store/platformStore.ts`. Admin store: `src/platform/store/adminStore.ts`. Super Admin store: `src/platform/store/superAdminStore.ts`.
5. **Role guards.** Admin routes are wrapped in `<AdminGuard>`. Super Admin routes in `<SuperAdminGuard>`. These check `currentUser.role` — no API call needed.
6. **3-pass validation every screen:** `typecheck + lint` → `build` → 5 smoke tests.
7. **Folder structure** (`src/platform/screens/` for sPM, `src/modules/scientific-writing/screens/` for sB10):
```
src/platform/
├── screens/          ← one file per screen
├── store/            ← platformStore, adminStore, superAdminStore
├── api/              ← platformApi.ts
└── components/       ← shared platform UI components
src/mocks/handlers/
└── platform.ts       ← all platform MSW handlers in one file
```

---

## 8. JSON Fixture Files for Platform Screens

The following fixture files go in `src/data/` before CC builds any platform screen.
Full JSON content is in `docs/PM/CC/platform-data-files.md`.

| File | Records | Primary screens |
|------|---------|----------------|
| `platformConfig.json` | 1 | sPM04, sPM05 |
| `users.json` | 8 | sPM06, sPM07 |
| `raciMatrix.json` | 5 modules × roles | sPM07 |
| `masterLibraryItems.json` | 12 | sPM08 |
| `bestPractices.json` | 8 | sPM09 |
| `notifications.json` | 10 | sPM14 |
| `auditTrail.json` | 20 | sPM15 |
| `ratecards.json` | 2 versions | sPM12 |
| `subscription.json` | 1 | sPM11, sPM13 |
| `reports.json` | 6 report types | sPM16 |
| `taTags.json` | 12 | sPM17 |
| `regulatoryFrameworks.json` | 15 | sPM18 |
| `slidedeckJob.json` | 1 | sB10 |

---

## 9. Demo Personas for Platform Screens

| User ID | Name | Role | Visible in |
|---------|------|------|-----------|
| `user-sa` | **Alex Thornton** | Super Admin (GenBioCa) | sPM05, sPM12, sPM18 |
| `user-admin` | **Dr James Hartley** | Admin (client org) | sPM04, sPM06, sPM07, sPM13, sPM15, sPM17 |
| `user-pl` | **Ms Priya Nair** | Project Lead | sPM07, sPM11, sPM16 |
| `user-il` | **Ms Priya Nair** | Ideation Lead (Module E) | sPM10 (Module E wizard) |
| `user-rw` | **Dr Sarah Chen** | Regulatory Writer (Module D) | sPM10 (Module D wizard) |

**Note:** Dr James Hartley appears as Admin (platform role) in sPM screens. He also appears as Regulatory Affairs Lead (module role) in Module D screens — the same person holds both roles in the demo.

---

## 10. Non-Negotiable Rules for Both CD and CC

1. **ClinWrite.AI** is the product name — never AURORA, GenovAI, or any other name.
2. **No red for severity tags** — use steel blue `#005F8E` for informational blocking, amber for warnings, green for approved. Red only for critical system errors.
3. **Audit trail entries are always immutable** — the note must be visible on every screen that writes audit entries (sPM15 always; sPM04, sPM06, sPM12, sPM13 when showing confirmation states).
4. **Super Admin ≠ Admin** — label them precisely throughout. Super Admin has no client affiliation; Admin is client-organisation scoped.
5. **Rate cards cannot be backdated** — this constraint is displayed in the UI, not just enforced by the API.
6. **Best Practices naming convention** `[Module]-[Category]-[Version]-[Date]` — shown as a validation rule in sPM09.

---

## 11. File Naming Convention

**CD output files:**
```
docs/PM/design/aurora-sPM04-admin-panel.html
docs/PM/design/aurora-sPM05-super-admin-panel.html
docs/PM/design/aurora-sPM06-user-management.html
docs/PM/design/aurora-sPM07-raci-matrix.html
docs/PM/design/aurora-sPM08-master-library.html
docs/PM/design/aurora-sPM09-best-practices-library.html
docs/PM/design/aurora-sPM10-onboarding-wizard.html
docs/PM/design/aurora-sPM11-services-dashboard.html
docs/PM/design/aurora-sPM12-rate-card-admin.html
docs/PM/design/aurora-sPM13-subscription-payment.html
docs/PM/design/aurora-sPM14-notification-centre.html
docs/PM/design/aurora-sPM15-audit-trail-viewer.html
docs/PM/design/aurora-sPM16-reports-analytics.html
docs/PM/design/aurora-sPM17-ta-tag-configuration.html
docs/PM/design/aurora-sPM18-regulatory-framework-admin.html
docs/B/design/aurora-sB10-slide-deck-generator.html
```

**CC component files:**
```
src/platform/screens/AdminPanel.tsx
src/platform/screens/SuperAdminPanel.tsx
... (one per screen)
src/modules/scientific-writing/screens/SlidedeckGenerator.tsx
```
