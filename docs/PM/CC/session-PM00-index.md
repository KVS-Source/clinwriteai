# Platform Module (PM) + sB10 + sC04 — CC Session Index
**Read this before starting any PM session.**
**Classification: Internal — GenBioCa Confidential**

---

## How to Use This Index

1. Give CC the index prompt below. CC reads and confirms understanding. Does not build anything.
2. Give CC the PM00 setup prompt. CC executes setup, confirms all items and 3 checks pass.
3. Give CC one session prompt at a time in the order listed below. CC builds, validates 3 passes, reports.
4. Only move to the next session after CC reports all checks passing.

**3-pass validation — every screen:**
- Pass 1 — `npm run typecheck && npm run lint` — fix all errors before Pass 2
- Pass 2 — `npm run build` — fix all errors before Pass 3
- Pass 3 — 5 smoke tests specific to that screen — listed in each session brief

---

## Session Map

| Session | File | Screen | Component | HTML Design | Primary Data |
|---------|------|--------|-----------|-------------|-------------|
| PM00 | `session-PM00-index.md` | This file | — | — | — |
| PM01 | `session-PM01-admin-panel.md` | Admin Panel | `AdminPanel` | `aurora-sPM04-admin-panel.html` | `platformConfig.json` |
| PM02 | `session-PM02-super-admin-panel.md` | Super Admin Panel | `SuperAdminPanel` | `aurora-sPM05-super-admin-panel.html` | `platformConfig.json`, `users.json` |
| PM03 | `session-PM03-user-management.md` | User Management | `UserManagement` | `aurora-sPM06-user-management.html` | `users.json`, `raciMatrix.json` |
| PM06 | `session-PM06-raci-matrix-viewer.md` | RACI Matrix Viewer | `RACIMatrix` | `aurora-sPM07-raci-matrix-viewer.html` | `raciMatrix.json`, `users.json` |
| PM15 | `session-PM15-master-library.md` | Master Library | `MasterLibrary` | `aurora-sPM08-master-library.html` | `masterLibraryItems.json` |
| PM17 | `session-PM17-best-practices-library.md` | Best Practices Library | `BestPracticesLibrary` | `aurora-sPM09-best-practices-library.html` | `bestPractices.json` |
| PM07 | `session-PM07-onboarding-wizard.md` | Onboarding Wizard | `OnboardingWizard` | `aurora-sPM10-onboarding-wizard.html` | `raciMatrix.json`, `users.json` |
| PM14 | `session-PM14-services-dashboard.md` | Services Dashboard | `ServicesDashboard` | `aurora-sPM11-services-dashboard.html` | `subscription.json` |
| PM15 | `session-PM15-rate-card-admin.md` | Rate Card Admin | `RateCardAdmin` | `aurora-sPM12-rate-card-admin.html` | `ratecards.json` |
| PM17 | `session-PM17-subscription-payment.md` | Subscription & Payment | `SubscriptionPayment` | `aurora-sPM13-subscription-payment.html` | `subscription.json`, `ratecards.json`, `platformConfig.json` |
| PM15 | `session-PM15-notification-centre.md` | Notification Centre | `NotificationCentre` | `aurora-sPM14-notification-centre.html` | `notifications.json`, `notificationPrefs.json` |
| PM04 | `session-PM04-audit-trail-viewer.md` | Audit Trail Viewer | `AuditTrailViewer` | `aurora-sPM15-audit-trail-viewer.html` | `auditTrail.json` |
| PM17 | `session-PM17-reports-analytics.md` | Reports & Analytics | `ReportsAnalytics` | `aurora-sPM16-reports-analytics.html` | `reports.json`, `moduleHealthScores.json`, `subscription.json` |
| PM05 | `session-PM05-ta-tag-configuration.md` | TA Tag Configuration | `TATagConfiguration` | `aurora-sPM17-ta-tag-configuration.html` | `taTags.json` |
| PM14 | `session-PM14-regulatory-framework-admin.md` | Regulatory Framework Admin | `RegulatoryFrameworkAdmin` | `aurora-sPM18-regulatory-framework-admin.html` | `regulatoryFrameworks.json` |
| PM17 | `session-PM17-slide-deck-generator.md` | Slide Deck Generator | `SlidedeckGenerator` | `aurora-sB10-slide-deck-generator.html` | `slidedeckJob.json` |
| PM10 | `session-PM10-content-editor.md` | Content Editor (HCP Slide Deck) | `ContentEditor` | `aurora-sC04-content-editor.html` | `medContent.json`, `medClaims.json`, `medPreMLR.json` |

