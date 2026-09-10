# Module E — CC Session Index
**Read this before starting any Module E session.**
**Classification: Internal — GenBioCa Confidential**

---

## How to Use This Index

1. Give CC the index prompt below. CC reads and confirms understanding. Does not build anything.
2. Give CC the E00 context brief prompt. CC executes setup, confirms all 12 items and 3 checks pass.
3. Give CC one session prompt at a time (E01 → E10 in order). CC builds, validates 3 passes, reports.
4. Only move to the next session after CC reports all checks passing.

**3-pass validation — every screen:**
- Pass 1 — `npm run typecheck && npm run lint` — fix all errors before Pass 2
- Pass 2 — `npm run build` — fix all errors before Pass 3
- Pass 3 — 5 smoke tests specific to that screen — listed in each session brief

---

## Session Map

| Session | File | Screen | Component | HTML Design | Primary Data |
|---------|------|--------|-----------|-------------|-------------|
| E00 (index) | `session-E00-index.md` | This file | — | — | — |
| E00 (setup) | `session-E00-module-e-context.md` | Infrastructure setup | — | — | All 8 JSON fixtures |
| E01 | `session-E01-ideation-publishing-home.md` | Ideation & Publishing Home | `IdeationPublishingHome` | `aurora-sE01-*.html` | `ideationProjects.json` |
| E02 | `session-E02-artefact-upload-source-check.md` | Artefact Upload & Source Check | `ArtefactUploadSourceCheck` | `aurora-sE02-*.html` | `ideationProjects.json`, `ideationArtefacts.json`, `claimCurrencyCheck.json` |
| E03 | `session-E03-content-card-tagging.md` | Content Card Tagging | `ContentCardTagging` | `aurora-sE03-*.html` | `ideationArtefacts.json`, `ideationContentCards.json`, `atomisedContent.json` |
| E04 | `session-E04-pre-review-compliance.md` | Pre-Review Compliance Screen | `PreReviewComplianceScreen` | `aurora-sE04-*.html` | `ideationContentCards.json`, `atomisedContent.json` |
| E05 | `session-E05-kol-review-interface.md` | KOL Review Interface | `KOLReviewInterface` | `aurora-sE05-*.html` | `kolContacts.json`, `ideationContentCards.json` |
| E06 | `session-E06-medical-affairs-approval.md` | Medical Affairs Approval | `MedicalAffairsApproval` | `aurora-sE06-*.html` | `ideationContentCards.json`, `kolContacts.json` |
| E07 | `session-E07-content-calendar.md` | Content Calendar | `ContentCalendar` | `aurora-sE07-*.html` | `ideationCalendar.json`, `socialListeningAlerts.json` |
| E08 | `session-E08-publishing-monitor.md` | Publishing Monitor | `PublishingMonitor` | `aurora-sE08-*.html` | `ideationCalendar.json`, `socialListeningAlerts.json`, `atomisedContent.json` |
| E09 | `session-E09-final-output-publishing-record.md` | Final Output & Publishing Record | `FinalOutputPublishingRecord` | `aurora-sE09-*.html` | `ideationProjects.json`, `ideationContentCards.json` |
| E10 | `session-E10-standards-metadata-doi.md` | Standards, Metadata & DOI | `StandardsMetadataDOI` | `aurora-sE10-*.html` | `ideationContentCards.json`, `atomisedContent.json` |

---

## File Locations

