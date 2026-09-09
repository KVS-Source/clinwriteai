---
title: AURORA Module D — JSON Data Fixture Files
version: v1.0
prepared: September 2026
classification: Internal — GenBioCa Confidential
purpose: MSW mock data for Module D Regulatory Writing prototype. Copy all 12 files to src/data/
---

# AURORA Module D — JSON Data Fixture Files

Twelve fixture files for the Module D MSW handlers. All validated. Copy to `src/data/` alongside existing Module A, B, and C fixtures.

**Primary demo submission throughout:** VELORA-301 NDA (`sub-001`) — Veloricept + Pembrolizumab · First-line advanced NSCLC · FDA (Priority 1) + EMA (Priority 2) · eCTD v3.2.2 · Stage 2 authoring at demo start.

**Key demo narrative:** sub-001 has the canonical JSON indexed (847 data points), one Major consistency contradiction resolved (HR 0.61 vs 0.63) and one Minor unresolved. FDA ACK2 confirmed. EMA pending. eCTD validation has 1 major error (file naming) blocking Stage 6. 23 of 55 PPD/CCI instances confirmed. This gives every screen something to show.

---

## File Summary

| File | Records | Screens | Description |
|------|---------|---------|-------------|
| `regulatorySubmissions.json` | 3 | sD01, sD02, sD05, sD12 | 3 submissions: VELORA-301 NDA (Stage 2 authoring), VELORA-301 PSUR (Stage 4 Super Review), AURELIA-101 IND (Stage 6 ACK3 complete) |
| `ectdGranularityMap.json` | 36 | sD01, sD03, sD04, sD07 | 36 eCTD tree nodes for sub-001 (VELORA-301 NDA): auto-generated, signed, in-authoring, in-review, not-started, and read-only Module 5 nodes |
| `cmcReadinessReport.json` | 1 | sD02, sD05 | 1 record — 84% completeness, stability gap in 3.2.A, acknowledged by Dr James Hartley with risk note |
| `consistencyCheckResult.json` | 1 | sD04, sD06 | 1 record — 2 contradictions: HR 0.61 vs 0.63 (Major, resolved with note), median PFS 9.7 vs 9.4 months (Minor, unresolved). passed=false. |
| `regulatoryAlerts.json` | 2 | sD01, sD11 | 2 alerts: ICH E2C(R2) PBRER draft revision (affects D + C), FDA 21 CFR Part 314 eCTD v4.0 update (D only) |
| `gatewaySubmissions.json` | 3 | sD09, sD12 | 3 gateway records: sub-001 FDA ACK2 ✓ (6min→ACK1, 2h25m→ACK2), sub-001 EMA pending, sub-003 EMA ACK3 complete |
| `haCorrespondence.json` | 4 | sD09, sD10 | 4 records for sub-001: NDA transmitted (outbound), ACK1 (inbound), ACK2 (inbound), FDA Day 120 LoQ with 7 questions parsed |
| `superReviewers.json` | 6 | sD06 | 6 RACI roles for sub-001: 2 signed (SC, JH), 4 pending (EV, RM, AP, DC-eCTD). eCTD Specialist shown with crimson avatar. |
| `ectdValidationResult.json` | 1 | sD07 | 1 record — 0 critical, 1 major (file naming), 3 minor. passed=false. autoFix available for the major error. |
| `redactionRecord.json` | 1 | sD07, sD08 | 1 record — 47 PPD + 8 CCI across 2 documents. 23 PPD confirmed, 5 CCI confirmed. Stage 5 irreversible flag set. |
| `regulatoryLibraryCards.json` | 5 | sD09, sD12 | 5 Master Library cards pushed after ACK2: CTD 2.5, CTD 2.7, SmPC, RMP core document, HA response template bundle |
| `oddAssessment.json` | 1 | sD12 | 1 ODD assessment for AURELIA-101 (Cardiometabolic): EU 3.2/10,000 ✓, US 178,000 ✓, eligibility score 84%. Clinical Lead sign-off pending. |

---

## Demo Personas

All screens use these consistent user IDs:

| User ID | Name | Role |
|---------|------|------|
| `user-sc` | Dr Sarah Chen | Regulatory Writer (current user for most sD screens) |
| `user-jh` | Dr James Hartley | Regulatory Affairs Lead |
| `user-ev` | Dr Elena Vasquez | Clinical Lead |
| `user-rm` | Dr Rebecca Morton | PV / Risk Management Lead |
| `user-ap` | Dr Arjun Patel | CMC / Nonclinical Lead |
| `user-dc` | Mr David Chen | eCTD Specialist |
| `user-rw` | Dr Rachel Williams | Regulatory Writer (PSUR sub-002) |
| `user-ra` | Dr Robert Allworth | Regulatory Affairs Lead (AURELIA-101) |

---

## MSW Handler Registration

Add to `src/mocks/browser.ts` after `...medContentHandlers`. Handler file: `src/mocks/handlers/regulatoryWriting.ts`

```typescript
import { regulatoryWritingHandlers } from './handlers/regulatoryWriting'
export const worker = setupWorker(
  ...documentHandlers, ...projectHandlers, ...aiHandlers,
  ...publicationHandlers, ...medContentHandlers,
  ...regulatoryWritingHandlers,  // ← Module D
)
```

---

## regulatorySubmissions.json

**Used by:** sD01 · sD02 · sD05 · sD12  
**Records:** 3  
**Description:** 3 submissions: VELORA-301 NDA (Stage 2 authoring), VELORA-301 PSUR (Stage 4 Super Review), AURELIA-101 IND (Stage 6 ACK3 complete)

