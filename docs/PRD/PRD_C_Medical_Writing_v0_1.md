# GenBioCa — AURORA
## PRD C — Medical Writing
### Version 0.1

**Platform name:** Aurora (placeholder — rebrand in progress. Shortlist: AXION, VERIDOC, SYNTHARA, CLARIVA, GENOVA)
**Tagline:** AI-Native Authoring for Life Sciences
**Module colour:** #7C3AED (Violet)

*Status: First draft — gap analysis complete, SME decisions incorporated, 6 open decisions flagged. Ready for design-phase scoping.*
*Classification: Confidential — Internal Use Only*
*Prepared: September 2026*

---

## 0. Document Control

| Field | Value |
|-------|-------|
| Document | PRD C — Medical Writing, v0.1 |
| Status | First draft. Built from PRD v4.1 Module C sections + competitor gap analysis (AURORA_ModuleC_Competitor_Analysis_and_Gaps.xlsx). 12 gap rows confirmed Include. 1 row Skip. 6 rows pending SME decision (B1–B5, C3). |
| Supersedes | — (first version) |
| Built From | PRD v4.1 §4.3, §5.3, §6.3, RACI Chart 3, §11A.3, §12.3 + Module C Competitor Gap Analysis v0.1 (Sept 2026) |
| Naming Note | Platform referred to as "Aurora" throughout (placeholder). Module C is the internal identifier — never shown in UI. |
| Dependency | Module C depends on Module A as primary upstream source of truth (CSR, SmPC/IB, clinical data). Module B publications may also serve as inputs to Module C content (slide decks, CME). |

---

## 0A. Gap Analysis Summary — Input to This PRD

**Source file:** AURORA_ModuleC_Competitor_Analysis_and_Gaps.xlsx
**Competitors reviewed:** Veeva Vault PromoMats + Falcon MLR, MACg (aingens), Within3
**Total gap rows:** 19 (9 Competitor Has/PRD Lacks · 5 Differentiators · 5 GAPs Missing Everywhere)

| ID | Area | Direction | Severity | SME Decision | Where in This PRD |
|----|------|-----------|----------|-------------|-------------------|
| A1 | MLR Review Automation — Pre-MLR Check | Competitor Has | Major | **Include** | FR-C-016 |
| A2 | MLR Review Automation — Agentic Layer | Competitor Has | Major | **Include** | FR-C-017 |
| A3 | Content Reuse — Claims Harvesting | Competitor Has | Medium | **Include** | FR-C-018 |
| A4 | Review Efficiency — Tier-Based Routing | Competitor Has | Medium | **Include** | FR-C-019 |
| A5 | KOL Advisory Board — Structured Platform | Competitor Has | Major | **Include** | FR-C-010 (Phase 2 candidate per SME) |
| A6 | KOL Advisory Board — AI Insights Analysis | Competitor Has | Medium | **Include** | FR-C-011 |
| A7 | Content Creation — Single AI Workspace | Competitor Has | Minor | **Skip** | Not included |
| A8 | Market Positioning / Efficiency Claims | Competitor Has | Minor | **Include** | Analytics dashboard (§11 Backlog) |
| A9 | Localisation / Multi-Language Translation | Competitor Has | Major | **Include** | FR-C-021 + OQ-C-001 (PRD contradiction) |
| B1 | Platform Scope — Unified 5-Module | Differentiator | Major | **⚠ TBD** | §14 Open Questions |
| B2 | Metadata Governance — TA + Master Library | Differentiator | Medium | **⚠ TBD** | §14 Open Questions |
| B3 | Roles & Governance — RACI | Differentiator | Medium | **⚠ TBD** | §14 Open Questions |
| B4 | Patient-Facing Content — FK Grade ≤8 Gate | Differentiator | Medium | **⚠ TBD** | §14 Open Questions |
| B5 | Compliance — 21 CFR Part 11 Native | Differentiator | Medium | **⚠ TBD** | §14 Open Questions |
| C1 | CME Compliance Automation — ACCME/EACCME | GAP | Major | **Include** | FR-C-020 |
| C2 | Health Economics Content Generation | GAP | Medium | **Include** | FR-C-014 |
| C3 | Claim Traceability — Machine-Verifiable | GAP | Major | **⚠ TBD** | §14 Open Questions (needs SME discussion) |
| C4 | Accessibility — WCAG 2.1 Automated Testing | GAP | Medium | **Include** | FR-C-022 |
| C5 | Patient Advocacy Input — Structured Mechanism | GAP | Minor | **Include** | FR-C-012 |

**SME notes captured:**
- A1/A2/A3/A4: "This will make it quite comprehensive, but we will end up creating an Armada" — acknowledged; each FR is scoped to a specific automation layer, not a full replication of Veeva's compliance suite
- A5: "What will this cost in terms of tokens, performance and increased complexity, will need more detailing and could be taken up for Phase 2" — included as FR-C-010 with explicit Phase 2 flag
- A7: Skipped — MACg's single-workspace positioning is a product marketing claim, not a missing feature. Aurora already covers all the listed content types as separate deliverables.
- A8: "We can have this as part of our dashboards" — analytics dashboard, Backlog
- A9: "This is for a large enterprise, we could view this as local instances, and then bring in flagged items into common shared document library" — included with a localisation strategy aligned to the SME's shared-library model. PRD contradiction (Stage 5 vs §13) flagged as OQ-C-001 and must be resolved before design.
- C3: "Will need to understand this in more detail, park this and will need a discussion with SME" — included as open question OQ-C-002
- C5: "Very different view" — included; the structured PAO feedback mechanism is scoped narrowly as a review annotation layer, not a full external portal

**Second-pass findings from gap analysis (carried forward):**
1. **PRD v4.1 internal contradiction — Stage 5 vs §13:** PRD v4.1 §5.3 Stage 5 requires multi-language translation and cultural adaptation as a Module C workflow activity. PRD v4.1 §13 states "English at launch; structured for translation in future releases." These are directly contradictory. This PRD includes localisation as FR-C-021 but flags it as OQ-C-001 — a blocker that must be resolved before the Stage 5 screen is designed.
2. **Cross-module traceability opportunity:** Claim-to-source anchoring (C3) echoes Module A's statement-level traceability (FR-A-001 family) and Module B's AI Footprint (FR-B-006). This may be a single shared platform capability worth building once and reusing across Modules A/B/C — flagged for architecture review in §5.4.

---

## 1. Purpose & Background

Aurora Module C — Medical Writing — is the medical affairs content authoring platform within the Aurora ecosystem. It transforms approved clinical data from Module A (CSR, SmPC/IB) and scientific publications from Module B into the full spectrum of medical affairs content: HCP slide decks, CME modules, patient information leaflets (PILs), disease dossiers, advisory board materials, medical information (MI) letters, health economic dossiers, and EU CTR plain language summaries.

