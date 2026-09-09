---
title: AURORA Module E — JSON Data Fixture Files
version: v1.0
prepared: September 2026
classification: Internal — GenBioCa Confidential
purpose: MSW mock data for Module E Ideation & Publishing prototype. Copy all 8 files to src/data/
---

# AURORA Module E — JSON Data Fixture Files

Eight fixture files for the Module E MSW handlers. All validated. Copy to `src/data/` alongside existing Module A–D fixtures.

**Primary demo project throughout:** VELORA-301 Efficacy Communications (`ip-001`) — KOL Session Summary from Module C, 3 content cards, all approved, 2 published, 1 overdue.

**Key demo narrative:** ip-001 is the fully-worked example — source gate passed, claim currency checked (1 flag acknowledged), all 3 cards KOL-approved then MA-approved, 8 channel adaptations generated (one with a compliance fix applied), 5 calendar entries (2 published, 1 overdue, 1 scheduled), 1 sentiment alert resolved. ip-002 shows Stage 2 Under Review. ip-003 shows Stage 1 blocked by source gate — the VELORA-302 draft is still In Authoring in Module A. This gives sE01 three distinct states and sE02 the blocked state.

---

## File Summary

| File | Records | Screens | Description |
|------|---------|---------|-------------|
| `ideationProjects.json` | 3 | sE01, sE02, sE09 | 3 projects: VELORA-301 (Stage 4 Approved), AURELIA-101 (Stage 2 Under Review), VELORA-302 (Stage 1 Uploaded — source gate BLOCKED) |
| `ideationArtefacts.json` | 3 | sE02, sE03 | 3 artefacts: KOL Summary (Module C, gate passed), Phase I Brief (external, confirmed), VELORA-302 draft (Module A, gate BLOCKED — in-authoring) |
| `ideationContentCards.json` | 3 | sE03, sE04, sE05, sE06, sE09, sE10 | 3 content cards from ip-001: c-001 Efficacy (approved), c-002 Safety (approved), c-003 Subgroup (approved, claim currency flag acknowledged) |
| `atomisedContent.json` | 8 | sE03, sE04, sE08 | 8 channel adaptations: c-001 → LinkedIn (compliance fix applied), Blog, HCP, Email; c-002 → HCP, MA; c-003 → LinkedIn, HCP |
| `claimCurrencyCheck.json` | 1 | sE02, sE03 | 1 check for ia-001: 14 claims — 12 current, 1 potentially-superseded (PD-L1 subgroup, acknowledged), 0 conflicting |
| `ideationCalendar.json` | 5 | sE07, sE08 | 5 calendar entries: LinkedIn 22 Oct published ✓, Blog 25 Oct overdue (48h), HCP 28 Oct published ✓, HCP Safety 18 Oct overdue, Subgroup LinkedIn 5 Nov scheduled |
| `socialListeningAlerts.json` | 1 | sE07, sE08 | 1 sentiment alert: Blog Post negative score 0.36 (below auto-stop threshold 0.50) — notified MA Lead, resolved 24 Oct |
| `kolContacts.json` | 1 | sE05, sE06 | 1 KOL: Prof. James Whitfield — signed off all 3 cards, c-003 comment on PD-L1 language |

---

## Demo Personas

| User ID | Name | Role |
|---------|------|------|
| `user-il` | Dr Priya Sharma | Ideation Lead (current user for most sE screens) |
| `user-ma` | Dr Michael Andrews | MA Team Lead |
| `user-cr` | Alex Brennan | Content Calendar Manager / Creative |
| `user-sc` | Dr Sarah Chen | Regulatory Writer (source — Module D) |
| `user-jh` | Dr James Hartley | Regulatory Affairs Lead (source — Module D) |

KOL (guest — no Aurora account): Prof. James Whitfield · `kol-tok-001-demo`

---

## MSW Handler Registration

Add to `src/mocks/browser.ts` after `...regulatoryWritingHandlers`:

```typescript
import { ideationPublishingHandlers } from './handlers/ideationPublishing'
// Handler file: src/mocks/handlers/ideationPublishing.ts
export const worker = setupWorker(
  ...documentHandlers, ...projectHandlers, ...aiHandlers,
  ...publicationHandlers, ...medContentHandlers,
  ...regulatoryWritingHandlers,
  ...ideationPublishingHandlers,  // ← Module E
)
```

---

## ideationProjects.json

**Used by:** sE01 · sE02 · sE09  
**Records:** 3  
**Description:** 3 projects: VELORA-301 (Stage 4 Approved), AURELIA-101 (Stage 2 Under Review), VELORA-302 (Stage 1 Uploaded — source gate BLOCKED)