```json
[
  {
    "id": "sub-001",
    "projectId": "proj-velora-301",
    "sourceModuleAProjectId": "proj-velora-301",
    "submissionType": "nda-maa",
    "status": "module2-authoring",
    "stage": 2,
    "targetHAs": [
      "fda-esg",
      "ema-cesp"
    ],
    "ectdVersion": "3.2.2",
    "taTag": "Oncology",
    "validatorEngine": "extedo",
    "title": "Veloricept NDA \u2014 FDA + EMA Submission",
    "compound": "Veloricept + Pembrolizumab",
    "indication": "First-line advanced NSCLC",
    "ownerId": "user-sc",
    "createdBy": "user-sc",
    "createdAt": "2026-10-01T09:00:00Z",
    "updatedAt": "2026-10-16T09:14:00Z",
    "project": "VELORA-301",
    "lane": "authoring",
    "consistencyFlagged": true,
    "consistencyContradictions": 2,
    "cmcReadinessAcknowledged": true,
    "cmcReadinessPct": 84,
    "canonicalJsonIndexed": true,
    "canonicalJsonDataPoints": 847
  },
  {
    "id": "sub-002",
    "projectId": "proj-velora-301",
    "sourceModuleAProjectId": "proj-velora-301",
    "submissionType": "psur-pbrer",
    "status": "super-review",
    "stage": 4,
    "targetHAs": [
      "ema-cesp"
    ],
    "ectdVersion": "3.2.2",
    "taTag": "Oncology",
    "validatorEngine": "extedo",
    "title": "Veloricept PSUR \u2014 Annual Safety Update",
    "compound": "Veloricept",
    "indication": "NSCLC \u2014 safety update",
    "ownerId": "user-rw",
    "createdBy": "user-rw",
    "createdAt": "2026-09-01T09:00:00Z",
    "updatedAt": "2026-10-13T16:44:00Z",
    "project": "VELORA-301",
    "lane": "review",
    "raciSignedCount": 3,
    "raciTotalCount": 6
  },
  {
    "id": "sub-003",
    "projectId": "proj-aurelia-101",
    "sourceModuleAProjectId": "proj-aurelia-101",
    "submissionType": "ind",
    "status": "submitted",
    "stage": 6,
    "targetHAs": [
      "ema-cesp"
    ],
    "ectdVersion": "3.2.2",
    "taTag": "Cardiometabolic",
    "validatorEngine": "extedo",
    "title": "AURELIA-101 IND \u2014 Phase I Safety",
    "compound": "AUR-101",
    "indication": "Cardiometabolic Phase I",
    "ownerId": "user-ra",
    "createdBy": "user-ra",
    "createdAt": "2026-08-01T09:00:00Z",
    "updatedAt": "2026-10-12T14:22:00Z",
    "project": "AURELIA-101",
    "lane": "submitted",
    "gatewayAck2ConfirmedAt": "2026-10-12T14:22:00Z",
    "gatewayAck2Gateway": "EMA CESP"
  }
]
```

---

## ectdGranularityMap.json

**Used by:** sD01 · sD03 · sD04 · sD07  
**Records:** 36  
**Description:** 36 eCTD tree nodes for sub-001 (VELORA-301 NDA): auto-generated, signed, in-authoring, in-review, not-started, and read-only Module 5 nodes