Module C operates at the intersection of scientific accuracy, promotional compliance, and educational ethics — a more complex regulatory environment than either Module A (clinical data fidelity) or Module B (publication ethics). The MLR review gate is the centrepiece of every Module C workflow, and the pre-MLR automation layer (A1/A2) is the feature that will most directly determine Module C's competitive position against Veeva Vault PromoMats, which dominates this space in large pharma.

Three competitors were analysed: Veeva Vault PromoMats + Falcon MLR (dominant enterprise MLR platform), MACg (AI medical affairs content workspace), and Within3 (KOL/advisory board engagement platform). No single competitor covers the full Module C scope; Aurora's differentiator is the only platform that connects upstream clinical data (Module A CSR) and publications (Module B) directly into the medical affairs content workflow.

---

## 2. Scope

### 2.1 In Scope for v0.1 Build

- The full six-stage Module C workflow: Strategic Input & Briefing → Content Outlining & KOL Engagement → Content Creation (Drafting) → MLR Review → Formatting & Localisation → Final Output.
- All nine Module C deliverable families (from PRD v4.1 §4.3): Medical Information Letters, Drug Monographs/Disease Dossiers, PILs/Patient Journals, Medical Education Materials (slide decks, e-learning), Advisory Board Meeting Materials/Reports, CME Content, Medical Affairs Plans, Disease Awareness Materials, Health Economic/Outcomes Communication Materials.
- Mandatory TA tagging at all levels.
- Pre-MLR automated quality-check pass before formal review (A1).
- Agentic compliance layer for MLR-style self-review against approved labels (A2 — scoped as augmented AI assistance, not full autonomous approval).
- Automated claims harvesting and content-similarity detection (A3).
- Tier-based review routing based on content reuse vs new authoring (A4).
- KOL/advisory board session capture and AI-powered insights summarisation (A5 scope per SME: Phase 2 for full asynchronous platform; v0.1 includes structured meeting capture only — FR-C-010/FR-C-011).
- Structured Patient Advocacy Organisation (PAO) review annotation (C5 — FR-C-012).
- Health economic content generation from model outputs (C2 — FR-C-014).
- Flesch-Kincaid readability grade ≤8 enforcement on all patient-facing content (B4 — FR-C-006).
- Automated ACCME/EACCME independence and fair-balance verification for CME content (C1 — FR-C-020).
- Localisation workflow with shared Master Library model per SME direction (A9 — FR-C-021, subject to OQ-C-001 resolution).
- WCAG 2.1 automated accessibility testing at Stage 5 (C4 — FR-C-022).
- Pre-configured RACI matrix for the 6 Module C roles (B3 — FR-C-013).
- Master Library push at Final Output — tagged content cards by TA, project, channel (B2 — FR-C-023).
- 21 CFR Part 11 audit trail and e-signatures — same infrastructure as Modules A and B.

### 2.2 Explicitly Out of Scope for v0.1

- Full asynchronous virtual advisory board platform with 40+ engagement types, anonymised participant profiles, and in-platform translation (A5 full scope — Phase 2 per SME).
- Automated machine-verifiable claim-to-source anchoring (C3 — pending SME decision; see §14 OQ-C-002).
- Market positioning / efficiency analytics dashboard (A8 — Backlog).
- Single-content-workspace product positioning (A7 — Skipped; not a feature gap).
- Full journal portal API integrations (Module B scope, not Module C).
- Modules A, B, D, E in this document.

---

## 3. Goals

*The following four best practices from PRD v4.1 §12.3 are design principles for every Module C FR — not just suggestions:*
1. *All claims in HCP-facing materials must be substantiated by the approved product label or primary data.*
2. *Fair-balance is mandatory: all promotional-adjacent content must present risks alongside benefits.*
3. *Patient-facing content must be written at a Flesch-Kincaid reading grade of 8 or lower.*
4. *MLR review is mandatory before distribution of any external-facing content — the MLR gate must not be bypassed.*

- Enable a medical writer to take a Module A CSR and approved label and produce a full MLR-cleared medical affairs content package without leaving the Aurora platform.
- Build the pre-MLR automation layer that is Aurora's primary competitive weapon against Veeva Vault — Quick Check and agentic compliance, implemented as an AI assistance layer rather than a full autonomous approval engine in v0.1.
- Enforce content quality gates that no competitor currently enforces: Flesch-Kincaid ≤8 on patient-facing content, ACCME independence verification on CME content.
- Maintain the single audit trail from clinical data (Module A) through publication (Module B) through medical affairs content (Module C) — the only platform that does this natively.
- Ship a pilot-ready Module C that a medical affairs team can use end-to-end through all six workflow stages.

---

## 4. Glossary

| Term | Definition |
|------|-----------|
| MLR | Medical-Legal-Regulatory review — the cross-functional compliance gate for all external-facing content |
| PIL | Patient Information Leaflet — patient-facing approved label summary |
| PLS | Plain Language Summary — lay summary of a clinical trial (EU CTR requirement) |
| CME/CPD | Continuing Medical Education / Continuing Professional Development |
| ACCME | Accreditation Council for Continuing Medical Education (US) |
| EACCME | European Accreditation Council for CME |
| HCP | Healthcare Professional |
| KOL | Key Opinion Leader |
| PAO | Patient Advocacy Organisation |
| MI | Medical Information — responses to unsolicited healthcare professional queries |
| MLR | Medical-Legal-Regulatory review |
| HEOR | Health Economics and Outcomes Research |
| GVD | Global Value Dossier |
| AMCP | Academy of Managed Care Pharmacy — GVD format standard |
| FK | Flesch-Kincaid readability scoring |
| DAM | Digital Asset Management |
| SmPC | Summary of Product Characteristics (EU) |
| USPI | US Prescribing Information |
| IFPMA | International Federation of Pharmaceutical Manufacturers & Associations |
| EFPIA | European Federation of Pharmaceutical Industries and Associations |
| ABPI | Association of the British Pharmaceutical Industry |
| PhRMA | Pharmaceutical Research and Manufacturers of America |
| EU CTR | EU Clinical Trials Regulation (EU No 536/2014) — requires plain language summaries |
| FR-C-### | Functional Requirement identifier, Module C scope |

---

## 5. Architecture Context

### 5.1 Module Dependency

Module C is downstream of both Module A and Module B. The data flow is:

```
Module A (CSR / SmPC/IB / Clinical Data)
         ↓
Module B (Manuscripts / Publications)  ──┐
         ↓                               │
Module C (HCP Decks / CME / PILs / MI)  ←┘
         ↓
Master Library (tagged content cards — TA, project, channel)
```

A Module C project must link to a Module A project at creation. The CSR and approved regulatory labels (SmPC/USPI/IB) from the linked Module A project are available as read-only source documents inside the Module C editor. Module B publication outputs (manuscripts, abstracts) may optionally be linked as additional source documents for content that references published data.

