# GenBioCa — AURORA
## PRD D — Regulatory Writing
### Version 0.2

**Platform name:** Aurora (placeholder — rebrand in progress. Shortlist: AXION, VERIDOC, SYNTHARA, CLARIVA, GENOVA)
**Tagline:** AI-Native Authoring for Life Sciences
**Module colour:** #B0200D (Crimson) — per PRD v4.1 §3.3 Module Colour Coding

*Status: First draft — gap analysis complete, SME decisions incorporated, 7 open decisions flagged. Ready for design-phase scoping.*
*Classification: Confidential — Internal Use Only*
*Prepared: September 2026*

---

## 0. Document Control

| Field | Value |
|-------|-------|
| Document | PRD D — Regulatory Writing, v0.1 |
| Status | First draft. Built from PRD v4.1 Module D sections + competitor gap analysis (AURORA_ModuleD_Competitor_Analysis_and_Gaps.xlsx). 10 gap rows confirmed Include. 7 rows pending SME decision (B1–B4, A7, A8, C4). 3 validation findings from gap analysis carried forward. |
| Supersedes | — (first version) |
| Built From | PRD v4.1 §4.4, §5.4, §6.4, RACI Chart 4, §11A.4, §12.4 + Module D Competitor Gap Analysis v0.1 (Sept 2026) |
| Naming Note | Platform referred to as "Aurora" throughout (placeholder). Module D is the internal identifier — never shown in UI. |
| Dependency | Module D depends on Module A as primary upstream source (CSRs, IBs, SAPs, TLFs). Module D also ingests CMC/nonclinical data from external sources. Module B publications and Module C medical affairs outputs may optionally be cited in regulatory submissions. |

---

## 0A. Gap Analysis Summary — Input to This PRD

**Source file:** AURORA_ModuleD_Competitor_Analysis_and_Gaps.xlsx
**Competitors reviewed:** Veeva Vault RIM, ArisGlobal LifeSphere Regulatory, EXTEDO (EXTEDOpulse/eCTDmanager/MPDmanager)
**Total gap rows:** 17 (8 Competitor Has/PRD Lacks · 4 Differentiators · 5 GAPs Missing Everywhere)

| ID | Area | Direction | Severity | SME Decision | Where in This PRD |
|----|------|-----------|----------|-------------|-------------------|
| A1 | eCTD Publishing — Continuous/Automated | Competitor Has | Major | **Include** | FR-D-019 |
| A2 | Submission Planning — AI-Generated TOC | Competitor Has | Medium | **Include** | FR-D-003 |
| A3 | HA Correspondence — Predictive Timeline | Competitor Has | Medium | **Include** | FR-D-023 |
| A4 | Regulatory Intelligence — Live Change Monitoring | Competitor Has | Major | **Include** | FR-D-024 |
| A5 | Safety Report Automation — PSURs/PBRERs | Competitor Has | Major | **Include** | FR-D-015 |
| A6 | Cross-Functional Data Sync — Safety/Quality Triggers | Competitor Has | Medium | **Include** | FR-D-025 |
| A7 | Product Data Standards — IDMP/XEVMPD/SPOR | Competitor Has | Major | **⚠ TBD** | §14 OQ-D-001 |
| A8 | EXTEDO Vendor Scope Expansion | Competitor Has | Major | **⚠ TBD** | §14 OQ-D-002 |
| B1 | Platform Scope — Unified 5-Module | Differentiator | Major | **⚠ TBD** | §14 OQ-D-003 |
| B2 | AI-Native Authoring from Module A CSR | Differentiator | Major | **⚠ TBD** | §14 OQ-D-004 |
| B3 | Metadata Governance — TA + Master Library | Differentiator | Medium | **⚠ TBD** | §14 OQ-D-005 |
| B4 | Roles & Governance — RACI | Differentiator | Medium | **⚠ TBD** | §14 OQ-D-006 |
| C1 | HA Response Drafting — AI from LoQ | GAP | Major | **Include** | FR-D-022 |
| C2 | Cross-CTD-Module Consistency Checking | GAP | Major | **Include** | FR-D-016 |
| C3 | CMC Data Readiness Scoring | GAP | Medium | **Include** | FR-D-004 |
| C4 | eCTD Version Migration (v3.2.2 → v4.0) | GAP | Medium | **⚠ TBD** | §14 OQ-D-007 |
| C5 | Orphan Drug / Rare Disease Eligibility Tool | GAP | Minor | **Include** | FR-D-026 |

**SME notes captured:**
- A7: "Not clear, need to understand this" — IDMP/XEVMPD/SPOR structured product-data management. Flagged OQ-D-001.
- A8: "Not clear, need to understand this" — EXTEDO vendor relationship scope question. Flagged OQ-D-002. This is a strategic vendor decision, not a feature decision.
- C4: "Needs to be reviewed, maybe Phase 2" — eCTD v3.2.2 → v4.0 migration. Flagged OQ-D-007 with Phase 2 recommendation.
- B1–B4: No SME decision recorded. All four differentiators flagged as TBD, consistent with Module B and C pattern.

**Validation findings carried forward (from gap analysis Read Me):**

**Finding #1 — Cross-Module Correction (Module A C3 classification):**
The Module A gap analysis classified "live regulatory-guidance change monitoring" as a universal GAP — Missing Everywhere (gap C3 in Module A). This is no longer accurate at the platform level: both ArisGlobal LifeSphere (Regulatory Intelligence module) and EXTEDO MPDmanager (RI Module) offer this today in the RIM category. The Module A PRD open questions and gap classification should be updated to note that regulatory intelligence monitoring exists in the RIM space and is addressed in Module D (FR-D-024). The platform decision is whether to build this capability once in Module D and surface it cross-module, rather than treating it as a universal gap.

**Finding #2 — EXTEDO Vendor Scope:**
EXTEDO is already named in PRD v4.1 §9.1 as an eCTD validation-checker (rows 19–20, alongside Lorenz). EXTEDO's actual platform scope is significantly broader. OQ-D-002 captures the strategic question: deliberately keep EXTEDO narrow (validation only) or expand the vendor relationship to cover IDMP, labeling, and regulatory intelligence rather than building those capabilities in-house.

**Finding #3 — MHRA Gateway Inconsistency:**
PRD v4.1 §5.4 Stage 6 lists MHRA (UK) as a submission gateway, but MHRA has no entry in PRD v4.1 §9.1 External API Registry and was not part of the resolved gateway-priority decision (§15 Issue 10: FDA ESG priority 1, EMA CESP priority 2, CDSCO priority 3). This PRD treats MHRA as a named gateway in FR-D-021 and flags it as OQ-D-008 for a clean-up decision: formally add MHRA to the gateway priority list and §9.1, or remove it from Stage 6 wording.

---

## 1. Purpose & Background

Aurora Module D — Regulatory Writing — is the regulatory dossier authoring, compilation, and submission management module within the Aurora ecosystem. It takes the clinical study data from Module A (CSRs, IBs, SAPs, TLFs) and external CMC/nonclinical data and transforms it into complete ICH CTD-compliant submission dossiers for FDA, EMA, MHRA, CDSCO, and PMDA, including INDs, NDAs/MAAs, RMPs, PSURs/PBRERs, HA response packages, and Orphan Drug Designations.

Module D operates in the most complex and highest-stakes regulatory environment of all five modules. Every document it produces is a formal submission to a health authority — incorrect content, a missed cross-reference, or a malformed eCTD package can trigger a refuse-to-file determination or months of delay. The four discipline rules (audit trail first, human sign-off required, modular monolith boundaries, TA tag mandatory) are applied with the highest strictness in Module D.

Three competitors were analysed: Veeva Vault RIM (dominant enterprise RIM by customer count), ArisGlobal LifeSphere Regulatory (leading enterprise alternative), and EXTEDO (25+ year eCTD specialist, already a named vendor in our PRD). Aurora's primary differentiator against all three is that it is the only platform that authors CTD Module 2 summaries from upstream clinical data within the same platform and audit trail — all three competitors manage, store, and publish regulatory documents but do not natively draft them from the CSR.