---

## File Locations

```
C:/Chetan/GenBioCa/LifeSciences/
├── docs/PM/
│   ├── CC/                                           ← these session brief files
│   │   ├── session-PM00-index.md                     ← this file
│   │   ├── platform-module-brief.md                  ← read at setup
│   │   ├── platform-data-files.md                    ← all 13 JSON fixtures embedded
│   │   ├── session-PM01-admin-panel.md
│   │   ├── session-PM02-super-admin-panel.md
│   │   ├── session-PM03-user-management.md
│   │   ├── session-PM06-raci-matrix-viewer.md
│   │   ├── session-PM15-master-library.md
│   │   ├── session-PM17-best-practices-library.md
│   │   ├── session-PM07-onboarding-wizard.md
│   │   ├── session-PM14-services-dashboard.md
│   │   ├── session-PM15-rate-card-admin.md
│   │   ├── session-PM17-subscription-payment.md
│   │   ├── session-PM15-notification-centre.md
│   │   ├── session-PM04-audit-trail-viewer.md
│   │   ├── session-PM17-reports-analytics.md
│   │   ├── session-PM05-ta-tag-configuration.md
│   │   ├── session-PM14-regulatory-framework-admin.md
│   │   ├── session-PM17-slide-deck-generator.md
│   │   └── session-PM10-content-editor.md
│   └── design/                                       ← all HTML design files
│       ├── aurora-sPM04-admin-panel.html
│       ├── aurora-sPM05-super-admin-panel.html
│       ├── ... (one per screen)
│       ├── aurora-sB10-slide-deck-generator.html
│       └── aurora-sC04-content-editor.html
├── apps/web/src/
│   ├── platform/
│   │   ├── screens/                                  ← one component per sPM screen
│   │   ├── store/platformStore.ts
│   │   ├── store/adminStore.ts
│   │   ├── store/superAdminStore.ts
│   │   ├── api/platformApi.ts
│   │   └── components/guards/
│   │       ├── AdminGuard.tsx
│   │       └── SuperAdminGuard.tsx
│   ├── modules/
│   │   ├── scientific-writing/screens/SlidedeckGenerator.tsx   ← sB10 UPDATE
│   │   └── medical-writing/screens/ContentEditor.tsx           ← sC04 UPDATE
│   ├── data/                                         ← all 13 JSON fixtures
│   └── mocks/handlers/platform.ts                   ← all platform MSW handlers
```

---

## Platform Module Design Rules (apply to every PM session)

1. **Navy `#1A3C5E` is the accent** for all sPM04–sPM18 screens. Never use a module accent colour (teal, crimson, violet, blue) as a platform-level accent — except sPM10 which inherits the per-module colour for the active wizard.

2. **Super Admin ≠ Admin.** Label them precisely throughout. Super Admin (`user-sa`, Alex Thornton) governs every client organisation — GenBioCa internal. Admin (`user-admin`, Dr James Hartley) governs a single client account. Never conflate them. Super Admin routes are guarded by `<SuperAdminGuard>`, Admin routes by `<AdminGuard>`.

3. **Audit trail entries are always immutable.** Every screen that writes audit entries must display the immutability note. No delete or edit endpoints exist for audit records. A 403 is returned for any such attempt — and the attempt itself is logged.