### 5.2 Architecture Rules (same four discipline rules as Modules A and B)

1. **Module boundary enforcement:** Module C components must not import directly from Module A or Module B components. Cross-module data flows through the platform interface layer only.
2. **Audit trail first:** Every content change, AI action, reviewer decision, and approval event is written to the audit trail before the UI updates.
3. **Human sign-off required:** The MLR gate is never automated to the point of autonomous approval. AI assists; the MLR Review Team signs.
4. **TA tag mandatory:** Every project, content item, and Master Library card must carry a TA tag before it can be saved.

### 5.3 Shared Infrastructure

Module C reuses the following from the platform:
- Authentication, MFA, Terms Gate, AppShell (Modules A/B Sessions 4–7)
- Document Editor core (Module A Session 11) — adapted for multi-format content (slides, MI letters, PILs)
- Review Assignment Panel (Module A Session 15)
- CRM Module (Module A Session 18) — repurposed as MLR resolution meeting
- Comment Resolution Panel (Module A Session 19)
- E-Signature (Module A Session 20)
- Audit Trail Panel (Module A Session 14)
- Voice Note Panel (Module A Session 12) — used for KOL session capture
- Master Library push (§7.6 platform feature)

Module C adds new screens and panels for: Content Briefing & Scope Matrix, KOL Advisory Board Session, Pre-MLR Check Panel, Agentic MLR Review Panel, Claims Matrix Panel, Tier-Based Routing Indicator, FK Readability Panel, HEOR Content Generator, Localisation Workflow, WCAG Accessibility Checker.

### 5.4 Architecture Flag: Cross-Module Claim Traceability

The gap analysis second pass identified that claim-to-source anchoring (C3) is the same underlying capability as Module A's statement-level TLF traceability (FR-A-001 family) and Module B's AI Footprint (FR-B-006). Before Module C design begins, the architecture team should evaluate whether a single shared "Source Anchor" service can serve all three modules, rather than three separate implementations. This is flagged here but not yet an FR — it requires an architecture decision first.

---

## 6. Functional Requirements

### 6.1 Strategic Input & Briefing (Stage 1)

**FR-C-001 — Content Scope Matrix & Compliance Track Selection** *(MVP)*
At Stage 1, the system generates a content scope matrix from the following required inputs (per PRD v4.1 §5.3 Stage 1): CSR, approved SmPC/USPI, Brand Strategy/Medical Affairs Plan, Market Research, and Target Audience Personas. The matrix covers:
- Audience definition: HCP vs. Patient/Caregiver vs. Both
- Content type selection from the 9 Module C deliverable families
- Compliance track selection: Independent Education (ACCME/EACCME path) vs. Commercial/Brand (MLR/PhRMA/ABPI/EFPIA path)

The compliance track selection at Stage 1 determines which regulatory frameworks are applied throughout the workflow. ACCME track → FR-C-020 ACCME gate activates. MLR track → FR-C-016/FR-C-017 pre-MLR and agentic MLR checks activate. Both tracks are mutually exclusive per content item; a single piece cannot be ACCME-independent and commercially promoted simultaneously.

**FR-C-002 — Source Document Linkage** *(MVP)*
Every Module C project links to a Module A project at creation. The following documents are surfaced as read-only inside the Module C editor:
- CSR (or CSR synopsis)
- Approved SmPC/USPI
- Investigator's Brochure (IB)
- Clinical Trial Registration (NCT/EudraCT ID)

Optionally, Module B manuscript outputs may be linked as additional source documents. All content statements that reference these source documents are tagged in the audit trail.

**FR-C-003 — Medical Affairs Plan & Publication Plan Creation** *(MVP)*
The system enables creation of a structured Medical Affairs Plan and Publication Plan covering: strategic objectives, evidence generation gaps, target audience segments, content calendar milestones, regulatory market mapping, and TA tag. Both plans are versioned and stored in the project record.

**FR-C-004 — Mandatory TA Tagging** *(MVP)*
Same as Module A and B. Every project, content item, section, and Master Library card must carry a mandatory TA tag before saving. Enforced at creation and every stage gate.

---

### 6.2 Content Outlining & KOL Engagement (Stage 2)

**FR-C-005 — KOL/Advisory Board Meeting Capture** *(MVP — Stage 2 scope of A5)*
The system provides structured tooling for capturing KOL advisory board sessions:
- Pre-meeting: pre-read document upload, agenda creation, attendee/KOL list with GDPR consent flag
- During meeting: structured note-taking template aligned to the content outline, voice note capture (using Module A Voice Note Panel infrastructure)
- Post-meeting: transcript upload and voice-note-to-text conversion, synthesis into a KOL Insights Report

This is the v0.1 scope of A5. The full asynchronous advisory board platform with anonymised profiles and 40+ engagement types is Phase 2. SME note: "could be taken up for Phase 2."

**FR-C-006 — Scientific Messaging Framework** *(MVP)*
After the KOL session, the system generates a structured scientific messaging framework: key claims, evidence base (linked to source documents from FR-C-002), target audience per claim, and claim approval status. This framework is the source of truth for all content drafted in Stage 3 and is referenced by the Claims Matrix Panel in Stage 4.

---

### 6.3 Content Creation — Drafting (Stage 3)

**FR-C-007 — Multi-Format Document Editor (Module C Variant)** *(MVP)*
The Module C document editor supports five content formats, each with format-specific structure enforcement:
- **HCP Slide Deck:** slide-by-slide editor with claim tracking per slide
- **MI Response Letter:** structured sections (question, answer, evidence summary, references)
- **PIL/Patient Journal:** patient-facing format with inline FK readability scoring
- **CME Module:** ACCME-compliant structure (learning objectives, content, assessment questions, disclosures)
- **Disease Dossier / GVD:** AMCP dossier format structure (clinical overview, HEOR, budget impact)
- **EU CTR PLS:** Plain Language Summary template per EU CTR requirements
- **Advisory Board Report:** structured output from KOL session capture

**FR-C-008 — AI Auto-Suggest (Module C Variant)** *(MVP)*
AI auto-suggest in the Module C editor is grounded in the linked source documents (CSR, SmPC, publications). Module C-specific system prompts enforce:
- Claim-to-label grounding: suggestions reference approved label language
- Fair-balance by default: every efficacy claim is accompanied by a safety qualifier
- Audience-appropriate language: HCP content uses clinical terminology; patient-facing content uses lay language at FK ≤8

**FR-C-009 — Flesch-Kincaid Readability Enforcement** *(MVP — Differentiator B4)*
For all patient-facing content (PILs, patient journals, patient disease awareness materials):
- The editor shows a live FK readability score in the panel sidebar, updated paragraph by paragraph
- A Stage 3 gate check requires FK grade ≤8 before content can proceed to Stage 4
- Content above FK grade 8 is highlighted in amber; above grade 10 in red
- The gate is hard: content above FK ≤8 cannot be submitted for MLR review