```json
[
  {
    "id": "nd-001",
    "submissionId": "sub-001",
    "moduleSection": "1.0",
    "sectionTitle": "Module 1 \u2014 Regional Administrative",
    "status": "not-started",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-16T09:00:00Z"
  },
  {
    "id": "nd-002",
    "submissionId": "sub-001",
    "moduleSection": "1.1-fda",
    "sectionTitle": "Cover Letter (FDA)",
    "status": "auto-generated",
    "isReadOnly": false,
    "isSystemGenerated": true,
    "lastUpdated": "2026-10-05T09:00:00Z"
  },
  {
    "id": "nd-003",
    "submissionId": "sub-001",
    "moduleSection": "1.1-ema",
    "sectionTitle": "Cover Letter (EMA)",
    "status": "auto-generated",
    "isReadOnly": false,
    "isSystemGenerated": true,
    "lastUpdated": "2026-10-05T09:00:00Z"
  },
  {
    "id": "nd-004",
    "submissionId": "sub-001",
    "moduleSection": "1.2",
    "sectionTitle": "Regional Forms (FDA 1571/1572)",
    "status": "not-started",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-01T09:00:00Z"
  },
  {
    "id": "nd-005",
    "submissionId": "sub-001",
    "moduleSection": "1.3",
    "sectionTitle": "Regional Labelling Documents",
    "status": "not-started",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-01T09:00:00Z"
  },
  {
    "id": "nd-010",
    "submissionId": "sub-001",
    "moduleSection": "2.1",
    "sectionTitle": "Table of Contents for Module 2",
    "status": "auto-generated",
    "isReadOnly": false,
    "isSystemGenerated": true,
    "lastUpdated": "2026-10-05T09:00:00Z"
  },
  {
    "id": "nd-011",
    "submissionId": "sub-001",
    "moduleSection": "2.2",
    "sectionTitle": "Introduction to the Dossier",
    "status": "auto-generated",
    "isReadOnly": false,
    "isSystemGenerated": true,
    "lastUpdated": "2026-10-05T09:00:00Z"
  },
  {
    "id": "nd-012",
    "submissionId": "sub-001",
    "moduleSection": "2.3",
    "sectionTitle": "Quality Overall Summary (QOS)",
    "status": "in-review",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "aiFootprintPct": 28,
    "lastUpdated": "2026-10-14T10:00:00Z"
  },
  {
    "id": "nd-013",
    "submissionId": "sub-001",
    "moduleSection": "2.4",
    "sectionTitle": "Nonclinical Overview",
    "status": "in-review",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "aiFootprintPct": 35,
    "lastUpdated": "2026-10-13T15:00:00Z"
  },
  {
    "id": "nd-014",
    "submissionId": "sub-001",
    "moduleSection": "2.5",
    "sectionTitle": "Clinical Overview",
    "status": "in-authoring",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "aiFootprintPct": 42,
    "lastUpdated": "2026-10-16T09:14:00Z",
    "consistencyFlagged": true
  },
  {
    "id": "nd-015",
    "submissionId": "sub-001",
    "moduleSection": "2.5.1",
    "sectionTitle": "2.5.1 Background",
    "status": "signed",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "aiFootprintPct": 38,
    "lastUpdated": "2026-10-12T10:00:00Z"
  },
  {
    "id": "nd-016",
    "submissionId": "sub-001",
    "moduleSection": "2.5.2",
    "sectionTitle": "2.5.2 Overview of Bioavailability",
    "status": "signed",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "aiFootprintPct": 22,
    "lastUpdated": "2026-10-12T11:00:00Z"
  },
  {
    "id": "nd-017",
    "submissionId": "sub-001",
    "moduleSection": "2.5.3",
    "sectionTitle": "2.5.3 Overview of Pharmacokinetics",
    "status": "signed",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "aiFootprintPct": 30,
    "lastUpdated": "2026-10-12T14:00:00Z"
  },
  {
    "id": "nd-018",
    "submissionId": "sub-001",
    "moduleSection": "2.5.4",
    "sectionTitle": "2.5.4 Overview of Efficacy",
    "status": "in-authoring",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "aiFootprintPct": 51,
    "lastUpdated": "2026-10-16T09:14:00Z",
    "consistencyFlagged": true
  },
  {
    "id": "nd-019",
    "submissionId": "sub-001",
    "moduleSection": "2.5.5",
    "sectionTitle": "2.5.5 Overview of Safety",
    "status": "in-authoring",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "aiFootprintPct": 45,
    "lastUpdated": "2026-10-15T14:00:00Z"
  },
  {
    "id": "nd-020",
    "submissionId": "sub-001",
    "moduleSection": "2.5.6",
    "sectionTitle": "2.5.6 Benefits and Risks",
    "status": "not-started",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "aiFootprintPct": null,
    "lastUpdated": "2026-10-01T09:00:00Z"
  },
  {
    "id": "nd-021",
    "submissionId": "sub-001",
    "moduleSection": "2.5.7",
    "sectionTitle": "2.5.7 Conclusions",
    "status": "not-started",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-01T09:00:00Z"
  },
  {
    "id": "nd-022",
    "submissionId": "sub-001",
    "moduleSection": "2.6",
    "sectionTitle": "Nonclinical Written and Tabulated Summaries",
    "status": "not-started",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-01T09:00:00Z"
  },
  {
    "id": "nd-023",
    "submissionId": "sub-001",
    "moduleSection": "2.7",
    "sectionTitle": "Clinical Summaries",
    "status": "in-authoring",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "aiFootprintPct": 39,
    "lastUpdated": "2026-10-15T16:00:00Z"
  },
  {
    "id": "nd-024",
    "submissionId": "sub-001",
    "moduleSection": "2.7.1",
    "sectionTitle": "2.7.1 Summary of Biopharmaceutic Studies",
    "status": "signed",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "aiFootprintPct": 29,
    "lastUpdated": "2026-10-11T09:00:00Z"
  },
  {
    "id": "nd-025",
    "submissionId": "sub-001",
    "moduleSection": "2.7.2",
    "sectionTitle": "2.7.2 Summary of Clinical Pharmacology",
    "status": "in-authoring",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "aiFootprintPct": 44,
    "lastUpdated": "2026-10-15T16:00:00Z",
    "consistencyFlagged": true
  },
  {
    "id": "nd-026",
    "submissionId": "sub-001",
    "moduleSection": "2.7.3",
    "sectionTitle": "2.7.3 Summary of Clinical Efficacy",
    "status": "not-started",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-01T09:00:00Z"
  },
  {
    "id": "nd-027",
    "submissionId": "sub-001",
    "moduleSection": "2.7.4",
    "sectionTitle": "2.7.4 Summary of Clinical Safety",
    "status": "not-started",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-01T09:00:00Z"
  },
  {
    "id": "nd-030",
    "submissionId": "sub-001",
    "moduleSection": "3.0",
    "sectionTitle": "Module 3 \u2014 Quality (CMC)",
    "status": "in-review",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-14T09:00:00Z"
  },
  {
    "id": "nd-031",
    "submissionId": "sub-001",
    "moduleSection": "3.2.S",
    "sectionTitle": "3.2.S Drug Substance",
    "status": "signed",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-14T09:00:00Z"
  },
  {
    "id": "nd-032",
    "submissionId": "sub-001",
    "moduleSection": "3.2.P",
    "sectionTitle": "3.2.P Drug Product",
    "status": "signed",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-14T09:00:00Z"
  },
  {
    "id": "nd-033",
    "submissionId": "sub-001",
    "moduleSection": "3.2.A",
    "sectionTitle": "3.2.A Appendices",
    "status": "in-review",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-10T09:00:00Z",
    "stabilityGap": true
  },
  {
    "id": "nd-034",
    "submissionId": "sub-001",
    "moduleSection": "3.3",
    "sectionTitle": "3.3 Literature References (CMC)",
    "status": "signed",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-08T09:00:00Z"
  },
  {
    "id": "nd-035",
    "submissionId": "sub-001",
    "moduleSection": "3.4",
    "sectionTitle": "3.4 Regional Information",
    "status": "not-started",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-01T09:00:00Z"
  },
  {
    "id": "nd-040",
    "submissionId": "sub-001",
    "moduleSection": "4.0",
    "sectionTitle": "Module 4 \u2014 Nonclinical Study Reports",
    "status": "in-review",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-13T09:00:00Z"
  },
  {
    "id": "nd-041",
    "submissionId": "sub-001",
    "moduleSection": "4.2",
    "sectionTitle": "4.2 Non-Clinical Study Reports",
    "status": "signed",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-13T09:00:00Z"
  },
  {
    "id": "nd-042",
    "submissionId": "sub-001",
    "moduleSection": "4.3",
    "sectionTitle": "4.3 Literature References (Nonclinical)",
    "status": "signed",
    "isReadOnly": false,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-08T09:00:00Z"
  },
  {
    "id": "nd-050",
    "submissionId": "sub-001",
    "moduleSection": "5.0",
    "sectionTitle": "Module 5 \u2014 Clinical Study Reports",
    "status": "read-only",
    "isReadOnly": true,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-01T09:00:00Z",
    "sourceModule": "A",
    "sourceProjectId": "proj-velora-301"
  },
  {
    "id": "nd-051",
    "submissionId": "sub-001",
    "moduleSection": "5.2",
    "sectionTitle": "5.2 Tabular Listing of Clinical Studies",
    "status": "read-only",
    "isReadOnly": true,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-01T09:00:00Z",
    "sourceModule": "A"
  },
  {
    "id": "nd-052",
    "submissionId": "sub-001",
    "moduleSection": "5.3.1",
    "sectionTitle": "5.3.1 VELORA-301 Phase III CSR v1.0",
    "status": "read-only",
    "isReadOnly": true,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-01T09:00:00Z",
    "sourceModule": "A",
    "importedVersion": "CSR v1.0 \u00b7 Signed 28 Oct 2026"
  },
  {
    "id": "nd-053",
    "submissionId": "sub-001",
    "moduleSection": "5.4",
    "sectionTitle": "5.4 Literature References (Clinical)",
    "status": "read-only",
    "isReadOnly": true,
    "isSystemGenerated": false,
    "lastUpdated": "2026-10-01T09:00:00Z",
    "sourceModule": "A"
  }
]
```