---

## 2. Scope

### 2.1 In Scope for v0.1 Build

- The full six-stage Module D workflow: Source Data Gathering → Module 2 Authoring → Modules 1 & 3–5 Finalisation → Integrated Review (Super Review) → Publishing (eCTD Compilation) → Submission & Post-Submission.
- All eleven Module D deliverable families (from PRD v4.1 §4.4): CTD Module 2.5 (Clinical Overview), CTD Module 2.6 (Nonclinical Overview), CTD Module 2.7 (Clinical Summary), INDs, NDAs/MAAs, RMPs/REMS, Regulatory Question Responses (Day 80/120/180), PSURs/PBRERs, SmPC/USPI Labels, Clinical Evaluation Reports (CERs), Orphan Drug Designation Applications.
- Mandatory TA tagging at all levels.
- Source document ingestion and canonical JSON layer (CSRs, nonclinical reports, CMC data, PK/PD datasets).
- AI-generated submission table of contents and eCTD granularity map (A2).
- CMC data readiness/completeness scoring before authoring (C3).
- AI-assisted drafting of CTD Module 2 summaries (2.5, 2.6, 2.7) grounded in Module A CSR/IB data.
- Cross-CTD-module consistency checking — automated contradiction detection across Module 2.5/2.7 and Module 5 TLFs (C2).
- Automated aggregate safety report generation — PSURs, PBRERs, DSURs from safety data (A5).
- Multi-disciplinary Super Review (Stage 4) — cross-functional CRM for inter-module discrepancies.
- PPD/CCI anonymisation and redaction (EMA Policy 0070/0043, Health Canada PRCI).
- Continuous/automated eCTD publishing — documents publish into the content plan as they are associated or updated (A1).
- eCTD validation against regional specifications (FDA/EMA/PMDA/CDSCO) using Admin-selected validation tool (EXTEDO/Lorenz).
- Regulatory submission gateways: FDA ESG (priority 1), EMA CESP (priority 2), CDSCO (priority 3), MHRA (subject to OQ-D-008).
- ACK1/ACK2/ACK3 receipt logging and submission status tracking.
- AI-drafted HA response packages from Health Authority List of Questions (LoQ) (C1).
- Predictive submission timeline estimation and HA correspondence AI (A3).
- Live regulatory-guidance change monitoring (A4).
- Cross-functional data sync triggers — safety signal → label update tracking (A6).
- Orphan Drug Designation eligibility scoring tool (C5).
- Pre-configured RACI matrix for the 6 Module D roles (B4).
- Master Library push at Final Output — tagged dossier sections by TA, project, submission type (B3).
- 21 CFR Part 11 audit trail and e-signatures — mandatory, same infrastructure as Modules A/B/C.

### 2.2 Explicitly Out of Scope for v0.1

- IDMP/XEVMPD/SPOR structured product-data management (A7 — pending SME decision; see OQ-D-001).
- EXTEDO vendor scope expansion beyond eCTD validation (A8 — strategic vendor decision; see OQ-D-002).
- eCTD v3.2.2 → v4.0 automated migration (C4 — Phase 2 per SME note; see OQ-D-007).
- Full Pharmacovigilance (PV) case management and signal detection — Module D writes the safety reports but does not replace a standalone PV system (Argus, ARISg). Safety data is ingested as exports, not as live case-level data.
- Full RIM (Regulatory Information Management) system — submission tracking, registration management, product-lifecycle management. Module D provides submission authoring and basic status tracking, not a full RIM replacement.
- Market positioning analytics dashboard (Module B/C Backlog item, applies here too).

---

## 3. Goals

*The following four best practices from PRD v4.1 §12.4 are design principles for every Module D FR:*
1. *Maintain strict objectivity in all regulatory documents — avoid language that overstates efficacy or downplays risk.*
2. *Ensure protocol language is reusable for the CSR from the outset.*
3. *CTD Modules 2.5 and 2.7 must be internally consistent and cross-referenced to Module 5 TLFs.*
4. *Country-specific variations must be applied using the country dropdown; the platform flags differences from the base submission.*

- Enable a regulatory writer to take a completed Module A CSR package and produce a submission-ready eCTD dossier without leaving the Aurora platform.
- Be the only authoring platform that drafts CTD Module 2 summaries from upstream clinical data within the same audit trail — the primary differentiator against all three RIM competitors.
- Enforce automated cross-module consistency checks that no competitor currently offers as an automated gate.
- Maintain a single, unbroken 21 CFR Part 11-compliant audit trail from clinical data (Module A CSR) through regulatory submission (Module D dossier) — the only platform that does this natively.
- Ship a pilot-ready Module D that a regulatory writing team can use end-to-end through all six workflow stages.

---

## 4. Glossary

| Term | Definition |
|------|-----------|
| CTD | Common Technical Document — the five-module dossier structure required for all major HA submissions |
| CTD Module 2 subsections | 2.1 Table of Contents (auto-generated), 2.2 Introduction to the Dossier (boilerplate), 2.3 Quality Overall Summary, 2.4 Nonclinical Overview, 2.5 Clinical Overview, 2.6 Nonclinical Written and Tabulated Summaries, 2.7 Clinical Summaries — per ICH M4E(R2) |
| eCTD | Electronic CTD — the electronic format with XML backbone for submission to FDA/EMA/PMDA etc. |
| ICH M4 / M11 | ICH guidelines governing CTD structure and eCTD specification |
| IND | Investigational New Drug application (US FDA) |
| NDA | New Drug Application (US FDA) |
| MAA | Marketing Authorisation Application (EMA) |
| CTD Module 2 | Summary documents: 2.3 QOS, 2.4 Nonclinical Overview, 2.5 Clinical Overview, 2.6 Nonclinical Summaries, 2.7 Clinical Summaries |
| ISE / ISS | Integrated Summary of Efficacy / Integrated Summary of Safety — major components of Module 5 |
| SmPC / USPI | Summary of Product Characteristics (EU) / US Prescribing Information — the product label |
| RMP / REMS | Risk Management Plan (EMA) / Risk Evaluation and Mitigation Strategy (FDA) |
| PSUR / PBRER | Periodic Safety Update Report / Periodic Benefit-Risk Evaluation Report |
| DSUR | Development Safety Update Report |
| CER | Clinical Evaluation Report — required for EU medical device dossiers |
| PPD | Personal Protective Data — patient/investigator identifiers redacted before public disclosure |
| CCI | Commercially Confidential Information — business-sensitive information redacted from public dossier |
| LoQ | List of Questions — Health Authority's formal questions during dossier review (Day 80/120/180) |
| HA | Health Authority (FDA, EMA, MHRA, CDSCO, PMDA) |
| RIM | Regulatory Information Management — category of platforms managing submission lifecycle |
| IDMP | Identification of Medicinal Products — EMA structured product data standard |
| XEVMPD | Extended EudraVigilance Medicinal Product Dictionary — EU product registration database |
| SPOR | Substances, Products, Organisations and Referentials — EMA master data system |
| CMC | Chemistry, Manufacturing, and Controls — Module 3 content |
| FDA ESG | FDA Electronic Submissions Gateway |
| EMA CESP | EMA Common European Submission Portal |
| CDSCO | Central Drugs Standard Control Organisation (India) |
| MHRA | Medicines and Healthcare products Regulatory Agency (UK) |
| PMDA | Pharmaceuticals and Medical Devices Agency (Japan) |
| ACK | Acknowledgement receipt from HA gateway (ACK1 = receipt, ACK2 = format validation passed, ACK3 = accepted for review) |
| Super Review | Multi-disciplinary cross-functional review of the complete dossier (Stage 4) |
| FR-D-### | Functional Requirement identifier, Module D scope |

---

## 5. Architecture Context

### 5.1 Module Dependency

Module D is the terminal downstream module in the clinical data flow:

```
Module A (CSR / IB / SAP / TLF Package)
         ↓
Module B (Publications)  ──┐
         ↓                 │
Module C (Med Affairs)   ──┤
         ↓                 │
Module D (CTD Dossier / Regulatory Submission) ←┘
         ↓
Master Library (approved dossier sections by TA, submission type)
         ↓
Regulatory Gateway (FDA ESG / EMA CESP / CDSCO / MHRA)
```