```json
[
  {
    "id": "ip-001",
    "projectId": "proj-velora-301",
    "sourceType": "master-library",
    "taTag": "Oncology",
    "status": "approved",
    "stage": 4,
    "title": "VELORA-301 Efficacy Communications",
    "compound": "Veloricept + Pembrolizumab",
    "indication": "First-line advanced NSCLC",
    "createdBy": "user-il",
    "createdByName": "Dr Priya Sharma",
    "createdByRole": "Ideation Lead",
    "createdAt": "2026-10-18T09:00:00Z",
    "updatedAt": "2026-10-24T14:30:00Z",
    "contentCardCount": 3,
    "approvedCardCount": 3,
    "scheduledCount": 3,
    "publishedCount": 1,
    "maApprovedAt": "2026-10-22T11:45:00Z",
    "maApprovedBy": "user-ma",
    "maApprovedByName": "Dr Michael Andrews",
    "maApprovedByRole": "MA Team Lead"
  },
  {
    "id": "ip-002",
    "projectId": "proj-aurelia-101",
    "sourceType": "upload",
    "taTag": "Cardiometabolic",
    "status": "under-review",
    "stage": 2,
    "title": "AURELIA-101 Phase I Brief Communications",
    "compound": "AUR-101",
    "indication": "Cardiometabolic Phase I",
    "createdBy": "user-il",
    "createdByName": "Dr Priya Sharma",
    "createdByRole": "Ideation Lead",
    "createdAt": "2026-10-20T09:00:00Z",
    "updatedAt": "2026-10-23T10:00:00Z",
    "contentCardCount": 2,
    "approvedCardCount": 0,
    "scheduledCount": 0,
    "publishedCount": 0,
    "maApprovedAt": null,
    "maApprovedBy": null,
    "maApprovedByName": null,
    "maApprovedByRole": null
  },
  {
    "id": "ip-003",
    "projectId": "proj-velora-302",
    "sourceType": "master-library",
    "taTag": "Oncology",
    "status": "uploaded",
    "stage": 1,
    "title": "VELORA-302 Pre-launch Ideation",
    "compound": "Veloricept next-gen",
    "indication": "Second-line NSCLC",
    "createdBy": "user-il",
    "createdByName": "Dr Priya Sharma",
    "createdByRole": "Ideation Lead",
    "createdAt": "2026-10-25T09:00:00Z",
    "updatedAt": "2026-10-25T09:00:00Z",
    "contentCardCount": 0,
    "approvedCardCount": 0,
    "scheduledCount": 0,
    "publishedCount": 0,
    "sourceGateStatus": "blocked",
    "sourceGateReason": "Source document status is 'In Authoring' in Module A. Only Signed / Final Output / Submitted documents may enter the ideation pipeline.",
    "maApprovedAt": null,
    "maApprovedBy": null
  }
]
```

---

## ideationArtefacts.json

**Used by:** sE02 · sE03  
**Records:** 3  
**Description:** 3 artefacts: KOL Summary (Module C, gate passed), Phase I Brief (external, confirmed), VELORA-302 draft (Module A, gate BLOCKED — in-authoring)

```json
[
  {
    "id": "ia-001",
    "ideationProjectId": "ip-001",
    "sourceModule": "C",
    "sourceDocId": "doc-kol-summary-001",
    "title": "VELORA-301 KOL Advisory Board Summary",
    "originalApprovalDate": "2026-10-15",
    "version": "v1.0",
    "sourceCurrencyStatus": "current",
    "approvalStatusCheck": "passed",
    "approvalStatusNote": "Document status: Final Output in Module C. Source gate passed.",
    "masterLibraryPushDate": "2026-10-15",
    "withinNinetyDays": true,
    "claimCurrencyChecked": true,
    "claimCurrencyCheckedAt": "2026-10-18T09:30:00Z"
  },
  {
    "id": "ia-002",
    "ideationProjectId": "ip-002",
    "sourceModule": "external",
    "sourceDocId": null,
    "filePath": "/uploads/aurelia-101-phase1-brief-v1.pdf",
    "title": "AURELIA-101 Phase I Clinical Brief",
    "originalApprovalDate": "2026-10-19",
    "version": "v1.0",
    "sourceCurrencyStatus": "external-confirmed",
    "approvalStatusCheck": "confirmed-external",
    "approvalStatusNote": "External document. Ideation Lead confirmed approval via external process. Logged to audit trail.",
    "externalConfirmedBy": "user-il",
    "externalConfirmedAt": "2026-10-20T09:12:00Z",
    "masterLibraryPushDate": null,
    "withinNinetyDays": null,
    "claimCurrencyChecked": false
  },
  {
    "id": "ia-003",
    "ideationProjectId": "ip-003",
    "sourceModule": "A",
    "sourceDocId": "doc-velora-302-draft",
    "title": "VELORA-302 Draft CSR (Module A)",
    "originalApprovalDate": null,
    "version": "v0.2-draft",
    "sourceCurrencyStatus": "current",
    "approvalStatusCheck": "blocked",
    "approvalStatusNote": "Source content gate failed \u2014 document status is 'In Authoring' in Module A. Only Signed / Final Output / Submitted documents may enter the ideation pipeline.",
    "masterLibraryPushDate": null,
    "withinNinetyDays": null,
    "claimCurrencyChecked": false
  }
]
```