---

## cmcReadinessReport.json

**Used by:** sD02 · sD05  
**Records:** 1  
**Description:** 1 record — 84% completeness, stability gap in 3.2.A, acknowledged by Dr James Hartley with risk note

```json
{
  "id": "cmc-001",
  "submissionId": "sub-001",
  "completenessPct": 84,
  "generatedAt": "2026-10-08T09:00:00Z",
  "acknowledgedBy": "user-jh",
  "acknowledgedAt": "2026-10-08T09:42:00Z",
  "riskNote": "Stability data for batches 3 and 4 pending finalisation. Expected by 15 Nov 2026. Regulatory Affairs Lead acknowledges this risk and confirms Stage 2 authoring may proceed on the current data set.",
  "sections": [
    {
      "section": "3.2.S",
      "title": "Drug Substance",
      "status": "complete",
      "completePct": 100,
      "missingItems": []
    },
    {
      "section": "3.2.P",
      "title": "Drug Product",
      "status": "complete",
      "completePct": 100,
      "missingItems": []
    },
    {
      "section": "3.2.A",
      "title": "Appendices",
      "status": "gap",
      "completePct": 60,
      "missingItems": [
        {
          "item": "Stability data \u2014 batch 3 (12-month)",
          "required": true,
          "expectedDate": "2026-11-15"
        },
        {
          "item": "Stability data \u2014 batch 4 (12-month)",
          "required": true,
          "expectedDate": "2026-11-15"
        }
      ]
    },
    {
      "section": "3.3",
      "title": "Literature References",
      "status": "complete",
      "completePct": 100,
      "missingItems": []
    },
    {
      "section": "3.4",
      "title": "Regional Information (FDA)",
      "status": "not-started",
      "completePct": 0,
      "missingItems": [
        {
          "item": "FDA regional administrative forms",
          "required": false,
          "expectedDate": null
        }
      ]
    }
  ],
  "ichQValidation": {
    "3.2.S": {
      "Q11": "pass",
      "Q8": "pass"
    },
    "3.2.P": {
      "Q8": "pass",
      "Q9": "pass",
      "Q10": "pass"
    }
  }
}
```

---

## consistencyCheckResult.json

**Used by:** sD04 · sD06  
**Records:** 1  
**Description:** 1 record — 2 contradictions: HR 0.61 vs 0.63 (Major, resolved with note), median PFS 9.7 vs 9.4 months (Minor, unresolved). passed=false.

```json
{
  "id": "cc-001",
  "submissionId": "sub-001",
  "runAt": "2026-10-15T09:18:00Z",
  "model": "claude-sonnet-4-6",
  "passed": false,
  "auditEntryId": "ae-cc-001",
  "contradictions": [
    {
      "id": "con-001",
      "sourceSection": "2.5.4 Clinical Overview \u2014 Efficacy",
      "targetSection": "Module 5 \u00b7 Table 14.2.1 (CSR v1.0)",
      "sourceValue": "Hazard ratio: 0.61 (95% CI 0.48\u20130.77; p<0.001)",
      "targetValue": "Hazard ratio: 0.63 (95% CI 0.50\u20130.79; p<0.001) \u2014 interim analysis",
      "severity": "major",
      "resolved": true,
      "resolvedBy": "user-sc",
      "resolvedAt": "2026-10-15T10:05:00Z",
      "resolutionNote": "Module 2.5.4 references the final analysis HR (0.61) from the primary data cut. Table 14.2.1 in the CSR shows the interim analysis (0.63) from the Week 48 data cut. Both values are correct for their respective analyses. Section 2.5.4 updated to clarify 'final analysis, primary data cut: HR 0.61'. Cross-reference to Table 14.2.1 updated to specify interim analysis context."
    },
    {
      "id": "con-002",
      "sourceSection": "2.7.2.1 Clinical Summary \u2014 PFS",
      "targetSection": "Module 5 \u00b7 Table 14.2.2 (CSR v1.0)",
      "sourceValue": "Median PFS: 9.7 months (veloricept arm)",
      "targetValue": "Median PFS: 9.4 months (interim analysis, Table 14.2.2)",
      "severity": "minor",
      "resolved": false,
      "resolvedBy": null,
      "resolvedAt": null,
      "resolutionNote": null
    }
  ]
}
```

---

## regulatoryAlerts.json

**Used by:** sD01 · sD11  
**Records:** 2  
**Description:** 2 alerts: ICH E2C(R2) PBRER draft revision (affects D + C), FDA 21 CFR Part 314 eCTD v4.0 update (D only)