A Module D project must link to a Module A project at creation. The linked CSRs, IBs, SAPs, and TLF package from Module A are the primary authoring inputs for CTD Modules 2.5 and 2.7. External CMC/nonclinical reports (Module 3/4 content) are ingested directly into Module D as they are not produced by Aurora's other modules.

### 5.2 Architecture Rules (same four discipline rules as Modules A/B/C, maximum strictness)

1. **Module boundary enforcement:** Module D components must not import directly from Modules A/B/C components. Cross-module data flows through the platform interface layer only.
2. **Audit trail first — highest strictness:** Every content change, AI suggestion, reviewer decision, cross-reference check result, anonymisation action, and gateway submission event is immutably logged before the UI updates. No exceptions. The audit trail is the regulatory submission record.
3. **Human sign-off required — mandatory at every stage gate:** No AI-generated content enters the eCTD package without a named human reviewer's explicit sign-off. The Regulatory Writer, Reg Affairs Lead, and eCTD Specialist each have defined sign-off points in the workflow.
4. **TA tag mandatory:** Every project, dossier section, and Master Library card must carry a TA tag before it can be saved.

### 5.3 Shared Infrastructure

Module D reuses the following from the platform:
- Authentication, MFA, Terms Gate, AppShell (Modules A/B/C)
- Document Editor core (Module A Session 11) — adapted for CTD module structure
- Review Assignment Panel (Module A Session 15)
- CRM Module (Module A Session 18) — repurposed as Super Review CRM (Stage 4)
- Comment Resolution Panel (Module A Session 19)
- E-Signature (Module A Session 20) — mandatory at Stage 4 and Stage 6
- Audit Trail Panel (Module A Session 14)
- Master Library push (§7.6 platform feature)

Module D adds new screens and panels for: Source Data Ingestion, eCTD Granularity Map, CMC Data Readiness Panel, Regulatory Intelligence Panel, Cross-Module Consistency Checker, PPD/CCI Redaction Tool, eCTD Continuous Publishing Monitor, Gateway Submission Panel, HA Correspondence Tracker, HA Response Drafting Panel, Orphan Drug Eligibility Tool.

### 5.4 Architecture Flag: Regulatory Intelligence as a Cross-Module Service

The gap analysis Finding #1 notes that regulatory intelligence monitoring (gap A4) was previously misclassified as a universal gap. Given that Module D is where this capability belongs, the architecture question is: should the live regulatory-guidance change monitor be a Module D-only feature, or a platform-level service that all five modules can query? Modules A (ICH E3 compliance), B (GPP 2022/ICMJE updates), and C (MLR regulatory code updates) would all benefit from live framework monitoring. This is flagged for architecture review — the preferred approach is a single shared Regulatory Intelligence service surfaced in each module's relevant context, with Module D as the primary owner and driver.

---

## 6. Functional Requirements

### 6.1 Source Data Gathering (Stage 1)

**FR-D-001 — Source Document Ingestion & Canonical JSON Layer** *(MVP)*
The system ingests source documents from the linked Module A project (CSRs, IBs, SAPs, TLF package) and from external uploads (Module 3 CMC data, Module 4 nonclinical reports, PK/PD datasets, Previous HA Briefing Books). All ingested documents are stored in a canonical JSON layer — a structured representation that allows the AI authoring engine to query specific data points (e.g., primary endpoint results, safety data tables) without re-reading the full PDF. The canonical layer is version-controlled and each update is logged in the audit trail.

**FR-D-002 — Regional Submission Strategy & Country Selector** *(MVP)*
At Stage 1, the Regulatory Affairs Lead selects:
- Target submission type (IND, NDA/MAA, PSUR/PBRER, RMP, HA Response, CER, Orphan Drug Designation)
- Target regulatory pathway(s) per region: FDA (US), EMA (EU), MHRA (UK), CDSCO (India), PMDA (Japan)
- Submission timeline
- eCTD version: v3.2.2 (default) or v4.0 (PMDA mandatory from April 2026; EMA/Health Canada phasing in)

Country-specific variations are flagged throughout the authoring workflow wherever regional requirements differ from the base CTD template. PRD v4.1 §12.4 best practice: "country-specific variations must be applied using the country dropdown; the platform flags differences from the base submission."

**FR-D-003 — AI-Generated Submission Table of Contents & eCTD Granularity Map** *(MVP — Gap A2)*
Based on the submission type and target regions selected in FR-D-002, the system generates:
- An AI-populated submission table of contents aligned to ICH M4 CTD structure
- A real-time eCTD granularity map showing which documents are: received and validated / in authoring / in review / signed off / not yet received
- A dossier completeness indicator showing the percentage of required sections with at least a draft version

This replaces the manually built eCTD granularity map currently required in PRD v4.1 §5.4 Stage 1. Veeva Vault RIM's equivalent capability is the benchmark.

**FR-D-004 — CMC Data Readiness Scoring** *(MVP — Gap C3)*
Before Module 3 CMC data is incorporated into Stage 2 authoring, the system runs a completeness check:
- Verifies that all required Module 3 sections (3.2.S, 3.2.P, 3.2.A, 3.3, 3.4) have submitted data or a justified absence
- Flags missing CMC data items ahead of authoring rather than discovering them at Stage 4 Super Review
- Generates a CMC Readiness Report with a completeness score (%) and a prioritised list of missing items
- The Regulatory Affairs Lead must acknowledge the CMC Readiness Report before Stage 2 begins; partial readiness can be accepted with an explicit risk acknowledgement logged to the audit trail

**FR-D-005 — Mandatory TA Tagging** *(MVP)*
Same as all modules. Every project, dossier section, and Master Library card must carry a mandatory TA tag before saving.

---

### 6.2 Module 2 Authoring (Stage 2)

**FR-D-006 — CTD Module Structure Enforcement** *(MVP)*
The document editor for Module D enforces the ICH M4 CTD structure per submission type:
- Module 2.1 — Table of Contents for Module 2 (system-generated by eCTD publisher)
- Module 2.2 — Introduction to the Dossier (boilerplate section; system-generated from project metadata)
- Module 2.3 — Quality Overall Summary (QOS)
- Module 2.4 — Nonclinical Overview
- Module 2.5 — Clinical Overview (primary AI authoring target)
- Module 2.6 — Nonclinical Written and Tabulated Summaries
- Module 2.7 — Clinical Summaries (primary AI authoring target)
- Module 1 — Regional administrative documents (SmPC/USPI, cover letters, regional forms)
- Module 3 — CMC (finalised in Stage 3)
- Module 4 — Nonclinical (finalised in Stage 3)
- Module 5 — Clinical Study Reports (imported from Module A; not re-authored in Module D)

Section order within each CTD module is locked to the ICH M4 template. Subsections may be added within the defined hierarchy; the top-level ICH structure cannot be reordered.

**FR-D-007 — AI-Assisted CTD Module 2 Drafting** *(MVP — Differentiator B2)*
The AI auto-suggest engine in Module D is grounded specifically in the canonical JSON layer (FR-D-001). For Modules 2.5 and 2.7:
- AI generates draft sections from the linked Module A CSR, IB, SAP, and TLF data
- Every AI suggestion cites the specific source document section, table, or data point from which it was derived
- AI suggestions are marked with an AI Footprint indicator (same as Module B FR-B-006) — immutable, logged to audit trail, never removable without replacing the content
- The system enforces strict data objectivity: PRD v4.1 §12.4 best practice 1 ("avoid language that overstates efficacy or downplays risk") is encoded as an AI system-prompt constraint and checked by the pre-submission consistency check

Note on Module 2.6: AI suggestions for Module 2.6 (Nonclinical Written and Tabulated Summaries) are grounded in the nonclinical canonical JSON layer (Module 4 data ingested via FR-D-001), not the Module A CSR. Module A CSR data is the primary authoring source for Modules 2.5 and 2.7 only.

