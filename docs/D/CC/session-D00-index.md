# Module D — CC Session Index
**Read this before starting any Module D session.**
**Classification: Internal — GenBioCa Confidential**

---

## How to Use This Index

1. Give CC the index prompt below. CC reads and confirms understanding. Does not build anything.
2. Give CC the D00 context brief prompt. CC executes setup, confirms all 13 items and 3 checks pass.
3. Give CC one session prompt at a time (D01 → D12 in order). CC builds, validates 3 passes, reports.
4. Only move to the next session after CC reports all checks passing.

**3-pass validation — every screen:**
- Pass 1 — `npm run typecheck && npm run lint` — fix all errors before Pass 2
- Pass 2 — `npm run build` — fix all errors before Pass 3
- Pass 3 — 5 smoke tests specific to that screen — listed in each session brief

---

## Session Map

| Session | File | Screen | Stage | HTML Design | Primary Data |
|---------|------|--------|-------|-------------|-------------|
| D00 (index) | `session-D00-index.md` | This file | — | — | — |
| D00 (setup) | `session-D00-module-d-context.md` | Infrastructure setup | — | — | All 12 JSON fixtures |
| D01 | `session-D01-regulatory-writing-home.md` | Regulatory Writing Home | Dashboard | `aurora-sD01-regulatory-writing-home.html` | `regulatorySubmissions.json`, `regulatoryAlerts.json`, `ectdGranularityMap.json` |
| D02 | `session-D02-submission-setup-strategy.md` | Submission Setup & Strategy | Stage 1 | `aurora-sD02-submission-setup-strategy.html` | `regulatorySubmissions.json`, `cmcReadinessReport.json` |
| D03 | `session-D03-ectd-granularity-map.md` | eCTD Granularity Map | Stage 1 | `aurora-sD03-ectd-granularity-map.html` | `ectdGranularityMap.json`, `consistencyCheckResult.json` |
| D04 | `session-D04-ctd-module2-editor.md` | CTD Module 2 Editor | Stage 2 | `aurora-sD04-ctd-module2-editor.html` | `ectdGranularityMap.json`, `consistencyCheckResult.json` |
| D05 | `session-D05-cmc-nonclinical-finalisation.md` | CMC & Nonclinical Finalisation | Stage 3 | `aurora-sD05-cmc-nonclinical-finalisation.html` | `cmcReadinessReport.json`, `ectdGranularityMap.json` |
| D06 | `session-D06-super-review.md` | Super Review | Stage 4 | `aurora-sD06-super-review.html` | `superReviewers.json`, `consistencyCheckResult.json` |
| D07 | `session-D07-ectd-publishing-monitor.md` | eCTD Publishing Monitor | Stage 5 | `aurora-sD07-ectd-publishing-monitor.html` | `ectdGranularityMap.json`, `ectdValidationResult.json`, `redactionRecord.json` |
| D08 | `session-D08-ppd-cci-redaction.md` | PPD/CCI Redaction Tool | Stage 5 | `aurora-sD08-ppd-cci-redaction.html` | `redactionRecord.json` |
| D09 | `session-D09-gateway-submission.md` | Gateway Submission | Stage 6 | `aurora-sD09-gateway-submission.html` | `gatewaySubmissions.json`, `haCorrespondence.json`, `regulatoryLibraryCards.json` |
| D10 | `session-D10-ha-response-drafting.md` | HA Response Drafting | Stage 6 | `aurora-sD10-ha-response-drafting.html` | `haCorrespondence.json` |
| D11 | `session-D11-regulatory-intelligence.md` | Regulatory Intelligence | Cross-stage | `aurora-sD11-regulatory-intelligence.html` | `regulatoryAlerts.json` |
| D12 | `session-D12-final-output-portfolio.md` | Final Output & Portfolio | Stage 6 | `aurora-sD12-final-output-portfolio.html` | `regulatorySubmissions.json`, `gatewaySubmissions.json`, `regulatoryLibraryCards.json`, `oddAssessment.json` |

---

## File Locations