```json
[
  {
    "id": "alert-001",
    "frameworkName": "ICH E2C(R2) \u2014 PBRER",
    "changeSummary": "Draft revision published. Proposes changes to the benefit-risk evaluation framework structure (Section 8) and signal assessment methodology (Section 7). Public consultation open until 15 Dec 2026.",
    "effectiveDate": "2027-01-01",
    "isEffectiveDateEstimate": true,
    "affectedModules": [
      "regulatory-writing",
      "medical-writing"
    ],
    "alertedAt": "2026-09-04T06:00:00Z",
    "acknowledgedByIds": [],
    "affectedDossierSections": [
      "2.7.6 Safety Summary",
      "PSUR/PBRER draft \u2014 benefit-risk section"
    ],
    "actionRequired": "Review Section 8 benefit-risk framework in PSUR draft. Flag 2 dossier sections for review.",
    "sourceUrl": "https://www.ich.org/page/safety-guidelines"
  },
  {
    "id": "alert-002",
    "frameworkName": "FDA 21 CFR Part 314 \u2014 NDA Amendments",
    "changeSummary": "Updated electronic submission format requirements for eCTD v4.0 pathways. New requirements apply to submissions filed on or after 01 Jan 2027.",
    "effectiveDate": "2027-01-01",
    "isEffectiveDateEstimate": false,
    "affectedModules": [
      "regulatory-writing"
    ],
    "alertedAt": "2026-09-05T06:00:00Z",
    "acknowledgedByIds": [],
    "affectedDossierSections": [
      "eCTD structure \u2014 Module 1 cover letter format"
    ],
    "actionRequired": "Review eCTD v4.0 pathway requirements if submission is planned for after 01 Jan 2027.",
    "sourceUrl": "https://www.fda.gov/drugs/electronic-regulatory-submission-and-review"
  }
]
```

---

## gatewaySubmissions.json

**Used by:** sD09 · sD12  
**Records:** 3  
**Description:** 3 gateway records: sub-001 FDA ACK2 ✓ (6min→ACK1, 2h25m→ACK2), sub-001 EMA pending, sub-003 EMA ACK3 complete

```json
[
  {
    "id": "gw-001",
    "submissionId": "sub-001",
    "gateway": "fda-esg",
    "gatewayLabel": "FDA ESG",
    "status": "ack2",
    "transmittedAt": "2026-10-16T14:22:00Z",
    "transmittedBy": "user-jh",
    "transmittedByName": "Dr James Hartley",
    "transmittedByRole": "Regulatory Affairs Lead",
    "ack1At": "2026-10-16T14:28:00Z",
    "ack1ElapsedMinutes": 6,
    "ack2At": "2026-10-16T16:47:00Z",
    "ack2ElapsedHours": 2.42,
    "ack3At": null,
    "ack3EstimatedDate": "2026-10-31",
    "nackCode": null,
    "partEleven": {
      "meaning": "I authorise the transmission of this eCTD package to FDA ESG under 21 CFR Part 312/314.",
      "timestamp": "2026-10-16T14:22:00Z",
      "signatoryName": "Dr James Hartley",
      "signatoryRole": "Regulatory Affairs Lead"
    },
    "packageSize": "847 MB",
    "sectionCount": 62,
    "packageHash": "a3f7c2e8d14b9f63a1c5e2d7b8f4c9e1d3a6b7c2e5f8d9a4b1c6e3f7d2a9b5c8",
    "masterLibraryPushUnlocked": true,
    "masterLibraryPushedAt": "2026-10-16T17:10:00Z",
    "masterLibraryCardsPushed": 5
  },
  {
    "id": "gw-002",
    "submissionId": "sub-001",
    "gateway": "ema-cesp",
    "gatewayLabel": "EMA CESP",
    "status": "pending",
    "transmittedAt": null,
    "transmittedBy": null,
    "ack1At": null,
    "ack2At": null,
    "ack3At": null,
    "nackCode": null,
    "partEleven": null
  },
  {
    "id": "gw-003",
    "submissionId": "sub-003",
    "gateway": "ema-cesp",
    "gatewayLabel": "EMA CESP",
    "status": "ack3",
    "transmittedAt": "2026-10-12T10:00:00Z",
    "transmittedBy": "user-ra",
    "ack1At": "2026-10-12T10:09:00Z",
    "ack1ElapsedMinutes": 9,
    "ack2At": "2026-10-12T12:30:00Z",
    "ack2ElapsedHours": 2.5,
    "ack3At": "2026-10-12T14:22:00Z",
    "ack3ElapsedHours": 4.37,
    "nackCode": null,
    "partEleven": {
      "meaning": "I authorise the transmission of this eCTD package to EMA CESP.",
      "timestamp": "2026-10-12T10:00:00Z",
      "signatoryName": "Dr Rebecca Allworth",
      "signatoryRole": "Regulatory Affairs Lead"
    }
  }
]
```

---

## haCorrespondence.json

**Used by:** sD09 · sD10  
**Records:** 4  
**Description:** 4 records for sub-001: NDA transmitted (outbound), ACK1 (inbound), ACK2 (inbound), FDA Day 120 LoQ with 7 questions parsed

