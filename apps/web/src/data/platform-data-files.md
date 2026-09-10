# Platform & Admin Module — Data Files for CC
## `platform-data-files.md`
**Copy to:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/`
**CC reads this during sPM00 setup before building any platform screen.**
**Classification:** Internal — GenBioCa Confidential

---

## 1. What This File Is

This is the data wiring document for the Platform & Admin module (sPM04–sPM18) and Module B Slide Deck Generator (sB10). It contains all 13 JSON fixture files that CC must copy to `apps/web/src/data/` before building any platform screen.

The pattern is identical to `aurora-module-e-data-files.md` and `aurora-module-d-data-files.md`.

---

## 2. Setup Instruction for CC

Before building any platform screen:

1. Read `docs/PM/CC/platform-module-brief.md` in full.
2. Copy all 13 JSON files below into `apps/web/src/data/`.
3. Register all platform MSW handlers in `src/mocks/handlers/platform.ts` (new file).
4. Import `platform.ts` in `src/mocks/handlers/index.ts`.
5. Run `npm run typecheck && npm run lint && npm run build` — all must pass before proceeding to any individual screen session.

---

## 3. Fixture File Map

| File | Records | Primary screens | What it powers |
|------|---------|----------------|----------------|
| `platformConfig.json` | 1 | sPM04, sPM05 | AI engine, voice, eCTD, payment gateway, external API config |
| `users.json` | 8 | sPM06, sPM07 | User table, invite drawer, RACI user assignments |
| `raciMatrix.json` | 1 | sPM07 | RACI matrix table — Modules D and E tasks and role assignments |
| `masterLibraryItems.json` | 12 | sPM08 | Library search results list and item detail panel |
| `bestPractices.json` | 8 | sPM09 | Best practice cards by module tab |
| `notifications.json` | 10 | sPM14 | Notification inbox list and detail panel |
| `notificationPrefs.json` | 5 | sPM14 | Notification preference table (email / in-app / SMS toggles) |
| `auditTrail.json` | 20 | sPM15 | Audit trail table rows and 21 CFR Part 11 detail drawer |
| `ratecards.json` | 2 | sPM12 | Version history list and rate card detail table |
| `subscription.json` | 1 | sPM11, sPM13 | Services dashboard module breakdown + Subscription payment panel, invoice history, market value savings |
| `reports.json` | 6 | sPM16 | Available report types list in left nav |
| `moduleHealthScores.json` | 6 | sPM16 | Module health score cards on the reports dashboard |
| `taTags.json` | 12 | sPM17 | TA tag configuration table |
| `regulatoryFrameworks.json` | 15 | sPM18 | Regulatory framework registry table and edit drawer |
| `slidedeckJob.json` | 1 | sB10 | Slide deck job: congress gate, accessibility gate, slides list, export state |

---

## 4. Cross-Module References

These fixture IDs link the platform layer to existing module fixtures already in `src/data/`:

| Platform fixture | References | Existing fixture |
|-----------------|------------|-----------------|
| `auditTrail.json` | `sub-001` VELORA-301 NDA | `regulatorySubmissions.json` |
| `auditTrail.json` | `ip-001` VELORA-301 Efficacy | `ideationProjects.json` |
| `auditTrail.json` | `ia-001` KOL Session Summary | `ideationArtefacts.json` |
| `auditTrail.json` | `alert-001` ICH E2C(R2) | `regulatoryAlerts.json` |
| `masterLibraryItems.json` | `sub-001`, `ip-001` | `regulatorySubmissions.json`, `ideationProjects.json` |
| `notifications.json` | `cal-002`, `cal-005` | `ideationCalendar.json` |
| `regulatoryFrameworks.json` | `alert-001` | `regulatoryAlerts.json` |

---

## 5. Demo Personas

All platform screens use these users from `users.json`:

| ID | Name | Role | Primary screens |
|----|------|------|----------------|
| `user-admin` | Dr James Hartley | Admin | sPM04, sPM06, sPM07, sPM13, sPM15, sPM17 |
| `user-sa` | Alex Thornton | Super Admin | sPM05, sPM12, sPM18 |
| `user-il` | Ms Priya Nair | Ideation Lead | sPM10 (Module E wizard), sPM16 |
| `user-rw` | Dr Sarah Chen | Regulatory Writer | sPM14 (current user for notification inbox demo) |
| `user-ma` | Dr Rebecca Morton | MA Team Lead | sPM14 (notification body references) |
| `user-cl` | Dr Elena Vasquez | Clinical Lead | sB10 (slide deck generator current user) |

---

## 6. MSW Handler Registration

Create `src/mocks/handlers/platform.ts` with handlers for all platform endpoints. Example pattern:

```typescript
import { http, HttpResponse } from 'msw'
import platformConfig  from '../../data/platformConfig.json'
import users           from '../../data/users.json'
import raciMatrix      from '../../data/raciMatrix.json'
import masterLibrary   from '../../data/masterLibraryItems.json'
import bestPractices   from '../../data/bestPractices.json'
import notifications   from '../../data/notifications.json'
import notifPrefs      from '../../data/notificationPrefs.json'
import auditTrail      from '../../data/auditTrail.json'
import ratecards       from '../../data/ratecards.json'
import subscription    from '../../data/subscription.json'
import reports         from '../../data/reports.json'
import healthScores    from '../../data/moduleHealthScores.json'
import taTags          from '../../data/taTags.json'
import regFrameworks   from '../../data/regulatoryFrameworks.json'
import slidedeckJob    from '../../data/slidedeckJob.json'