---

## ideationContentCards.json

**Used by:** sE03 · sE04 · sE05 · sE06 · sE09 · sE10  
**Records:** 3  
**Description:** 3 content cards from ip-001: c-001 Efficacy (approved), c-002 Safety (approved), c-003 Subgroup (approved, claim currency flag acknowledged)

```json
[
  {
    "id": "c-001",
    "ideationArtefactId": "ia-001",
    "ideationProjectId": "ip-001",
    "sourceSection": "\u00a73.2 Primary Efficacy Results",
    "sourcePassage": "Veloricept plus pembrolizumab demonstrated a statistically significant improvement in progression-free survival (hazard ratio 0.61; 95% CI 0.48\u20130.77; p<0.001) in the intention-to-treat population, with a median PFS of 14.2 months versus 8.7 months with pembrolizumab alone.",
    "claimCurrencyStatus": "current",
    "channelFormats": [
      "linkedin",
      "blog",
      "hcp",
      "medical-affairs"
    ],
    "kolStatus": "approved",
    "kolApprovedAt": "2026-10-21T14:00:00Z",
    "kolApprovedBy": "Prof. James Whitfield",
    "maStatus": "approved",
    "maApprovedAt": "2026-10-22T11:45:00Z",
    "overallStatus": "approved",
    "provenance": {
      "sourceDoc": "VELORA-301 KOL Advisory Board Summary v1.0",
      "sourceDocVersion": "v1.0",
      "section": "\u00a73.2 Primary Efficacy Results",
      "passage": "Hazard ratio 0.61 \u2014 primary PFS endpoint",
      "approvalDate": "2026-10-15",
      "originModule": "C"
    },
    "provenanceChain": [
      "Source: KOL Summary \u00a73.2",
      "CSR v1.0 \u00b7 Table 14.2.1",
      "Module A \u00b7 Clinical Writing"
    ],
    "title": "Primary PFS Efficacy Result",
    "cardType": "efficacy"
  },
  {
    "id": "c-002",
    "ideationArtefactId": "ia-001",
    "ideationProjectId": "ip-001",
    "sourceSection": "\u00a74.1 Safety Profile Overview",
    "sourcePassage": "The safety profile of veloricept plus pembrolizumab was consistent with the known profiles of each agent. Grade 3 or higher treatment-related adverse events occurred in 52% of patients in the veloricept arm versus 44% in the control arm.",
    "claimCurrencyStatus": "current",
    "channelFormats": [
      "hcp",
      "medical-affairs"
    ],
    "kolStatus": "approved",
    "kolApprovedAt": "2026-10-21T14:15:00Z",
    "kolApprovedBy": "Prof. James Whitfield",
    "maStatus": "approved",
    "maApprovedAt": "2026-10-22T11:45:00Z",
    "overallStatus": "approved",
    "provenance": {
      "sourceDoc": "VELORA-301 KOL Advisory Board Summary v1.0",
      "sourceDocVersion": "v1.0",
      "section": "\u00a74.1 Safety Profile Overview",
      "passage": "Grade 3+ TRAE rates: 52% vs 44%",
      "approvalDate": "2026-10-15",
      "originModule": "C"
    },
    "provenanceChain": [
      "Source: KOL Summary \u00a74.1",
      "CSR v1.0 \u00b7 Table 12.2.4",
      "Module A \u00b7 Clinical Writing"
    ],
    "title": "Safety Profile \u2014 Grade 3+ AEs",
    "cardType": "safety"
  },
  {
    "id": "c-003",
    "ideationArtefactId": "ia-001",
    "ideationProjectId": "ip-001",
    "sourceSection": "\u00a73.4 Subgroup Consistency",
    "sourcePassage": "The clinical benefit was consistent across all pre-specified subgroups, including PD-L1 expression level (combined positive score \u22651% and \u226550%) and tumour histology (squamous and non-squamous).",
    "claimCurrencyStatus": "potentially-superseded",
    "claimCurrencyFlag": {
      "flagId": "ccf-001",
      "text": "PD-L1 subgroup claim may be superseded \u2014 updated label threshold data published 01 Oct 2026.",
      "acknowledgedBy": "user-il",
      "acknowledgedAt": "2026-10-19T10:00:00Z",
      "acknowledgementNote": "Current label thresholds confirmed with CMC Lead. Subgroup claim remains consistent with approved SmPC v1.0. Acknowledged and proceeding."
    },
    "channelFormats": [
      "linkedin",
      "hcp"
    ],
    "kolStatus": "approved",
    "kolApprovedAt": "2026-10-21T14:30:00Z",
    "kolApprovedBy": "Prof. James Whitfield",
    "maStatus": "approved",
    "maApprovedAt": "2026-10-22T11:45:00Z",
    "overallStatus": "approved",
    "provenance": {
      "sourceDoc": "VELORA-301 KOL Advisory Board Summary v1.0",
      "sourceDocVersion": "v1.0",
      "section": "\u00a73.4 Subgroup Consistency",
      "passage": "Subgroup consistency across PD-L1 and histology",
      "approvalDate": "2026-10-15",
      "originModule": "C"
    },
    "provenanceChain": [
      "Source: KOL Summary \u00a73.4",
      "CSR v1.0 \u00b7 Table 14.2.7.1",
      "Module A \u00b7 Clinical Writing"
    ],
    "title": "Subgroup Consistency",
    "cardType": "subgroup"
  }
]
```