```json
[
  {
    "id": "hac-001",
    "submissionId": "sub-001",
    "direction": "inbound",
    "type": "loq",
    "gateway": "fda-esg",
    "contentSummary": "FDA Day 120 List of Questions \u2014 12 questions across Clinical (7), CMC (3), Administrative (2) categories",
    "receivedAt": "2026-10-22T09:00:00Z",
    "respondedAt": null,
    "loqDocId": "loq-doc-001",
    "loqDocTitle": "FDA Day 120 LoQ \u2014 Veloricept NDA",
    "questionsExtracted": 12,
    "questionsCategories": {
      "clinical": 7,
      "cmc": 3,
      "administrative": 2
    },
    "responsePkgDocId": null,
    "questions": [
      {
        "questionId": "q-001",
        "number": 1,
        "category": "clinical",
        "text": "Please provide additional subgroup analyses for the primary endpoint (progression-free survival) stratified by baseline ECOG performance status (0 vs 1\u20132) and histology (squamous vs non-squamous), with associated confidence intervals and p-values for interaction.",
        "assignedTo": "user-ev",
        "assignedRole": "Clinical Lead",
        "status": "responded",
        "respondedAt": "2026-10-24T10:00:00Z",
        "aiDraftGenerated": true,
        "aiFootprintPct": 68
      },
      {
        "questionId": "q-002",
        "number": 2,
        "category": "clinical",
        "text": "Provide a detailed discussion of the immunogenic potential of veloricept including post-market commitments for ongoing immunogenicity monitoring.",
        "assignedTo": "user-ev",
        "assignedRole": "Clinical Lead",
        "status": "responded",
        "respondedAt": "2026-10-23T14:00:00Z",
        "aiDraftGenerated": true,
        "aiFootprintPct": 55
      },
      {
        "questionId": "q-003",
        "number": 3,
        "category": "clinical",
        "text": "Clarify the mechanism of any observed synergy between veloricept and pembrolizumab. If a PD-1/L1 mechanism is proposed, provide supporting preclinical data with appropriate statistical analyses.",
        "assignedTo": "user-sc",
        "assignedRole": "Regulatory Writer",
        "status": "in-progress",
        "respondedAt": null,
        "aiDraftGenerated": true,
        "aiFootprintPct": 72
      },
      {
        "questionId": "q-004",
        "number": 4,
        "category": "clinical",
        "text": "The benefit-risk assessment in Section 2.5.6 does not adequately address the subgroup of patients with ECOG PS 2. Please provide a dedicated benefit-risk discussion for this subgroup.",
        "assignedTo": "user-sc",
        "assignedRole": "Regulatory Writer",
        "status": "not-started",
        "respondedAt": null,
        "aiDraftGenerated": false,
        "aiFootprintPct": null
      },
      {
        "questionId": "q-005",
        "number": 5,
        "category": "cmc",
        "text": "Provide additional information on process validation for the commercial manufacturing site, including three consecutive validation batches with full analytical data.",
        "assignedTo": "user-ap",
        "assignedRole": "CMC Lead",
        "status": "responded",
        "respondedAt": "2026-10-23T11:00:00Z",
        "aiDraftGenerated": false,
        "aiFootprintPct": null
      },
      {
        "questionId": "q-006",
        "number": 6,
        "category": "cmc",
        "text": "The proposed shelf life of 24 months requires supporting data from primary stability batches. Please provide the accelerated stability data for all three batches.",
        "assignedTo": "user-ap",
        "assignedRole": "CMC Lead",
        "status": "in-progress",
        "respondedAt": null,
        "aiDraftGenerated": false,
        "aiFootprintPct": null
      },
      {
        "questionId": "q-007",
        "number": 7,
        "category": "administrative",
        "text": "Confirm the proposed USPI indication language aligns with the agreed Phase 3 trial primary endpoint language.",
        "assignedTo": "user-jh",
        "assignedRole": "Regulatory Affairs Lead",
        "status": "not-started",
        "respondedAt": null,
        "aiDraftGenerated": false,
        "aiFootprintPct": null
      }
    ]
  },
  {
    "id": "hac-002",
    "submissionId": "sub-001",
    "direction": "inbound",
    "type": "ack",
    "gateway": "fda-esg",
    "contentSummary": "ACK2 \u2014 Format validation passed",
    "receivedAt": "2026-10-16T16:47:00Z",
    "respondedAt": null,
    "loqDocId": null,
    "responsePkgDocId": null
  },
  {
    "id": "hac-003",
    "submissionId": "sub-001",
    "direction": "inbound",
    "type": "ack",
    "gateway": "fda-esg",
    "contentSummary": "ACK1 \u2014 Receipt confirmed",
    "receivedAt": "2026-10-16T14:28:00Z",
    "respondedAt": null,
    "loqDocId": null,
    "responsePkgDocId": null
  },
  {
    "id": "hac-004",
    "submissionId": "sub-001",
    "direction": "outbound",
    "type": "response",
    "gateway": "fda-esg",
    "contentSummary": "NDA Submission \u2014 VELORA-301 Veloricept NDA v1.0",
    "receivedAt": null,
    "respondedAt": "2026-10-16T14:22:00Z",
    "loqDocId": null,
    "responsePkgDocId": "pkg-001"
  }
]
```

---

## superReviewers.json

**Used by:** sD06  
**Records:** 6  
**Description:** 6 RACI roles for sub-001: 2 signed (SC, JH), 4 pending (EV, RM, AP, DC-eCTD). eCTD Specialist shown with crimson avatar.

```json
[
  {
    "id": "sr-001",
    "submissionId": "sub-001",
    "userId": "user-sc",
    "name": "Dr Sarah Chen",
    "initials": "SC",
    "role": "Regulatory Writer",
    "signedAt": "2026-10-15T08:30:00Z",
    "signedAtDisplay": "15 Oct 08:30",
    "pillBg": "#F0FDF4",
    "pillFg": "#15803D",
    "avBg": "#F1F5F9",
    "avFg": "#475569"
  },
  {
    "id": "sr-002",
    "submissionId": "sub-001",
    "userId": "user-jh",
    "name": "Dr James Hartley",
    "initials": "JH",
    "role": "Regulatory Affairs Lead",
    "signedAt": "2026-10-14T16:45:00Z",
    "signedAtDisplay": "14 Oct 16:45",
    "pillBg": "#F0FDF4",
    "pillFg": "#15803D",
    "avBg": "#F1F5F9",
    "avFg": "#475569"
  },
  {
    "id": "sr-003",
    "submissionId": "sub-001",
    "userId": "user-ev",
    "name": "Dr Elena Vasquez",
    "initials": "EV",
    "role": "Clinical Lead",
    "signedAt": null,
    "signedAtDisplay": null,
    "pillBg": "#FFFBEB",
    "pillFg": "#B45309",
    "avBg": "#F1F5F9",
    "avFg": "#475569"
  },
  {
    "id": "sr-004",
    "submissionId": "sub-001",
    "userId": "user-rm",
    "name": "Dr Rebecca Morton",
    "initials": "RM",
    "role": "PV / Risk Management Lead",
    "signedAt": null,
    "signedAtDisplay": null,
    "pillBg": "#FFFBEB",
    "pillFg": "#B45309",
    "avBg": "#F1F5F9",
    "avFg": "#475569"
  },
  {
    "id": "sr-005",
    "submissionId": "sub-001",
    "userId": "user-ap",
    "name": "Dr Arjun Patel",
    "initials": "AP",
    "role": "CMC / Nonclinical Lead",
    "signedAt": null,
    "signedAtDisplay": null,
    "pillBg": "#FFFBEB",
    "pillFg": "#B45309",
    "avBg": "#F1F5F9",
    "avFg": "#475569"
  },
  {
    "id": "sr-006",
    "submissionId": "sub-001",
    "userId": "user-dc",
    "name": "Mr David Chen",
    "initials": "DC",
    "role": "eCTD Specialist",
    "signedAt": null,
    "signedAtDisplay": null,
    "pillBg": "#FFFBEB",
    "pillFg": "#B45309",
    "avBg": "#FFF5F5",
    "avFg": "#B0200D"
  }
]
```