This is Aurora's strongest differentiator against all three RIM competitors, none of which draft CTD Module 2 summaries from upstream clinical data.

**FR-D-008 — SmPC/USPI Label Drafting** *(MVP)*
The system provides a SmPC/USPI label drafting editor with:
- EMA SmPC structure enforced (per EMA Guideline on SmPC, 2009 updated)
- USPI structure enforced (per FDA regulations)
- Label language grounded in Module 2.5 Clinical Overview (approved content only)
- Country-specific label variant tracking: base label → EU SmPC variant → US USPI variant → country-specific adaptations
- Label version history with full diff view between versions

**FR-D-009 — RMP/REMS Authoring** *(MVP)*
Structured authoring for Risk Management Plans (EMA) and Risk Evaluation and Mitigation Strategies (FDA):
- Pre-built RMP template per EMA GVP Module V (Risk Management Systems)
- REMS template per FDA REMS requirements
- Safety specification sourced from Module A pharmacovigilance data and the PSUR/PBRER (FR-D-015)
- Pharmacovigilance plan sections require PV Lead sign-off (RACI)

---

### 6.3 Modules 1 & 3–5 Finalisation (Stage 3)

**FR-D-010 — Regional Administrative Documents (Module 1)** *(MVP)*
Module 1 administrative documents are region-specific and vary per target HA:
- Cover letter template per HA (FDA, EMA, MHRA, CDSCO, PMDA)
- Form FDA 1571 / Form FDA 1572 for US INDs
- Regional forms auto-populated from the project record (applicant name, compound name, IND/NDA number)
- Country-specific labeling differences flagged automatically against the base SmPC/USPI

**FR-D-011 — Module 3 CMC Finalisation** *(MVP)*
CMC data ingested in Stage 1 is finalised in Stage 3 with the CMC Lead's sign-off. The system:
- Validates Module 3 completeness against the CMC Readiness Report (FR-D-004)
- Checks all Module 3 sections against ICH Q8/Q9/Q10/Q11 structure
- Flags cross-references from Module 2.3 (QOS) to Module 3 as verified or broken
- CMC Lead must sign off all Module 3 sections before Stage 4

**FR-D-012 — Module 4 Nonclinical Finalisation** *(MVP)*
Nonclinical study reports (pharmacology, PK, toxicology) are reviewed and locked:
- ICH S1–S9 structure validation
- Cross-references from Module 2.4 and 2.6 to Module 4 studies flagged as verified or broken
- Nonclinical Lead must sign off Module 4 sections before Stage 4

**FR-D-013 — Module 5 Clinical Study Report Integration** *(MVP)*
Module 5 Clinical Study Reports are imported directly from Module A (not re-authored). The system:
- Imports the final signed CSR from the linked Module A project
- Generates a Module 5 table of contents from the imported CSRs
- Cross-references from Modules 2.5 and 2.7 to Module 5 TFLs are tracked (see FR-D-016)
- Module 5 is read-only in Module D; any changes to the CSR require a new version in Module A


---

### 6.4 Integrated Review — Super Review (Stage 4)

**FR-D-015 — Automated Aggregate Safety Report Generation** *(MVP — Gap A5)*
The system generates first-draft aggregate safety reports from pharmacovigilance data exports:
- **PSUR/PBRER:** structured per ICH E2C(R2); draft generated from safety database line-listing exports (Argus, ARISg format supported), reference safety information (SmPC/IB), and Module 2.5 safety section
- **DSUR:** structured per ICH E2F; draft generated from IND safety data
- All AI-generated safety report sections are marked with AI Footprint indicator
- The PV Lead must verify all signal tables, incidence rates, and benefit-risk assessments before Stage 4 sign-off
- ArisGlobal LifeSphere's Advanced Compliance Docs is the benchmark competitor

**FR-D-016 — Cross-CTD-Module Consistency Check** *(MVP — Gap C2)*
The most technically distinctive feature in Module D. The system automatically:
- Checks every quantitative data point in Module 2.5 (Clinical Overview) and Module 2.7 (Clinical Summary) against the same data point in the Module 5 TFLs
- Flags contradictions: e.g., Module 2.5 states "hazard ratio 0.61" but Module 5 Table 14.2.1 shows "hazard ratio 0.63"
- Checks cross-references are not broken (referenced table/figure exists in the target module)
- Generates a Cross-Module Consistency Report listing all flagged contradictions with source/target citations
- All contradictions must be resolved and documented before Stage 4 sign-off
- PRD v4.1 §12.4 best practice 3 ("CTD Modules 2.5 and 2.7 must be internally consistent and cross-referenced to Module 5 TFLs") is enforced as an automated gate, not a manual step

**FR-D-017 — Multi-Disciplinary Super Review (Stage 4)** *(MVP)*
The Super Review is the Module D equivalent of Module A's Cross-Functional Review:
- All six RACI roles participate: Regulatory Writer, Reg Affairs Lead, Clinical Lead, PV Lead, CMC/Nonclinical Leads, eCTD Specialist
- Review uses the platform CRM infrastructure (Module A Session 18) — a structured Comments Resolution Meeting for inter-module discrepancies
- Stage 4 gate requires sign-off from all six roles before dossier proceeds to Stage 5
- The Cross-Module Consistency Report (FR-D-016) is the primary working document for the Super Review

**FR-D-018 — RACI Matrix — Module D Roles** *(MVP — Differentiator B4)*
Pre-configured RACI for Module D — six roles, Admin-editable only:

| Role | Primary Responsibility |
|------|----------------------|
| Regulatory Writer | Authors CTD Modules 2.5, 2.6, 2.7; drafts SmPC/USPI; integrates CMC/nonclinical/clinical data |
| Regulatory Affairs Lead (Strategist) | Defines submission strategy; determines target label; interfaces with HA |
| Clinical Lead/Clinician | Writes/reviews Module 2.5 Clinical Overview and Module 2.7 Clinical Summary |
| Pharmacovigilance/Risk Management Lead | Provides safety data; writes RMP/REMS; writes safety specification and PV plan |
| CMC/Nonclinical Leads | Provide Module 3 CMC data and Module 4 nonclinical reports |
| Publishing/eCTD Specialist | Handles technical eCTD compilation, bookmarking, hyperlinking, gateway transmission |

RACI Chart 4 from PRD v4.1 is the authoritative source for task-level R/A/C/I assignments.

---

### 6.5 Publishing — eCTD Compilation (Stage 5)

**FR-D-014 — PPD/CCI Anonymisation & Redaction** *(MVP)*
For submissions requiring public disclosure (EMA Policy 0070/0043, Health Canada PRCI):
- The system identifies all instances of Personal Protective Data (patient names, investigator names, site addresses) and Commercially Confidential Information throughout the dossier
- AI-assisted redaction highlighting marks all detected instances for human review
- The Regulatory Writer must confirm each redaction — AI marks, human confirms, audit trail records
- Two versions are produced: the original unredacted dossier (restricted access) and the redacted public copy
- Redaction decisions are logged immutably; a redaction cannot be reversed after Stage 5 submission without a new version

**FR-D-019 — Continuous/Automated eCTD Publishing** *(MVP — Gap A1)*
Rather than a discrete "compile at the end" step, the system continuously publishes documents into the eCTD content plan as they are associated or updated:
- Each signed-off section is automatically placed into the eCTD package structure at the correct granularity level
- The eCTD Granularity Map (FR-D-003) updates in real time as sections are locked
- The Publishing Monitor panel shows the current state of the eCTD package at all times — which sections are compiled, which are still pending
- At Stage 5, the final compilation step is a validation pass, not a manual assembly step

This directly replicates Veeva Vault RIM's Continuous Publishing capability and eliminates the manual eCTD compilation bottleneck.

**FR-D-020 — eCTD Validation** *(MVP)*
The compiled eCTD package is validated against regional specifications before submission:
- Validation engine: Admin-selectable (EXTEDO EXTEDOpulse default, as already specified in PRD v4.1 §9.1; Lorenz as alternative)
- Validates against FDA eCTD v3.2.2 and v4.0, EMA eCTD v3.2.2, PMDA eCTD v4.0, CDSCO eCTD v3.2.2
- Validation report shows: pass/fail per rule, severity (critical/major/minor), fix instructions
- All critical and major validation errors must be resolved before Stage 6
- Validation pass result and all error resolutions are logged to the audit trail