---

## atomisedContent.json

**Used by:** sE03 · sE04 · sE08  
**Records:** 8  
**Description:** 8 channel adaptations: c-001 → LinkedIn (compliance fix applied), Blog, HCP, Email; c-002 → HCP, MA; c-003 → LinkedIn, HCP

```json
[
  {
    "id": "ac-001",
    "ideationContentCardId": "c-001",
    "channel": "linkedin",
    "channelLabel": "LinkedIn",
    "contentText": "Exciting results from the VELORA-301 trial: veloricept plus pembrolizumab demonstrated a statistically significant improvement in progression-free survival (HR 0.61; 95% CI 0.48\u20130.77; p<0.001), with a median PFS of 14.2 months versus 8.7 months with pembrolizumab alone in first-line advanced NSCLC.\n\nThese results reinforce the role of combination immunotherapy in transforming outcomes for patients with advanced non-small cell lung cancer.\n\n#Oncology #NSCLC #ClinicalTrials #Veloricept",
    "aiGenerated": true,
    "aiFootprintHash": "af-linkedin-c001-v1",
    "brandScreenPassed": true,
    "complianceScreenPassed": true,
    "complianceFixes": [
      {
        "issue": "Original draft contained 'transformative' \u2014 removed per MLR guidance \u00a74.2 (promotional language without substantiation).",
        "fixApplied": true
      }
    ],
    "characterCount": 512,
    "wordCount": 74
  },
  {
    "id": "ac-002",
    "ideationContentCardId": "c-001",
    "channel": "blog",
    "channelLabel": "Blog Post",
    "contentText": "The VELORA-301 Phase III trial has demonstrated that veloricept in combination with pembrolizumab significantly improves progression-free survival in patients with first-line advanced non-small cell lung cancer.\n\nKey findings:\n\u2022 Hazard ratio: 0.61 (95% CI 0.48\u20130.77; p<0.001)\n\u2022 Median PFS: 14.2 months (veloricept arm) vs 8.7 months (pembrolizumab alone)\n\u2022 Results were consistent across pre-specified subgroups\n\nThese data support the potential of veloricept as a clinically meaningful addition to the treatment landscape for advanced NSCLC. Full trial results are published in the New England Journal of Medicine.",
    "aiGenerated": true,
    "aiFootprintHash": "af-blog-c001-v1",
    "brandScreenPassed": true,
    "complianceScreenPassed": true,
    "complianceFixes": [],
    "characterCount": 721,
    "wordCount": 105
  },
  {
    "id": "ac-003",
    "ideationContentCardId": "c-001",
    "channel": "hcp",
    "channelLabel": "HCP Summary",
    "contentText": "VELORA-301 Phase III Primary PFS Data Summary\n\nPopulation: Patients with untreated advanced NSCLC (n=487), ECOG PS 0\u20132, any PD-L1 expression.\n\nPrimary endpoint: Progression-free survival (investigator-assessed, RECIST v1.1).\n\nResults: Median PFS 14.2 months (veloricept + pembrolizumab) vs 8.7 months (pembrolizumab + placebo). HR 0.61 (95% CI 0.48\u20130.77; p<0.001, pre-specified significance threshold p<0.01).\n\nSubgroup consistency: Benefit observed across PD-L1 expression levels and histology subgroups. Interaction p-values non-significant.\n\nRef: VELORA-301 CSR v1.0 \u00b7 Table 14.2.1 \u00b7 Primary Analysis",
    "aiGenerated": true,
    "aiFootprintHash": "af-hcp-c001-v1",
    "brandScreenPassed": true,
    "complianceScreenPassed": true,
    "complianceFixes": [],
    "characterCount": 694,
    "wordCount": 98
  },
  {
    "id": "ac-004",
    "ideationContentCardId": "c-001",
    "channel": "email",
    "channelLabel": "Email",
    "contentText": "Subject: VELORA-301 Phase III Primary PFS Results Now Available\n\nDear [HCP Name],\n\nWe are pleased to share that the primary efficacy results from the VELORA-301 Phase III trial are now available.\n\nVeloricept plus pembrolizumab demonstrated a statistically significant improvement in progression-free survival (hazard ratio 0.61; 95% CI 0.48\u20130.77; p<0.001) versus pembrolizumab alone in patients with first-line advanced NSCLC.\n\nMedian PFS was 14.2 months in the combination arm versus 8.7 months in the control arm.\n\nFull data including subgroup analyses and safety are available in the enclosed summary.\n\nIf you have questions, please contact your GenBioCa Medical Affairs representative.\n\nMedical Affairs Team\nGenBioCa Sciences",
    "aiGenerated": true,
    "aiFootprintHash": "af-email-c001-v1",
    "brandScreenPassed": true,
    "complianceScreenPassed": true,
    "complianceFixes": [],
    "characterCount": 805,
    "wordCount": 122
  },
  {
    "id": "ac-005",
    "ideationContentCardId": "c-002",
    "channel": "hcp",
    "channelLabel": "HCP Summary",
    "contentText": "VELORA-301 Safety Profile \u2014 Grade 3+ TRAE Summary\n\nGrade 3 or higher treatment-related adverse events (TRAEs) occurred in 52% of patients in the veloricept arm versus 44% in the pembrolizumab control arm.\n\nNo new safety signals were identified. The safety profile was consistent with the known profiles of each agent. Immune-mediated adverse events were manageable with standard protocols.\n\nCommon Grade 3+ TRAEs (\u22655% in either arm): fatigue, decreased appetite, pneumonitis (veloricept arm: 8%), elevated ALT/AST.\n\nRef: VELORA-301 CSR v1.0 \u00b7 Table 12.2.4 \u00b7 Safety Population (n=487)",
    "aiGenerated": true,
    "aiFootprintHash": "af-hcp-c002-v1",
    "brandScreenPassed": true,
    "complianceScreenPassed": true,
    "complianceFixes": [],
    "characterCount": 610,
    "wordCount": 88
  },
  {
    "id": "ac-006",
    "ideationContentCardId": "c-002",
    "channel": "medical-affairs",
    "channelLabel": "Medical Affairs",
    "contentText": "Medical Affairs Briefing Note \u2014 Veloricept Safety Profile\n\nFor internal Medical Affairs use only.\n\nKey safety data from VELORA-301:\n\u2022 Grade 3+ TRAE rate: 52% (veloricept arm) vs 44% (control)\n\u2022 No new safety signals identified in the Phase III dataset\n\u2022 Immune-mediated AEs: pneumonitis (8%), colitis (3%), endocrinopathies (6%)\n\u2022 Treatment discontinuation due to AEs: 12% vs 8%\n\nAll safety data reviewed and accepted by PV Lead (Dr R. Morton, VELORA-301 Super Review, 15 Oct 2026).\n\nFor HCP communications, refer to approved SmPC \u00a74.8 and approved label language only.",
    "aiGenerated": true,
    "aiFootprintHash": "af-ma-c002-v1",
    "brandScreenPassed": true,
    "complianceScreenPassed": true,
    "complianceFixes": [],
    "characterCount": 680,
    "wordCount": 97
  },
  {
    "id": "ac-007",
    "ideationContentCardId": "c-003",
    "channel": "linkedin",
    "channelLabel": "LinkedIn",
    "contentText": "Consistent benefit across subgroups in VELORA-301: the PFS improvement with veloricept plus pembrolizumab was observed regardless of PD-L1 expression level and tumour histology (squamous and non-squamous), supporting a broad patient population.\n\nNote: Claim currency flag acknowledged \u2014 PD-L1 subgroup language confirmed consistent with approved SmPC v1.0.\n\n#Oncology #NSCLC #Biomarkers",
    "aiGenerated": true,
    "aiFootprintHash": "af-linkedin-c003-v1",
    "brandScreenPassed": true,
    "complianceScreenPassed": true,
    "complianceFixes": [],
    "characterCount": 398,
    "wordCount": 58
  },
  {
    "id": "ac-008",
    "ideationContentCardId": "c-003",
    "channel": "hcp",
    "channelLabel": "HCP Summary",
    "contentText": "VELORA-301 Subgroup Analyses \u2014 Consistency Summary\n\nPD-L1 Subgroups (CPS threshold):\n\u2022 CPS \u22651%: HR 0.59 (95% CI 0.44\u20130.79)\n\u2022 CPS \u226550%: HR 0.55 (95% CI 0.38\u20130.79)\n\u2022 CPS <1%: HR 0.68 (95% CI 0.47\u20130.98)\n\nHistology:\n\u2022 Squamous: HR 0.59 (95% CI 0.42\u20130.83)\n\u2022 Non-squamous: HR 0.62 (95% CI 0.46\u20130.83)\n\nAll interaction p-values non-significant. Benefit consistent across subgroups.\n\nClaim currency note: PD-L1 subgroup language reviewed against SmPC v1.0 (approved). Confirmed current.\n\nRef: VELORA-301 CSR v1.0 \u00b7 Table 14.2.7.1 and 14.2.7.2",
    "aiGenerated": true,
    "aiFootprintHash": "af-hcp-c003-v1",
    "brandScreenPassed": true,
    "complianceScreenPassed": true,
    "complianceFixes": [],
    "characterCount": 652,
    "wordCount": 90
  }
]
```