4. **Rate cards cannot be backdated.** The effective date picker must reject past dates. Expired rate cards block new purchases until a successor is published.

5. **Closed projects are read-only.** All Master Library items from closed projects show the "Archived — read-only" state. No write operations on closed project artefacts.

6. **Currency is USD throughout.** All cost and rate figures display in USD ($). `platformConfig.json` `currency: "USD"`.

7. **sB10 and sC04 are UPDATES to existing builds.** These screens were built in prior sessions. Run the 3-pass validation after applying changes and report which specific changes were made vs what was already in place.

---

> **Product name throughout:** ClinWrite.AI — never AURORA or ClinWrite.AI in any platform screen.

## Demo Personas

| User ID | Name | Role | Primary screens |
|---------|------|------|----------------|
| `user-sa` | Alex Thornton | Super Admin | PM05, PM12, PM18, PM09 |
| `user-admin` | Dr James Hartley | Admin | PM04, PM06, PM07, PM13, PM15, PM16, PM17 |
| `user-rw` | Dr Sarah Chen | Regulatory Writer | PM08, PM14 |
| `user-il` | Ms Priya Nair | Ideation Lead | PM10 (Module E wizard) |
| `user-cl` | Dr Elena Vasquez | Clinical Lead | sB10 |
| `user-dc` | Mr David Chen | Author (Module B) | sB10 (collaborative editing) |
| `user-ma` | Dr Rebecca Morton | MA Team Lead | sB10 (viewing), sC04 |

---

## Send Order

Build in this order. Each phase depends on the previous:

**Phase 0 (foundation — build first):**
PM04 → PM05 → PM06 → PM15 → PM17

**Phase 1 (workflow — after Phase 0):**
PM07 → PM10 → PM14

**Phase 2 (updates to existing builds — parallel with Phase 1):**
sB10 → sC04

**Phase 3 (content — after Phase 1):**
PM18

**Phase 4 (commerce + reporting — after Phase 3):**
PM08 → PM09 → PM11 → PM12 → PM13 → PM16

---

## CC Prompt — Index (send this first)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM00-index.md and confirm all of the following before doing anything else:

1. You have noted the session map (PM04 through PM18, plus sB10 and sC04) and all file locations.
2. You have noted the 7 Platform Module design rules that apply to every screen.
3. You understand Navy #1A3C5E is the accent for all sPM screens (except sPM10 which uses per-module colour).
4. You understand Super Admin (Alex Thornton, user-sa) ≠ Admin (Dr James Hartley, user-admin) — different role guards, different routes, different capabilities.
5. You understand sB10 and sC04 are UPDATES to screens already built in previous sessions — not new builds.
6. You have noted the send order: Phase 0 first (PM04, PM05, PM06, PM15, PM17), then Phase 1, then Phase 2 updates (sB10, sC04), then Phase 3, then Phase 4.
7. Currency is USD throughout — platformConfig.json currency: "USD".

Do not build anything. Do not read any other file. Confirm each point by number and wait.
```

## CC Prompt — Setup (send after index is confirmed)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/platform-module-brief.md in full.
Then read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/platform-data-files.md.
Copy all 13 JSON fixtures to apps/web/src/data/.
Create src/mocks/handlers/platform.ts with all platform MSW handlers as specified in Section 6 of platform-data-files.md.
Import platformHandlers in src/mocks/handlers/index.ts.
Create the src/platform/ folder structure:
  src/platform/screens/
  src/platform/store/platformStore.ts
  src/platform/store/adminStore.ts
  src/platform/store/superAdminStore.ts
  src/platform/api/platformApi.ts
  src/platform/components/guards/AdminGuard.tsx
  src/platform/components/guards/SuperAdminGuard.tsx
Run npm run typecheck && npm run lint && npm run build.
Report all setup items complete and all 3 checks passing before awaiting Session PM01.
```