```
C:/chetan/genBioCa/LifeSciences/
├── docs/E/
│   ├── CC/                                          ← these session brief files
│   │   ├── session-E00-index.md                     ← this file
│   │   ├── session-E00-module-e-context.md
│   │   ├── session-E01-ideation-publishing-home.md
│   │   ├── session-E02-artefact-upload-source-check.md
│   │   ├── session-E03-content-card-tagging.md
│   │   ├── session-E04-pre-review-compliance.md
│   │   ├── session-E05-kol-review-interface.md
│   │   ├── session-E06-medical-affairs-approval.md
│   │   ├── session-E07-content-calendar.md
│   │   ├── session-E08-publishing-monitor.md
│   │   ├── session-E09-final-output-publishing-record.md
│   │   └── session-E10-standards-metadata-doi.md
│   ├── design/                                      ← `docs/E/design/`                                      ← all HTML files
│   │   ├── aurora-sE01-ideation-publishing-home.html
│   │   ├── aurora-sE02-artefact-upload-source-check.html
│   │   ├── aurora-sE03-content-card-tagging.html
│   │   ├── aurora-sE04-pre-review-compliance.html
│   │   ├── aurora-sE05-kol-review-interface.html
│   │   ├── aurora-sE06-medical-affairs-approval.html
│   │   ├── aurora-sE07-content-calendar.html
│   │   ├── aurora-sE08-publishing-monitor.html
│   │   ├── aurora-sE09-final-output-publishing-record.html
│   │   └── aurora-sE10-standards-metadata-doi.html
│   └── aurora-module-e-data-files.md
├── apps/web/src/
│   ├── modules/ideation-publishing/
│   ├── data/                                        ← all 8 JSON fixtures
│   └── mocks/handlers/ideationPublishing.ts
└── packages/types/src/domain.ts
```

---

## Module E Design Rules (all sessions)

> **5 design rules. Apply to every session E01–E10 without being asked.**

1. **Source document always read-only.** The artefact/source panel in sE02 and sE03 has no edit controls anywhere. `SourceGateBlock` renders as a full-width block when gate fails — no bypass path. DD-E-001, DD-E-002.
2. **One atomisation call per channel.** Never batch all channels in a single API call. `AtomisationSpinner` shows individual per-channel spinners that resolve independently. DD-E-004.
3. **Provenance chain always visible without interaction.** `ProvenanceChip` renders on every content card without any click, expand, or "view source" action required. FR-E-009.
4. **Conflicting claim currency blocks tagging.** `ClaimCurrencyStatus === 'conflicting'` prevents the passage being tagged as a content card — the tag action is absent, not disabled. DD-E-003.
5. **sE05 KOL route is fully public.** Registered at router root, outside AppShell. No auth header, no login redirect, no session check. On expired/used token: show public "link expired" page — never the Aurora login page. FR-E-010, AC-E-023.

---

## Demo Project Context

**ip-001 — VELORA-301 Efficacy Communications — Stage 4 Approved** is the primary demo:
- Source: KOL Advisory Board Summary (Module C, `ia-001`) — gate passed, within 90 days
- 3 content cards: c-001 Efficacy (approved), c-002 Safety (approved), c-003 Subgroup (approved, amber claim currency flag acknowledged)
- 8 channel adaptations — c-001 LinkedIn has compliance fix (word "transformative" removed)
- KOL: Prof. James Hartley — signed off all 3 cards on 18 Oct 2026 14:32 UTC, c-003 comment on PD-L1 language
- MA: Dr Rebecca Morton — approved all 3 cards on 19 Oct 2026 16:41 UTC
- Calendar: 5 entries — 1 LinkedIn published, 1 blog overdue (48h), 1 HCP published, 1 safety HCP overdue, 1 scheduled 5 Nov

**ip-003 — VELORA-302 Pre-launch — Stage 1 BLOCKED** shows the source gate failure (draft in Module A).

---

## Confirmed Personas (from design reviews sE01–sE10)

These replace any earlier names in session briefs or fixtures:

| User ID | Name | Role |
|---------|------|------|
| `user-il` | **Ms Priya Nair** | Ideation Lead |
| `user-ma` | **Dr Rebecca Morton** | Medical Affairs Team Lead |
| `user-ccm` | **Mr Daniel Okafor** | Content Calendar Manager |
| KOL guest | **Prof. James Hartley** | External KOL reviewer |