---

## claimCurrencyCheck.json

**Used by:** sE02 · sE03  
**Records:** 1  
**Description:** 1 check for ia-001: 14 claims — 12 current, 1 potentially-superseded (PD-L1 subgroup, acknowledged), 0 conflicting

```json
{
  "id": "ccc-001",
  "ideationArtefactId": "ia-001",
  "ideationProjectId": "ip-001",
  "runAt": "2026-10-18T09:30:00Z",
  "totalClaimsExtracted": 14,
  "results": {
    "current": 12,
    "potentiallySuperseded": 1,
    "conflicting": 0
  },
  "claimsExtracted": [
    {
      "id": "cl-001",
      "text": "hazard ratio 0.61 (95% CI 0.48\u20130.77; p<0.001)",
      "status": "current",
      "source": "\u00a73.2",
      "verifiedAgainst": "SmPC v1.0 \u00a75.1"
    },
    {
      "id": "cl-002",
      "text": "median PFS 14.2 months versus 8.7 months",
      "status": "current",
      "source": "\u00a73.2",
      "verifiedAgainst": "SmPC v1.0 \u00a75.1"
    },
    {
      "id": "cl-003",
      "text": "Grade 3 or higher TRAEs occurred in 52% vs 44%",
      "status": "current",
      "source": "\u00a74.1",
      "verifiedAgainst": "SmPC v1.0 \u00a74.8"
    },
    {
      "id": "cl-004",
      "text": "consistent across PD-L1 expression level and tumour histology",
      "status": "potentially-superseded",
      "source": "\u00a73.4",
      "verifiedAgainst": "SmPC v1.0 \u00a74.1",
      "flagNote": "PD-L1 subgroup claim \u2014 updated label threshold data published 01 Oct 2026. Verify against current SmPC \u00a74.1.",
      "acknowledgedBy": "user-il",
      "acknowledgedAt": "2026-10-19T10:00:00Z",
      "acknowledgementNote": "Current label thresholds confirmed with CMC Lead. Subgroup claim consistent with approved SmPC v1.0. Proceeding."
    },
    {
      "id": "cl-005",
      "text": "intention-to-treat population",
      "status": "current",
      "source": "\u00a73.2",
      "verifiedAgainst": "SmPC v1.0 \u00a75.1"
    },
    {
      "id": "cl-006",
      "text": "no new safety signals were identified",
      "status": "current",
      "source": "\u00a74.2",
      "verifiedAgainst": "PV Lead confirmation 15 Oct 2026"
    },
    {
      "id": "cl-007",
      "text": "pneumonitis (8% in veloricept arm)",
      "status": "current",
      "source": "\u00a74.3",
      "verifiedAgainst": "SmPC v1.0 \u00a74.8"
    },
    {
      "id": "cl-008",
      "text": "ECOG PS 0\u20132",
      "status": "current",
      "source": "\u00a72.1",
      "verifiedAgainst": "Protocol inclusion criteria"
    },
    {
      "id": "cl-009",
      "text": "first-line advanced NSCLC",
      "status": "current",
      "source": "\u00a71.1",
      "verifiedAgainst": "SmPC v1.0 \u00a74.1"
    },
    {
      "id": "cl-010",
      "text": "pembrolizumab alone",
      "status": "current",
      "source": "\u00a73.2",
      "verifiedAgainst": "Protocol comparator arm"
    },
    {
      "id": "cl-011",
      "text": "interaction p-values non-significant",
      "status": "current",
      "source": "\u00a73.4",
      "verifiedAgainst": "CSR v1.0 Table 14.2.7.1"
    },
    {
      "id": "cl-012",
      "text": "CPS \u22651%",
      "status": "current",
      "source": "\u00a73.4",
      "verifiedAgainst": "SmPC v1.0 \u00a74.1"
    },
    {
      "id": "cl-013",
      "text": "squamous and non-squamous",
      "status": "current",
      "source": "\u00a73.4",
      "verifiedAgainst": "Protocol histology stratification"
    },
    {
      "id": "cl-014",
      "text": "treatment discontinuation due to AEs: 12% vs 8%",
      "status": "current",
      "source": "\u00a74.4",
      "verifiedAgainst": "SmPC v1.0 \u00a74.8"
    }
  ],
  "acknowledgedBy": "user-il",
  "acknowledgedAt": "2026-10-19T10:00:00Z"
}
```