---

## ectdValidationResult.json

**Used by:** sD07  
**Records:** 1  
**Description:** 1 record — 0 critical, 1 major (file naming), 3 minor. passed=false. autoFix available for the major error.

```json
{
  "id": "val-001",
  "submissionId": "sub-001",
  "runAt": "2026-10-15T15:00:00Z",
  "validator": "extedo",
  "validatorVersion": "EXTEDOpulse 8.2.1",
  "criticalCount": 0,
  "majorCount": 1,
  "minorCount": 3,
  "passed": false,
  "auditEntryId": "ae-val-001",
  "errors": [
    {
      "id": "ve-001",
      "severity": "major",
      "rule": "FDA v3.2.2 \u00b7 M2-01",
      "description": "Module 2.3 Quality Overall Summary \u2014 file naming convention violation",
      "detail": "File named 'quality-overall-summary.pdf'. Required format per ICH M2 eCTD specification: 'm2-3-quality-overall-summary.pdf'",
      "fixInstructions": "Rename file to 'm2-3-quality-overall-summary.pdf' and re-publish the section.",
      "autoFixAvailable": true,
      "fixed": false
    },
    {
      "id": "ve-002",
      "severity": "minor",
      "rule": "ICH M2 \u00b7 META-01",
      "description": "Section metadata \u2014 missing dc:creator field in Module 1 cover letter XML",
      "detail": "The cover letter (1.1-fda) XML does not include a dc:creator metadata element. Advisory: add author metadata for completeness.",
      "autoFixAvailable": false,
      "fixed": false
    },
    {
      "id": "ve-003",
      "severity": "minor",
      "rule": "ICH M2 \u00b7 LINK-02",
      "description": "Hyperlink target not found \u2014 Section 2.5.4 contains a cross-reference to Appendix 14.2.1.1 which is not present in the current eCTD package",
      "detail": "Cross-reference at paragraph 3 of Section 2.5.4 links to Appendix 14.2.1.1. This appendix is in Module 5 and may not have been compiled yet.",
      "autoFixAvailable": false,
      "fixed": false
    },
    {
      "id": "ve-004",
      "severity": "minor",
      "rule": "EMA \u00b7 CESP-04",
      "description": "EMA CESP submission: the electronic application form (eAF) version must be v4.1 or later. Current form version in package is v4.0.",
      "detail": "Update the eAF to v4.1 before EMA gateway transmission.",
      "autoFixAvailable": false,
      "fixed": false
    }
  ]
}
```

---

## redactionRecord.json

**Used by:** sD07 · sD08  
**Records:** 1  
**Description:** 1 record — 47 PPD + 8 CCI across 2 documents. 23 PPD confirmed, 5 CCI confirmed. Stage 5 irreversible flag set.

```json
{
  "id": "red-001",
  "submissionId": "sub-001",
  "stageAtCreation": 5,
  "totalPPD": 47,
  "totalCCI": 8,
  "confirmedPPD": 23,
  "confirmedCCI": 5,
  "documents": [
    {
      "documentId": "doc-5.3.1",
      "documentTitle": "5.3.1 VELORA-301 Phase III CSR v1.0",
      "ppdDetected": 38,
      "ppdConfirmed": 14,
      "cciDetected": 6,
      "cciConfirmed": 5,
      "totalPages": 387,
      "ppdItems": [
        {
          "id": "ppd-001",
          "page": 24,
          "location": "\u00a74.3 Patient Listings",
          "originalText": "PT-VELORA-301-004",
          "redactedAs": "[REDACTED]",
          "type": "ppd",
          "confirmed": true,
          "confirmedBy": "Dr Sarah Chen",
          "confirmedAt": "2026-10-15T10:30:00Z"
        },
        {
          "id": "ppd-002",
          "page": 47,
          "location": "\u00a76.2 Investigator List",
          "originalText": "Dr. [Investigator Name], Memorial Cancer Institute",
          "redactedAs": "[INVESTIGATOR NAME REDACTED]",
          "type": "ppd",
          "confirmed": false,
          "confirmedBy": null,
          "confirmedAt": null
        },
        {
          "id": "ppd-003",
          "page": 52,
          "location": "\u00a76.2 Investigator List",
          "originalText": "Dr. [Second Investigator], Royal Marsden Hospital",
          "redactedAs": "[INVESTIGATOR NAME REDACTED]",
          "type": "ppd",
          "confirmed": false,
          "confirmedBy": null,
          "confirmedAt": null
        }
      ],
      "cciItems": [
        {
          "id": "cci-001",
          "page": 201,
          "location": "\u00a711.4 Manufacturing Process",
          "originalText": "[Proprietary formulation process \u2014 step 3 temperature parameters: REDACTED]",
          "redactedAs": "[CCI REDACTED]",
          "type": "cci",
          "confirmed": true,
          "confirmedBy": "Dr Sarah Chen",
          "confirmedAt": "2026-10-15T11:00:00Z"
        },
        {
          "id": "cci-002",
          "page": 215,
          "location": "\u00a711.4 Manufacturing Process",
          "originalText": "[Proprietary formulation process \u2014 step 7 excipient ratios: REDACTED]",
          "redactedAs": "[CCI REDACTED]",
          "type": "cci",
          "confirmed": false,
          "confirmedBy": null,
          "confirmedAt": null
        }
      ]
    },
    {
      "documentId": "doc-5.3.1-appendix",
      "documentTitle": "5.3.1 Appendix \u2014 Patient Data Listings",
      "ppdDetected": 9,
      "ppdConfirmed": 9,
      "cciDetected": 0,
      "cciConfirmed": 0,
      "totalPages": 84,
      "ppdItems": [
        {
          "id": "ppd-010",
          "page": 3,
          "location": "Patient Listing Table 1",
          "originalText": "[All 9 patient IDs confirmed redacted]",
          "redactedAs": "[REDACTED]",
          "type": "ppd",
          "confirmed": true,
          "confirmedBy": "Dr Sarah Chen",
          "confirmedAt": "2026-10-15T10:45:00Z"
        }
      ],
      "cciItems": []
    }
  ]
}
```