PRD v4.1 §12.3 best practice: "patient-facing content must be written at a Flesch-Kincaid reading grade of 8 or lower." This PRD implements that best practice as a hard gate, not a style suggestion — differentiating Aurora from all three competitors analysed.

**FR-C-010 — Health Economics & HEOR Content Generation** *(MVP — Gap C2)*
For Disease Dossier and HEOR communication materials:
- The system ingests health economic model outputs (cost-effectiveness model tables, budget-impact model outputs) uploaded by the author
- AI generates draft HEOR narrative sections directly from the model data: cost-per-QALY interpretation, budget-impact projection narrative, comparator summary
- All AI-generated HEOR narrative is marked with the AI Footprint indicator (same as Module B FR-B-006)
- The Biostatistician role (Consulted in RACI) must verify the HEOR narrative against the source model before Stage 4

**FR-C-011 — KOL Advisory Board AI Insights Summarisation** *(MVP — Gap A6)*
After the advisory board session capture (FR-C-005):
- The system generates an AI-powered KOL Insights Report from the session transcript and voice notes
- Structured output: key themes, unmet need statements, clinical evidence gaps, competitive landscape observations, KOL quotations (with KOL approval flag required before quoting)
- Report is version-controlled and stored against the project record
- The 90% reduction in reporting time claimed by Within3 is the benchmark target; Aurora's advantage is that the insights report is generated inside the same platform that holds the clinical source data

**FR-C-012 — Patient Advocacy Organisation (PAO) Review Annotation** *(MVP — Gap C5)*
For patient-facing content (PILs, patient journals, disease awareness materials):
- A dedicated PAO Reviewer role is assigned at Stage 3 via the RACI matrix
- The PAO reviewer accesses a reviewer-specific view of the document (same infrastructure as Module A Reviewer View — Session 16)
- PAO reviewers can annotate for: readability feedback, empathy and tone, cultural sensitivity, accessibility concerns
- PAO annotations are tracked separately from MLR comments in the comment stream
- SME note: "very different view" — PAO input is scoped as an annotation layer, not a formal approval gate in v0.1

---

### 6.4 MLR Review (Stage 4)

**FR-C-013 — RACI Matrix — Module C Roles** *(MVP — Differentiator B3)*
Pre-configured RACI for Module C — six roles, Admin-editable only:

| Role | Primary Responsibility |
|------|----------------------|
| Medical Writer (Broad/Med Comms) | Drafts all content formats; manages KOL input; ensures structural compliance |
| Medical Director/Medical Affairs Lead | Strategic oversight; approves final materials |
| MLR Review Team | Mandatory compliance review; claim substantiation; fair-balance; removes promotional language |
| KOLs/Advisory Board | Clinical accuracy review; CME faculty |
| Patient Advocacy Group/Patient Reviewer | Patient-facing language; readability; cultural sensitivity |
| CME Accreditor (External) | Approves CME/CPD content for ACCME/EACCME accreditation |

RACI Chart 3 from PRD v4.1 is the authoritative source for task-level R/A/C/I assignments.

**FR-C-014 — Claims Matrix** *(MVP)*
The system maintains a Claims Matrix for every content item, automatically populated during drafting:
- Every substantive claim extracted from the draft
- Source citation for each claim (SmPC section, CSR section, publication reference)
- Approval status: approved / modified from approved / new/unvetted
- MLR reviewer assignment per claim

The Claims Matrix is surfaced as a panel in the Stage 4 MLR review view and is the primary reference for the claim-to-source verification step required by PRD v4.1 §5.3 Stage 4.

**FR-C-015 — Pre-MLR Automated Quality-Check Pass** *(MVP — Gap A1)*
Before content reaches the formal MLR Review Team, an automated pre-MLR quality-check layer runs:
- **Editorial checks:** spelling, grammar, sentence structure, reading level (FK score)
- **Brand compliance checks:** terminology against approved brand glossary, logo/mark usage
- **Claims checks:** identification of unsubstantiated comparative claims, superlatives, and efficacy-only statements without safety context
- **Channel compliance checks:** format rules for digital vs print vs HCP vs patient channel

Each issue is categorised as: Must Fix (blocks MLR submission) / Should Fix (advisory) / Note (information only). The pre-MLR check must pass (zero Must Fix issues) before the document can be submitted to the MLR Review Team. This is the equivalent of Veeva Vault PromoMats' Quick Check Agent. SME note: "this will make it quite comprehensive."

**FR-C-016 — Agentic MLR Compliance Layer** *(MVP — Gap A2)*
Once pre-MLR checks pass, an agentic AI layer performs a deeper compliance review before the content reaches the human MLR reviewers:
- Checks every claim against the linked approved label (SmPC/USPI) for on-label vs off-label status
- Flags language that overstates efficacy vs label wording
- Checks IFPMA/EFPIA/ABPI/PhRMA code compliance per the compliance track selected in Stage 1
- Generates a structured MLR Pre-Review Report with findings categorised by severity

The agentic layer is advisory — it produces a report that the human MLR Review Team uses as their primary working document. It does not approve content autonomously in v0.1. This is analogous to Veeva's Falcon MLR direction but scoped to augmented assistance rather than autonomous approval. SME note: "this will make it quite comprehensive, but we will end up creating an Armada" — the agentic layer is designed as a single AI call with a structured prompt, not a multi-agent orchestration system.

**FR-C-017 — Tier-Based Review Routing** *(MVP — Gap A4)*
The system classifies each document into a review tier based on the proportion of reused vs new content:
- **Tier 1 (Expedited):** ≥80% pre-approved/reused claims from the Claims Matrix → abbreviated MLR review checklist
- **Tier 2 (Standard):** 40–80% reused claims → standard MLR review workflow
- **Tier 3 (Full):** <40% reused claims or any new clinical data → full MLR review with all reviewers

The tier is calculated automatically from the Claims Matrix. Tier assignment is shown to the Publication Manager and MLR Review Team before review begins. The tier can be manually overridden by the MLR Review Team Lead (with audit record). This directly targets the 50–75% faster approval time claimed by Veeva PromoMats.

**FR-C-018 — Claims Harvesting & Content Similarity Detection** *(MVP — Gap A3)*
During authoring and at Stage 4, the system:
- Automatically extracts all substantive claims from the draft into the Claims Matrix (FR-C-014)
- Compares each new claim against the existing approved claims library (content stored in the Master Library from prior approved documents)
- Flags near-duplicate claims (≥80% text similarity) with a "reuse approved claim" suggestion
- Flags novel claims with no approved equivalent as requiring full MLR attention

This surfaces pre-approved claims during drafting, reducing the amount of new claim creation and accelerating MLR review. SME note: "this will make it quite comprehensive."