---

### 6.6 Submission & Post-Submission (Stage 6)

**FR-D-021 — Regulatory Gateway Submission** *(MVP)*
Submission via configured regulatory gateways in priority order per PRD v4.1 §15 Issue 10 resolution:
- Priority 1: FDA Electronic Submissions Gateway (ESG)
- Priority 2: EMA Common European Submission Portal (CESP)
- Priority 3: CDSCO (India)
- Priority 4: MHRA (UK) — subject to OQ-D-008 (currently listed in PRD v4.1 §5.4 Stage 6 but absent from §9.1 External API Registry and the §15 priority resolution)

For each gateway:
- Credentials stored securely in Admin configuration (never in user session)
- Submission transmission logged with timestamp and ACK receipt tracking
- ACK1 (receipt), ACK2 (format validation passed), ACK3 (accepted for review) are all logged and trigger notifications to the Reg Affairs Lead and eCTD Specialist
- Failed submissions (NACK) are flagged with the error code and resolution instructions

**FR-D-022 — AI-Drafted HA Response Packages** *(MVP — Gap C1)*
When a Health Authority issues a List of Questions (LoQ — Day 80, Day 120, or Day 180):
- The LoQ is uploaded into the system as a structured document
- The system generates a response letter template with each HA question as a numbered section
- AI drafts a first-pass response for each question, grounded in the original dossier sections and Module A source data (same canonical JSON layer from FR-D-001)
- Each AI-drafted response is flagged with the AI Footprint indicator
- The Regulatory Writer and Clinical Lead review, revise, and sign off each response
- The complete response package is version-controlled and submitted via the gateway

**FR-D-023 — Predictive Submission Timeline & HA Correspondence AI** *(MVP — Gap A3)*
- Predictive timeline estimation: based on submission type, target HA, and dossier completeness (from FR-D-003), the system generates an estimated submission readiness date and a milestone calendar
- HA correspondence tracking: all HA communications (queries, acknowledgements, responses, approvals) are logged in a structured correspondence record against the submission
- AI-accelerated intake of HA correspondence: incoming HA questions are automatically parsed and categorised (clinical, safety, CMC, administrative) before being routed to the relevant RACI role

**FR-D-024 — Live Regulatory-Guidance Change Monitor** *(MVP — Gap A4)*
A dedicated Regulatory Intelligence panel that monitors for changes to the regulatory frameworks listed in §10 and alerts relevant module users:
- Monitors: FDA guidance updates, EMA guidelines, ICH Q-series, ICH E-series, GSPR/MDR/IVDR amendments
- Change alerts are pushed to the Regulatory Affairs Lead with: framework name, change summary, effective date, and affected dossier sections
- The platform flags any dossier section whose regulatory basis has been updated since the section was last reviewed
- Per architecture flag §5.4: this panel is the primary owner in Module D but the alert service is designed as a cross-module service available to Modules A/B/C/D

**FR-D-025 — Cross-Functional Data Sync Triggers** *(MVP — Gap A6)*
Automated triggers between Module D and platform events in other modules:
- **Safety signal trigger:** if the PV Lead flags a new safety signal in the Module D submission record, the system automatically opens a label-update task in the same project (SmPC/USPI change required) and notifies the Reg Affairs Lead
- **CSR update trigger:** if the linked Module A CSR is revised (new version created), Module D flags all dossier sections that reference the updated CSR sections and requires review sign-off from the Regulatory Writer
- **Publication trigger:** if Module B publishes a new manuscript from the same Module A source project, the system alerts the Regulatory Affairs Lead that a new publication may need to be cited in the regulatory submission
- All triggers are logged to the audit trail with the triggering event, affected sections, and resolution status

**FR-D-026 — Orphan Drug Designation Eligibility Tool** *(MVP — Gap C5)*
A dedicated tool for Orphan Drug Designation (ODD) applications:
- Disease prevalence assessment: the system accepts epidemiological data inputs and scores the compound's likelihood of meeting the prevalence threshold (EU: ≤5 in 10,000; US: <200,000 patients)
- Medical plausibility assessment: the AI drafts the "significant benefit over existing therapies" section from the linked Module A CSR and Module 4 nonclinical data
- Generates a structured ODD application package per FDA/EMA ODD guidelines
- The tool is scoped as an eligibility-scoring and drafting assistant — the scientific rationale is reviewed and signed off by the Clinical Lead before submission

**FR-D-027 — Master Library Push at Final Output** *(MVP — Differentiator B3)*
At Stage 6 (after gateway ACK2 confirmation), the system creates tagged content cards for the Master Library:
- Approved dossier sections: CTD Module 2.5, 2.6, 2.7 by TA and submission type
- Approved SmPC/USPI label (base version and regional variants)
- Approved RMP/REMS core documents
- HA response templates (by question category)

Cards are tagged with: TA, module (D), project, submission type, HA target, submission date, approval status. Available for cross-module reuse — particularly relevant for subsequent submissions (line extensions, label updates, new indications).

---

## 7. Confirmed Differentiators (Protect — No New Build Without PRD Update)

| ID | Differentiator | Why It Matters |
|----|----------------|----------------|
| B2 | AI drafting of CTD Module 2 from Module A CSR data (FR-D-007) | All three RIM competitors manage and publish regulatory documents but do not draft CTD Module 2 summaries from upstream clinical data. Aurora does. |
| C2 | Cross-CTD-module automated consistency checking (FR-D-016) | PRD v4.1 §12.4 names this as a manual best practice. No competitor offers automated cross-module contradiction detection. Aurora makes it a hard gate. |
| A1 | Continuous eCTD publishing (FR-D-019) | Matches Veeva Vault RIM's Continuous Publishing capability — necessary to be competitive in the enterprise space. |
| C1 | AI-drafted HA response packages from LoQ (FR-D-022) | No competitor identified offers AI-drafted HA responses grounded in the original submission dossier data. |
| Cross-module | Single audit trail from CSR (Module A) through eCTD submission (Module D) | The only platform that traces regulatory submission content back to the clinical study data that generated it, under one 21 CFR Part 11-compliant audit trail. |

---

## 8. Non-Functional Requirements

### 8.1 Compliance & Audit — Maximum Strictness

- 21 CFR Part 11 compliant audit trail: immutable, timestamped, user-attributed record of every action across the entire dossier lifecycle.
- 21 CFR Part 312 (IND) and 21 CFR Part 314 (NDA): all submission content and transmission events logged.
- EU GMP Annex 11: computerised systems compliance for all electronic records.
- ICH M4E(R2): CTD structure compliance enforced by the document editor.
- GSPR/MDR/IVDR: CER-specific compliance tracking for medical device submissions.
- Audit trail must be exportable in a format acceptable for Health Authority inspection.

### 8.2 Security & Data Protection

- Same security posture as Modules A/B/C plus gateway credential management.
- Gateway credentials (FDA ESG, EMA CESP, CDSCO, MHRA) stored in an encrypted credential vault accessible only to Admin and eCTD Specialist roles.
- Unredacted dossier versions (containing PPD/CCI) are access-controlled to the Regulatory Writer and Reg Affairs Lead only — not accessible to downstream users.
- GDPR applies to any EU patient or investigator data present in Module 5 CSRs imported from Module A.

### 8.3 Performance

- Cross-module consistency check (FR-D-016): complete within 120 seconds for a full NDA/MAA dossier. *[Engineering flag: confirm feasibility with pre-indexed canonical JSON layer before sprint commitment.]*
- eCTD validation (FR-D-020): complete within 300 seconds for a full dossier package.
- AI Module 2 drafting (FR-D-007): section-level suggestions within 10 seconds.
- Aggregate safety report generation (FR-D-015): initial PSUR/PBRER draft within 60 seconds.
- Gateway submission (FR-D-021): transmission timeout 600 seconds; retry logic on network failure.