---

## regulatoryLibraryCards.json

**Used by:** sD09 · sD12  
**Records:** 5  
**Description:** 5 Master Library cards pushed after ACK2: CTD 2.5, CTD 2.7, SmPC, RMP core document, HA response template bundle

```json
[
  {
    "id": "rlc-001",
    "submissionId": "sub-001",
    "cardType": "ctd-section",
    "name": "CTD 2.5 Clinical Overview \u2014 Veloricept NDA v1.0",
    "tags": "ONCOLOGY \u00b7 NSCLC \u00b7 NDA \u00b7 FDA \u00b7 EMA",
    "taTag": "Oncology",
    "submissionType": "nda-maa",
    "haTarget": "FDA + EMA",
    "availableInModules": [
      "regulatory-writing",
      "ideation-publishing"
    ],
    "pushedBy": "user-jh",
    "pushedAt": "2026-10-16T17:10:00Z",
    "deprecatedAt": null
  },
  {
    "id": "rlc-002",
    "submissionId": "sub-001",
    "cardType": "ctd-section",
    "name": "CTD 2.7 Clinical Summary \u2014 Veloricept NDA v1.0",
    "tags": "ONCOLOGY \u00b7 NSCLC \u00b7 NDA \u00b7 CLINICAL SUMMARY",
    "taTag": "Oncology",
    "submissionType": "nda-maa",
    "haTarget": "FDA + EMA",
    "availableInModules": [
      "regulatory-writing",
      "ideation-publishing"
    ],
    "pushedBy": "user-jh",
    "pushedAt": "2026-10-16T17:10:00Z",
    "deprecatedAt": null
  },
  {
    "id": "rlc-003",
    "submissionId": "sub-001",
    "cardType": "label",
    "name": "SmPC v1.0 \u2014 Veloricept approved label (EU)",
    "tags": "ONCOLOGY \u00b7 SMPC \u00b7 EU LABEL",
    "taTag": "Oncology",
    "submissionType": "nda-maa",
    "haTarget": "EMA",
    "availableInModules": [
      "regulatory-writing",
      "medical-writing",
      "ideation-publishing"
    ],
    "pushedBy": "user-jh",
    "pushedAt": "2026-10-16T17:10:00Z",
    "deprecatedAt": null
  },
  {
    "id": "rlc-004",
    "submissionId": "sub-001",
    "cardType": "rmp",
    "name": "RMP Core Document \u2014 Veloricept v1.0",
    "tags": "ONCOLOGY \u00b7 RMP \u00b7 EMA \u00b7 RISK MANAGEMENT",
    "taTag": "Oncology",
    "submissionType": "nda-maa",
    "haTarget": "EMA",
    "availableInModules": [
      "regulatory-writing"
    ],
    "pushedBy": "user-jh",
    "pushedAt": "2026-10-16T17:10:00Z",
    "deprecatedAt": null
  },
  {
    "id": "rlc-005",
    "submissionId": "sub-001",
    "cardType": "ha-response-template",
    "name": "HA Response Template Bundle \u2014 FDA Day 120 \u00b7 VELORA-301",
    "tags": "ONCOLOGY \u00b7 HA RESPONSE \u00b7 FDA \u00b7 LOQ",
    "taTag": "Oncology",
    "submissionType": "ha-response",
    "haTarget": "FDA",
    "availableInModules": [
      "regulatory-writing"
    ],
    "pushedBy": "user-jh",
    "pushedAt": "2026-10-16T17:10:00Z",
    "deprecatedAt": null
  }
]
```

---

## oddAssessment.json

**Used by:** sD12  
**Records:** 1  
**Description:** 1 ODD assessment for AURELIA-101 (Cardiometabolic): EU 3.2/10,000 ✓, US 178,000 ✓, eligibility score 84%. Clinical Lead sign-off pending.

```json
{
  "id": "odd-001",
  "submissionId": "sub-003",
  "projectId": "proj-aurelia-101",
  "compound": "AUR-101",
  "indication": "AURELIA-101 \u2014 Cardiometabolic rare variant",
  "taTag": "Cardiometabolic",
  "prevalenceScore": 84,
  "eu": {
    "prevalence": "3.2 per 10,000",
    "threshold": "\u22645 per 10,000",
    "meetsThreshold": true,
    "patientEstimate": "~160,000 EU patients",
    "status": "eligible"
  },
  "us": {
    "prevalencePatients": 178000,
    "threshold": "<200,000 patients",
    "meetsThreshold": true,
    "status": "eligible"
  },
  "eligibilityScore": 84,
  "eligibilityLabel": "Likely eligible for ODD",
  "benefitDraft": "AUR-101 demonstrates significant benefit over existing treatments in patients with the identified cardiometabolic rare variant, with preliminary Phase I data showing 67% reduction in primary composite endpoint versus standard of care.",
  "benefitDraftStatus": "clinical-lead-pending",
  "clinicalLeadSignedAt": null,
  "generatedAt": "2026-10-18T09:00:00Z"
}
```

---

## CC Prompt for Module D Setup

Once all twelve JSON files are in `src/data/`, give CC the following prompt:

```
Read C:/chetan/genBioCa/LifeSciences/docs/D/CC/session-D00-module-d-context.md
and execute. Report all setup items completed and all 3 verification checks
(typecheck, lint, build) passing before awaiting Session D01.
```

---

*AURORA Module D Data Files · v1.0 · September 2026 · GenBioCa Confidential*