**FR-C-019 — ACCME/EACCME Independence Verification for CME** *(MVP — Gap C1)*
For content on the ACCME/EACCME compliance track (selected at Stage 1):
- The system enforces a dedicated CME compliance checklist at Stage 4 separate from the standard MLR gate:
  - Commercial support disclosure (must be identified; no control of content by supporter)
  - Faculty financial disclosure (all planners and faculty must disclose)
  - Independence statement (content not influenced by commercial interest)
  - Fair-balance in educational content (risks and benefits presented equally)
  - ACCME Standards for Integrity & Independence (2022) compliance

These checks are run by the CME Accreditor (External) role, not the MLR Review Team. The ACCME gate and the MLR gate are separate review paths that may run in parallel depending on content type. This is a differentiating feature: no competitor analysed has ACCME-specific automation built into a medical writing platform.

---

### 6.5 Formatting & Localisation (Stage 5)

**FR-C-020 — Multi-Format Output & Digital Channel Tagging** *(MVP)*
At Stage 5, the system formats the MLR-approved content for its intended channel:
- PDF for print distribution (HCP slide decks, PILs, disease dossiers)
- HTML for digital/web distribution
- PPTX for slide decks
- MP4/SCORM package for e-learning modules (stub — full LMS integration Phase 2)
- EU CTR PLS PDF per regulatory requirements

All formatted outputs are tagged with channel metadata (print/digital/HCP/patient/congress) before distribution.

**FR-C-021 — Localisation Workflow** *(MVP — Gap A9, subject to OQ-C-001)*
A localisation workflow is included subject to resolution of OQ-C-001 (see §14 — PRD v4.1 internal contradiction between Stage 5 requirement and §13 English-only launch scope).

Assuming OQ-C-001 is resolved to include localisation:
- MLR-approved content is packaged as a localisation source package with all claim-source anchors intact
- Country affiliate teams receive the package and add local translation/adaptation
- Translated versions are subject to a local MLR sign-off (separate sign-off chain per country)
- All localised versions are stored under the parent content item with language tag
- Per SME direction: localised versions are not standalone — they reference back to the approved parent and push tagged localised cards to the shared Master Library

Note: A translation-service API (e.g., DeepL, Google Translate) is not in PRD v4.1 §9.1. If automated machine translation is required (not just human translation workflow support), a translation API must be procured. See §12.

**FR-C-022 — WCAG 2.1 Automated Accessibility Testing** *(MVP — Gap C4)*
At Stage 5, before final formatting approval:
- The system runs automated WCAG 2.1 Level AA accessibility tests on all digital outputs
- Tests cover: colour contrast ratio, alt text on all images and charts, keyboard navigation, screen-reader compatibility, heading structure
- Results are displayed as a pass/fail checklist with specific fixes required for each failure
- Digital outputs must pass WCAG 2.1 AA before they can proceed to Stage 6 Final Output
- All accessibility test results are logged to the audit trail

PRD v4.1 §5.3 Stage 5 explicitly requires "test WCAG 2.1 accessibility" — this FR implements it as an automated gate rather than a manual step.

---

### 6.6 Final Output (Stage 6)

**FR-C-023 — Final Local MLR Sign-Off & E-Signature** *(MVP)*
The Final Output stage requires a signed local MLR sign-off — a named e-signature from the Medical Director/MA Lead and the MLR Review Team Lead, with meaning: "I approve this content for external distribution." Same e-signature infrastructure as Modules A and B. For localised versions, a separate local sign-off is required per country.

**FR-C-024 — Multi-Channel Distribution** *(MVP)*
After final sign-off, the system packages content for distribution:
- Direct download of formatted outputs (PDF, PPTX, HTML)
- CRM/Rep portal export stub (Phase 2 — Veeva CRM, Salesforce Health Cloud connectors)
- Email distribution to named recipients with delivery tracking
- Congress submission export (formatted abstract/poster per congress spec)

**FR-C-025 — Master Library Push at Final Output** *(MVP — Differentiator B2)*
At Stage 6, the system creates tagged content cards for the Master Library from:
- Approved claim statements (by TA, product, evidence level)
- Key slides from approved HCP decks (by slide theme and audience)
- Approved MI response paragraphs (by query category)
- CME module sections (by learning objective)

Cards are tagged with: TA, module (C), project, content type, channel, approval date, and expiry date. Available for cross-module reuse in Module D (regulatory submissions citing medical affairs evidence) and Module E (ideation). SME note: "We need this — TA-specific focus" (from Module B, applies equally here).

**FR-C-026 — Content Expiry & Review Cadence** *(MVP)*
All approved content items carry an expiry date (configurable, default 24 months from approval date). The system:
- Alerts the Medical Writer and Medical Director 60 days before expiry
- Marks expired content in the Master Library with an "Expired — Review Required" flag
- Blocks re-use of expired content cards in new documents until reviewed and re-approved

This is a Module C-specific requirement not present in Modules A or B — approved promotional/medical content has a regulatory shelf-life linked to the product label version.

---

## 7. Confirmed Differentiators (Protect — No New Build Without PRD Update)

| ID | Differentiator | Why It Matters |
|----|----------------|----------------|
| B4 | FK Grade ≤8 hard gate on patient-facing content (FR-C-009) | No competitor enforces this as a gate. Veeva PromoMats does not check readability. MACg does not check readability. Within3 is a KOL platform. Aurora is the only platform that blocks patient-facing content above FK ≤8 from reaching MLR. |
| C1 | ACCME/EACCME independence verification automation (FR-C-019) | No competitor offers ACCME-specific compliance automation inside a medical writing platform. |
| A9 (Aurora approach) | Localisation via shared Master Library model (FR-C-021) | Rather than a standalone localisation tool, Aurora's model pushes parent-approved content to the shared library and routes country affiliate adaptation through a local MLR sign-off chain — maintaining the single audit trail. |
| B3 | RACI-enforced 6-role workflow (FR-C-013) | PRD-specified and platform-enforced RACI matrix, not a guidelines document. Admin-editable only. |
| Cross-module | Single audit trail from CSR (Module A) through MLR-approved content (Module C) | No competitor connects clinical trial data directly to medical affairs content in one platform. |

---

## 8. Non-Functional Requirements

### 8.1 Compliance & Audit

- 21 CFR Part 11 compliant audit trail: every content change, AI action, pre-MLR check result, MLR review decision, and distribution event is immutably logged.
- IFPMA/EFPIA/ABPI/PhRMA code compliance evidence: the audit trail constitutes a compliance record for all promotional content reviews.
- ACCME Standards for Integrity & Independence (2022): CME content review chain is logged separately from the MLR chain and available for ACCME audit.
- EU CTR (EU No 536/2014) Annex V: PLS content review and approval is logged in the audit trail.

### 8.2 Security & Data Protection