### 8.4 Token Cost Management

- The AI drafting of CTD Module 2 documents (FR-D-007) involves the longest documents in any module — Module 2.5 Clinical Overview can exceed 100 pages. Token usage is monitored per section and per submission. Admin-configurable budget alerts apply.
- Aggregate safety report generation (FR-D-015) may involve large safety database exports — token-efficient chunking strategy required in the implementation design.

### 8.5 Data Integrity

- Imported Module 5 CSRs from Module A are read-only in Module D — any edit requires a new version created in Module A first. This preserves the single source of truth in Module A.
- PPD/CCI redaction is irreversible after Stage 5 submission. Version history keeps the pre-redaction version under restricted access.

---

## 9. Data Model Stub

New entities required for Module D (extending Modules A/B/C data models):

| Entity | Key Fields | Notes |
|--------|-----------|-------|
| `regulatory_submission` | id, project_id, source_module_a_project_id, submission_type (ind/nda/maa/psur/pbrer/rmp/ha-response/cer/odd), status, stage (1–6), target_has (JSONB array), ectd_version (3.2.2/4.0), ta_tag | Core Module D entity |
| `ectd_granularity_map` | id, submission_id, module_section, section_title, status (received/in-authoring/in-review/signed/not-started), document_id (nullable), last_updated | Real-time dossier map |
| `cmc_readiness_report` | id, submission_id, completeness_pct, missing_items (JSONB), generated_at, acknowledged_by, acknowledged_at, risk_note | CMC completeness gate |
| `canonical_json_layer` | id, submission_id, source_doc_id, source_type (csr/ib/sap/tlf/cmc/nonclin), content (JSONB), version, indexed_at | Structured source data |
| `consistency_check_result` | id, submission_id, run_at, contradictions (JSONB — each with source, target, source_value, target_value, severity), passed | Cross-module consistency gate |
| `redaction_record` | id, submission_id, document_id, ppd_items (JSONB), cci_items (JSONB), confirmed_by, confirmed_at | PPD/CCI redaction audit |
| `ectd_validation_result` | id, submission_id, run_at, validator (extedo/lorenz), errors (JSONB), passed | eCTD validation gate |
| `gateway_submission` | id, submission_id, gateway (fda-esg/ema-cesp/cdsco/mhra), transmitted_at, ack1_at, ack2_at, ack3_at, nack_code (nullable), status | Gateway transmission record |
| `ha_correspondence` | id, submission_id, direction (inbound/outbound), type (loq/response/ack/approval/nack), content_summary, received_at, responded_at, loq_doc_id (nullable — FK to canonical_json_layer; set when direction=inbound and type=loq), response_doc_id (nullable) | HA communication log |
| `aggregate_safety_report` | id, submission_id, type (psur/pbrer/dsur), reference_period, data_sources (JSONB), draft_generated_at, pv_lead_signed_at | Safety report record |
| `regulatory_alert` | id, framework_name, change_summary, effective_date, affected_modules (JSONB), alerted_at, acknowledged_by_ids (JSONB) | Regulatory intelligence alert |
| `odd_assessment` | id, submission_id, prevalence_score, prevalence_meets_threshold, benefit_draft, clinical_lead_signed_at | Orphan Drug eligibility record |

---

## 10. Regulatory Framework Registry — Module D

Source: PRD v4.1 §11A.4

| Framework | Issuer | Version | Scope in Module D |
|-----------|--------|---------|-------------------|
| 21 CFR Part 11 — Electronic Records & Signatures | FDA (US) | Current | Mandatory — audit trail and digital signatures for all submission documents |
| 21 CFR Part 312 — IND Applications | FDA (US) | Current | IND submission requirements, amendments, safety reporting |
| 21 CFR Part 314 — NDA Applications | FDA (US) | Current | NDA submission requirements and format |
| ICH M4E(R2) — eCTD Common Technical Document | ICH | Jun 2022 | Mandatory — CTD structure, module organisation, submission format |
| ICH M2 — eCTD Specifications v3.2.2 / v4.0 | ICH | v3.2.2 current; v4.0 emerging | eCTD technical specification — Admin-selectable |
| ICH Q8, Q9, Q10, Q11 — CMC Quality Guidelines | ICH | Current | CMC data requirements for Module 3 |
| ICH S1–S9 — Nonclinical Safety Guidelines | ICH | Current | Nonclinical reporting requirements for Module 4 |
| EMA CHMP Guideline on Excipients | EMA | 2019 | Excipient disclosure requirements in EU SmPC |
| EU Regulation (EC) 726/2004 — Centralised Procedure | EMA/EU | 2004 (amended) | Centralised MAA and post-approval requirements |
| EU GMP Annex 11 | EMA/EU | Feb 2011 | Computerised systems; electronic records |
| GSPR — General Safety and Performance Requirements (MDR/IVDR) | EU | MDR 2017/745 / IVDR 2017/746 | CER requirements for medical devices |
| FDA 21 CFR Part 820 — Quality System Regulation | FDA (US) | Current (updated 2024) | Device quality and clinical evidence |
| EMA Guideline on SmPC | EMA | 2009 (updated) | SmPC structure and content |
| EMA Guideline on Package Leaflet (PIL) | EMA | 2009 (updated) | PIL structure and content |
| ICH E2C(R2) — PBRER | ICH | Nov 2012 | PSUR/PBRER structure and content |
| ICH E2F — Development Safety Update Report (DSUR) | ICH | Jul 2011 | DSUR structure and content — required for clinical trials in progress; referenced by FR-D-015 |
| ICH E2A — Clinical Safety Data Management | ICH | Oct 1994 | SAE reporting timelines and format |
| GDPR (EU) 2016/679 | EU | 2018 | Patient and investigator data in regulatory submissions |

---

## 11. Phase & Priority Plan

### Phase Assignment Legend

| Phase | Meaning |
|-------|---------|
| MVP | Required for v0.1 release |
| Phase 2 | Confirmed in scope, deferred |
| Backlog | Identified, not yet scoped |
| Out of Scope | Explicitly declined |

### Full FR List with Phase Assignments

| FR | Description | Phase | Source |
|----|-------------|-------|--------|
| FR-D-001 | Source document ingestion & canonical JSON layer | MVP | PRD v4.1 §5.4 Stage 1 |
| FR-D-002 | Regional submission strategy & country selector | MVP | PRD v4.1 §5.4 Stage 1 |
| FR-D-003 | AI-generated submission TOC & eCTD granularity map | MVP | Gap A2 |
| FR-D-004 | CMC data readiness scoring | MVP | Gap C3 |
| FR-D-005 | Mandatory TA tagging | MVP | PRD v4.1 §7.9 |
| FR-D-006 | CTD module structure enforcement | MVP | PRD v4.1 §5.4 Stage 2 |
| FR-D-007 | AI-assisted CTD Module 2 drafting | MVP | PRD v4.1 §5.4 Stage 2 + Gap B2 |
| FR-D-008 | SmPC/USPI label drafting | MVP | PRD v4.1 §5.4 Stage 3 |
| FR-D-009 | RMP/REMS authoring | MVP | PRD v4.1 §4.4, §5.4 Stage 3 |
| FR-D-010 | Regional administrative documents (Module 1) | MVP | PRD v4.1 §5.4 Stage 3 |
| FR-D-011 | Module 3 CMC finalisation | MVP | PRD v4.1 §5.4 Stage 3 |
| FR-D-012 | Module 4 nonclinical finalisation | MVP | PRD v4.1 §5.4 Stage 3 |
| FR-D-013 | Module 5 CSR integration from Module A | MVP | PRD v4.1 §5.4 Stage 3 |
| FR-D-014 | PPD/CCI anonymisation & redaction | MVP | PRD v4.1 §5.4 Stage 5 |
| FR-D-015 | Automated aggregate safety report generation | MVP | Gap A5 |
| FR-D-016 | Cross-CTD-module consistency check | MVP | PRD v4.1 §12.4 + Gap C2 |
| FR-D-017 | Multi-disciplinary Super Review (Stage 4) | MVP | PRD v4.1 §5.4 Stage 4 |
| FR-D-018 | RACI matrix — Module D 6 roles | MVP | PRD v4.1 §6.4 + RACI Chart 4 + Gap B4 |
| FR-D-019 | Continuous/automated eCTD publishing | MVP | Gap A1 |
| FR-D-020 | eCTD validation (EXTEDO/Lorenz) | MVP | PRD v4.1 §5.4 Stage 5 |
| FR-D-021 | Regulatory gateway submission (FDA/EMA/CDSCO/MHRA) | MVP | PRD v4.1 §5.4 Stage 6 |
| FR-D-022 | AI-drafted HA response packages from LoQ | MVP | Gap C1 |
| FR-D-023 | Predictive submission timeline & HA correspondence AI | MVP | Gap A3 |
| FR-D-024 | Live regulatory-guidance change monitor | MVP | Gap A4 |
| FR-D-025 | Cross-functional data sync triggers | MVP | Gap A6 |
| FR-D-026 | Orphan Drug eligibility tool | MVP | Gap C5 |
| FR-D-027 | Master Library push at Final Output | MVP | PRD v4.1 §5.4 Stage 6 + Gap B3 |
| — | IDMP/XEVMPD/SPOR product data management | **⚠ TBD** | Gap A7 (see OQ-D-001) |
| — | EXTEDO vendor scope expansion | **⚠ TBD** | Gap A8 (see OQ-D-002) |
| — | eCTD v3.2.2 → v4.0 automated migration | **⚠ TBD / Phase 2** | Gap C4 (see OQ-D-007) |
| — | Full RIM (registration/product lifecycle management) | **Out of Scope** | Not in PRD v4.1 scope |
| — | PV case management / signal detection | **Out of Scope** | Standalone PV system dependency |
| — | Market positioning analytics dashboard | **Backlog** | Pattern from Modules B/C/D |

