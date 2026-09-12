# Session PM06 — Onboarding Wizard
**Screen:** sPM10 · Onboarding Wizard
**Route:** `/onboarding/:module`
**Component:** `src/platform/screens/OnboardingWizard.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM10-onboarding-wizard.html`
**Data:** `raciMatrix.json`, `users.json`
**Store:** `platformStore`
**Access:** All users (shown on first module access)

---

## What to Build

Full-screen overlay — no AppShell sidebar visible, top strip only. 6-step wizard. Demo renders Module E with Ms Priya Nair · Ideation Lead. Module E colour `#0D9488` teal accent for the demo (wizard inherits per-module colour per PRD §7.11).

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Top strip:** ClinWrite.AI wordmark · `{{ u.name }}` · `{{ roleLabel }}`
**Progress dots:** 6 dots · Step 1 completed (✓ Done) · Step 2 active

**Step 1 — Welcome (shown as completed):**
- Module colour banner strip across top of card
- "Welcome to {{ moduleName }}" · `{{ moduleBlurb }}`
- Stage dots strip: `{{ stages }}` — 4 dots for Module E (Uploaded → Under Review → Reviewed → Approved)
- "✓ Done" indicator

**Step 2 — Your Role (ACTIVE in demo):**
- "Your role in this module · {{ roleLabel }}"
- "These assignments come from the project RACI matrix. They determine which actions you can take and which notifications you receive."
- RACI table: `{{ raci }}` loop — `{{ r.task }}` · `{{ r.mark }}` chip · `{{ r.word }}` meaning
- "R = you do this · A = you are accountable · C = you are consulted · I = you are informed"

**Step navigation (bottom):**
- `{{ back }}` "← Back" (grey) · "Step `{{ stepNum }}` of 6" · `{{ next }}` `{{ nextLabel }}` button
- "Your progress is saved. You can reopen this walkthrough from the help menu at any time."
- "Skip wizard" link (small, grey)

---

## Data Wiring

```typescript
// Module constants — keyed by route param :module — NOT from API
const MODULE_META = {
  A: { name: 'Clinical Writing',      blurb: 'CSRs, IBs, SAPs and regulatory documents', stages: 6, colour: '#2563EB' },
  B: { name: 'Scientific Writing',    blurb: 'Manuscripts, abstracts, posters and publications', stages: 6, colour: '#7C3AED' },
  C: { name: 'Medical Writing',       blurb: 'HCP decks, PILs, CME modules and disease dossiers', stages: 6, colour: '#7C3AED' },
  D: { name: 'Regulatory Writing',    blurb: 'CTD/eCTD submissions and gateway filings', stages: 6, colour: '#D97706' },
  E: { name: 'Ideation & Publishing', blurb: 'Content cards, KOL review and publishing calendar', stages: 4, colour: '#0D9488' },
}

// RACI rows for Step 2 — filter raciMatrix.json active module
// Only rows where currentUser.role has an assignment (R/A/C/I)
// r.word derives from r.mark: R→Responsible, A→Accountable, C→Consulted, I→Informed

// Step 1 cannot be dismissed (no Skip on Step 1)
// Steps 2-6 have "Skip wizard" link
// Once wizard is completed or skipped: set localStorage flag; do not auto-show again
// Re-launchable from help icon (not built in this session — just the wizard itself)
```

---

## Implementation Notes (from design review)

- RACI table has **three columns**: task · letter chip · word meaning — `r.word` derives from `r.mark` in the store, not a fixture field
- `moduleName`, `moduleBlurb`, and stage count are **constants** keyed by route param — not fetched from API (see `MODULE_META` above)
- Demo renders Module E: Ms Priya Nair · Ideation Lead · teal `#0D9488` wizard accent
- Step 1 cannot be dismissed during first run — "Skip wizard" only appears from Step 2 onwards
- `{{ d.title }}` = stage label per dot in the stage strip (e.g. "Uploaded", "Under Review", "Reviewed", "Approved")
- `{{ nextLabel }}` = "Next →" for steps 1–5, "Go to Module Home →" for step 6

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Wizard renders as full-screen overlay — AppShell sidebar is absent. Module E teal colour strip visible at top. (AC-PM-014)
2. Step 2 RACI table shows 3 columns: task · R/A/C/I chip · word meaning. All 7 Module E tasks from `raciMatrix.json` are shown for Ms Priya Nair (Ideation Lead). (AC-PM-015)
3. Stage dot strip shows 4 dots for Module E (not 6).
4. Step 1 shows "✓ Done" completed state. Step 2 is active. Step navigation shows "Step 2 of 6".
5. "Skip wizard" link is present from Step 2 onwards. Step 1 has no Skip option.

---

## CC Prompt

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM07-onboarding-wizard.md and execute.
Build OnboardingWizard exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM10-onboarding-wizard.html.
Run all 3 validation passes and report results before awaiting Session PM08.
```