- Same security posture as Modules A and B: AES-256 at rest, TLS 1.3 in transit, MFA enforced.
- KOL and Medical Affairs team contact details (name, email, mobile) are personal data under GDPR — stored with explicit consent record (PRD v4.1 §13.4).
- Patient data in PILs: content-level data is approved label text (public), not patient-specific — no BAA requirement. However, patient eCRF data used in case report PILs triggers the same BAA posture as Module B FR-B-025.
- GDPR: voice note recordings from KOL sessions are stored per Admin-configured data residency and retention policy (PRD v4.1 §13.4).

### 8.3 Performance

- Pre-MLR check (FR-C-015): all checks complete within 45 seconds for documents up to 10,000 words.
- Agentic MLR layer (FR-C-016): MLR Pre-Review Report generated within 90 seconds.
- AI auto-suggest: < 5 seconds (same as Modules A/B).
- FK readability scoring: real-time, < 500ms per paragraph update.
- WCAG accessibility test (FR-C-022): < 60 seconds per formatted output.

### 8.4 Token Cost Management

- The pre-MLR check (FR-C-015) and agentic MLR layer (FR-C-016) are the most token-intensive operations in Module C. Combined, they run on every document at Stage 4. Token budget monitoring and Admin-configurable alerts apply (same as Module B FR-B-*** note on token costs).
- SME note (A1/A2): "will end up creating an Armada" — the pre-MLR and agentic layers are scoped as single structured AI calls with defined output schemas, not multi-agent orchestrations.

### 8.5 Accessibility

- All Aurora platform UI: WCAG 2.2 AA (same as Modules A/B).
- All Module C content outputs: WCAG 2.1 AA enforced by FR-C-022.

---

## 9. Data Model Stub

New entities required for Module C (extending Modules A and B data models):

| Entity | Key Fields | Notes |
|--------|-----------|-------|
| `med_content_item` | id, project_id, source_module_a_project_id, source_module_b_publication_id (nullable), type (hcp-deck/mi-letter/pil/cme/disease-dossier/pls/advisory-report/med-affairs-plan/heor), status, stage (1–6), compliance_track (accme/mlr), ta_tag, version, expiry_date | Core Module C entity |
| `claims_matrix` | id, content_item_id, claim_text, source_ref, source_type (smpc/csr/publication/label), approval_status (approved/modified/new), reviewer_id | Claim-by-claim tracking |
| `pre_mlr_check_result` | id, content_item_id, run_at, must_fix_count, should_fix_count, note_count, issues (JSONB), passed | Pre-MLR check output |
| `agentic_mlr_report` | id, content_item_id, run_at, findings (JSONB — claim, status, label_ref, severity), passed_to_mlr_team_at | Agentic compliance layer output |
| `review_tier` | id, content_item_id, tier (1/2/3), reuse_pct, calculated_at, overridden_by, override_reason | Tier-based routing |
| `fk_score_record` | id, content_item_id, section_id, score, calculated_at, passed (score <= 8) | Readability gate record |
| `accme_checklist` | id, content_item_id, items (JSONB), completed_by_accreditor, completed_at | CME accreditation gate |
| `kol_session` | id, content_item_id, date, attendees (JSONB), transcript, voice_note_ids (JSONB), insights_report | Advisory board session record |
| `localised_version` | id, parent_content_item_id, language_code, country_code, local_mlr_sign_off_id, status | Localised content version |
| `wcag_test_result` | id, content_item_id, format, run_at, failures (JSONB), passed | Accessibility gate record |
| `content_expiry` | id, content_item_id, expiry_date, alert_60d_sent_at, alert_30d_sent_at, expired | Expiry tracking |

---

## 10. Regulatory Framework Registry — Module C

Source: PRD v4.1 §11A.3

| Framework | Issuer | Version | Scope in Module C |
|-----------|--------|---------|-------------------|
| ACCME Standards for Integrity & Independence in CME | ACCME | 2022 | Mandatory — independence, fair-balance, and disclosure in CME/CPD content (FR-C-019) |
| OIG Compliance Program Guidance | OIG (US) | 2003 (updated) | Anti-kickback and promotional compliance for HCP materials |
| ABPI Code of Practice | ABPI (UK) | 2023 | UK promotional materials compliance and fair-balance |
| EFPIA Code on Promotion of Medicines | EFPIA (EU) | 2022 | EU promotional materials compliance |
| PhRMA Code on Interactions with HCPs | PhRMA (US) | 2022 | US HCP engagement and materials compliance |
| FDA Guidance — Promoting Medical Products Online | FDA (US) | 2014 | Digital and social media medical communications |
| FDA Guidance — Responding to Unsolicited Requests | FDA (US) | 2012 | Medical information response compliance |
| EU Falsified Medicines Directive 2011/62/EU | EMA/EU | 2019 | Patient-facing materials safety and traceability |
| Flesch-Kincaid Readability Standard (Grade ≤8) | Applied Linguistics | — | Mandatory gate for all patient-facing content (FR-C-009) |
| 21 CFR Part 11 | FDA (US) | Current | Electronic records for MLR-reviewed and approved materials |
| GDPR (EU) 2016/679 | EU | 2018 | Patient data, KOL contact data, voice recordings |
| EU CTR (EU No 536/2014) Annex V | EU | 2022 | Plain Language Summary requirements |
| WCAG 2.1 Level AA | W3C | 2018 | Digital content accessibility (FR-C-022) |

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
| FR-C-001 | Content scope matrix & compliance track selection | MVP | PRD v4.1 §5.3 Stage 1 |
| FR-C-002 | Source document linkage (Module A CSR/SmPC/IB) | MVP | PRD v4.1 §3.1, §5.3 Stage 1 |
| FR-C-003 | Medical Affairs Plan & Publication Plan creation | MVP | PRD v4.1 §4.3, §5.3 Stage 1 |
| FR-C-004 | Mandatory TA tagging | MVP | PRD v4.1 §7.9 |
| FR-C-005 | KOL/advisory board session capture (v0.1 scope) | MVP | PRD v4.1 §5.3 Stage 2 |
| FR-C-006 | Scientific messaging framework | MVP | PRD v4.1 §5.3 Stage 2 |
| FR-C-007 | Multi-format document editor | MVP | PRD v4.1 §5.3 Stage 3 |
| FR-C-008 | AI auto-suggest (Module C variant) | MVP | PRD v4.1 §7.2 |
| FR-C-009 | FK readability ≤8 hard gate | MVP | PRD v4.1 §12.3 + Gap B4 |
| FR-C-010 | HEOR content generation | MVP | Gap C2 |
| FR-C-011 | KOL insights summarisation | MVP | Gap A6 |
| FR-C-012 | PAO review annotation | MVP | Gap C5 |
| FR-C-013 | RACI matrix — Module C 6 roles | MVP | PRD v4.1 §6.3 + RACI Chart 3 + Gap B3 |
| FR-C-014 | Claims matrix | MVP | PRD v4.1 §5.3 Stage 4 |
| FR-C-015 | Pre-MLR automated quality-check pass | MVP | Gap A1 |
| FR-C-016 | Agentic MLR compliance layer | MVP | Gap A2 |
| FR-C-017 | Tier-based review routing | MVP | Gap A4 |
| FR-C-018 | Claims harvesting & content-similarity detection | MVP | Gap A3 |
| FR-C-019 | ACCME/EACCME independence verification | MVP | Gap C1 |
| FR-C-020 | Multi-format output & digital channel tagging | MVP | PRD v4.1 §5.3 Stage 5 |
| FR-C-021 | Localisation workflow | MVP (subject to OQ-C-001) | Gap A9 |
| FR-C-022 | WCAG 2.1 automated accessibility testing | MVP | PRD v4.1 §5.3 Stage 5 + Gap C4 |
| FR-C-023 | Final local MLR sign-off & e-signature | MVP | PRD v4.1 §5.3 Stage 6 |
| FR-C-024 | Multi-channel distribution | MVP | PRD v4.1 §5.3 Stage 6 |
| FR-C-025 | Master Library push at Final Output | MVP | PRD v4.1 §5.3 Stage 6 + Gap B2 |
| FR-C-026 | Content expiry & review cadence | MVP | Module C-specific operational requirement |
| — | Full async virtual advisory board (40+ engagement types, anonymised profiles) | **Phase 2** | Gap A5 (full scope) |
| — | CRM/Rep portal connector (Veeva CRM, Salesforce Health Cloud) | **Phase 2** | PRD v4.1 §5.3 Stage 6 |
| — | LMS/SCORM integration for e-learning distribution | **Phase 2** | PRD v4.1 §4.3 |
| — | Automated machine-verifiable claim-to-source anchoring | **⚠ TBD** | Gap C3 (see §14 OQ-C-002) |
| — | Platform scope differentiator (marketing/onboarding) | **⚠ TBD** | Gap B1 (see §14 OQ-C-003) |
| — | Market positioning analytics dashboard | **Backlog** | Gap A8 |
| — | Single AI content workspace positioning | **Out of Scope** | Gap A7 (Skipped per SME) |