**Total MVP FRs: 27**

---

## 12. Dependencies & Procurement Items

| Item | Type | Owner | Notes |
|------|------|-------|-------|
| EXTEDO EXTEDOpulse — eCTD validation | Already in PRD v4.1 §9.1 | Engineering | Primary validation engine. Already scoped as Admin-selectable validator. See OQ-D-002 regarding potential scope expansion. |
| Lorenz eCTD Publisher — eCTD validation | Already in PRD v4.1 §9.1 | Engineering | Alternative validation engine. Admin-selectable. |
| FDA ESG — Electronic Submissions Gateway | External API (PRD v4.1 §9.1) | Engineering | FDA gateway credentials. FDA requires a registered submitter account. |
| EMA CESP — Common European Submission Portal | External API (PRD v4.1 §9.1) | Engineering | EMA gateway credentials. Requires CESP account registration. |
| CDSCO — India submission gateway | External API (PRD v4.1 §9.1) | Engineering | CDSCO submission portal. Technical spec required. |
| MHRA — UK submission gateway | External API (NOT in PRD v4.1 §9.1) | Engineering | Not in PRD v4.1 External API Registry. Subject to OQ-D-008 resolution. API spec required if included. |
| Safety database export compatibility | Technical spec | Engineering | FR-D-015 requires importing Argus and ARISg line-listing exports. Format specs needed for both. |
| Regulatory intelligence data feeds | External data / API | Product | Required for FR-D-024. Options: manual monitoring with Admin update (MVP), or subscription to a regulatory intelligence feed (e.g., Thomson Reuters Regulatory Intelligence, Emergo by UL). Decision needed before sprint. |
| eCTD v4.0 specification | Technical spec | Engineering | Required for PMDA submissions (mandatory from April 2026) and EMA/Health Canada phased adoption. ICH M2 v4.0 spec is publicly available. |
| IDMP/SPOR data standards | Technical spec / Vendor | Product | Required if OQ-D-001 resolves to Include. IDMP specification is complex — EMA has tooling (SPOR API). Vendor options include EXTEDO (see OQ-D-002). |

---

## 13. Traceability

| FR | PRD v4.1 Source | Gap Analysis Row |
|----|----------------|-----------------|
| FR-D-001 | §5.4 Stage 1 — source data gathering | — |
| FR-D-002 | §5.4 Stage 1 — submission strategy, country selector | — |
| FR-D-003 | §5.4 Stage 1 — eCTD granularity map | A2 |
| FR-D-004 | §5.4 Stage 1 — CMC data ingestion | C3 |
| FR-D-005 | §7.9 mandatory TA tagging | — |
| FR-D-006 | §5.4 Stage 2 — CTD module authoring | — |
| FR-D-007 | §5.4 Stage 2 — Module 2 drafting; §7.2 AI auto-suggest | B2 |
| FR-D-008 | §5.4 Stage 3 — SmPC/USPI; §4.4 deliverables | — |
| FR-D-009 | §5.4 Stage 3 — RMP/REMS; §4.4 deliverables | — |
| FR-D-010 | §5.4 Stage 3 — Module 1 regional admin docs | — |
| FR-D-011 | §5.4 Stage 3 — Module 3 CMC; §4.4 deliverables | — |
| FR-D-012 | §5.4 Stage 3 — Module 4 nonclinical; §4.4 deliverables | — |
| FR-D-013 | §5.4 Stage 3 — Module 5 CSR integration | — |
| FR-D-014 | §5.4 Stage 5 — PPD/CCI redaction | — |
| FR-D-015 | §4.4 deliverables — PSURs/PBRERs | A5 |
| FR-D-016 | §12.4 best practice 3 — cross-module consistency | C2 |
| FR-D-017 | §5.4 Stage 4 — Super Review | — |
| FR-D-018 | §6.4 + RACI Chart 4 | B4 |
| FR-D-019 | §5.4 Stage 5 — eCTD compilation | A1 |
| FR-D-020 | §5.4 Stage 5 — eCTD validation; §9.1 EXTEDO/Lorenz | — |
| FR-D-021 | §5.4 Stage 6 — submission gateways; §7.8; §15 Issue 10 | — |
| FR-D-022 | §5.4 Stage 6 — HA LoQ responses; §4.4 deliverables | C1 |
| FR-D-023 | §5.4 Stage 6 — submission timeline | A3 |
| FR-D-024 | §7.7 Regulatory Intelligence & Compliance Appendix | A4 |
| FR-D-025 | §5.4 Stage 6 — cross-functional data sync | A6 |
| FR-D-026 | §4.4 deliverables — Orphan Drug Designation | C5 |
| FR-D-027 | §5.4 Stage 6 — Master Library push; §7.6 | B3 |

---

## 14. Open Questions Before Design Phase