KOL token: `kol-tok-001-demo` · email: `j.hartley@example.ac.uk` · sign-off: 18 Oct 2026 14:32 UTC

Update `ideationProjects.json` `maApprovedBy` → `"Dr Rebecca Morton"`, `maApprovedAt` → `"2026-10-19T16:41:00Z"`.
Update `kolContacts.json` `name` → `"Prof. James Hartley"`, `signedOffAt` → `"2026-10-18T14:32:00Z"`, `email` → `"j.hartley@example.ac.uk"`.

## Module E Colour — Resolved Decision

**Module E accent: `#0D9488` Teal** — confirmed from design files sE01–sE10. Do not use any other value.

Three values existed in different documents — all resolved here:

| Source | Value | Status |
|--------|-------|--------|
| PRD v4.1 §3.3 | `#005F8E` Steel Blue | ✗ Overridden — this is the cross-module blocking-state colour (C/D design rule). Using it as a module accent makes blocking states ambiguous. |
| Architecture Tailwind stub | `#E11D48` Rose | ✗ Overridden — rose is the sE07/sE08 overdue/error colour (`cal-002` rose tint, `SourceGateBlock` hard block). Cannot double as module accent. |
| Design files sE01–sE10 | `#0D9488` Teal | ✓ **Adopted** — no semantic collision with any existing state colour or module accent. |

**Tailwind tokens for Module E (add to `tailwind.config.ts`):**
```typescript
teal: {
  600: '#0D9488',   // Primary accent — buttons, active states, progress
  50:  '#F0FDFA',   // Teal tint — card backgrounds, approved states
  100: '#CCFBF1',   // Teal light — hover states
  200: '#99F6E4',   // Teal medium — borders, chips
}
```

**Module E blocking state colours** (distinct from the module accent):
- Source gate hard block (`SourceGateBlock`): rose `#BE123C` / `#FFF1F2` — already used in sE01/sE02
- Advisory / warning: amber `#D97706` / `#B45309` / `#FFFBEB` — same as C/D
- Pending / inactive: grey `#94A3B8` / `#F1F5F9`
- Approved / passed: green `#15803D` / `#F0FDF4`
- `#005F8E` steel blue: reserved for `ClaimCurrencyBadge` conflicting state only — never used as a background or module-level accent in Module E

## CC Prompt for the Index

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/session-E00-index.md and confirm all of the following before doing anything else:

1. You have noted the session map (E00 through E10) and all file locations under docs/E/CC/ and docs/E/design/.
2. You have noted the 5 Module E design rules that apply to every screen without exception.
3. You understand the ip-001 demo project context (Stage 4 Approved, primary demo) and ip-003 blocked state (source gate failure).
4. You understand sE05 is a public route registered at the router ROOT — outside the AppShell, no auth check, no login redirect.
5. You have noted the confirmed personas: Ms Priya Nair (Ideation Lead, user-il), Dr Rebecca Morton (MA Team Lead, user-ma), Mr Daniel Okafor (Content Calendar Manager, user-ccm), Prof. James Hartley (KOL guest, kol-tok-001-demo, j.hartley@example.ac.uk).
6. You have noted the Module E colour decision: accent is #0D9488 Teal — NOT #005F8E (steel blue, reserved for blocking states in C/D) and NOT #E11D48 (rose, reserved for overdue/error states in sE07/sE08). Tailwind token: teal-600: #0D9488.
7. You have noted that Module E blocking states use amber (#D97706), grey (#94A3B8), and rose (#BE123C) — never teal as a severity signal.

Do not build anything. Do not read any other file. Confirm each point by number and wait.
```

## CC Prompt for E00 Setup

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/session-E00-module-e-context.md and execute.
Also read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/aurora-module-e-data-files.md for the full JSON fixture content — copy all 8 fixtures to apps/web/src/data/.
Report all 12 setup items completed and all 3 verification checks (typecheck, lint, build) passing before awaiting Session E01.
```