**Total MVP FRs: 26**

---

## 12. Dependencies & Procurement Items

| Item | Type | Owner | Notes |
|------|------|-------|-------|
| Translation service API (e.g., DeepL, Google Translate) | External API | Engineering | Required if FR-C-021 includes automated machine translation. Not in PRD v4.1 §9.1. Procurement required. Subject to OQ-C-001 resolution. |
| WCAG 2.1 automated testing library (e.g., axe-core, Pa11y) | Open-source library | Engineering | Required for FR-C-022. axe-core is free/open-source. Pa11y is also free. No procurement needed — confirm license for commercial use. |
| Claims similarity engine (semantic similarity model) | AI model / library | Engineering | Required for FR-C-018 claims similarity detection. Options: sentence-transformers library, OpenAI embeddings API, or Claude embeddings. Token cost modelling required. |
| ACCME/EACCME compliance rule set | Content / Legal | Product | Required for FR-C-019. ACCME Standards for Integrity & Independence (2022) are published and freely available. EACCME equivalent rules need sourcing. Legal review of rule encoding required. |
| KOL / Medical Affairs contact GDPR consent mechanism | Legal / Compliance | GenBioCa Legal | Required for FR-C-005. KOL contact details and session recordings are GDPR personal data. Consent capture and DPA required before v0.1 launch. |
| FK readability scoring library | Open-source library | Engineering | Required for FR-C-009. Multiple free libraries available (textstat Python library, Flesch library for Node.js). No procurement needed. |
| Brand glossary / approved terminology list | Content | Client onboarding | Required for FR-C-015 brand compliance check. Each client provides their own approved terminology list at onboarding. Platform must support client-specific term lists. |
| Health economic model input format spec | Content / Product | Product | Required for FR-C-010. Must define which model output formats are supported (Excel, CSV, proprietary model outputs). Decision needed before FR-C-010 sprint. |

---

## 13. Traceability

| FR | PRD v4.1 Source | Gap Analysis Row |
|----|----------------|-----------------|
| FR-C-001 | §5.3 Stage 1 — scope, compliance track | — |
| FR-C-002 | §3.1 module dependency, §5.3 Stage 1 inputs | — |
| FR-C-003 | §4.3 deliverables — Medical Affairs Plans | — |
| FR-C-004 | §7.9 mandatory TA tagging | — |
| FR-C-005 | §5.3 Stage 2 — KOL advisory board | A5 (v0.1 scope) |
| FR-C-006 | §5.3 Stage 2 — scientific messaging framework | — |
| FR-C-007 | §5.3 Stage 3 — content creation | — |
| FR-C-008 | §7.2 AI Auto-Suggest | — |
| FR-C-009 | §12.3 best practice FK ≤8 | B4 |
| FR-C-010 | §4.3 deliverables — HEOR materials | C2 |
| FR-C-011 | §5.3 Stage 2 — KOL insights report | A6 |
| FR-C-012 | §6.3 roles — Patient Advocacy Group | C5 |
| FR-C-013 | §6.3 + RACI Chart 3 | B3 |
| FR-C-014 | §5.3 Stage 4 — claim-to-source anchoring | — |
| FR-C-015 | §5.3 Stage 4 — MLR review | A1 |
| FR-C-016 | §5.3 Stage 4 — MLR review | A2 |
| FR-C-017 | §5.3 Stage 4 — review efficiency | A4 |
| FR-C-018 | §5.3 Stage 4 — claims | A3 |
| FR-C-019 | §5.3 Stage 4 — ACCME independence | C1 |
| FR-C-020 | §5.3 Stage 5 — formatting | — |
| FR-C-021 | §5.3 Stage 5 — localisation (vs §13 contradiction) | A9 |
| FR-C-022 | §5.3 Stage 5 — WCAG 2.1 | C4 |
| FR-C-023 | §5.3 Stage 6 — final sign-off | — |
| FR-C-024 | §5.3 Stage 6 — distribution | — |
| FR-C-025 | §5.3 Stage 6 — Master Library push; §7.6 | B2 |
| FR-C-026 | Module C operational requirement | — |

---

## 14. Open Questions Before Design Phase