```
C:/chetan/genBioCa/LifeSciences/
├── docs/D/
│   ├── CC/                                          ← these session brief files
│   │   ├── session-D00-index.md                     ← this file
│   │   ├── session-D00-module-d-context.md          ← D00 setup brief
│   │   ├── session-D01-regulatory-writing-home.md
│   │   ├── session-D02-submission-setup-strategy.md
│   │   ├── session-D03-ectd-granularity-map.md
│   │   ├── session-D04-ctd-module2-editor.md
│   │   ├── session-D05-cmc-nonclinical-finalisation.md
│   │   ├── session-D06-super-review.md
│   │   ├── session-D07-ectd-publishing-monitor.md
│   │   ├── session-D08-ppd-cci-redaction.md
│   │   ├── session-D09-gateway-submission.md
│   │   ├── session-D10-ha-response-drafting.md
│   │   ├── session-D11-regulatory-intelligence.md
│   │   └── session-D12-final-output-portfolio.md
│   ├── design/                                      ← docs/D/design/ — all HTML files
│   │   ├── aurora-sD01-regulatory-writing-home.html
│   │   ├── aurora-sD02-submission-setup-strategy.html
│   │   ├── aurora-sD03-ectd-granularity-map.html
│   │   ├── aurora-sD04-ctd-module2-editor.html
│   │   ├── aurora-sD05-cmc-nonclinical-finalisation.html
│   │   ├── aurora-sD06-super-review.html
│   │   ├── aurora-sD07-ectd-publishing-monitor.html
│   │   ├── aurora-sD08-ppd-cci-redaction.html
│   │   ├── aurora-sD09-gateway-submission.html
│   │   ├── aurora-sD10-ha-response-drafting.html
│   │   ├── aurora-sD11-regulatory-intelligence.html
│   │   └── aurora-sD12-final-output-portfolio.html
│   └── aurora-module-d-data-files.md               ← full JSON reference doc
├── apps/web/src/
│   ├── modules/regulatory-writing/                  ← Module D components
│   ├── data/                                        ← all 12 JSON fixtures
│   └── mocks/handlers/regulatoryWriting.ts          ← MSW handler
└── packages/types/src/domain.ts                     ← Module D types
```

---

## Module D Design Rules (all sessions)

1. **No red.** Blocking states use `#005F8E` (Steel Blue). Module crimson `#B0200D` is the accent only.
2. **Module 5 is always read-only.** Every Module 5 node shows lock icon + `CTDReadOnlyBanner`. No edit controls ever.
3. **Consistency check is a hard gate.** "Submit to Stage 5 →" stays inactive while any Major contradiction is unresolved.
4. **Gateway requires inline Part 11 confirm.** `PartElevenConfirm` expands inline — never a modal. `confirmingTransmission` boolean gates the actual API call.
5. **Redaction is irreversible after Stage 5.** Word "redact" throughout — never "delete". `DD-D-003`.
6. **sD07 → sD08 are linked.** The PPD/CCI summary panel in sD07 links to the full redaction tool in sD08. Build sD07 first, then sD08. The "Review all [N] instances →" link in sD07 navigates to the `redaction` route.

---

## Demo Submission Context

All screens use the **VELORA-301 NDA (`sub-001`)** as the primary demo submission:
- Stage 2 authoring at session start
- 847 canonical JSON data points indexed
- HR 0.61 (final analysis) vs 0.63 (interim) — the consistency contradiction
- 2 contradictions: con-001 Major resolved ✓, con-002 Minor unresolved ✗ (blocks Stage 5)
- FDA ACK2 confirmed, EMA pending
- 2 of 6 RACI signed for Super Review
- 47 PPD + 8 CCI detected, 23+5 confirmed

---

## CC Prompt for the Index

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D00-index.md and confirm:
1. You have noted the session map (D00 through D12) and all file locations.
2. You have noted the 6 Module D design rules that apply to every screen.
3. You understand the VELORA-301 NDA demo submission context.
4. You understand that sD07 must be built before sD08.
Do not build anything yet. Confirm understanding and wait.
```

## CC Prompt for D00 Setup

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D00-module-d-context.md and execute.
Report all 13 setup items completed and all 3 verification checks
(typecheck, lint, build) passing before awaiting Session D01.
```