| ID | Question | Source | Blocker? |
|----|----------|--------|----------|
| OQ-D-001 | **A7 — IDMP/XEVMPD/SPOR Product Data Management:** SME noted "not clear, need to understand this." IDMP (Identification of Medicinal Products) is the EMA's mandatory structured product-data standard. All three competitors (Veeva RIM Registrations, ArisGlobal IDMP module, EXTEDO MPDmanager) have first-class IDMP support. If Aurora is to compete in the enterprise EU regulatory space, IDMP compliance will eventually be required. Decision needed: (a) build IDMP support in Module D v0.1, (b) defer to Phase 2, (c) partner/integrate with EXTEDO's IDMP capability (links to OQ-D-002). | Gap A7 | **Yes — affects EU enterprise positioning** |
| OQ-D-002 | **A8 — EXTEDO Vendor Scope Expansion:** EXTEDO is already in PRD v4.1 §9.1 as an eCTD validation-checker. EXTEDO's actual platform covers IDMP, pharmacovigilance, labeling, and regulatory intelligence. Decision needed: deliberately keep EXTEDO narrow (validation only) or expand the vendor relationship to cover IDMP (OQ-D-001), labeling, and regulatory intelligence (FR-D-024) rather than building those in-house. This is a strategic build-vs-partner decision, not a feature gap. | Gap A8 + OQ-D-001 | **Yes — affects build scope of FR-D-024 and OQ-D-001** |
| OQ-D-003 | **B1 — Platform Scope Differentiator:** Same pattern as Module B OQ-B-001 and Module C OQ-C-003. Should the unified 5-module platform be explicitly called out in the Module D submission strategy UI at Stage 1? Affects the submission briefing screen design. | Gap B1 | No — design can proceed |
| OQ-D-004 | **B2 — AI Authoring Differentiator UI:** Should the fact that Aurora drafts CTD Module 2 from Module A CSR data be surfaced explicitly in the Module D onboarding and as a persistent provenance panel in the editor? This affects the AI Footprint panel design and the audit trail export format. | Gap B2 | No — design can proceed with FR-D-007 as specified |
| OQ-D-005 | **B3 — Master Library Continuity:** Same pattern as Module B OQ-B-002 and Module C OQ-C-004. Should the regulatory submission audit trail and the Master Library be surfaced as a unified cross-module regulatory record? Affects the Final Output screen design. | Gap B3 | No — design can proceed |
| OQ-D-006 | **B4 — RACI Enforcement Level:** Module D RACI (RACI Chart 4) is the most complex in the platform — six distinct expert roles, multiple concurrent workstreams, and the eCTD Specialist role is purely technical (not a writer). Should the RACI enforcement be tighter in Module D than in Modules A/B/C — for example, preventing any Stage 5 action without the eCTD Specialist role being explicitly assigned? | Gap B4 | No — design can proceed with FR-D-018 as specified |
| OQ-D-007 | **C4 — eCTD v3.2.2 → v4.0 Migration:** SME noted "needs to be reviewed, maybe Phase 2." PMDA already mandates v4.0 from April 2026. EMA and Health Canada are phasing in v4.0. Decision: (a) include an automated v3.2.2 → v4.0 structure remapper in v0.1 (complex), (b) support v4.0 for new submissions from v0.1 but do not auto-migrate existing v3.2.2 dossiers (simpler), (c) defer migration tooling entirely to Phase 2. Option (b) is recommended — v4.0 is already Admin-selectable per FR-D-002; the "migration" question is specifically about existing dossiers in v3.2.2 that need to be resubmitted in v4.0. | Gap C4 | **Yes — affects PMDA submission support** |
| OQ-D-008 | **MHRA Gateway — PRD v4.1 Internal Inconsistency:** PRD v4.1 §5.4 Stage 6 lists MHRA as a submission gateway, but MHRA has no entry in PRD v4.1 §9.1 External API Registry and was not included in the §15 Issue 10 priority resolution (FDA/EMA/CDSCO only). Decision: (a) formally add MHRA to the gateway priority list, procure MHRA gateway API credentials, and add to §9.1 — FR-D-021 is written to support this, (b) remove MHRA from Stage 6 wording and scope it as Phase 2. Post-Brexit, MHRA is increasingly important for UK submissions. Option (a) recommended. | PRD v4.1 §5.4 / §9.1 / §15 contradiction | **Yes — affects gateway procurement** |

---

## 15. Design Decisions Log

| ID | Decision | Rationale | Date |
|----|----------|-----------|------|
| DD-D-001 | Module 5 CSRs are imported read-only from Module A — not re-authored in Module D | Preserves Module A as the single source of truth for clinical data. Any CSR correction requires a new version in Module A, which triggers the cross-functional data sync (FR-D-025). Prevents data divergence between the regulatory submission and the source clinical record. | Sept 2026 |
| DD-D-002 | Cross-module consistency check (FR-D-016) is a hard gate — contradictions must be resolved before Stage 4 sign-off | PRD v4.1 §12.4 names consistency as a best practice. This PRD converts it to a hard gate — the most impactful differentiator in Module D. A contradiction between Module 2.5 and Module 5 TFLs in a submitted NDA/MAA can trigger a Day 120 question or refuse-to-file. The gate prevents this. | Sept 2026 |
| DD-D-003 | PPD/CCI redaction is irreversible after Stage 5 submission — pre-redaction version kept under restricted access | Once a dossier is submitted, the public copy cannot be un-redacted. The restricted pre-redaction version is retained for the lifetime of the submission record per 21 CFR Part 11 data retention requirements. | Sept 2026 |
| DD-D-004 | AI-drafted HA response packages (FR-D-022) are grounded in the same canonical JSON layer as the original submission — not re-derived from the PDF dossier | The canonical JSON layer (FR-D-001) contains structured, queryable representations of all source data. Grounding HA responses in this layer ensures consistency between the original submission and the response and enables citation-level traceability. | Sept 2026 |
| DD-D-005 | Regulatory Intelligence (FR-D-024) is designed as a cross-module shared service from the start, with Module D as the primary owner | The architecture flag in §5.4 recommends a single shared service rather than module-specific implementations. Starting with this design in Module D avoids a rewrite when Modules A/B/C need the same alerts. | Sept 2026 |
| DD-D-006 | PRD v4.1 §9.1 does not include MHRA gateway — FR-D-021 includes MHRA as Priority 4 | This PRD includes MHRA based on its explicit presence in PRD v4.1 §5.4 Stage 6. OQ-D-008 closed Sept 2026: MHRA included as Priority 4 gateway in prototype UI; API procurement required before production. This is no longer a design-phase blocker. | Sept 2026 |

---

## 16. Version History

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 0.2 | Sept 2026 | GenBioCa / Claude | Validation pass against PRD v4.1. 7 findings fixed: module colour corrected to Crimson #B0200D (was #D97706 amber — PRD v4.1 §3.3); FR-D-014 moved to Stage 5 §6.5 (was wrongly in Stage 3 §6.3); CTD Module 2 sections 2.1 and 2.2 added to Glossary and FR-D-006; FR-D-007 clarified that Module 2.6 uses nonclinical canonical JSON not Module A CSR; loq_doc_id added to ha_correspondence data entity; ICH E2F (DSUR) added to §10 Framework Registry; DD-D-006 updated to remove stale MHRA blocker (OQ-D-008 now closed); V-04 engineering flag added to §8.3 FR-D-016 performance target. |
| 0.1 | Sept 2026 | GenBioCa / Claude | First version. Built from PRD v4.1 Module D sections + gap analysis. 27 MVP FRs. 7 open SME decisions/questions (OQ-D-001 to OQ-D-008 includes the MHRA inconsistency finding). 3 gap analysis validation findings carried forward. Module A C3 cross-module correction noted. EXTEDO vendor scope question documented. MHRA gateway PRD inconsistency flagged and documented. |


---

## 17. Open Question Resolutions — v0.1 → v0.2

| OQ | Decision | Detail |
|----|----------|--------|
| OQ-D-001 | **Phase 2** | No pilot client. Prototype targets FDA/EMA core submission workflow only. IDMP/XEVMPD/SPOR deferred to Phase 2 when client need confirmed. |
| OQ-D-002 | **Keep EXTEDO narrow** | Validation-checker only for v0.1 as specified in PRD v4.1 §9.1. Scope expansion deferred to Phase 2 when client need confirmed. |
| OQ-D-003 | **Include (subtle)** | Compact source chip in submission strategy header at Stage 1. Consistent with Modules B/C. |
| OQ-D-004 | **Include (subtle)** | Provenance panel in CTD Module 2 editor: "Drafted from: VELORA-301 CSR v1.0 · Module A." Consistent with Modules B/C. |
| OQ-D-005 | **Include (Final Output only)** | Compliance Provenance section at Stage 6 post-gateway-submission. Consistent with Modules B/C. |
| OQ-D-006 | **Standard enforcement** | Same RACI enforcement as Modules A/B/C. eCTD Specialist assigned at project creation. No additional gate strictness for prototype. |
| OQ-D-007 | **Phase 2** | Prototype uses v3.2.2 as default. v4.0 Admin-selectable for new submissions per FR-D-002. Migration tooling (v3.2.2 → v4.0) deferred to Phase 2. |
| OQ-D-008 | **Include MHRA in prototype UI as Priority 4** | No live API needed for prototype. MHRA shown in gateway submission screen consistent with PRD v4.1 §5.4 Stage 6. Add to §9.1 note: "procure before production." |

**PRD D status after OQ resolution: all 8 open questions closed. Ready for Phase 3 — CD Design.**
