# Module E — CC Prompts for E01–E10 (copy-paste)

Give these to CC **one at a time**, in order, in a fresh conversation. CC reads
the referenced session brief, reads the referenced HTML design, builds the screen,
runs 3 validation passes, reports results. Only give the next prompt after CC
reports the current one green.

**Prerequisites (must be true before E01):**
- Module E00 setup complete — 12 items green (fixtures + types + stores + API + MSW + routes + UI components + Tailwind teal tokens)
- `npm run typecheck && npm run lint && npm run build` all clean on `main`
- Design HTMLs present in `docs/E/design/`
- Session briefs present in `docs/E/CC/`

**Confirmed personas** (used throughout — do not substitute):
- `user-il` — **Ms Priya Nair** (Ideation Lead)
- `user-ma` — **Dr Rebecca Morton** (MA Team Lead)
- `user-ccm` — **Mr Daniel Okafor** (Content Calendar Manager)
- KOL guest — **Prof. James Hartley** (`j.hartley@example.ac.uk`, token `kol-tok-001-demo`, sign-off `2026-10-18T14:32:00Z`)
- MA approval timestamp: `2026-10-19T16:41:00Z`

**Non-negotiable rules on every screen** (from `session-E00-index.md`):
1. Source document is always read-only. `SourceGateBlock` full-width when gate fails, no bypass.
2. One atomisation API call per channel. `AtomisationSpinner` shows per-channel spinners resolving independently.
3. Provenance chain always visible without interaction — `ProvenanceChip` on every card.
4. Conflicting claim currency **blocks tagging** — tag action absent, not disabled.
5. sE05 KOL route is public — registered at router root outside AppShell, no auth check, no login redirect.

**Module accent:** teal `#0D9488`. Blocking states use rose (`#BE123C` hard block), amber (`#D97706` advisory), grey (inactive), green (approved). Steel blue `#005F8E` reserved for `ClaimCurrencyBadge` conflicting state only. **Never teal as a severity signal.**

---

## E01 — Ideation & Publishing Home

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/session-E01-ideation-publishing-home.md and execute.
Read the HTML at C:/Chetan/GenBioCa/LifeSciences/docs/E/design/aurora-sE01-ideation-publishing-home.html for the visual layout.
Build IdeationPublishingHome at src/modules/ideation-publishing/screens/IdeationPublishingHome.tsx, replace the sE01 placeholder in src/router/index.tsx, write a smoke test at c:/tmp/smoke-E01.js, and run 3 validation passes.
Apply the confirmed personas: Ms Priya Nair, Dr Rebecca Morton (MA approval 19 Oct 2026 16:41 UTC).
Report all 3 passes green before awaiting E02.
```

---

## E02 — Artefact Upload & Source Check

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/session-E02-artefact-upload-source-check.md and execute.
Read the HTML at C:/Chetan/GenBioCa/LifeSciences/docs/E/design/aurora-sE02-artefact-upload-source-check.html.
Build ArtefactUploadSourceCheck at src/modules/ideation-publishing/screens/ArtefactUploadSourceCheck.tsx, replace the sE02 placeholder in src/router/index.tsx, write c:/tmp/smoke-E02.js, run 3 validation passes.
Enforce rule 1: SourceGateBlock renders full-width when gate fails (ip-003 case) — no bypass. External-upload (ip-002) requires explicit Ideation Lead confirmation.
Report all 3 passes green before awaiting E03.
```

---