---

## ideationCalendar.json

**Used by:** sE07 · sE08  
**Records:** 5  
**Description:** 5 calendar entries: LinkedIn 22 Oct published ✓, Blog 25 Oct overdue (48h), HCP 28 Oct published ✓, HCP Safety 18 Oct overdue, Subgroup LinkedIn 5 Nov scheduled

```json
[
  {
    "id": "cal-001",
    "ideationContentCardId": "c-001",
    "ideationProjectId": "ip-001",
    "channel": "linkedin",
    "channelLabel": "LinkedIn",
    "cardTitle": "Primary PFS Efficacy Result",
    "scheduledDate": "2026-10-22",
    "assignedCreativeId": "user-cr",
    "assignedCreativeName": "Alex Brennan",
    "status": "published",
    "publishedAt": "2026-10-22T09:00:00Z",
    "publishedBy": "user-cr",
    "utmParams": "utm_source=linkedin&utm_medium=social&utm_campaign=velora301-pfs&utm_content=hr-0.61",
    "seoMetadata": {
      "tags": [
        "Oncology",
        "NSCLC",
        "ClinicalTrials",
        "Veloricept"
      ]
    },
    "sentimentScore": 0.78,
    "sentimentAlertSent": false,
    "isOverdue": false
  },
  {
    "id": "cal-002",
    "ideationContentCardId": "c-001",
    "ideationProjectId": "ip-001",
    "channel": "blog",
    "channelLabel": "Blog Post",
    "cardTitle": "Primary PFS Efficacy Result",
    "scheduledDate": "2026-10-25",
    "assignedCreativeId": "user-cr",
    "assignedCreativeName": "Alex Brennan",
    "status": "overdue",
    "publishedAt": null,
    "publishedBy": null,
    "utmParams": null,
    "seoMetadata": {},
    "sentimentScore": null,
    "sentimentAlertSent": false,
    "isOverdue": true,
    "overdueHours": 48,
    "overdueAlertSentAt": "2026-10-26T09:00:00Z"
  },
  {
    "id": "cal-003",
    "ideationContentCardId": "c-001",
    "ideationProjectId": "ip-001",
    "channel": "hcp",
    "channelLabel": "HCP Summary",
    "cardTitle": "Primary PFS Efficacy Result",
    "scheduledDate": "2026-10-28",
    "assignedCreativeId": "user-cr",
    "assignedCreativeName": "Alex Brennan",
    "status": "published",
    "publishedAt": "2026-10-28T10:00:00Z",
    "publishedBy": "user-cr",
    "utmParams": "utm_source=email&utm_medium=hcp&utm_campaign=velora301-pfs",
    "seoMetadata": {},
    "sentimentScore": null,
    "sentimentAlertSent": false,
    "isOverdue": false
  },
  {
    "id": "cal-004",
    "ideationContentCardId": "c-002",
    "ideationProjectId": "ip-001",
    "channel": "hcp",
    "channelLabel": "HCP Summary",
    "cardTitle": "Safety Profile \u2014 Grade 3+ AEs",
    "scheduledDate": "2026-10-18",
    "assignedCreativeId": "user-cr",
    "assignedCreativeName": "Alex Brennan",
    "status": "overdue",
    "publishedAt": null,
    "publishedBy": null,
    "utmParams": null,
    "seoMetadata": {},
    "sentimentScore": null,
    "sentimentAlertSent": true,
    "isOverdue": true,
    "overdueHours": 192,
    "overdueAlertSentAt": "2026-10-19T09:00:00Z"
  },
  {
    "id": "cal-005",
    "ideationContentCardId": "c-003",
    "ideationProjectId": "ip-001",
    "channel": "linkedin",
    "channelLabel": "LinkedIn",
    "cardTitle": "Subgroup Consistency",
    "scheduledDate": "2026-11-05",
    "assignedCreativeId": "user-cr",
    "assignedCreativeName": "Alex Brennan",
    "status": "scheduled",
    "publishedAt": null,
    "publishedBy": null,
    "utmParams": null,
    "seoMetadata": {},
    "sentimentScore": null,
    "sentimentAlertSent": false,
    "isOverdue": false,
    "maAdvanceNotificationSent": true,
    "maAdvanceNotificationSentAt": "2026-11-02T09:00:00Z"
  }
]
```