| ID | Question | Source | Blocker? |
|----|----------|--------|----------|
| OQ-C-001 | **PRD v4.1 Internal Contradiction — Localisation:** PRD v4.1 §5.3 Stage 5 requires "multi-language translation and cultural adaptation for country affiliates" as a mandatory Module C workflow activity. PRD v4.1 §13 states "English at launch; structured for translation into additional languages in future releases." These are directly contradictory. Decision needed: (a) remove translation from Stage 5 for v0.1 and flag as Phase 2, or (b) include localisation in v0.1 launch scope and specify how (human translation workflow only vs. machine translation API). SME direction (A9 note) suggests local instances with shared library — this aligns with option (b) as a human translation workflow without a machine translation API. Resolution required before Stage 5 design. | Gap A9 + PRD v4.1 §5.3/§13 contradiction | **Yes — Stage 5 design blocker** |
| OQ-C-002 | **C3 — Machine-Verifiable Claim-to-Source Anchoring:** SME said "will need to understand this in more detail, park this and will need a discussion with SME." If included, this is a shared platform capability (potentially reusable across Modules A, B, and C) that automatically verifies every substantive claim links to a specific source citation and label section at draft time. The architecture flag in §5.4 suggests this should be designed as a cross-module service. How should this be prioritised relative to the pre-MLR check (FR-C-015) and agentic MLR layer (FR-C-016)? | Gap C3 | No — FR-C-015/016 cover the MLR gate; C3 would extend traceability to draft time |
| OQ-C-003 | **B1 — Platform Scope Differentiator (Modules B/C shared):** Same open question as Module B OQ-B-001. Should the unified 5-module platform be explicitly called out in the Module C onboarding and content briefing UI? Affects Stage 1 scope matrix design. | Gap B1 | No — design can proceed |
| OQ-C-004 | **B2/B5 — Master Library & 21 CFR Part 11 Continuity:** Same pattern as Module B OQ-B-002. Should the audit trail continuity from Module A (clinical data) through Module C (MLR-approved content) be surfaced explicitly in the UI — a "Regulatory Record" panel showing the Module A source audit trail alongside the Module C MLR decision record? | Gaps B2, B5 | No — design can proceed |
| OQ-C-005 | **A5 Phase 2 Scope Definition:** SME flagged A5 (full async advisory board) as Phase 2. Before the Phase 2 design sprint, the following need to be defined: (a) what 40+ engagement types are relevant to the Aurora client base, (b) whether anonymised participant profiles are a legal/GDPR complexity, (c) what the in-platform translation capability means for the §13 language scope question. | Gap A5 | No — Phase 2 |
| OQ-C-006 | **FR-C-016 Agentic Layer Autonomy Level:** The agentic MLR layer is scoped as advisory (produces a report for the human MLR team) in v0.1. Should there be a defined Phase 2 path toward autonomous approval for Tier 1 (expedited) content where ≥80% of claims are pre-approved? This affects the data model design for `agentic_mlr_report` and the long-term competitive positioning against Veeva Falcon MLR. | Gap A2 + SME "Armada" note | No — v0.1 scoped, Phase 2 path optional |

---

## 15. Design Decisions Log

| ID | Decision | Rationale | Date |
|----|----------|-----------|------|
| DD-C-001 | Compliance track (ACCME vs MLR) is selected once at Stage 1 and cannot be changed mid-workflow | Changing compliance track mid-workflow would invalidate the review chain. If the track is wrong, the content item must be closed and a new one created with the correct track. | Sept 2026 |
| DD-C-002 | Pre-MLR check (FR-C-015) and agentic MLR layer (FR-C-016) are sequential, not parallel | The pre-MLR check is an editorial/compliance filter; the agentic layer is a deeper label-grounding check. Running agentic on content that fails pre-MLR wastes tokens. Sequential order: pre-MLR first, agentic only if pre-MLR passes. | Sept 2026 |
| DD-C-003 | Tier-based routing (FR-C-017) is a routing indicator, not a bypass | Tier 1 (expedited) content still goes through all MLR reviewers — it just uses an abbreviated checklist. No reviewer is removed from the chain. The audit trail records the tier and abbreviated checklist for each Tier 1 document. | Sept 2026 |
| DD-C-004 | PAO review (FR-C-012) is an annotation layer, not a formal approval gate in v0.1 | PAO reviewer annotations are captured and visible to the MLR team but do not block or gate the MLR review. This is consistent with the RACI Chart 3 which shows Patient Advocate as C (Consulted) not A/R. Phase 2 may elevate PAO to a formal gate for certain content types (PILs). | Sept 2026 |
| DD-C-005 | FK readability check (FR-C-009) is a hard gate — content above FK ≤8 cannot proceed to MLR | PRD v4.1 §12.3 states this as a best practice. This PRD converts it to a hard gate — a deliberate decision to enforce what the PRD recommends. This is Aurora's strongest differentiator vs all three competitors on patient-facing content quality. If the SME disagrees with the hard gate, it can be downgraded to a soft warning without an FR change. | Sept 2026 |
| DD-C-006 | PRD v4.1 §9.1 does not include any translation-service API — FR-C-021 is contingent on OQ-C-001 resolution | The localisation workflow FR is included in this PRD based on PRD v4.1 §5.3 Stage 5 requirements, but it is explicitly marked as subject to OQ-C-001 resolution. The design sprint for Stage 5 cannot begin until OQ-C-001 is answered. | Sept 2026 |

---

## 16. Version History

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 0.1 | Sept 2026 | GenBioCa / Claude | First version. Built from PRD v4.1 Module C sections + gap analysis. 26 MVP FRs. 6 open SME decisions/questions. 1 Skip (A7). 1 Phase 2 (A5 full scope). PRD v4.1 internal contradiction on localisation (Stage 5 vs §13) flagged as OQ-C-001. Cross-module claim traceability architecture flag documented in §5.4. |


---

## 17. Open Question Resolutions — v0.1 → v0.2

| OQ | Decision | Detail |
|----|----------|--------|
| OQ-C-001 | **Browser-native localisation** | Platform UI stays English (satisfying §13). Browser handles affiliate UI translation natively. No translation API, no dedicated localisation screen. Content authored in any language. Stage 5 screen shows formatting/channel tagging only. |
| OQ-C-002 | **Phase 2 — shared service** | FR-C-015 (pre-MLR check) + FR-C-016 (agentic layer) cover v0.1. Machine-verifiable claim-to-source anchoring built once as shared platform service in Phase 2 across Modules A/B/C/E. |
| OQ-C-003 | **Include (subtle)** | Compact source chip in Content Scope Matrix header at Stage 1. Consistent with Module B OQ-B-001. |
| OQ-C-004 | **Include (Final Output only)** | Cross-module 21 CFR Part 11 compliance chain surfaced at Stage 6 Final Output only — Compliance Provenance section. Consistent with Module B OQ-B-002. |
| OQ-C-005 | **Deferred to Phase 2** | Full async advisory board platform (40+ engagement types, anonymised profiles) scoped to Phase 2 planning sprint. v0.1 scope (FR-C-005/011) unchanged. |
| OQ-C-006 | **Phase 2 decision** | v0.1 agentic layer is advisory-only. Data model already supports future autonomy upgrade. Phase 2 decision on autonomous Tier 1 approval when client need confirmed. |

**PRD C status after OQ resolution: all 6 open questions closed. Ready for Phase 3 — CD Design.**