## E03 — Content Card Tagging & Atomisation

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/session-E03-content-card-tagging.md and execute.
Read the HTML at C:/Chetan/GenBioCa/LifeSciences/docs/E/design/aurora-sE03-content-card-tagging-atomisation.html.
Build ContentCardTagging at src/modules/ideation-publishing/screens/ContentCardTagging.tsx, replace the sE03 placeholder in src/router/index.tsx, write c:/tmp/smoke-E03.js, run 3 validation passes.
Enforce rule 2 (one API call per channel — AtomisationSpinner per-channel), rule 3 (ProvenanceChip always visible on every card), rule 4 (conflicting claim currency blocks tagging — tag action absent, not disabled).
Report all 3 passes green before awaiting E04.
```

---

## E04 — Pre-Review Compliance Screen

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/session-E04-pre-review-compliance.md and execute.
Read the HTML at C:/Chetan/GenBioCa/LifeSciences/docs/E/design/aurora-sE04-pre-review-compliance-screen.html.
Build PreReviewComplianceScreen at src/modules/ideation-publishing/screens/PreReviewComplianceScreen.tsx, replace the sE04 placeholder in src/router/index.tsx, write c:/tmp/smoke-E04.js, run 3 validation passes.
Show c-001 LinkedIn adaptation with the applied compliance fix ('transformative' removed). Must Fix count = 0 unlocks "Submit to KOL" (unblocks stage 2 → 3 transition).
Report all 3 passes green before awaiting E05.
```

---

## E05 — KOL Review Interface (PUBLIC)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/session-E05-kol-review-interface.md and execute.
Read the HTML at C:/Chetan/GenBioCa/LifeSciences/docs/E/design/aurora-sE05-kol-review-interface.html.
Build KOLReviewInterface at src/modules/ideation-publishing/screens/KOLReviewInterface.tsx, replace the sE05 placeholder in src/router/index.tsx (public route at ROOT — outside AuthGuard/AppShell), write c:/tmp/smoke-E05.js, run 3 validation passes.
Enforce rule 5: no auth header, no login redirect, no session check. Fetch KOL data via raw fetch (not the authenticated api client). Expired/used-token state shows a self-contained public "link expired" page — never the ClinWrite.AI login.
Persona: Prof. James Hartley (token kol-tok-001-demo, email j.hartley@example.ac.uk). Sign-off timestamp 2026-10-18T14:32:00Z.
Report all 3 passes green before awaiting E06.
```

---

## E06 — Medical Affairs Approval

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/session-E06-medical-affairs-approval.md and execute.
Read the HTML at C:/Chetan/GenBioCa/LifeSciences/docs/E/design/aurora-sE06-medical-affairs-approval.html.
Build MedicalAffairsApproval at src/modules/ideation-publishing/screens/MedicalAffairsApproval.tsx, replace the sE06 placeholder in src/router/index.tsx, write c:/tmp/smoke-E06.js, run 3 validation passes.
Show KOL feedback trail on c-003 (Prof. James Hartley PD-L1 comment) plus the Ideation Lead resolution (Ms Priya Nair) — AC-E-010 requires both visible to MA Lead before approve.
MA approver: Dr Rebecca Morton. On approval, stamp 2026-10-19T16:41:00Z.
Report all 3 passes green before awaiting E07.
```

---

## E07 — Content Calendar

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/session-E07-content-calendar.md and execute.
Read the HTML at C:/Chetan/GenBioCa/LifeSciences/docs/E/design/aurora-sE07-content-calendar.html.
Build ContentCalendar at src/modules/ideation-publishing/screens/ContentCalendar.tsx, replace the sE07 placeholder in src/router/index.tsx, write c:/tmp/smoke-E07.js, run 3 validation passes.
Render the 5 calendar entries from ideationCalendar.json: cal-001 LinkedIn 22 Oct PUBLISHED, cal-002 Blog 25 Oct OVERDUE (48h, rose tint + amber sentiment badge from sla-001), cal-003 HCP 28 Oct PUBLISHED, cal-004 Safety HCP 18 Oct OVERDUE (192h), cal-005 LinkedIn 5 Nov SCHEDULED. Sentiment alert resolution attributed to Dr Rebecca Morton.
Report all 3 passes green before awaiting E08.
```

---

## E08 — Publishing Monitor & Social Listening

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/session-E08-publishing-monitor.md and execute.
Read the HTML at C:/Chetan/GenBioCa/LifeSciences/docs/E/design/aurora-sE08-publishing-monitor-social-listening.html.
Build PublishingMonitor at src/modules/ideation-publishing/screens/PublishingMonitor.tsx, replace the sE08 placeholder in src/router/index.tsx, write c:/tmp/smoke-E08.js, run 3 validation passes.
DD-E-005: "Mark as published" is a human-executed action. Platform records the publish event; it never calls social platform APIs directly. Sentiment alert sla-001 detail shows resolution by Dr Rebecca Morton on 24 Oct.
Report all 3 passes green before awaiting E09.
```