---

## socialListeningAlerts.json

**Used by:** sE07 · sE08  
**Records:** 1  
**Description:** 1 sentiment alert: Blog Post negative score 0.36 (below auto-stop threshold 0.50) — notified MA Lead, resolved 24 Oct

```json
[
  {
    "id": "sla-001",
    "publishRecordId": "cal-002",
    "calendarEntryId": "cal-002",
    "ideationProjectId": "ip-001",
    "cardTitle": "Primary PFS Efficacy Result \u2014 Blog Post",
    "alertType": "sentiment",
    "thresholdBreached": false,
    "sentimentScore": 0.36,
    "sentimentThreshold": 0.4,
    "triggeredAt": "2026-10-23T14:30:00Z",
    "notifiedMALeadAt": "2026-10-23T14:31:00Z",
    "notifiedMALeadName": "Dr Michael Andrews",
    "autoStopTriggered": false,
    "autoStopNote": "Sentiment score 0.36 negative \u2014 below advisory threshold (0.40). Notification sent to MA Lead. Auto-stop not triggered (threshold for auto-stop: >0.50 negative).",
    "resolvedAt": "2026-10-24T09:00:00Z",
    "resolvedBy": "user-ma",
    "resolvedByName": "Dr Michael Andrews",
    "resolutionNote": "Reviewed negative sentiment \u2014 attributed to one critical blog comment (off-label query). No label issue. Blog post content unchanged. Monitoring continues."
  }
]
```