export const platformHandlers = [
  http.get('/api/admin/config',              () => HttpResponse.json(platformConfig)),
  http.get('/api/admin/users',               () => HttpResponse.json(users)),
  http.get('/api/raci/:projectId',           () => HttpResponse.json(raciMatrix)),
  http.get('/api/library',                   () => HttpResponse.json(masterLibrary)),
  http.get('/api/library/best-practices',    () => HttpResponse.json(bestPractices)),
  http.get('/api/notifications',             () => HttpResponse.json(notifications)),
  http.get('/api/notifications/preferences', () => HttpResponse.json(notifPrefs)),
  http.get('/api/audit',                     () => HttpResponse.json(auditTrail)),
  http.get('/api/super-admin/rate-cards',    () => HttpResponse.json(ratecards)),
  http.get('/api/services/dashboard',        () => HttpResponse.json(subscription)),
  http.get('/api/reports/available',         () => HttpResponse.json(reports)),
  http.get('/api/reports/health-scores',     () => HttpResponse.json(healthScores)),
  http.get('/api/admin/taxonomy',            () => HttpResponse.json(taTags)),
  http.get('/api/regulatory-frameworks',     () => HttpResponse.json(regFrameworks)),
  http.get('/api/publications/:id/slides/:jobId', () => HttpResponse.json(slidedeckJob)),
]
```

Add `...platformHandlers` to the handlers array in `src/mocks/handlers/index.ts`.

---

## 7. Key Design Decisions Embedded in the Data

- **`platformConfig.json`** — `aiEngine.default` is `"claude-sonnet-4-5"`. The model string shown in the Admin Panel AI Engine tab must match this exactly.
- **`ratecards.json`** — `v1.0` has `"isDisruptionRateCard": true` and `"status": "archived"`. `v1.1` has `"status": "active"` and no backdating (`effectiveFrom: "2026-07-01"` is after `v1.0` ended). The "cannot be backdated" rule is enforced by the UI — the `effectiveFrom` date picker must reject past dates.
- **`regulatoryFrameworks.json`** — `rf-003` (21 CFR Part 314) has `"status": "Updated"` and `rf-008` (ICH E2C(R2)) has `"status": "Draft revision"`. These two rows must render with amber `⚠ Updated` / `⚠ Draft revision` chips in sPM18. Both have `changeSummary` populated — shown in the edit drawer.
- **`auditTrail.json`** — `aud-001` has a full `partEleven` object (SIGNATURE_APPLIED). `aud-005` also has `partEleven` (SUBMISSION_TRANSMITTED). All other rows have `"partEleven": null`. The detail drawer only shows the 21 CFR Part 11 section when `partEleven !== null`.
- **`slidedeckJob.json`** — `congressGateActive: true` and `totalSlides: 18` (limit 15) — export button must be inactive. `accessibilityGate.missingAltText` has one entry (fig-003 on slide-006) — shows the inline alt text field for that figure.
- **`subscription.json`** — `marketValueSavings.total = 184720` and `rateCardVersion = "v1.1"`. The footnote in sPM16 reads "Market value savings calculated using Rate Card v1.1 (Alex Thornton · 01 Jul 2026)".
- **`notifications.json`** — `notif-001`, `notif-002`, `notif-003` have `"isRead": false` — these are the 3 unread notifications. `unreadCount` badge on the Inbox tab shows `3`.

---

## 8. JSON Fixture Content

### `platformConfig.json`
**Records:** 1 · **Screens:** sPM04, sPM05

```json
{
  "clientId": "client-genbioca-001",
  "clientName": "GenBioCa Sciences",
  "plan": "Enterprise",
  "planStartDate": "2026-01-01",
  "renewalDate": "2026-10-01",
  "contractedTokensPerMonth": 4000000,
  "currency": "GBP",
  "aiEngine": {
    "default": "claude-sonnet-4-5",
    "fallback": "claude-haiku-4-5",
    "perModuleOverrideEnabled": true,
    "availableEngines": [
      {
        "id": "claude-sonnet-4-5",
        "label": "Claude Sonnet 4.5",
        "provider": "Anthropic",
        "status": "active"
      },
      {
        "id": "claude-opus-4",
        "label": "Claude Opus 4",
        "provider": "Anthropic",
        "status": "available"
      },
      {
        "id": "gpt-4o",
        "label": "GPT-4o",
        "provider": "OpenAI",
        "status": "available"
      },
      {
        "id": "gemini-pro",
        "label": "Gemini Pro",
        "provider": "Google",
        "status": "available"
      }
    ],
    "lastTested": "2026-09-09T14:22:00Z",
    "lastTestedLatencyMs": 340,
    "lastTestedStatus": "connected"
  },
  "voiceTranscription": {
    "engine": "whisper",
    "availableEngines": [
      {
        "id": "whisper",
        "label": "Whisper (OpenAI)",
        "status": "active"
      },
      {
        "id": "assemblyai",
        "label": "AssemblyAI",
        "status": "available"
      },
      {
        "id": "azure-speech",
        "label": "Azure Speech",
        "status": "available"
      }
    ],
    "gdprJurisdiction": "EU",
    "audioRetentionPolicy": "delete-immediately",
    "auditDeletionLogged": true
  },
  "ectd": {
    "defaultVersion": "v3.2.2",
    "validationTool": "EXTEDO EXTEDOpulse",
    "validationCredentialsLastValidated": "2026-09-15T00:00:00Z"
  },
  "paymentGateways": [
    {
      "id": "stripe",
      "label": "Stripe",
      "status": "active",
      "lastTested": "2026-09-08"
    },
    {
      "id": "razorpay",
      "label": "RazorPay",
      "status": "active",
      "lastTested": "2026-09-08"
    },
    {
      "id": "payu",
      "label": "PayU",
      "status": "inactive",
      "lastTested": null
    },
    {
      "id": "ccavenue",
      "label": "CCAvenue",
      "status": "inactive",
      "lastTested": null
    },
    {
      "id": "upi",
      "label": "UPI",
      "status": "active",
      "lastTested": "2026-09-08"
    },
    {
      "id": "net-banking",
      "label": "Net Banking",
      "status": "active",
      "lastTested": "2026-09-08"
    }
  ],
  "externalApis": [
    {
      "id": "fda-esg",
      "label": "FDA ESG",
      "status": "connected",
      "lastTested": "2026-09-09T09:00:00Z"
    },
    {
      "id": "ema-cesp",
      "label": "EMA CESP",
      "status": "connected",
      "lastTested": "2026-09-09T09:00:00Z"
    },
    {
      "id": "mhra",
      "label": "MHRA",
      "status": "not-configured",
      "lastTested": null,
      "note": "OQ-D-008 \u2014 Priority 4"
    },
    {
      "id": "extedo",
      "label": "EXTEDO EXTEDOpulse",
      "status": "connected",
      "lastTested": "2026-09-15T00:00:00Z"
    },
    {
      "id": "crossref-orcid",
      "label": "CrossRef / ORCID",
      "status": "connected",
      "lastTested": "2026-09-09T00:00:00Z",
      "owner": "Module E"
    },
    {
      "id": "pubmed",
      "label": "PubMed",
      "status": "connected",
      "lastTested": "2026-09-01T00:00:00Z"
    },
    {
      "id": "cdsco",
      "label": "CDSCO",
      "status": "inactive",
      "lastTested": null
    },
    {
      "id": "sms-gateway",
      "label": "SMS Gateway",
      "status": "connected",
      "lastTested": "2026-09-08T00:00:00Z"
    },
    {
      "id": "smtp",
      "label": "Email SMTP",
      "status": "connected",
      "lastTested": "2026-09-09T00:00:00Z"
    },
    {
      "id": "pmda",
      "label": "PMDA",
      "status": "inactive",
      "lastTested": null
    }
  ],
  "featureFlags": [
    {
      "id": "module-e-localisation",
      "label": "Module E Localisation",
      "status": "enabled"
    },
    {
      "id": "voice-notes",
      "label": "Voice Notes",
      "status": "enabled"
    },
    {
      "id": "slide-deck-generator",
      "label": "Slide Deck Generator",
      "status": "enabled"
    },
    {
      "id": "best-practices-api",
      "label": "Best Practices API",
      "status": "beta"
    }
  ]
}
```

---

### `users.json`
**Records:** 8 · **Screens:** sPM06, sPM07

```json
[
  {
    "id": "user-admin",
    "name": "Dr James Hartley",
    "email": "j.hartley@genbioca.com",
    "role": "admin",
    "modules": [
      "A",
      "B",
      "C",
      "D",
      "E"
    ],
    "status": "active",
    "lastActive": "2026-09-09T09:15:00Z"
  },
  {
    "id": "user-il",
    "name": "Ms Priya Nair",
    "email": "p.nair@genbioca.com",
    "role": "ideation-lead",
    "modules": [
      "E"
    ],
    "status": "active",
    "lastActive": "2026-09-09T08:44:00Z"
  },
  {
    "id": "user-rw",
    "name": "Dr Sarah Chen",
    "email": "s.chen@genbioca.com",
    "role": "regulatory-writer",
    "modules": [
      "D"
    ],
    "status": "active",
    "lastActive": "2026-09-08T17:30:00Z"
  },
  {
    "id": "user-ma",
    "name": "Dr Rebecca Morton",
    "email": "r.morton@genbioca.com",
    "role": "ma-team-lead",
    "modules": [
      "C",
      "E"
    ],
    "status": "active",
    "lastActive": "2026-09-09T07:30:00Z"
  },
  {
    "id": "user-ccm",
    "name": "Mr Daniel Okafor",
    "email": "d.okafor@genbioca.com",
    "role": "content-calendar-manager",
    "modules": [
      "E"
    ],
    "status": "active",
    "lastActive": "2026-09-08T00:00:00Z"
  },
  {
    "id": "user-cl",
    "name": "Dr Elena Vasquez",
    "email": "e.vasquez@genbioca.com",
    "role": "clinical-lead",
    "modules": [
      "A"
    ],
    "status": "active",
    "lastActive": "2026-09-07T00:00:00Z"
  },
  {
    "id": "user-cmc",
    "name": "Dr Arjun Patel",
    "email": "a.patel@genbioca.com",
    "role": "cmc-lead",
    "modules": [
      "D"
    ],
    "status": "active",
    "lastActive": "2026-09-06T00:00:00Z"
  },
  {
    "id": "user-auth",
    "name": "Ms Laura Kim",
    "email": "l.kim@genbioca.com",
    "role": "author",
    "modules": [
      "A",
      "B"
    ],
    "status": "invited",
    "lastActive": null
  }
]
```

---

### `raciMatrix.json`
**Records:** 1 · **Screens:** sPM07

```json
{
  "version": "v1.0",
  "effectiveDate": "2026-01-01",
  "modules": {
    "D": {
      "label": "Module D \u2014 Regulatory Writing",
      "tasks": [
        {
          "id": "d-t1",
          "label": "Submission setup (Stage 1)",
          "assignments": {
            "admin": "A",
            "regulatory-writer": "R",
            "clinical-lead": "C",
            "cmc-lead": "C",
            "qc-checker": "I",
            "e-signatory": "I"
          }
        },
        {
          "id": "d-t2",
          "label": "CTD Module 2 authoring (Stage 2)",
          "assignments": {
            "admin": "A",
            "regulatory-writer": "R",
            "clinical-lead": "C",
            "cmc-lead": "I",
            "qc-checker": "I",
            "e-signatory": "I"
          }
        },
        {
          "id": "d-t3",
          "label": "CMC/Nonclinical (Stage 3)",
          "assignments": {
            "admin": "A",
            "regulatory-writer": "C",
            "clinical-lead": "I",
            "cmc-lead": "R",
            "qc-checker": "I",
            "e-signatory": "I"
          }
        },
        {
          "id": "d-t4",
          "label": "Super Review (Stage 4)",
          "assignments": {
            "admin": "A",
            "regulatory-writer": "R",
            "clinical-lead": "R",
            "cmc-lead": "R",
            "qc-checker": "R",
            "e-signatory": "R"
          }
        },
        {
          "id": "d-t5",
          "label": "eCTD Publishing (Stage 5)",
          "assignments": {
            "admin": "A",
            "regulatory-writer": "R",
            "clinical-lead": "I",
            "cmc-lead": "I",
            "qc-checker": "C",
            "e-signatory": "I"
          }
        },
        {
          "id": "d-t6",
          "label": "Gateway Submission (Stage 6)",
          "assignments": {
            "admin": "A",
            "regulatory-writer": "R",
            "clinical-lead": "I",
            "cmc-lead": "I",
            "qc-checker": "I",
            "e-signatory": "R"
          }
        },
        {
          "id": "d-t7",
          "label": "HA Response Drafting",
          "assignments": {
            "admin": "A",
            "regulatory-writer": "R",
            "clinical-lead": "C",
            "cmc-lead": "C",
            "qc-checker": "I",
            "e-signatory": "I"
          }
        },
        {
          "id": "d-t8",
          "label": "Regulatory Intelligence",
          "assignments": {
            "admin": "A",
            "regulatory-writer": "R",
            "clinical-lead": "C",
            "cmc-lead": "I",
            "qc-checker": "I",
            "e-signatory": "I"
          }
        }
      ]
    },
    "E": {
      "label": "Module E \u2014 Ideation & Publishing",
      "tasks": [
        {
          "id": "e-t1",
          "label": "Artefact upload & source check",
          "assignments": {
            "ideation-lead": "R",
            "ma-team-lead": "C",
            "content-calendar-manager": "I",
            "creative-team-member": "I"
          }
        },
        {
          "id": "e-t2",
          "label": "Content card tagging",
          "assignments": {
            "ideation-lead": "R",
            "ma-team-lead": "C",
            "content-calendar-manager": "I",
            "creative-team-member": "I"
          }
        },
        {
          "id": "e-t3",
          "label": "Pre-review compliance",
          "assignments": {
            "ideation-lead": "R",
            "ma-team-lead": "C",
            "content-calendar-manager": "I",
            "creative-team-member": "I"
          }
        },
        {
          "id": "e-t4",
          "label": "KOL review",
          "assignments": {
            "ideation-lead": "A",
            "ma-team-lead": "C",
            "content-calendar-manager": "I",
            "creative-team-member": "I"
          }
        },
        {
          "id": "e-t5",
          "label": "Medical Affairs approval",
          "assignments": {
            "ideation-lead": "C",
            "ma-team-lead": "A",
            "content-calendar-manager": "I",
            "creative-team-member": "I"
          }
        },
        {
          "id": "e-t6",
          "label": "Content calendar scheduling",
          "assignments": {
            "ideation-lead": "C",
            "ma-team-lead": "I",
            "content-calendar-manager": "R",
            "creative-team-member": "C"
          }
        },
        {
          "id": "e-t7",
          "label": "Publishing execution",
          "assignments": {
            "ideation-lead": "I",
            "ma-team-lead": "I",
            "content-calendar-manager": "A",
            "creative-team-member": "R"
          }
        }
      ]
    }
  }
}
```

---

### `masterLibraryItems.json`
**Records:** 12 · **Screens:** sPM08

```json
[
  {
    "id": "ml-001",
    "name": "CTD 2.5 Clinical Overview \u2014 Veloricept NDA v1.0",
    "module": "D",
    "itemType": "document",
    "docType": "NDA",
    "ta": [
      "Oncology"
    ],
    "version": "v1.0",
    "pushedAt": "2026-10-16T17:04:00Z",
    "pushedBy": "user-admin",
    "pushedByName": "Dr James Hartley",
    "projectId": "proj-velora-301",
    "projectName": "VELORA-301 Efficacy Suite",
    "tags": [
      "NDA",
      "FDA + EMA",
      "Oct 2026",
      "Regulatory Writing"
    ],
    "isArchived": false,
    "provenanceChain": [
      "Module A \u00b7 VELORA-301 CSR v1.0",
      "Module D \u00b7 Regulatory Writing Stage 6",
      "Master Library 16 Oct 2026"
    ]
  },
  {
    "id": "ml-002",
    "name": "CTD 2.7 Clinical Summary \u2014 Veloricept NDA v1.0",
    "module": "D",
    "itemType": "document",
    "docType": "NDA",
    "ta": [
      "Oncology"
    ],
    "version": "v1.0",
    "pushedAt": "2026-10-16T17:04:00Z",
    "pushedBy": "user-admin",
    "pushedByName": "Dr James Hartley",
    "projectId": "proj-velora-301",
    "projectName": "VELORA-301 Efficacy Suite",
    "tags": [
      "NDA",
      "Clinical Summary"
    ],
    "isArchived": false,
    "provenanceChain": [
      "Module A \u00b7 VELORA-301 CSR v1.0",
      "Module D \u00b7 Stage 6"
    ]
  },
  {
    "id": "ml-003",
    "name": "VELORA-301 CSR v1.0",
    "module": "A",
    "itemType": "document",
    "docType": "CSR",
    "ta": [
      "Oncology"
    ],
    "version": "v1.0",
    "pushedAt": "2026-10-15T12:00:00Z",
    "pushedBy": "user-cl",
    "pushedByName": "Dr Elena Vasquez",
    "projectId": "proj-velora-301",
    "projectName": "VELORA-301 Efficacy Suite",
    "tags": [
      "CSR",
      "Phase III",
      "Oncology"
    ],
    "isArchived": true,
    "archivedReason": "Project closed",
    "provenanceChain": [
      "Module A \u00b7 Clinical Writing \u00b7 Final Output"
    ]
  },
  {
    "id": "ml-004",
    "name": "SmPC v1.0 \u2014 Veloricept approved label (EU)",
    "module": "D",
    "itemType": "document",
    "docType": "SmPC",
    "ta": [
      "Oncology"
    ],
    "version": "v1.0",
    "pushedAt": "2026-10-16T17:04:00Z",
    "pushedBy": "user-admin",
    "pushedByName": "Dr James Hartley",
    "projectId": "proj-velora-301",
    "projectName": "VELORA-301 Efficacy Suite",
    "tags": [
      "SmPC",
      "EMA",
      "Label"
    ],
    "isArchived": false,
    "provenanceChain": [
      "Module D \u00b7 Regulatory Writing Stage 6"
    ]
  },
  {
    "id": "ml-005",
    "name": "VELORA-301 KOL Session Summary",
    "module": "C",
    "itemType": "document",
    "docType": "KOL Summary",
    "ta": [
      "Oncology"
    ],
    "version": "v1.0",
    "pushedAt": "2026-10-15T14:00:00Z",
    "pushedBy": "user-ma",
    "pushedByName": "Dr Rebecca Morton",
    "projectId": "proj-velora-301",
    "projectName": "VELORA-301 Efficacy Suite",
    "tags": [
      "KOL",
      "Medical Writing"
    ],
    "isArchived": false,
    "provenanceChain": [
      "Module C \u00b7 Medical Writing \u00b7 Final Output"
    ]
  },
  {
    "id": "ml-006",
    "name": "Primary PFS Efficacy Blog Post",
    "module": "E",
    "itemType": "document",
    "docType": "Blog Post",
    "ta": [
      "Oncology"
    ],
    "version": "v1.0",
    "pushedAt": "2026-10-28T17:04:00Z",
    "pushedBy": "user-il",
    "pushedByName": "Ms Priya Nair",
    "projectId": "proj-velora-301",
    "projectName": "VELORA-301 Efficacy Suite",
    "tags": [
      "Blog",
      "LinkedIn",
      "Published Oct 2026"
    ],
    "isArchived": false,
    "provenanceChain": [
      "Module E \u00b7 Ideation & Publishing \u00b7 Final Output"
    ]
  },
  {
    "id": "ml-007",
    "name": "RMP Core Document \u2014 Veloricept v1.0",
    "module": "D",
    "itemType": "document",
    "docType": "RMP",
    "ta": [
      "Oncology"
    ],
    "version": "v1.0",
    "pushedAt": "2026-10-16T17:04:00Z",
    "pushedBy": "user-admin",
    "pushedByName": "Dr James Hartley",
    "projectId": "proj-velora-301",
    "projectName": "VELORA-301 Efficacy Suite",
    "tags": [
      "RMP",
      "EMA"
    ],
    "isArchived": false,
    "provenanceChain": [
      "Module D \u00b7 Stage 6"
    ]
  },
  {
    "id": "ml-008",
    "name": "AURELIA-101 Phase I Clinical Brief",
    "module": "B",
    "itemType": "document",
    "docType": "Clinical Brief",
    "ta": [
      "Cardiometabolic"
    ],
    "version": "v1.0",
    "pushedAt": "2026-10-22T10:00:00Z",
    "pushedBy": "user-cl",
    "pushedByName": "Dr Elena Vasquez",
    "projectId": "proj-aurelia-101",
    "projectName": "AURELIA-101 Phase I",
    "tags": [
      "Phase I",
      "Cardiometabolic"
    ],
    "isArchived": false,
    "provenanceChain": [
      "Module B \u00b7 Scientific Writing \u00b7 Final Output"
    ]
  },
  {
    "id": "ml-009",
    "name": "HA Response Template Bundle \u2014 FDA Day 120",
    "module": "D",
    "itemType": "section",
    "docType": "HA Response",
    "ta": [
      "Oncology"
    ],
    "version": "v1.0",
    "pushedAt": "2026-10-16T17:05:00Z",
    "pushedBy": "user-admin",
    "pushedByName": "Dr James Hartley",
    "projectId": "proj-velora-301",
    "projectName": "VELORA-301 Efficacy Suite",
    "tags": [
      "HA Response",
      "FDA",
      "Template"
    ],
    "isArchived": false,
    "provenanceChain": [
      "Module D \u00b7 HA Response Drafting \u00b7 sD10"
    ]
  },
  {
    "id": "ml-010",
    "name": "VELORA-301 Phase III Manuscript \u2014 NEJM submission",
    "module": "B",
    "itemType": "document",
    "docType": "Manuscript",
    "ta": [
      "Oncology"
    ],
    "version": "v2.1",
    "pushedAt": "2026-09-20T11:00:00Z",
    "pushedBy": "user-cl",
    "pushedByName": "Dr Elena Vasquez",
    "projectId": "proj-velora-301",
    "projectName": "VELORA-301 Efficacy Suite",
    "tags": [
      "Manuscript",
      "NEJM",
      "Publication"
    ],
    "isArchived": false,
    "provenanceChain": [
      "Module B \u00b7 Scientific Writing \u00b7 Final Output"
    ]
  },
  {
    "id": "ml-011",
    "name": "SmPC v2.1 \u2014 Veloricept updated label (EU)",
    "module": "D",
    "itemType": "document",
    "docType": "SmPC",
    "ta": [
      "Oncology"
    ],
    "version": "v2.1",
    "pushedAt": "2026-10-01T08:00:00Z",
    "pushedBy": "user-admin",
    "pushedByName": "Dr James Hartley",
    "projectId": "proj-velora-301",
    "projectName": "VELORA-301 Efficacy Suite",
    "tags": [
      "SmPC",
      "EMA",
      "Updated Oct 2026"
    ],
    "isArchived": false,
    "provenanceChain": [
      "Module D \u00b7 Regulatory Writing"
    ]
  },
  {
    "id": "ml-012",
    "name": "AURELIA-101 IND \u2014 Phase I Safety Summary",
    "module": "D",
    "itemType": "document",
    "docType": "IND",
    "ta": [
      "Cardiometabolic"
    ],
    "version": "v1.0",
    "pushedAt": "2026-10-12T15:00:00Z",
    "pushedBy": "user-admin",
    "pushedByName": "Dr James Hartley",
    "projectId": "proj-aurelia-101",
    "projectName": "AURELIA-101 Phase I",
    "tags": [
      "IND",
      "EMA",
      "ACK3"
    ],
    "isArchived": false,
    "provenanceChain": [
      "Module D \u00b7 Stage 6 \u00b7 EMA ACK3"
    ]
  }
]
```

---

### `bestPractices.json`
**Records:** 8 · **Screens:** sPM09

```json
[
  {
    "id": "bp-001",
    "module": "D",
    "category": "CTD Authoring",
    "name": "Module-D-CTD-Authoring-v1.2-2026-01",
    "guidance": "Use the canonical JSON data layer as the single source of truth for all efficacy claims in CTD Module 2.5 and 2.7. Never transcribe values manually \u2014 always pull from the indexed data layer to eliminate transcription error and maintain full provenance.",
    "applicableDocTypes": [
      "NDA",
      "IND",
      "MAA"
    ],
    "frameworkRefs": [
      "ICH M4E(R2)",
      "ICH E3"
    ],
    "effectiveFrom": "2026-01-01",
    "validUntil": "2026-12-31",
    "version": "v1.2",
    "createdBy": "user-sa",
    "updatedAt": "2026-01-01T00:00:00Z",
    "reviewDue": false
  },
  {
    "id": "bp-002",
    "module": "D",
    "category": "Super Review",
    "name": "Module-D-SuperReview-v1.0-2026-03",
    "guidance": "All six RACI roles must sign off before Stage 5. The 21 CFR Part 11 inline form captures signatory name, role, meaning of signature, and timestamp for each sign-off. Do not use a separate e-signature system.",
    "applicableDocTypes": [
      "NDA",
      "IND",
      "MAA",
      "PSUR"
    ],
    "frameworkRefs": [
      "21 CFR Part 11",
      "ICH M4E(R2)"
    ],
    "effectiveFrom": "2026-03-15",
    "validUntil": "2026-12-31",
    "version": "v1.0",
    "createdBy": "user-sa",
    "updatedAt": "2026-03-15T00:00:00Z",
    "reviewDue": false
  },
  {
    "id": "bp-003",
    "module": "D",
    "category": "MHRA Configuration",
    "name": "Module-D-MHRA-OQ-D-008-v1.0-2026-01",
    "guidance": "MHRA API procurement is required before production. Include MHRA in all prototype UI designs as Priority 4 (disabled state). OQ-D-008 is resolved for prototype purposes.",
    "applicableDocTypes": [
      "NDA",
      "MAA"
    ],
    "frameworkRefs": [
      "OQ-D-008"
    ],
    "effectiveFrom": "2026-01-01",
    "validUntil": "2026-12-31",
    "version": "v1.0",
    "createdBy": "user-sa",
    "updatedAt": "2026-01-01T00:00:00Z",
    "reviewDue": true,
    "reviewDueNote": "91 days old \u2014 quarterly refresh due"
  },
  {
    "id": "bp-004",
    "module": "E",
    "category": "Claim Currency",
    "name": "Module-E-ClaimCurrency-v1.0-2026-03",
    "guidance": "All artefacts entering Module E must pass the claim currency check before content cards are tagged. Conflicting claims (status: conflicting) block tagging at the passage level. Potentially-superseded claims require acknowledgement with a written rationale before proceeding. DD-E-003.",
    "applicableDocTypes": [
      "KOL Summary",
      "Clinical Brief",
      "Advisory Board Report"
    ],
    "frameworkRefs": [
      "DD-E-003",
      "FR-E-003"
    ],
    "effectiveFrom": "2026-03-01",
    "validUntil": "2026-12-31",
    "version": "v1.0",
    "createdBy": "user-sa",
    "updatedAt": "2026-03-01T00:00:00Z",
    "reviewDue": false
  },
  {
    "id": "bp-005",
    "module": "E",
    "category": "KOL Review",
    "name": "Module-E-KOLReview-v1.0-2026-03",
    "guidance": "KOL review links are one-time, token-based, and expire after 7 days. KOLs have no Aurora account. The platform escalates automatically at Day 3 (Reminder 1), Day 5 (Reminder 2), and Day 7 (escalation to Ideation Lead + MA Team Lead). FR-E-013.",
    "applicableDocTypes": [
      "Content Cards"
    ],
    "frameworkRefs": [
      "FR-E-013",
      "AC-E-029"
    ],
    "effectiveFrom": "2026-03-01",
    "validUntil": "2026-12-31",
    "version": "v1.0",
    "createdBy": "user-sa",
    "updatedAt": "2026-03-01T00:00:00Z",
    "reviewDue": false
  },
  {
    "id": "bp-006",
    "module": "C",
    "category": "MLR Submission",
    "name": "Module-C-MLRSubmission-v1.0-2026-01",
    "guidance": "FK readability grade must be \u22648 for PIL and EU CTR PLS content types before MLR submission. The platform enforces this as a hard gate. DD-C-005.",
    "applicableDocTypes": [
      "PIL",
      "EU CTR PLS"
    ],
    "frameworkRefs": [
      "DD-C-005",
      "ICH E3"
    ],
    "effectiveFrom": "2026-01-01",
    "validUntil": "2026-12-31",
    "version": "v1.0",
    "createdBy": "user-sa",
    "updatedAt": "2026-01-01T00:00:00Z",
    "reviewDue": false
  },
  {
    "id": "bp-007",
    "module": "A",
    "category": "Audit Trail",
    "name": "Module-A-AuditTrail-v1.0-2026-01",
    "guidance": "All document edits, stage advances, and signature events are written to the immutable audit trail in real time. Events cannot be retroactively modified. Compliant with 21 CFR Part 11. The audit trail is the legal record of authorship and approval.",
    "applicableDocTypes": [
      "CSR",
      "IB",
      "SAP",
      "Protocol"
    ],
    "frameworkRefs": [
      "21 CFR Part 11",
      "EU GMP Annex 11"
    ],
    "effectiveFrom": "2026-01-01",
    "validUntil": "2026-12-31",
    "version": "v1.0",
    "createdBy": "user-sa",
    "updatedAt": "2026-01-01T00:00:00Z",
    "reviewDue": false
  },
  {
    "id": "bp-008",
    "module": "platform",
    "category": "Project Governance",
    "name": "Platform-ProjectGovernance-v1.0-2026-01",
    "guidance": "Closed projects are read-only at the API layer for all users including Super Admin. This cannot be overridden. All Master Library contributions from a closed project remain accessible in archived (read-only) form permanently. PRD \u00a73A.",
    "applicableDocTypes": [
      "All document types"
    ],
    "frameworkRefs": [
      "PRD \u00a73A",
      "AC-D-044"
    ],
    "effectiveFrom": "2026-01-01",
    "validUntil": "2026-12-31",
    "version": "v1.0",
    "createdBy": "user-sa",
    "updatedAt": "2026-01-01T00:00:00Z",
    "reviewDue": false
  }
]
```

---

### `notifications.json`
**Records:** 10 · **Screens:** sPM14

```json
[
  {
    "id": "notif-001",
    "eventType": "stage_advance",
    "title": "VELORA-301 NDA \u2014 Super Review (Stage 4)",
    "body": "The submission VELORA-301 NDA has entered Stage 4 \u2014 Super Review. Your sign-off as Regulatory Writer is required.",
    "module": "D",
    "projectId": "proj-velora-301",
    "entityRef": "sub-001",
    "targetUserId": "user-rw",
    "sentAt": "2026-09-09T07:15:00Z",
    "isRead": false,
    "ctaLabel": "Go to Super Review \u2192",
    "ctaRoute": "/projects/proj-velora-301/regulatory-writing/super-review"
  },
  {
    "id": "notif-002",
    "eventType": "review_assigned",
    "title": "New assignment \u2014 VELORA-302 Module D",
    "body": "You have been assigned as Regulatory Writer on VELORA-302 \u00b7 Module D.",
    "module": "D",
    "projectId": "proj-velora-302",
    "entityRef": null,
    "targetUserId": "user-rw",
    "sentAt": "2026-09-09T05:00:00Z",
    "isRead": false,
    "ctaLabel": "Go to project \u2192",
    "ctaRoute": "/projects/proj-velora-302/regulatory-writing"
  },
  {
    "id": "notif-003",
    "eventType": "ma_advance_notice",
    "title": "VELORA-301 LinkedIn post due in 3 days",
    "body": "The VELORA-301 LinkedIn post (Subgroup Consistency) is scheduled for 12 Sept 2026. Medical Affairs advance notice sent. Scheduled by Mr Daniel Okafor.",
    "module": "E",
    "projectId": "proj-velora-301",
    "entityRef": "cal-005",
    "targetUserId": "user-rw",
    "sentAt": "2026-09-09T06:00:00Z",
    "isRead": false,
    "ctaLabel": "Go to calendar \u2192",
    "ctaRoute": "/projects/proj-velora-301/ideation-publishing/calendar"
  },
  {
    "id": "notif-004",
    "eventType": "stage_advance",
    "title": "VELORA-301 NDA \u2014 Publishing (Stage 5)",
    "body": "The submission VELORA-301 NDA has entered Stage 5 \u2014 eCTD Publishing.",
    "module": "D",
    "projectId": "proj-velora-301",
    "entityRef": "sub-001",
    "targetUserId": "user-rw",
    "sentAt": "2026-09-08T10:00:00Z",
    "isRead": true,
    "ctaLabel": "Go to Publishing Monitor \u2192",
    "ctaRoute": "/projects/proj-velora-301/regulatory-writing/ectd-publishing"
  },
  {
    "id": "notif-005",
    "eventType": "system",
    "title": "ACK2 received \u00b7 FDA ESG \u00b7 VELORA-301 NDA",
    "body": "FDA Electronic Submissions Gateway has confirmed format validation passed for VELORA-301 NDA. PDUFA action date: 16 Aug 2027.",
    "module": "D",
    "projectId": "proj-velora-301",
    "entityRef": "sub-001",
    "targetUserId": "user-rw",
    "sentAt": "2026-09-08T08:00:00Z",
    "isRead": true,
    "ctaLabel": "View submission \u2192",
    "ctaRoute": "/projects/proj-velora-301/regulatory-writing/gateway-submission"
  },
  {
    "id": "notif-006",
    "eventType": "comment",
    "title": "Comment on \u00a72.5.4 Overview of Efficacy",
    "body": "Dr Elena Vasquez left a comment on \u00a72.5.4: 'Please double-check the HR confidence interval against Table 14.2.1.'",
    "module": "D",
    "projectId": "proj-velora-301",
    "entityRef": "sub-001",
    "targetUserId": "user-rw",
    "sentAt": "2026-09-07T14:22:00Z",
    "isRead": true,
    "ctaLabel": "Go to section \u2192",
    "ctaRoute": "/projects/proj-velora-301/regulatory-writing/ctd-module2"
  },
  {
    "id": "notif-007",
    "eventType": "kol_reminder_1",
    "title": "KOL review reminder \u00b7 Prof. James Hartley",
    "body": "Prof. James Hartley has not yet completed KOL review for VELORA-301 Efficacy Communications. Reminder 1 sent (Day 3). Automatic escalation on Day 7.",
    "module": "E",
    "projectId": "proj-velora-301",
    "entityRef": "kol-001",
    "targetUserId": "user-il",
    "sentAt": "2026-10-14T09:00:00Z",
    "isRead": true,
    "ctaLabel": "View KOL status \u2192",
    "ctaRoute": "/projects/proj-velora-301/ideation-publishing/projects/ip-001/ma-approval"
  },
  {
    "id": "notif-008",
    "eventType": "publishing_overdue",
    "title": "Blog post overdue \u2014 VELORA-301",
    "body": "The Primary PFS Blog Post was scheduled for 25 Oct 2026 and is now 48 hours overdue.",
    "module": "E",
    "projectId": "proj-velora-301",
    "entityRef": "cal-002",
    "targetUserId": "user-ccm",
    "sentAt": "2026-10-27T08:00:00Z",
    "isRead": true,
    "ctaLabel": "Go to Publishing Monitor \u2192",
    "ctaRoute": "/projects/proj-velora-301/ideation-publishing/publishing"
  },
  {
    "id": "notif-009",
    "eventType": "stage_advance",
    "title": "AURELIA-101 IND \u2014 ACK3 received",
    "body": "EMA CESP has confirmed ACK3 for AURELIA-101 IND \u2014 Phase I Safety. Submission accepted for review.",
    "module": "D",
    "projectId": "proj-aurelia-101",
    "entityRef": "sub-003",
    "targetUserId": "user-admin",
    "sentAt": "2026-10-12T14:30:00Z",
    "isRead": true,
    "ctaLabel": "View submission \u2192",
    "ctaRoute": "/projects/proj-aurelia-101/regulatory-writing/gateway-submission"
  },
  {
    "id": "notif-010",
    "eventType": "system",
    "title": "Rate card expires in 7 days",
    "body": "Rate Card v1.1 expires on 31 Dec 2026. Please create Rate Card v1.2 before expiry. Super Admin action required.",
    "module": "platform",
    "projectId": null,
    "entityRef": "ratecard-v1.1",
    "targetUserId": "user-sa",
    "sentAt": "2026-12-24T08:00:00Z",
    "isRead": false,
    "ctaLabel": "Go to Rate Card Admin \u2192",
    "ctaRoute": "/super-admin/rate-card"
  }
]
```

---

### `notificationPrefs.json`
**Records:** 5 · **Screens:** sPM14

```json
[
  {
    "userId": "user-rw",
    "eventType": "stage_advance",
    "email": true,
    "inApp": true,
    "sms": false
  },
  {
    "userId": "user-rw",
    "eventType": "review_assigned",
    "email": true,
    "inApp": true,
    "sms": false
  },
  {
    "userId": "user-rw",
    "eventType": "kol_invitation",
    "email": true,
    "inApp": true,
    "sms": true
  },
  {
    "userId": "user-rw",
    "eventType": "ma_advance_notice",
    "email": true,
    "inApp": true,
    "sms": true
  },
  {
    "userId": "user-rw",
    "eventType": "system",
    "email": false,
    "inApp": true,
    "sms": false
  }
]
```

---

### `auditTrail.json`
**Records:** 20 · **Screens:** sPM15

```json
[
  {
    "id": "aud-001",
    "timestamp": "2026-09-09T09:15:32Z",
    "userId": "user-admin",
    "userName": "Dr James Hartley",
    "action": "SIGNATURE_APPLIED",
    "entityType": "submission",
    "entityId": "sub-001",
    "entityLabel": "VELORA-301 NDA sD06",
    "module": "D",
    "details": "Stage 4 sign-off \u00b7 Regulatory Affairs Lead",
    "ipAddress": "192.168.1.1",
    "sessionId": "sess_a3b7c2",
    "partEleven": {
      "signatoryName": "Dr James Hartley",
      "role": "Regulatory Affairs Lead",
      "email": "j.hartley@genbioca.com",
      "meaning": "I certify that the content of this document is accurate and complete to the best of my knowledge",
      "documentVersionHash": "a3f7c2e8d14b9f63",
      "timestamp": "2026-09-09T09:15:32Z"
    }
  },
  {
    "id": "aud-002",
    "timestamp": "2026-09-09T09:12:18Z",
    "userId": "user-rw",
    "userName": "Dr Sarah Chen",
    "action": "DOCUMENT_EDITED",
    "entityType": "document-section",
    "entityId": "sub-001-s254",
    "entityLabel": "VELORA-301 NDA \u00a72.5.4",
    "module": "D",
    "details": "v0.4 \u2192 v0.5 \u00b7 AI draft accepted",
    "ipAddress": "192.168.1.4",
    "sessionId": "sess_b2c4d1",
    "partEleven": null
  },
  {
    "id": "aud-003",
    "timestamp": "2026-09-09T08:44:02Z",
    "userId": "user-il",
    "userName": "Ms Priya Nair",
    "action": "ARTEFACT_UPLOADED",
    "entityType": "ideation-artefact",
    "entityId": "ia-001",
    "entityLabel": "VELORA-301 KOL Session Summary",
    "module": "E",
    "details": "Source gate check triggered \u00b7 gate passed",
    "ipAddress": "192.168.2.3",
    "sessionId": "sess_c3d5e2",
    "partEleven": null
  },
  {
    "id": "aud-004",
    "timestamp": "2026-09-08T16:47:21Z",
    "userId": "SYSTEM",
    "userName": "System",
    "action": "ACK2_RECEIVED",
    "entityType": "gateway-submission",
    "entityId": "sub-001",
    "entityLabel": "VELORA-301 NDA",
    "module": "D",
    "details": "FDA ESG \u00b7 format validation passed \u00b7 PDUFA 16 Aug 2027",
    "ipAddress": null,
    "sessionId": null,
    "partEleven": null
  },
  {
    "id": "aud-005",
    "timestamp": "2026-09-08T14:22:05Z",
    "userId": "user-admin",
    "userName": "Dr James Hartley",
    "action": "SUBMISSION_TRANSMITTED",
    "entityType": "submission",
    "entityId": "sub-001",
    "entityLabel": "VELORA-301 NDA",
    "module": "D",
    "details": "FDA ESG \u00b7 21 CFR Part 11 on file",
    "ipAddress": "192.168.1.1",
    "sessionId": "sess_a3b7c1",
    "partEleven": {
      "signatoryName": "Dr James Hartley",
      "role": "Regulatory Affairs Lead",
      "email": "j.hartley@genbioca.com",
      "meaning": "I authorise the transmission of this submission to the health authority",
      "documentVersionHash": "b4c8d2e9",
      "timestamp": "2026-09-08T14:22:05Z"
    }
  },
  {
    "id": "aud-006",
    "timestamp": "2026-09-08T11:30:44Z",
    "userId": "user-ma",
    "userName": "Dr Rebecca Morton",
    "action": "MA_APPROVED",
    "entityType": "ideation-project",
    "entityId": "ip-001",
    "entityLabel": "VELORA-301 Efficacy Communications",
    "module": "E",
    "details": "3 cards approved for calendar scheduling",
    "ipAddress": "192.168.3.1",
    "sessionId": "sess_d4e6f3",
    "partEleven": null
  },
  {
    "id": "aud-007",
    "timestamp": "2026-09-07T16:00:00Z",
    "userId": "user-il",
    "userName": "Ms Priya Nair",
    "action": "CLAIM_CURRENCY_ACKNOWLEDGED",
    "entityType": "ideation-artefact",
    "entityId": "ia-001",
    "entityLabel": "VELORA-301 KOL Session Summary",
    "module": "E",
    "details": "cl-004 PD-L1 subgroup claim acknowledged \u00b7 rationale recorded",
    "ipAddress": "192.168.2.3",
    "sessionId": "sess_e5f7g4",
    "partEleven": null
  },
  {
    "id": "aud-008",
    "timestamp": "2026-09-07T14:22:00Z",
    "userId": "user-cl",
    "userName": "Dr Elena Vasquez",
    "action": "COMMENT_ADDED",
    "entityType": "document-section",
    "entityId": "sub-001-s254",
    "entityLabel": "VELORA-301 NDA \u00a72.5.4",
    "module": "D",
    "details": "Comment: 'Please double-check the HR confidence interval against Table 14.2.1'",
    "ipAddress": "192.168.4.2",
    "sessionId": "sess_f6g8h5",
    "partEleven": null
  },
  {
    "id": "aud-009",
    "timestamp": "2026-09-06T10:00:00Z",
    "userId": "user-admin",
    "userName": "Dr James Hartley",
    "action": "USER_INVITED",
    "entityType": "user",
    "entityId": "user-auth",
    "entityLabel": "Ms Laura Kim",
    "module": "platform",
    "details": "Role: Author \u00b7 Modules: A, B \u00b7 Invitation expires 13 Sept 2026",
    "ipAddress": "192.168.1.1",
    "sessionId": "sess_g7h9i6",
    "partEleven": null
  },
  {
    "id": "aud-010",
    "timestamp": "2026-09-05T09:00:00Z",
    "userId": "user-admin",
    "userName": "Dr James Hartley",
    "action": "TC_ACCEPTED",
    "entityType": "user",
    "entityId": "user-admin",
    "entityLabel": "Dr James Hartley",
    "module": "platform",
    "details": "T&C version 1.0 accepted",
    "ipAddress": "192.168.1.1",
    "sessionId": "sess_h8i0j7",
    "partEleven": null
  },
  {
    "id": "aud-011",
    "timestamp": "2026-09-04T15:30:00Z",
    "userId": "SYSTEM",
    "userName": "System",
    "action": "FRAMEWORK_ALERT_TRIGGERED",
    "entityType": "regulatory-framework",
    "entityId": "alert-001",
    "entityLabel": "ICH E2C(R2) \u2014 PBRER",
    "module": "D",
    "details": "Status changed to Draft revision \u00b7 alert pushed to Modules C and D",
    "ipAddress": null,
    "sessionId": null,
    "partEleven": null
  },
  {
    "id": "aud-012",
    "timestamp": "2026-09-04T14:00:00Z",
    "userId": "user-admin",
    "userName": "Dr James Hartley",
    "action": "STAGE_ADVANCED",
    "entityType": "submission",
    "entityId": "sub-001",
    "entityLabel": "VELORA-301 NDA",
    "module": "D",
    "details": "Stage 5 \u2192 Stage 6 \u00b7 gateway transmission authorised",
    "ipAddress": "192.168.1.1",
    "sessionId": "sess_i9j1k8",
    "partEleven": null
  },
  {
    "id": "aud-013",
    "timestamp": "2026-09-03T11:00:00Z",
    "userId": "user-rw",
    "userName": "Dr Sarah Chen",
    "action": "CONTRADICTION_RESOLVED",
    "entityType": "consistency-check",
    "entityId": "con-001",
    "entityLabel": "HR 0.61 vs HR 0.63",
    "module": "D",
    "details": "con-001 Major contradiction resolved \u00b7 final vs interim analysis clarified",
    "ipAddress": "192.168.1.4",
    "sessionId": "sess_j0k2l9",
    "partEleven": null
  },
  {
    "id": "aud-014",
    "timestamp": "2026-09-02T09:00:00Z",
    "userId": "user-il",
    "userName": "Ms Priya Nair",
    "action": "CONTENT_CARD_TAGGED",
    "entityType": "content-card",
    "entityId": "c-001",
    "entityLabel": "Primary PFS Efficacy Result",
    "module": "E",
    "details": "c-001 tagged from KOL Session Summary \u00a73.2 \u00b7 4 channels atomised",
    "ipAddress": "192.168.2.3",
    "sessionId": "sess_k1l3m0",
    "partEleven": null
  },
  {
    "id": "aud-015",
    "timestamp": "2026-09-01T14:00:00Z",
    "userId": "user-sa",
    "userName": "Alex Thornton",
    "action": "RATE_CARD_UPDATED",
    "entityType": "rate-card",
    "entityId": "ratecard-v1.1",
    "entityLabel": "Rate Card v1.1",
    "module": "platform",
    "details": "Effective 01 Jul 2026 \u00b7 v1.0 archived",
    "ipAddress": "10.0.0.1",
    "sessionId": "sess_l2m4n1",
    "partEleven": null
  },
  {
    "id": "aud-016",
    "timestamp": "2026-08-31T10:00:00Z",
    "userId": "user-ma",
    "userName": "Dr Rebecca Morton",
    "action": "MA_REVIEW_RESOLVED",
    "entityType": "social-alert",
    "entityId": "sla-001",
    "entityLabel": "Blog Post sentiment alert",
    "module": "E",
    "details": "Reviewed \u00b7 no action required \u00b7 SmPC v2.1 \u00a74.8 confirmed consistent",
    "ipAddress": "192.168.3.1",
    "sessionId": "sess_m3n5o2",
    "partEleven": null
  },
  {
    "id": "aud-017",
    "timestamp": "2026-08-30T11:00:00Z",
    "userId": "user-admin",
    "userName": "Dr James Hartley",
    "action": "TA_TAG_CREATED",
    "entityType": "ta-tag",
    "entityId": "tag-onc",
    "entityLabel": "Oncology",
    "module": "platform",
    "details": "Tag created \u00b7 abbreviation ONC",
    "ipAddress": "192.168.1.1",
    "sessionId": "sess_n4o6p3",
    "partEleven": null
  },
  {
    "id": "aud-018",
    "timestamp": "2026-08-29T09:00:00Z",
    "userId": "user-sa",
    "userName": "Alex Thornton",
    "action": "CLIENT_CREATED",
    "entityType": "client",
    "entityId": "client-genbioca-001",
    "entityLabel": "GenBioCa Sciences",
    "module": "platform",
    "details": "Enterprise plan \u00b7 modules A B C D E",
    "ipAddress": "10.0.0.1",
    "sessionId": "sess_o5p7q4",
    "partEleven": null
  },
  {
    "id": "aud-019",
    "timestamp": "2026-08-28T16:00:00Z",
    "userId": "user-admin",
    "userName": "Dr James Hartley",
    "action": "FRAMEWORK_ACKNOWLEDGED",
    "entityType": "regulatory-framework",
    "entityId": "alert-001",
    "entityLabel": "ICH E2C(R2) \u2014 PBRER",
    "module": "D",
    "details": "Alert acknowledged \u00b7 sections flagged for review",
    "ipAddress": "192.168.1.1",
    "sessionId": "sess_p6q8r5",
    "partEleven": null
  },
  {
    "id": "aud-020",
    "timestamp": "2026-08-27T10:00:00Z",
    "userId": "user-cmc",
    "userName": "Dr Arjun Patel",
    "action": "STAGE_ADVANCED",
    "entityType": "submission",
    "entityId": "sub-001",
    "entityLabel": "VELORA-301 NDA",
    "module": "D",
    "details": "Stage 3 \u2192 Stage 4 \u00b7 CMC sign-off applied",
    "ipAddress": "192.168.5.1",
    "sessionId": "sess_q7r9s6",
    "partEleven": null
  }
]
```

---

### `ratecards.json`
**Records:** 2 · **Screens:** sPM12

```json
[
  {
    "id": "ratecard-v1.0",
    "version": "v1.0",
    "label": "Rate Card v1.0 \u00b7 AURORA Disruption Rate Card",
    "status": "archived",
    "effectiveFrom": "2026-01-01",
    "validUntil": "2026-06-30",
    "archivedAt": "2026-07-01T00:00:00Z",
    "createdBy": "user-sa",
    "createdByName": "Alex Thornton",
    "isDisruptionRateCard": true,
    "note": "AURORA Disruption Rate Card (PRD \u00a710.2) \u2014 platform default. Represents market disruption pricing versus standard consultancy rates.",
    "currency": "GBP",
    "rates": [
      {
        "module": "A",
        "serviceType": "CSR Authoring",
        "unit": "per token (1K)",
        "rate": 0.5
      },
      {
        "module": "A",
        "serviceType": "Document Review",
        "unit": "per hour",
        "rate": 150.0
      },
      {
        "module": "B",
        "serviceType": "Manuscript Authoring",
        "unit": "per token (1K)",
        "rate": 0.5
      },
      {
        "module": "B",
        "serviceType": "Slide Deck Generation",
        "unit": "per deck",
        "rate": 40.0
      },
      {
        "module": "C",
        "serviceType": "Content Authoring",
        "unit": "per token (1K)",
        "rate": 0.5
      },
      {
        "module": "D",
        "serviceType": "Regulatory Authoring",
        "unit": "per token (1K)",
        "rate": 0.5
      },
      {
        "module": "D",
        "serviceType": "Gateway Submission",
        "unit": "per submission",
        "rate": 180.0
      },
      {
        "module": "E",
        "serviceType": "Content Atomisation",
        "unit": "per card per channel",
        "rate": 4.5
      },
      {
        "module": "Platform",
        "serviceType": "AI Tokens (base)",
        "unit": "per 1K tokens",
        "rate": 0.005
      },
      {
        "module": "Platform",
        "serviceType": "Voice Transcription",
        "unit": "per minute",
        "rate": 0.02
      }
    ]
  },
  {
    "id": "ratecard-v1.1",
    "version": "v1.1",
    "label": "Rate Card v1.1",
    "status": "active",
    "effectiveFrom": "2026-07-01",
    "validUntil": "2026-12-31",
    "archivedAt": null,
    "createdBy": "user-sa",
    "createdByName": "Alex Thornton",
    "isDisruptionRateCard": false,
    "expiryReminderSentAt": null,
    "currency": "GBP",
    "rates": [
      {
        "module": "A",
        "serviceType": "CSR Authoring",
        "unit": "per token (1K)",
        "rate": 0.5
      },
      {
        "module": "A",
        "serviceType": "Document Review",
        "unit": "per hour",
        "rate": 150.0
      },
      {
        "module": "B",
        "serviceType": "Manuscript Authoring",
        "unit": "per token (1K)",
        "rate": 0.5
      },
      {
        "module": "B",
        "serviceType": "Slide Deck Generation",
        "unit": "per deck",
        "rate": 45.0
      },
      {
        "module": "C",
        "serviceType": "Content Authoring",
        "unit": "per token (1K)",
        "rate": 0.5
      },
      {
        "module": "D",
        "serviceType": "Regulatory Authoring",
        "unit": "per token (1K)",
        "rate": 0.5
      },
      {
        "module": "D",
        "serviceType": "Gateway Submission",
        "unit": "per submission",
        "rate": 200.0
      },
      {
        "module": "E",
        "serviceType": "Content Atomisation",
        "unit": "per card per channel",
        "rate": 5.0
      },
      {
        "module": "Platform",
        "serviceType": "AI Tokens (base)",
        "unit": "per 1K tokens",
        "rate": 0.005
      },
      {
        "module": "Platform",
        "serviceType": "Voice Transcription",
        "unit": "per minute",
        "rate": 0.02
      }
    ]
  }
]
```

---

### `subscription.json`
**Records:** 1 · **Screens:** sPM11, sPM13

```json
{
  "clientId": "client-genbioca-001",
  "planName": "Enterprise Plan",
  "contractedTokensPerMonth": 4000000,
  "currency": "GBP",
  "monthlyFee": 15000,
  "renewalDate": "2026-10-01",
  "autoRenew": true,
  "paymentMethod": {
    "type": "card",
    "brand": "Visa",
    "last4": "4417",
    "expiryMonth": 12,
    "expiryYear": 2027
  },
  "activeGateways": [
    "stripe",
    "razorpay"
  ],
  "currentPeriod": {
    "month": "2026-09",
    "tokensConsumed": 1847200,
    "tokensRemaining": 2152800,
    "estimatedSpend": 9236,
    "burnRatePerDay": 205244,
    "projectedEndOfMonth": 3899636
  },
  "moduleBreakdown": [
    {
      "module": "A",
      "label": "Clinical Writing",
      "tokensConsumed": 412000,
      "cost": 2060,
      "pctOfTotal": 22,
      "burnRate": "on-track",
      "status": "healthy"
    },
    {
      "module": "B",
      "label": "Scientific Writing",
      "tokensConsumed": 188000,
      "cost": 940,
      "pctOfTotal": 10,
      "burnRate": "on-track",
      "status": "healthy"
    },
    {
      "module": "C",
      "label": "Medical Writing",
      "tokensConsumed": 537000,
      "cost": 2685,
      "pctOfTotal": 29,
      "burnRate": "high",
      "status": "monitor"
    },
    {
      "module": "D",
      "label": "Regulatory Writing",
      "tokensConsumed": 621000,
      "cost": 3105,
      "pctOfTotal": 34,
      "burnRate": "high",
      "status": "monitor"
    },
    {
      "module": "E",
      "label": "Ideation & Publishing",
      "tokensConsumed": 89200,
      "cost": 446,
      "pctOfTotal": 5,
      "burnRate": "low",
      "status": "healthy"
    }
  ],
  "invoices": [
    {
      "id": "inv-2026-08",
      "date": "2026-08-01",
      "amount": 15000,
      "services": "All modules",
      "status": "paid",
      "pdfUrl": "/invoices/inv-2026-08.pdf"
    },
    {
      "id": "inv-2026-07",
      "date": "2026-07-01",
      "amount": 15000,
      "services": "All modules",
      "status": "paid",
      "pdfUrl": "/invoices/inv-2026-07.pdf"
    },
    {
      "id": "inv-2026-06",
      "date": "2026-06-01",
      "amount": 14200,
      "services": "All modules + overage",
      "status": "paid",
      "pdfUrl": "/invoices/inv-2026-06.pdf"
    }
  ],
  "marketValueSavings": {
    "total": 184720,
    "calculatedAt": "2026-09-09",
    "rateCardVersion": "v1.1",
    "rateCardSetBy": "Alex Thornton",
    "rateCardEffectiveDate": "2026-07-01",
    "breakdown": [
      {
        "module": "A",
        "hoursEquivalent": 82.4,
        "standardRate": 150,
        "savings": 12360
      },
      {
        "module": "B",
        "hoursEquivalent": 37.6,
        "standardRate": 125,
        "savings": 4700
      },
      {
        "module": "C",
        "hoursEquivalent": 107.4,
        "standardRate": 135,
        "savings": 14499
      },
      {
        "module": "D",
        "hoursEquivalent": 124.2,
        "standardRate": 160,
        "savings": 19872
      },
      {
        "module": "E",
        "hoursEquivalent": 17.84,
        "standardRate": 100,
        "savings": 1784
      }
    ]
  }
}
```

---

### `reports.json`
**Records:** 6 · **Screens:** sPM16

```json
[
  {
    "id": "rpt-001",
    "type": "project-summary",
    "label": "Project Summary Report",
    "description": "Full activity summary for a single project \u2014 all modules, all stages, all documents",
    "availableFormats": [
      "pdf",
      "csv"
    ],
    "lastGenerated": "2026-09-08T10:00:00Z",
    "generatedBy": "user-admin"
  },
  {
    "id": "rpt-002",
    "type": "module-activity",
    "label": "Module Activity Report",
    "description": "Per-module document and stage activity for a given date range",
    "availableFormats": [
      "pdf",
      "csv"
    ],
    "lastGenerated": null,
    "generatedBy": null
  },
  {
    "id": "rpt-003",
    "type": "ai-usage",
    "label": "AI Usage Report",
    "description": "Token consumption, cost, and model breakdown by module and user",
    "availableFormats": [
      "pdf",
      "csv"
    ],
    "lastGenerated": null,
    "generatedBy": null
  },
  {
    "id": "rpt-004",
    "type": "user-activity",
    "label": "User Activity Report",
    "description": "Documents touched, stages advanced, signatures applied per user",
    "availableFormats": [
      "pdf",
      "csv"
    ],
    "lastGenerated": null,
    "generatedBy": null
  },
  {
    "id": "rpt-005",
    "type": "compliance",
    "label": "Compliance Report",
    "description": "Gate pass/fail rates, audit events by type, 21 CFR Part 11 signature summary",
    "availableFormats": [
      "pdf",
      "csv"
    ],
    "lastGenerated": null,
    "generatedBy": null
  },
  {
    "id": "rpt-006",
    "type": "publishing-performance",
    "label": "Publishing Performance Report",
    "description": "Module E \u2014 content published, sentiment scores, overdue rates, calendar adherence",
    "availableFormats": [
      "pdf",
      "csv"
    ],
    "lastGenerated": null,
    "generatedBy": null
  }
]
```

---

### `moduleHealthScores.json`
**Records:** 6 · **Screens:** sPM16

```json
[
  {
    "module": "A",
    "label": "Clinical Writing",
    "healthScore": 87,
    "completionRate": 94,
    "reviewPassRate": 96,
    "crmCompletionRate": 91,
    "avgStageDays": 4.2,
    "activeDocuments": 12,
    "overdueDocuments": 0
  },
  {
    "module": "B",
    "label": "Scientific Writing",
    "healthScore": 79,
    "completionRate": 82,
    "reviewPassRate": 88,
    "crmCompletionRate": 85,
    "avgStageDays": 6.1,
    "activeDocuments": 6,
    "overdueDocuments": 1
  },
  {
    "module": "C",
    "label": "Medical Writing",
    "healthScore": 91,
    "completionRate": 96,
    "reviewPassRate": 98,
    "crmCompletionRate": 94,
    "avgStageDays": 3.8,
    "activeDocuments": 9,
    "overdueDocuments": 0
  },
  {
    "module": "D",
    "label": "Regulatory Writing",
    "healthScore": 88,
    "completionRate": 91,
    "reviewPassRate": 93,
    "crmCompletionRate": 89,
    "avgStageDays": 5.3,
    "activeDocuments": 12,
    "overdueDocuments": 1
  },
  {
    "module": "E",
    "label": "Ideation & Publishing",
    "healthScore": 94,
    "completionRate": 100,
    "reviewPassRate": 100,
    "crmCompletionRate": 98,
    "avgStageDays": 2.1,
    "activeDocuments": 3,
    "overdueDocuments": 0
  },
  {
    "module": "platform",
    "label": "Platform Overall",
    "healthScore": 88,
    "completionRate": 93,
    "reviewPassRate": 95,
    "crmCompletionRate": 91,
    "avgStageDays": 4.3,
    "activeDocuments": 42,
    "overdueDocuments": 2
  }
]
```

---

### `taTags.json`
**Records:** 12 · **Screens:** sPM17

```json
[
  {
    "id": "tag-onc",
    "name": "Oncology",
    "abbreviation": "ONC",
    "status": "active",
    "projectCount": 14,
    "documentCount": 247,
    "createdAt": "2026-01-01",
    "createdBy": "user-admin"
  },
  {
    "id": "tag-card",
    "name": "Cardiometabolic",
    "abbreviation": "CARD",
    "status": "active",
    "projectCount": 4,
    "documentCount": 38,
    "createdAt": "2026-01-01",
    "createdBy": "user-admin"
  },
  {
    "id": "tag-neuro",
    "name": "Neurology",
    "abbreviation": "NEURO",
    "status": "active",
    "projectCount": 2,
    "documentCount": 11,
    "createdAt": "2026-01-15",
    "createdBy": "user-admin"
  },
  {
    "id": "tag-rare",
    "name": "Rare Disease",
    "abbreviation": "RARE",
    "status": "active",
    "projectCount": 1,
    "documentCount": 6,
    "createdAt": "2026-02-01",
    "createdBy": "user-admin"
  },
  {
    "id": "tag-immuno",
    "name": "Immunology",
    "abbreviation": "IMMUNO",
    "status": "active",
    "projectCount": 0,
    "documentCount": 0,
    "createdAt": "2026-03-01",
    "createdBy": "user-admin"
  },
  {
    "id": "tag-resp",
    "name": "Respiratory",
    "abbreviation": "RESP",
    "status": "active",
    "projectCount": 1,
    "documentCount": 8,
    "createdAt": "2026-01-01",
    "createdBy": "user-admin"
  },
  {
    "id": "tag-derm",
    "name": "Dermatology",
    "abbreviation": "DERM",
    "status": "archived",
    "projectCount": 2,
    "documentCount": 14,
    "createdAt": "2025-06-01",
    "createdBy": "user-sa",
    "archivedAt": "2026-04-01"
  },
  {
    "id": "tag-gi",
    "name": "Gastroenterology",
    "abbreviation": "GI",
    "status": "active",
    "projectCount": 0,
    "documentCount": 2,
    "createdAt": "2026-05-01",
    "createdBy": "user-admin"
  },
  {
    "id": "tag-endo",
    "name": "Endocrinology",
    "abbreviation": "ENDO",
    "status": "active",
    "projectCount": 0,
    "documentCount": 0,
    "createdAt": "2026-06-01",
    "createdBy": "user-admin"
  },
  {
    "id": "tag-inf",
    "name": "Infectious Disease",
    "abbreviation": "ID",
    "status": "active",
    "projectCount": 1,
    "documentCount": 4,
    "createdAt": "2026-03-15",
    "createdBy": "user-admin"
  },
  {
    "id": "tag-heme",
    "name": "Haematology",
    "abbreviation": "HEME",
    "status": "active",
    "projectCount": 0,
    "documentCount": 0,
    "createdAt": "2026-07-01",
    "createdBy": "user-admin"
  },
  {
    "id": "tag-gene",
    "name": "Gene Therapy",
    "abbreviation": "GENE",
    "status": "active",
    "projectCount": 0,
    "documentCount": 0,
    "createdAt": "2026-08-01",
    "createdBy": "user-admin"
  }
]
```

---

### `regulatoryFrameworks.json`
**Records:** 15 · **Screens:** sPM18

```json
[
  {
    "id": "rf-001",
    "code": "21CFR11",
    "name": "21 CFR Part 11",
    "issuer": "FDA",
    "version": "Current",
    "effectiveDate": "2003-08-11",
    "scope": [
      "A",
      "B",
      "C",
      "D",
      "E"
    ],
    "status": "Current",
    "lastUpdated": "2003-08-11",
    "changeSummary": null
  },
  {
    "id": "rf-002",
    "code": "21CFR312",
    "name": "21 CFR Part 312",
    "issuer": "FDA",
    "version": "Current",
    "effectiveDate": "2012-04-05",
    "scope": [
      "D"
    ],
    "status": "Current",
    "lastUpdated": "2012-04-05",
    "changeSummary": null
  },
  {
    "id": "rf-003",
    "code": "21CFR314",
    "name": "21 CFR Part 314",
    "issuer": "FDA",
    "version": "Current",
    "effectiveDate": "2026-09-01",
    "scope": [
      "D"
    ],
    "status": "Updated",
    "lastUpdated": "2026-09-01",
    "changeSummary": "Updated electronic submission format requirements for eCTD v4.0 pathways. New requirements apply to submissions filed on or after 01 Jan 2027."
  },
  {
    "id": "rf-004",
    "code": "ICH-M4E-R2",
    "name": "ICH M4E(R2)",
    "issuer": "ICH",
    "version": "R2",
    "effectiveDate": "2022-06-01",
    "scope": [
      "D"
    ],
    "status": "Current",
    "lastUpdated": "2022-06-01",
    "changeSummary": null
  },
  {
    "id": "rf-005",
    "code": "ICH-M2-3.2.2",
    "name": "ICH M2 v3.2.2",
    "issuer": "ICH",
    "version": "v3.2.2",
    "effectiveDate": "2008-01-01",
    "scope": [
      "D"
    ],
    "status": "Current",
    "lastUpdated": "2008-01-01",
    "changeSummary": null
  },
  {
    "id": "rf-006",
    "code": "ICH-Q8-11",
    "name": "ICH Q8\u2013Q11",
    "issuer": "ICH",
    "version": "Current",
    "effectiveDate": "2009-08-01",
    "scope": [
      "D"
    ],
    "status": "Current",
    "lastUpdated": "2009-08-01",
    "changeSummary": null
  },
  {
    "id": "rf-007",
    "code": "ICH-S1-9",
    "name": "ICH S1\u2013S9",
    "issuer": "ICH",
    "version": "Current",
    "effectiveDate": "2012-01-01",
    "scope": [
      "D"
    ],
    "status": "Current",
    "lastUpdated": "2012-01-01",
    "changeSummary": null
  },
  {
    "id": "rf-008",
    "code": "ICH-E2C-R2",
    "name": "ICH E2C(R2) PBRER",
    "issuer": "ICH",
    "version": "R2",
    "effectiveDate": "2012-11-15",
    "scope": [
      "D"
    ],
    "status": "Draft revision",
    "lastUpdated": "2026-09-04",
    "changeSummary": "Draft revision proposes changes to the benefit-risk evaluation framework (Section 8) and signal assessment methodology (Section 7). Public consultation open until 15 Dec 2026."
  },
  {
    "id": "rf-009",
    "code": "EU-726-2004",
    "name": "EU Reg 726/2004",
    "issuer": "EMA",
    "version": "2004 (amended)",
    "effectiveDate": "2004-05-20",
    "scope": [
      "D"
    ],
    "status": "Current",
    "lastUpdated": "2019-01-01",
    "changeSummary": null
  },
  {
    "id": "rf-010",
    "code": "EU-GMP-A11",
    "name": "EU GMP Annex 11",
    "issuer": "EMA",
    "version": "2011",
    "effectiveDate": "2011-06-30",
    "scope": [
      "A",
      "B",
      "C",
      "D"
    ],
    "status": "Current",
    "lastUpdated": "2011-06-30",
    "changeSummary": null
  },
  {
    "id": "rf-011",
    "code": "GSPR",
    "name": "GSPR (MDR/IVDR)",
    "issuer": "EU",
    "version": "MDR 2017/745",
    "effectiveDate": "2017-05-05",
    "scope": [
      "D"
    ],
    "status": "Current",
    "lastUpdated": "2017-05-05",
    "changeSummary": null
  },
  {
    "id": "rf-012",
    "code": "ICH-E2F",
    "name": "ICH E2F DSUR",
    "issuer": "ICH",
    "version": "Current",
    "effectiveDate": "2011-07-07",
    "scope": [
      "D"
    ],
    "status": "Current",
    "lastUpdated": "2011-07-07",
    "changeSummary": null
  },
  {
    "id": "rf-013",
    "code": "ICH-E2A",
    "name": "ICH E2A",
    "issuer": "ICH",
    "version": "Current",
    "effectiveDate": "1994-10-27",
    "scope": [
      "D"
    ],
    "status": "Current",
    "lastUpdated": "1994-10-27",
    "changeSummary": null
  },
  {
    "id": "rf-014",
    "code": "EMA-GVP-V",
    "name": "EMA GVP Module V",
    "issuer": "EMA",
    "version": "2014",
    "effectiveDate": "2014-04-03",
    "scope": [
      "D"
    ],
    "status": "Current",
    "lastUpdated": "2014-04-03",
    "changeSummary": null
  },
  {
    "id": "rf-015",
    "code": "GDPR",
    "name": "GDPR (EU) 2016/679",
    "issuer": "EU",
    "version": "2018",
    "effectiveDate": "2018-05-25",
    "scope": [
      "A",
      "B",
      "C",
      "D",
      "E"
    ],
    "status": "Current",
    "lastUpdated": "2018-05-25",
    "changeSummary": null
  }
]
```

---

### `slidedeckJob.json`
**Records:** 1 · **Screens:** sB10

```json
{
  "id": "sdj-001",
  "publicationId": "pub-velora-301-manuscript",
  "publicationTitle": "VELORA-301 Phase III CSR v1.0 \u2014 Manuscript",
  "source": "full-manuscript",
  "congressTarget": "ESMO 2026",
  "slideCountLimit": 15,
  "status": "ready",
  "aiModel": "claude-sonnet-4-5",
  "aiFootprintPct": 62,
  "generatedAt": "2026-09-09T14:30:00Z",
  "totalSlides": 18,
  "clientTemplate": {
    "id": "tmpl-genbioca-v2",
    "label": "GenBioCa Corporate v2.1",
    "applied": true
  },
  "congressGateActive": true,
  "congressGateMessage": "\u26a0 Slide limit: 15 \u00b7 Currently: 18 slides \u2014 please remove or merge slides before export.",
  "accessibilityGate": {
    "active": true,
    "missingAltText": [
      {
        "slideId": "slide-006",
        "slideTitle": "Safety Profile",
        "figureId": "fig-003",
        "figureDescription": "Safety profile bar chart"
      }
    ]
  },
  "slides": [
    {
      "id": "slide-001",
      "position": 1,
      "title": "Title Slide",
      "bodyText": "VELORA-301 Phase III: Veloricept + Pembrolizumab in First-Line Advanced NSCLC\nPrimary PFS Results \u2014 ESMO 2026",
      "figures": [],
      "speakerNotes": "Opening slide. Present at ESMO Congress 2026, Berlin. Data cut: 14 Aug 2026."
    },
    {
      "id": "slide-002",
      "position": 2,
      "title": "Key Message 1 \u2014 Primary PFS Result",
      "bodyText": "Veloricept + pembrolizumab demonstrated statistically significant improvement in PFS vs pembrolizumab alone (HR 0.61; 95% CI 0.48\u20130.77; p<0.001).",
      "figures": [],
      "speakerNotes": "Emphasise the strength of the primary endpoint. Note interaction p-values for subgroups are non-significant."
    },
    {
      "id": "slide-003",
      "position": 3,
      "title": "Methods Overview",
      "bodyText": "Phase III, randomised, double-blind, placebo-controlled trial. n=487 patients. First-line advanced NSCLC. ECOG PS 0\u20132. Any PD-L1 expression.",
      "figures": [],
      "speakerNotes": "Briefly cover inclusion criteria. Audience is familiar with the design from prior presentations."
    },
    {
      "id": "slide-004",
      "position": 4,
      "title": "Results \u2014 PFS Kaplan-Meier",
      "bodyText": "Median PFS: 14.2 months (veloricept arm) vs 8.7 months (pembrolizumab alone). HR 0.61 (95% CI 0.48\u20130.77; p<0.001).",
      "figures": [
        {
          "figureId": "fig-001",
          "altText": "Kaplan-Meier curve showing progression-free survival probability over time for veloricept plus pembrolizumab versus pembrolizumab alone. Median PFS 14.2 months versus 8.7 months."
        }
      ],
      "speakerNotes": "Point to the separation of curves at Month 4 and the sustained benefit through Month 18."
    },
    {
      "id": "slide-005",
      "position": 5,
      "title": "Results \u2014 Subgroup Consistency",
      "bodyText": "Consistent benefit across PD-L1 expression levels and histology subgroups. All interaction p-values non-significant.",
      "figures": [
        {
          "figureId": "fig-002",
          "altText": "Forest plot showing hazard ratios for progression-free survival across pre-specified subgroups including PD-L1 CPS threshold and tumour histology."
        }
      ],
      "speakerNotes": "Key point: no differential benefit by PD-L1 threshold. Supports a broad label."
    },
    {
      "id": "slide-006",
      "position": 6,
      "title": "Safety Summary",
      "bodyText": "Grade 3+ TRAEs: 52% vs 44%. No new safety signals. Safety profile consistent with known profiles of each agent.",
      "figures": [
        {
          "figureId": "fig-003",
          "altText": null
        }
      ],
      "speakerNotes": "Note grade 3+ pneumonitis 8% in veloricept arm. Standard management protocols apply."
    }
  ]
}
```

---


## 9. CC Setup Prompt (sPM00)

```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/platform-module-brief.md in full.
Then read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/platform-data-files.md.
Copy all 13 JSON fixtures to apps/web/src/data/.
Create src/mocks/handlers/platform.ts with all platform MSW handlers as specified in Section 6.
Import platformHandlers in src/mocks/handlers/index.ts.
Create src/platform/ folder structure:
  src/platform/screens/
  src/platform/store/platformStore.ts
  src/platform/store/adminStore.ts
  src/platform/store/superAdminStore.ts
  src/platform/api/platformApi.ts
  src/platform/components/guards/AdminGuard.tsx
  src/platform/components/guards/SuperAdminGuard.tsx
Run npm run typecheck && npm run lint && npm run build.
Report all setup items complete and all 3 checks passing before awaiting the first screen session.
```