---

## E09 — Final Output & Publishing Record

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/session-E09-final-output-publishing-record.md and execute.
Read the HTML at C:/Chetan/GenBioCa/LifeSciences/docs/E/design/aurora-sE09-final-output-publishing-record.html.
Build FinalOutputPublishingRecord at src/modules/ideation-publishing/screens/FinalOutputPublishingRecord.tsx, replace the sE09 placeholder in src/router/index.tsx, write c:/tmp/smoke-E09.js, run 3 validation passes.
Compliance provenance chain fully visible without interaction. KOL sign-off "✓ Prof. James Hartley · 18 Oct 2026 14:32 UTC" and MA approval "✓ Dr Rebecca Morton · 19 Oct 2026 16:41 UTC" both stamped in the record. Note: these are digital approval stamps, not full 21 CFR Part 11 e-signatures (only DOI-registered artefacts require full Part 11).
Report all 3 passes green before awaiting E10.
```

---

## E10 — Standards, Metadata & DOI

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/session-E10-standards-metadata-doi.md and execute.
Read the HTML at C:/Chetan/GenBioCa/LifeSciences/docs/E/design/aurora-sE10-standards-metadata-doi.html.
Build StandardsMetadataDOI at src/modules/ideation-publishing/screens/StandardsMetadataDOI.tsx, replace the sE10 placeholder in src/router/index.tsx, write c:/tmp/smoke-E10.js, run 3 validation passes.
Implements FR-E-019 — DOI (CrossRef) + ORCID + Dublin Core 15 elements + WCAG 2.1 AA (NOT 2.2). This is the compliance home for standards Modules A–D only reference. Module E owns the shared CrossRef/ORCID service (OQ-E-006 resolution).
Report all 3 passes green.
This is the final Module E screen — after E10 passes, run a module-wide sweep (typecheck + lint + build + all 10 smoke tests + DEV route sweep 200 OK on all 10 E routes + public /kol-review/kol-tok-001-demo).
```

---

## Post-E10 module-wide sweep

Give this after E10 reports green:

```
Module E is complete. Run the module-wide sweep and report:
1. npm run typecheck (clean)
2. npm run lint (clean)
3. npm run build (module count + gzip size)
4. All 10 smoke tests (E01–E10) — total pass count
5. DEV route sweep: 11 URLs
   - /projects/proj-velora-301/ideation-publishing
   - /projects/proj-velora-301/ideation-publishing/calendar
   - /projects/proj-velora-301/ideation-publishing/publishing
   - /projects/proj-velora-301/ideation-publishing/projects/ip-001
   - /projects/proj-velora-301/ideation-publishing/projects/ip-001/tagging
   - /projects/proj-velora-301/ideation-publishing/projects/ip-001/compliance
   - /projects/proj-velora-301/ideation-publishing/projects/ip-001/ma-approval
   - /projects/proj-velora-301/ideation-publishing/projects/ip-001/final
   - /projects/proj-velora-301/ideation-publishing/projects/ip-001/standards
   - /projects/proj-velora-301/ideation-publishing/projects/ip-003 (Stage 1 BLOCKED — SourceGateBlock visible)
   - /kol-review/kol-tok-001-demo (public — must return 200 without auth redirect)
```

---

## If you want a single autonomous prompt covering all 10 screens

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/E/CC/session-E*.md — iterate through E01 to E10 in order.
For each session: read the brief, read the design HTML, build the screen, replace the placeholder in src/router/index.tsx, write a smoke .js in c:/tmp/, run 3 validation passes (typecheck+lint, build, smoke) with up to 3 fix iterations each. Follow the 5 Module E design rules on every screen. Use the confirmed personas (Ms Priya Nair, Dr Rebecca Morton, Mr Daniel Okafor, Prof. James Hartley). Fully autonomous — do not stop between screens unless something can't recover.
After E10, run the module-wide sweep above and report the totals.
```