---

## kolContacts.json

**Used by:** sE05 · sE06  
**Records:** 1  
**Description:** 1 KOL: Prof. James Whitfield — signed off all 3 cards, c-003 comment on PD-L1 language

```json
[
  {
    "id": "kol-001",
    "ideationProjectId": "ip-001",
    "name": "Prof. James Whitfield",
    "title": "Professor of Oncology, University of Edinburgh",
    "email": "j.whitfield@oncology-edinburgh.ac.uk",
    "reviewLinkToken": "kol-tok-001-demo",
    "reviewLinkExpiry": "2026-10-28T00:00:00Z",
    "signedOffAt": "2026-10-21T14:00:00Z",
    "reminder1SentAt": null,
    "reminder2SentAt": null,
    "escalatedAt": null,
    "reviewDecisions": [
      {
        "cardId": "c-001",
        "decision": "approved",
        "comment": null
      },
      {
        "cardId": "c-002",
        "decision": "approved",
        "comment": null
      },
      {
        "cardId": "c-003",
        "decision": "approved",
        "comment": "PD-L1 subgroup language \u2014 please ensure consistency with current ESMO guidelines."
      }
    ]
  }
]
```

---

## Key Design Decision References

- **DD-E-001** — Source document is always read-only. `ChannelAdaptationCard` text is editable; the source artefact panel is never editable.
- **DD-E-002** — External uploads require explicit Ideation Lead confirmation before proceeding past the source gate.
- **DD-E-003** — Conflicting claim currency status blocks card tagging entirely.
- **DD-E-004** — AI atomisation fires one API call per channel. Never batch. `AtomisationSpinner` shows per-channel spinners.
- **DD-E-005** — Publishing is human-executed. The platform records the publish event; it never calls social platform APIs directly.

## CC Prompt for Module E Setup

Once all eight JSON files are in `src/data/`, give CC the following prompt:

```
Read C:/chetan/genBioCa/LifeSciences/docs/E/CC/session-E00-module-e-context.md
and execute. Report all setup items completed and all 3 verification checks
(typecheck, lint, build) passing before awaiting Session E01.
```

---

*AURORA Module E Data Files · v1.0 · September 2026 · GenBioCa Confidential*
