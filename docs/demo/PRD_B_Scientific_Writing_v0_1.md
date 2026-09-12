# GenBioCa — AURORA
## PRD B — Scientific Writing
### Version 0.1

**Platform name:** Aurora (placeholder — rebrand in progress. Shortlist: AXION, VERIDOC, SYNTHARA, CLARIVA, GENOVA)
**Tagline:** AI-Native Authoring for Life Sciences
**Module colour:** #0D9488 (Teal)

*Status: First draft — gap analysis complete, SME decisions incorporated, 4 open decisions flagged. Ready for design-phase scoping.*
*Classification: Confidential — Internal Use Only*
*Prepared: September 2026*

---

## 0. Document Control

| Field | Value |
|-------|-------|
| Document | PRD B — Scientific Writing, v0.1 |
| Status | First draft. Built from PRD v4.1 Module B sections + competitor gap analysis (AURORA_ModuleB_Competitor_Analysis_and_Gaps.xlsx). 14 gap rows confirmed Include. 4 rows pending SME decision. 1 row Phase 2. |
| Supersedes | — (first version) |
| Built From | PRD v4.1 §4.2, §5.2, §6.2, RACI Chart 2, §11A.2, §12.2 + Module B Competitor Gap Analysis v0.1 (Sept 2026) |
| Naming Note | Platform referred to as "Aurora" throughout (placeholder). Module B is the internal identifier — never shown in UI. |
| Dependency | Module B depends on Module A as upstream source of truth. A CSR, TLF package, or SAP produced in Module A is the primary input for Module B manuscript authoring. |

---

## 0A. Gap Analysis Summary — Input to This PRD

**Source file:** AURORA_ModuleB_Competitor_Analysis_and_Gaps.xlsx
**Competitors reviewed:** iEnvision Datavision, Paperpal for Life Sciences, Ideagen PleaseReview
**Total gap rows:** 20 (8 Competitor Has/PRD Lacks · 6 Differentiators · 6 GAPs Missing Everywhere)

| ID | Area | Direction | Severity | SME Decision | Where in This PRD |
|----|------|-----------|----------|-------------|-------------------|
| A1 | Author/Contributor Vetting | Competitor Has | Major | **Include** | FR-B-014 |
| A2 | AI Authoring Traceability | Competitor Has | Major | **Include** | FR-B-006 |
| A3 | Literature & Citation Support | Competitor Has | Medium | **Include** | FR-B-008 |
| A4 | Journal Submission Readiness | Competitor Has | Major | **Include** | FR-B-020 |
| A5 | Multi-Author Collaboration | Competitor Has | Major | **Phase 2** | §11 Phase 2 |
| A6 | Plagiarism Detection | Competitor Has | Medium | **Include** | FR-B-021 (covered under A4) |
| A7 | Patient-Data Handling/BAA | Competitor Has | Medium | **Include** | FR-B-025 |
| A8 | Market Positioning/Efficiency Claims | Competitor Has | Minor | **N/A** | Analytics dashboard (future) |
| B1 | Platform Integration — CSR→Manuscript | Differentiator | Major | **Include** | FR-B-001 |
| B2 | Metadata Governance — TA + Master Library | Differentiator | Medium | **Include** | FR-B-026 |
| B3 | Roles & Governance — RACI | Differentiator | Medium | **Include** | FR-B-013 |
| B4 | Reporting Guideline Automation — EQUATOR | Differentiator | Medium | **Include** | FR-B-004 |
| B5 | Platform Scope — Unified 5-Module | Differentiator | Major | **⚠ TBD** | §14 Open Questions |
| B6 | Compliance — 21 CFR Part 11 Native | Differentiator | Medium | **⚠ TBD** | §14 Open Questions |
| C1 | Fair-Balance / Off-Label Detection | GAP | Major | **Include** | FR-B-011 (Phase 2 candidate) |
| C2 | AI Journal-Fit Recommendation | GAP | Medium | **Include** | FR-B-019 |
| C3 | ICMJE Authorship Governance | GAP | Medium | **⚠ TBD** | §14 Open Questions |
| C4 | Congress Submission Portal | GAP | Medium | **⚠ TBD** | §14 Open Questions |
| C5 | Duplicate Publication Detection | GAP | Medium | **Include** | FR-B-022 |
| C6 | DOI/ORCID Automation | GAP | Medium | **Include** | FR-B-027 |

**SME notes captured:**
- A1: "Good, but difficult to maintain" — maintenance strategy required before build
- A2: "Need to differentiate AI-generated vs human-generated"
- A4: "Watch token pricing" — cost modelling required before sprint
- A5: "Too complex, not now" — deferred to Phase 2
- A8: "Maybe a dashboard can show these stats" — analytics dashboard, not a publication workflow feature
- B1: "Good one" — strong differentiator vs all three competitors
- B2: "We need this — TA-specific focus"
- B4: "Like a wizard" — EQUATOR selection as a guided wizard flow
- B5: "Good" — decision pending
- B6: "Good" — decision pending
- C1: "Very complex, will need to see if this can get into Phase 2"
- C2: "Great value add"

---

## 1. Purpose & Background

Aurora Module B — Scientific Writing — is the publication authoring platform within the Aurora ecosystem. It takes the clinical study data produced in Module A (CSR, TLF package, SAP) and transforms it into peer-reviewed manuscripts, congress abstracts, scientific posters, and systematic reviews for journals and scientific conferences.

Module B exists at the intersection of two regulated worlds: the clinical data world (ICH E3, 21 CFR Part 11) and the publication ethics world (GPP 2022, ICMJE, EQUATOR). Aurora is the only platform that governs both under one audit trail, one project record, and one Master Library — the core differentiator against all three competitors analysed.

This document specifies Module B as a standalone buildable unit, subject to the same four architecture discipline rules as Module A. The six-stage workflow (Planning → Drafting → Internal Review → External Author Review → Journal Submission → Final Output) is the backbone of every functional requirement in this PRD.

---

## 2. Scope

### 2.1 In Scope for v0.1 Build

- The full six-stage Module B workflow: Planning & Message Development → First Draft Authoring → Internal Review Cycle → External Author Review → Journal Submission & Peer Review → Final Output.
- All seven Module B deliverable families: Manuscripts, Conference Abstracts, Posters/Slide Decks, White Papers, Letters to the Editor/Commentaries, Plain Language Summaries, Press Releases.
- Platform integration with Module A — direct linkage of CSR, TLF, and SAP as upstream source documents.
- AI-assisted drafting with mandatory human review and sign-off (same model as Module A).
- Mandatory TA tagging at project, publication, and section level.
- Author/contributor vetting against debarred/banned-writer lists (A1).
- AI authoring traceability — visible differentiation of AI-drafted vs human-authored content (A2).
- Integrated literature search and source-grounded citation support (A3).
- EQUATOR reporting guideline automation — wizard-guided CONSORT/STROBE/PRISMA/MOOSE selection (B4).
- Pre-configured RACI matrix for the 6 Module B roles (B3).
- AI fair-balance and off-label detection — flagging only, not blocking (C1 — see §11 phase note).
- AI journal-fit recommendation engine (C2).
- 30+ automated pre-submission readiness checks including plagiarism (A4/A6).
- Duplicate publication detection against prior publication history (C5).
- DOI/ORCID capture and CrossRef/ORCID API integration at Final Output stage (C6).
- Patient-data BAA compliance posture for case-report content (A7).
- 21 CFR Part 11 audit trail and e-signatures — same infrastructure as Module A.
- Master Library push at Final Output stage — tagged content cards for cross-module reuse (B2).

### 2.2 Explicitly Out of Scope for v0.1

- True real-time simultaneous multi-author editing (A5 — Phase 2, too complex for v0.1).
- Automated congress submission portal integration (C4 — pending SME decision; scoped in §14).
- Integrated ICMJE four-criteria authorship scoring engine (C3 — pending SME decision; scoped in §14).
- Full journal portal API integrations (ScholarOne, Editorial Manager) — Phase 2; v0.1 is document preparation and export only.
- Market positioning/efficiency dashboard (A8 — analytics feature, not publication workflow).
- Modules A, C, D, E in this document.

---

## 3. Goals

- Enable a medical writer to take a completed CSR from Module A and produce a submission-ready journal manuscript without leaving the Aurora platform.
- Maintain a single, GPP 2022-compliant, ICMJE-compliant audit trail from first draft to published DOI — the only platform that does this natively.
- Keep the AI layer strictly advisory: drafts, suggests, and flags; humans review, resolve, and sign.
- Protect the clinical data layer: all manuscripts are traceable to their source TLFs, SAP sections, and CSR paragraphs.
- Ship a pilot-ready Module B that a publications team can use end-to-end through all six workflow stages.

---

## 4. Glossary

| Term | Definition |
|------|-----------|
| Manuscript | A journal article (original research, systematic review, or case report) |
| Abstract | A structured summary submitted to a scientific congress (oral or poster) |
| IMRAD | Introduction, Methods, Results, and Discussion — standard manuscript structure |
| GPP 2022 / GPP4 | Good Publication Practice 4 — the current ISMPP publication ethics standard |
| ICMJE | International Committee of Medical Journal Editors — authorship and submission standards |
| EQUATOR | Enhancing the QUAlity and Transparency Of health Research — network of reporting guidelines |
| CONSORT | Consolidated Standards of Reporting Trials — RCT reporting guideline |
| STROBE | STrengthening the Reporting of OBservational studies in Epidemiology |
| PRISMA | Preferred Reporting Items for Systematic Reviews and Meta-Analyses |
| MOOSE | Meta-analysis Of Observational Studies in Epidemiology |
| COPE | Committee on Publication Ethics |
| KOL | Key Opinion Leader — external clinical expert and co-author |
| COI | Conflict of Interest disclosure form (required by ICMJE) |
| CRM | Comments Resolution Meeting — same as Module A |
| TLF/TLG | Tables, Listings, Figures/Graphs — statistical outputs from Module A |
| SAP | Statistical Analysis Plan — produced in Module A |
| CSR | Clinical Study Report — Module A's primary output; Module B's primary input |
| ORCID | Open Researcher and Contributor ID — author unique identifier |
| DOI | Digital Object Identifier — publication unique identifier |
| FR-B-### | Functional Requirement identifier, Module B scope |
| PLS | Plain Language Summary — a non-technical lay summary of a publication |
| BAA | Business Associate Agreement — HIPAA data processing agreement |

---

## 5. Architecture Context

### 5.1 Module Dependency

Module B is downstream of Module A. The data flow is:

```
Module A (CSR / TLF / SAP / Protocol)
         ↓
Module B (Manuscript / Abstract / Poster)
         ↓
Master Library (tagged content cards for cross-module reuse)
```

A Module B project must be linked to a Module A project at creation. A user cannot initiate a Module B publication without selecting a source Module A project. The CSR, TLF package, and SAP from that Module A project become the upstream source documents for all Module B authoring.

### 5.2 Architecture Rules (same four discipline rules as Module A)

1. **Module boundary enforcement:** Module B components must not import directly from Module A components. Cross-module data flows through the platform interface layer only.
2. **Audit trail first:** Every content change, AI suggestion, author action, and approval event is written to the audit trail before the UI updates.
3. **Human sign-off required:** AI may draft, suggest, or flag — it may not publish or approve. Every document stage gate requires a human signature.
4. **TA tag mandatory:** Every project, publication, section, and Master Library card must carry a therapeutic area tag before it can be saved.

### 5.3 Shared Infrastructure

Module B reuses the following from the platform:
- Authentication, MFA, Terms Gate (Module A Sessions 5–7)
- AppShell — TopNav, Sidebar (Module A Session 4)
- Document Editor core (Module A Session 11) — adapted for IMRAD structure
- Review Assignment Panel (Module A Session 15)
- Reviewer View (Module A Session 16)
- CRM Module (Module A Session 18)
- Comment Resolution Panel (Module A Session 19)
- E-Signature (Module A Session 20)
- Audit Trail Panel (Module A Session 14)
- Master Library push (Module A §6.5)

Module B adds new screens and panels for: Publication Planning, EQUATOR Wizard, Author/Contributor Management, AI Footprint Panel, Literature & Citation Panel, Journal Submission Readiness, Journal-Fit Recommendation.

---

## 6. Functional Requirements

### 6.1 Publication Planning & Message Development (Stage 1)

**FR-B-001 — Platform Integration: CSR-to-Manuscript Linkage** *(MVP — Differentiator B1)*
Every Module B project must link to a Module A source project at creation. The linked CSR, TLF package, and SAP are surfaced as read-only source documents inside the Module B editor. Any section of the manuscript can be traced back to the specific TLF table, CSR paragraph, or SAP section that sourced it.

**FR-B-002 — Publication Plan Creation** *(MVP)*
The system enables creation of a structured publication plan covering: key messages framework, target journal/congress selection, author team kick-off record, planned submission date, and publication type (manuscript/abstract/poster). The publication plan is versioned and stored in the project record.

**FR-B-003 — Therapeutic Area Mandatory Tagging** *(MVP)*
Every Module B project, publication, and section must carry a mandatory TA tag before it can be saved. The system enforces this at creation and at each stage gate. TA tag options are drawn from the platform master data list.

**FR-B-004 — EQUATOR Reporting Guideline Wizard** *(MVP — Differentiator B4)*
At Stage 1, the system presents a guided wizard that selects the correct EQUATOR reporting checklist based on study type:
- RCT → CONSORT 2010
- Observational study → STROBE 2007
- Systematic review / meta-analysis → PRISMA 2020
- Meta-analysis of observational studies → MOOSE 2000

The selected checklist is attached to the publication and drives Section 2 (Methods) completeness requirements throughout drafting. Checklist items are validated at the Stage 5 gate (Journal Submission). SME note: "like a wizard."

**FR-B-005 — Journal / Congress Target Selection** *(MVP)*
The system enables the writer to select a target journal or congress at Stage 1 and store the target's author guidelines (word count limits, structured abstract format, reference style, figure count limits) against the publication. These constraints are surfaced as live validation warnings during drafting in Stage 2.

---

### 6.2 First Draft Authoring (Stage 2)

**FR-B-006 — AI Authoring Traceability — AI Footprint** *(MVP — Gap A2)*
Every section of the manuscript that contains AI-generated content is visually marked with an AI Footprint indicator — a distinct inline badge and background colour — so reviewers and authors can identify AI-drafted text at a glance. This is surfaced:
- Inline in the document editor on every AI-drafted sentence or paragraph
- In the audit trail with the model name, generation timestamp, and source documents used
- In a dedicated AI Footprint summary panel showing AI vs human content percentage

This feature directly implements the key SME requirement: "need to differentiate AI-generated vs human-generated." The AI Footprint is never removable by the author — only by editing the content itself (replacing AI text with human text, which clears the badge on that passage).

**FR-B-007 — IMRAD Structure Enforcement** *(MVP)*
The document editor for manuscript deliverables enforces the IMRAD section structure: Introduction, Methods (with EQUATOR checklist integration), Results (with TLF cross-reference), Discussion, Conclusion, References, Disclosures. Section order is locked. Authors may add subsections within each IMRAD section but may not reorder the top-level structure.

**FR-B-008 — Literature Search & Source-Grounded Citation** *(MVP — Gap A3)*
The system provides an integrated PubMed search panel within the document editor. Authors can search PubMed, retrieve abstracts and citation metadata, and insert verified citations into the manuscript with one click. Inserted citations are tagged as "PubMed-verified" in the reference list and in the audit trail. AI-drafted text that references a source document links directly to that citation rather than hallucinating a reference.

**FR-B-009 — TLF Cross-Reference (Module B variant)** *(MVP)*
The same TLF cross-reference panel from Module A is surfaced in the Module B editor. The Results section surfaces the linked TLF package from Module A, allowing the writer to reference specific tables, listings, and figures directly in the manuscript body. All TLF references are bidirectionally linked — a change alert fires if the source TLF in Module A is updated after a manuscript section has referenced it.

**FR-B-010 — AI Auto-Suggest (Module B variant)** *(MVP)*
The AI auto-suggest engine operates in the Module B editor with Module B-specific system prompts: manuscript authoring context, GPP 2022 compliance framing, source document grounding (CSR + TLFs + SAP). All AI suggestions are marked with the AI Footprint (FR-B-006). The AI does not suggest content beyond what is supported by the linked source documents.

**FR-B-011 — Fair-Balance & Off-Label Language Detection** *(MVP — flagging only; full blocking Phase 2 — Gap C1)*
The system runs automated checks for:
- Language that overstates efficacy without citing the confidence interval or p-value
- Language that implies off-label use not supported by the approved indication
- Comparative claims without a cited source

Detected issues are flagged inline as amber warnings (not hard blocks in v0.1). The author must acknowledge each flag before the document can proceed to Stage 3. The audit trail records every flag, every acknowledgement, and every override. SME note: "very complex" — full blocking deferred to Phase 2.

---

### 6.3 Internal Review Cycle (Stage 3)

**FR-B-012 — Internal Review Gate** *(MVP)*
Stage 3 requires three internal review sign-offs before the manuscript can proceed to Stage 4:
1. Medical review — data accuracy against CSR and TLFs
2. Biostatistics verification — statistical methods match SAP; p-values, CIs, and hazard ratios verified
3. Legal/regulatory review — off-label risk and promotional bias (informed by FR-B-011 flags)

Each reviewer is assigned via the RACI matrix (FR-B-013). The review workflow uses the same Review Assignment Panel, Reviewer View, and CRM infrastructure as Module A.

**FR-B-013 — RACI Matrix — Module B Roles** *(MVP — Differentiator B3)*
The system enforces a pre-configured RACI matrix for Module B. Six roles are pre-defined and cannot be deleted by users (only by Admin):

| Role | RACI Position |
|------|--------------|
| Lead/First Author (KOL/Clinician) | Accountable on key messages, approves final version |
| Co-Authors (Investigators/Specialists) | Responsible for section-level scientific accuracy |
| Medical Writer/Publication Lead | Responsible for drafting, ICMJE/GPP compliance, submission |
| Publication Manager/Agency | Accountable for timeline and journal logistics |
| Biostatistician | Responsible for statistical output verification |
| Medical Affairs/Commercial | Consulted for fair-balance and off-label review |

RACI assignments are pre-populated at project creation. Admin can modify role names and assignments. Users cannot override RACI assignments.

**FR-B-014 — Author/Contributor Vetting** *(MVP — Gap A1)*
At Stage 1 (author team kick-off) and at Stage 4 (external author distribution), the system runs an automated check of all listed authors against a configurable debarred/banned-writer list. Sources include FDA Debarment List and DHHS OIG Exclusions List, updated on a configurable cadence. Any match generates a Major warning that blocks progression until resolved by a publication manager. SME note: "Good, but difficult to maintain" — list maintenance is an operations requirement, not a v0.1 blocker; the matching engine is built, the list sourcing is documented as a dependency (§12).

---

### 6.4 External Author Review (Stage 4)

**FR-B-015 — KOL/Co-Author Distribution** *(MVP)*
The system distributes the internally reviewed draft to all co-authors and KOLs via the Review Assignment Panel. Each external author receives a reviewer link with a time-boxed access window (configurable, default 14 days). External authors may add comments and approve sections but may not directly edit the manuscript body.

**FR-B-016 — ICMJE COI Disclosure Collection** *(MVP)*
At Stage 4, the system requires all listed authors to submit a signed ICMJE Conflict of Interest disclosure form before their review is accepted. A pre-built COI form template is provided. The signed disclosures are stored against the publication record and referenced in the final manuscript acknowledgements. Authors who have not submitted a COI form are blocked from completing their review step.

**FR-B-017 — CRM — Publication Comments Resolution Meeting** *(MVP)*
Stage 4 includes a Comments Resolution Meeting using the same CRM infrastructure as Module A. The publication lead chairs the meeting, works through all open author comments, records resolution decisions, and obtains steering committee approval before stage gate sign-off.

**FR-B-018 — Steering Committee Approval** *(MVP)*
The final step of Stage 4 is a formal steering committee approval — a named sign-off from the designated approver(s) that the manuscript is ready for journal submission. This is implemented as an e-signature step using the same e-signature chain as Module A, with meaning: "I approve this manuscript for journal submission."

---

### 6.5 Journal Submission & Peer Review (Stage 5)

**FR-B-019 — AI Journal-Fit Recommendation** *(MVP — Gap C2)*
Before or at Stage 5, the system provides an AI-powered journal recommendation panel. Based on the manuscript's therapeutic area, study type, statistical results, and target audience, the engine suggests the top 3–5 best-fit journals ranked by:
- Manuscript-to-journal scope match
- Impact factor range
- Realistic acceptance likelihood (based on study design and results size)
- Open access vs subscription model

The recommendation is advisory. The author's journal selection (from Stage 1) is pre-selected; the panel shows whether that choice is the engine's top recommendation or flags a better-fit alternative. SME note: "great value add."

**FR-B-020 — Pre-Submission Journal Readiness Checks** *(MVP — Gap A4)*
The system runs 30+ automated checks before the manuscript can be submitted, covering:
- Word count vs journal limit
- Abstract word count vs limit
- Reference count vs limit
- Figure count vs limit
- Reference format compliance (Vancouver/APA/AMA per journal)
- EQUATOR checklist completeness (all mandatory items ticked)
- Author statement completeness (funding, acknowledgements, data availability)
- ICMJE authorship criteria confirmation
- COI disclosure status for all authors

Each failing check is shown as a blocking error at the Stage 5 gate. All passing checks are logged to the audit trail.

**FR-B-021 — Plagiarism Detection** *(MVP — Gap A6, covered under A4)*
A plagiarism check is run as one of the 30+ pre-submission checks (FR-B-020). The check compares the manuscript against published literature and the sponsor's own prior publication history. Results are surfaced as a similarity score with highlighted passages. A similarity score above a configurable threshold (default 15%) generates a blocking warning. All check results are logged to the audit trail.

**FR-B-022 — Duplicate Publication Detection** *(MVP — Gap C5)*
The system maintains a publication history index per sponsor (all previously published abstracts and manuscripts from that organisation stored in the platform). Before Stage 5 sign-off, the system checks the new manuscript's abstract, title, and key data points against this history and flags potential duplicate submission violations. The check output is logged to the audit trail and shown to the publication manager.

**FR-B-023 — Peer Review Response Letters** *(MVP)*
When journal peer review comments are received (uploaded by the publication manager), the system creates a structured response letter template pre-populated with each reviewer comment as a section. The medical writer drafts point-by-point responses inline. The completed response letter is version-controlled and stored against the publication record.

---

### 6.6 Final Output (Stage 6)

**FR-B-024 — DOI/ORCID Capture and API Automation** *(MVP — Gap C6)*
At Final Output, the system:
- Triggers the CrossRef API to register the publication and obtain a DOI
- Verifies all listed authors' ORCID iDs via the ORCID API
- Stores the DOI and all ORCID iDs against the publication record
- Displays the final citation in the journal's required reference format

PRD v4.1 §9.1 does not currently list CrossRef or ORCID in the External API Registry — this is an identified gap. See §12 Dependencies for procurement and registration actions required.

**FR-B-025 — Patient-Data BAA Compliance** *(MVP — Gap A7)*
For case-report manuscripts that contain patient-derived data (eCRF data, anonymised medical records, diagnostic results):
- The system enforces an additional BAA acknowledgement step at project creation
- Patient-identifiable fields are flagged for anonymisation review before Stage 3
- The platform operates under HIPAA BAA terms for any project containing PHI/PII content (BAA availability is a procurement dependency — see §12)
- GDPR data handling applies to all EU patient data

**FR-B-026 — Master Library Push at Final Output** *(MVP — Differentiator B2)*
At Stage 6 (Final Output), the system automatically creates tagged content cards for the Master Library from:
- The accepted manuscript abstract
- Key results statements (linked to their source TLFs)
- The final EQUATOR checklist completion record
- The publication citation (with DOI)

All cards are tagged with TA, study type, module (B), and project. Cards are immediately available for cross-module reuse in Modules C (med comms slide decks) and E (ideation content). SME note: "We need this — TA-specific focus."

**FR-B-027 — Final Output Package** *(MVP)*
The Final Output stage produces:
- Accepted manuscript PDF (formatted to journal spec)
- Conference poster / abstract (if applicable)
- Tagged ideation cards pushed to Master Library
- DOI-registered citation record
- Full audit trail export (GPP 2022-compliant publication history)
- ICMJE COI disclosure archive
- EQUATOR checklist completion record

---

## 7. Confirmed Differentiators (Protect — No New Build Without PRD Update)

These four features are not available in any of the three competitor products analysed. They are Aurora Module B's primary competitive moat and must be protected in every design and architecture decision.

| ID | Differentiator | Why It Matters |
|----|----------------|----------------|
| B1 | Native CSR-to-Manuscript linkage (FR-B-001) | Every competitor requires manual data hand-off from clinical writing to publications. Aurora is the only platform where the CSR, TLF, and SAP from Module A are directly accessible and traceable inside the Module B editor. |
| B2 | TA-tagged Master Library push at Final Output (FR-B-026) | Competitors produce standalone publications. Aurora pushes publication content into a cross-module reuse library, enabling Module C and E downstream use. |
| B4 | EQUATOR wizard with study-type routing (FR-B-004) | No competitor offers automated EQUATOR checklist selection. Authors currently select and apply guidelines manually. |
| A2 | AI Footprint — visible AI vs human content tracking (FR-B-006) | Paperpal has an "AI Footprint" concept but it is not embedded in an end-to-end GxP-compliant audit trail. Aurora's AI Footprint is immutable and audit-logged. |

---

## 8. Non-Functional Requirements

### 8.1 Compliance & Audit

- 21 CFR Part 11 compliant audit trail: every content change, AI suggestion, reviewer action, stage gate, and signature is immutably logged with actor, timestamp, and version reference.
- GPP 2022 publication history: the audit trail constitutes a GPP 2022-compliant record of all editorial decisions, author contributions, and review steps.
- ICMJE authorship criteria enforced at the platform level — all four criteria documented per author.
- COPE guidelines: the platform supports COPE's guidelines on authorship disputes, data sharing, and post-publication corrections.

### 8.2 Security

- Same security posture as Module A: AES-256 at rest, TLS 1.3 in transit, MFA enforced.
- HIPAA BAA posture: PHI/PII in case-report content requires BAA (procurement dependency — §12).
- GDPR: EU patient data is stored in EU region. Audio from voice notes deleted after transcription (Admin-configurable).
- ISO/IEC 27001 and SOC 2 Type II — same roadmap as Module A.

### 8.3 Performance

- AI suggestion latency: < 5 seconds for manuscript section suggestions (same target as Module A).
- PubMed search results: < 3 seconds.
- Pre-submission checks (FR-B-020): all 30+ checks complete within 30 seconds.
- Plagiarism check: < 60 seconds.
- CrossRef/ORCID API calls: < 10 seconds per request.

### 8.4 Accessibility

- WCAG 2.2 AA compliance (same as Module A).
- All publication outputs (PDFs) meet PDF/UA standard.

### 8.5 Token Cost Management

- AI-assisted manuscript drafting consumes significantly more tokens than Module A CSR drafting due to longer documents and iterative journal formatting. Token usage must be monitored per publication and reported to Admin. SME note on A4: "watch what is the price we pay for number of tokens." Token budget alerts configurable by Admin.

---

## 9. Data Model Stub

New entities required for Module B (extending the Module A data model):

| Entity | Key Fields | Notes |
|--------|-----------|-------|
| `publication` | id, project_id (FK → project), source_module_a_project_id, type (manuscript/abstract/poster/white-paper/letter/pls/press-release), status, stage (1–6), target_journal, target_congress, ta_tag, version | Core Module B entity |
| `publication_plan` | id, publication_id, key_messages, journal_strategy, equator_guideline, planned_submission_date | Stage 1 output |
| `author` | id, publication_id, user_id (nullable — external authors may not have platform accounts), name, role, orcid_id, coi_submitted, coi_submitted_at, debarment_check_status, debarment_checked_at | Extends team member for external KOLs |
| `ai_footprint` | id, publication_id, section_id, content_hash, model_name, generated_at, source_docs, replaced_at (nullable) | Tracks AI vs human content per section |
| `citation` | id, publication_id, pubmed_id, doi, title, authors, journal, year, verified_at, inserted_by | PubMed-verified reference |
| `equator_checklist` | id, publication_id, guideline (consort/strobe/prisma/moose), items (JSONB), completed_at | Stage 2–5 compliance |
| `submission_check` | id, publication_id, check_name, status, detail, run_at | Pre-submission readiness checks |
| `plagiarism_result` | id, publication_id, similarity_score, flagged_passages (JSONB), run_at, acknowledged_by | Plagiarism check result |
| `journal_fit_result` | id, publication_id, recommendations (JSONB — ranked journal list with scores), generated_at | AI journal-fit output |
| `doi_record` | id, publication_id, doi, registered_at, crossref_response (JSONB) | DOI registration |
| `debarment_list` | id, name, source (fda/oig/other), listed_at, updated_at | Configurable banned-writer list |

---

## 10. Regulatory Framework Registry — Module B

Source: PRD v4.1 §11A.2

| Framework | Issuer | Version | Scope in Module B |
|-----------|--------|---------|-------------------|
| GPP3 / GPP 2022 (GPP4) | ISMPP | 2022 | Mandatory — disclosure, authorship, transparency for industry-sponsored publications |
| ICMJE Recommendations | ICMJE | 2023 update | Mandatory — authorship criteria, submission, data sharing |
| CONSORT 2010 | CONSORT Group | 2010 | RCT manuscript reporting structure |
| STROBE 2007 | STROBE Initiative | 2007 | Observational study reporting |
| PRISMA 2020 | PRISMA Group | 2020 update | Systematic review and meta-analysis reporting |
| MOOSE 2000 | MOOSE Group | 2000 | Meta-analysis of observational studies |
| ICMJE Uniform Requirements | ICMJE | 2023 | Manuscript formatting, reference style, submission |
| ClinicalTrials.gov Results Reporting | FDA / NLM | 42 CFR Part 11 (FDAAA 2007) | Mandatory results disclosure and timelines |
| 21 CFR Part 11 | FDA | Current | Electronic records for submission-linked publications |
| COPE Guidelines | COPE | Current | Authorship disputes, data sharing, post-publication corrections |

---

## 11. Phase & Priority Plan

### Phase Assignment Legend

| Phase | Meaning |
|-------|---------|
| MVP | Required for v0.1 release — pilot client must be able to use this |
| Phase 2 | Confirmed in scope, deferred — too complex or dependent on Phase 1 infrastructure |
| Backlog | Identified, not yet scoped |
| Out of Scope | Explicitly declined |

### Full FR List with Phase Assignments

| FR | Description | Phase | Source |
|----|-------------|-------|--------|
| FR-B-001 | CSR-to-Manuscript platform linkage | MVP | PRD v4.1 §5.2 + Gap B1 |
| FR-B-002 | Publication plan creation | MVP | PRD v4.1 §5.2 Stage 1 |
| FR-B-003 | Mandatory TA tagging | MVP | PRD v4.1 §7.9 |
| FR-B-004 | EQUATOR reporting guideline wizard | MVP | PRD v4.1 §5.2 Stage 1 + Gap B4 |
| FR-B-005 | Journal/congress target selection | MVP | PRD v4.1 §5.2 Stage 1 |
| FR-B-006 | AI Footprint — authoring traceability | MVP | Gap A2 |
| FR-B-007 | IMRAD structure enforcement | MVP | PRD v4.1 §5.2 Stage 2 |
| FR-B-008 | Literature search & source-grounded citation | MVP | Gap A3 |
| FR-B-009 | TLF cross-reference (Module B variant) | MVP | PRD v4.1 §5.2 Stage 2 |
| FR-B-010 | AI auto-suggest (Module B variant) | MVP | PRD v4.1 §7.2 |
| FR-B-011 | Fair-balance & off-label detection (flagging) | MVP — flagging only | Gap C1 (full blocking Phase 2) |
| FR-B-012 | Internal review gate — 3-reviewer sign-off | MVP | PRD v4.1 §5.2 Stage 3 |
| FR-B-013 | RACI matrix — Module B 6 roles | MVP | PRD v4.1 §6.2 + RACI Chart 2 + Gap B3 |
| FR-B-014 | Author/contributor debarment vetting | MVP | Gap A1 |
| FR-B-015 | KOL/co-author distribution | MVP | PRD v4.1 §5.2 Stage 4 |
| FR-B-016 | ICMJE COI disclosure collection | MVP | PRD v4.1 §5.2 Stage 4 |
| FR-B-017 | CRM — publication comments resolution | MVP | PRD v4.1 §5.2 Stage 4 |
| FR-B-018 | Steering committee approval e-signature | MVP | PRD v4.1 §5.2 Stage 4 |
| FR-B-019 | AI journal-fit recommendation | MVP | Gap C2 |
| FR-B-020 | Pre-submission readiness checks (30+) | MVP | Gap A4 |
| FR-B-021 | Plagiarism detection (part of FR-B-020) | MVP | Gap A6 |
| FR-B-022 | Duplicate publication detection | MVP | Gap C5 |
| FR-B-023 | Peer review response letters | MVP | PRD v4.1 §5.2 Stage 5 |
| FR-B-024 | DOI/ORCID capture and API automation | MVP | Gap C6 |
| FR-B-025 | Patient-data BAA compliance | MVP | Gap A7 |
| FR-B-026 | Master Library push at Final Output | MVP | PRD v4.1 §5.2 Stage 6 + Gap B2 |
| FR-B-027 | Final output package generation | MVP | PRD v4.1 §5.2 Stage 6 |
| — | Real-time multi-author simultaneous editing | **Phase 2** | Gap A5 |
| — | Full blocking fair-balance enforcement | **Phase 2** | Gap C1 |
| — | Journal portal API integration (ScholarOne, EM) | **Phase 2** | PRD v4.1 §5.2 Stage 5 |
| — | Congress submission portal integration | **⚠ TBD** | Gap C4 (see §14) |
| — | ICMJE four-criteria authorship scoring | **⚠ TBD** | Gap C3 (see §14) |
| — | Market positioning analytics dashboard | **Backlog** | Gap A8 |

**Total MVP FRs: 27**

---

## 12. Dependencies & Procurement Items

| Item | Type | Owner | Notes |
|------|------|-------|-------|
| FDA Debarment List API or data feed | External data | Publication Manager / Admin | Required for FR-B-014. FDA provides a downloadable list; no public API. Cadence: monthly refresh minimum. |
| DHHS OIG Exclusions List | External data | Publication Manager / Admin | Required for FR-B-014. Available as a downloadable CSV. |
| PubMed / NCBI E-utilities API | External API | Engineering | Free, rate-limited. Required for FR-B-008. API key registration required. |
| CrossRef API | External API | Engineering | Required for FR-B-024 DOI registration. Membership required; Fabrica account. |
| ORCID Member API | External API | Engineering | Required for FR-B-024 ORCID verification. ORCID Member organisation registration required. |
| HIPAA BAA — hosting provider | Legal / Compliance | GenBioCa Legal | Required before any case-report project with PHI/PII can be run on the platform (FR-B-025). |
| Plagiarism detection engine | Third-party service or API | Engineering | Options: iThenticate API (Turnitin), Copyleaks API. Token pricing applies. Selection required before sprint. |
| AI model token cost modelling | Internal analysis | Product / Finance | Required before FR-B-010 and FR-B-020 sprint planning. SME note: "watch token pricing." |
| ISMPP EQUATOR checklist data | Content / Legal | Product | CONSORT/STROBE/PRISMA/MOOSE checklists must be licensed for use or confirmed as open-access before embedding. |

---

## 13. Traceability

| FR | PRD v4.1 Source | Gap Analysis Row |
|----|----------------|-----------------|
| FR-B-001 | §5.2 Stage 1 data flow, §3.1 Module dependency | B1 |
| FR-B-002 | §5.2 Stage 1 — Publication plan | — |
| FR-B-003 | §7.9 Mandatory TA tagging | — |
| FR-B-004 | §5.2 Stage 1 — EQUATOR mapping | B4 |
| FR-B-005 | §5.2 Stage 1 — Journal selection | — |
| FR-B-006 | — | A2 |
| FR-B-007 | §5.2 Stage 2 — IMRAD structure | — |
| FR-B-008 | §5.2 Stage 2 — PubMed citation verification | A3 |
| FR-B-009 | §5.2 Stage 2 — data tables/figures | — |
| FR-B-010 | §7.2 AI Auto-Suggest Engine | — |
| FR-B-011 | §5.2 Stage 2 — fair-balance checks | C1 |
| FR-B-012 | §5.2 Stage 3 — Internal review cycle | — |
| FR-B-013 | §6.2 Module B Roles + RACI Chart 2 | B3 |
| FR-B-014 | — | A1 |
| FR-B-015 | §5.2 Stage 4 — KOL/co-author distribution | — |
| FR-B-016 | §5.2 Stage 4 — ICMJE COI disclosures | — |
| FR-B-017 | §5.2 Stage 4 — CRM | — |
| FR-B-018 | §5.2 Stage 4 — Steering committee approval | — |
| FR-B-019 | — | C2 |
| FR-B-020 | §5.2 Stage 5 — GPP 2022/ICMJE format | A4 |
| FR-B-021 | §5.2 Stage 5 | A6 |
| FR-B-022 | — | C5 |
| FR-B-023 | §5.2 Stage 5 — response letters | — |
| FR-B-024 | §5.2 Stage 6 — DOI/ORCID capture; §9.1 gap | C6 |
| FR-B-025 | §13.4 GDPR | A7 |
| FR-B-026 | §5.2 Stage 6 — Master Library push; §7.6 | B2 |
| FR-B-027 | §5.2 Stage 6 — Final Output | — |

---

## 14. Open Questions Before Design Phase

| ID | Question | Source | Blocker? |
|----|----------|--------|----------|
| OQ-B-001 | **B5 — Platform Scope:** SME noted "Good" but no decision yet. Does the PRD explicitly call out the unified 5-module platform as a named differentiator in Module B marketing and onboarding materials? This affects the publication planning UI at Stage 1 where the module context switcher is shown. | Gap B5 | No — design can proceed |
| OQ-B-002 | **B6 — Compliance Infrastructure:** SME noted "Good" but no decision yet. Should the 21 CFR Part 11 audit trail continuity from Module A (CSR record) through Module B (publication record) be surfaced explicitly in the Module B UI — e.g., a "Linked Regulatory Record" panel showing the Module A audit trail alongside the Module B one? | Gap B6 | No — design can proceed |
| OQ-B-003 | **C3 — ICMJE Authorship Scoring:** Needs more SME discussion. If included, this is an embedded scoring workflow inside the Author Management screen at Stage 4 — four criteria, contribution statements per author, scoring record stored against publication. How complex is acceptable? | Gap C3 | Yes — needed before authorship screen design |
| OQ-B-004 | **C4 — Congress Submission Portal:** Needs more discussion. If included, this is a congress-specific form builder at Stage 5 that handles word/character limits and structured format for abstract submissions to specific congress portals (ASH, ASCO, ESMO etc). Does v0.1 need live portal integrations or just formatted export? | Gap C4 | Yes — needed before Stage 5 screen design |

---

## 15. Design Decisions Log

| ID | Decision | Rationale | Date |
|----|----------|-----------|------|
| DD-B-001 | Module B depends on a linked Module A project — no standalone Module B projects | Protects the core B1 differentiator: CSR-to-manuscript traceability. Without this constraint, a user could create a Module B project without a source CSR and the differentiator collapses. | Sept 2026 |
| DD-B-002 | AI Footprint badge is immutable — cannot be removed by author, only by replacing AI text | Prevents laundering of AI content as human-authored. Required for GPP 2022 and ICMJE transparency. | Sept 2026 |
| DD-B-003 | Fair-balance detection (FR-B-011) is flagging only in v0.1 — not a hard block | SME flagged complexity. A blocking implementation requires calibrated language models specific to pharmaceutical regulatory content. Flagging-only is a safe MVP position that still creates an audit record. | Sept 2026 |
| DD-B-004 | Plagiarism check and pre-submission checks run as a batch at Stage 5 gate, not continuously | Continuous checking would create excessive token consumption and API calls. Batch at the gate is the right UX and cost model. | Sept 2026 |
| DD-B-005 | CrossRef and ORCID APIs are not in PRD v4.1 §9.1 External API Registry — this PRD adds them | PRD v4.1 lists "capture DOI/ORCID metadata" as a Stage 6 output but provides no API to support it. This PRD closes that gap as FR-B-024. §9.1 of the master PRD must be updated. | Sept 2026 |

---

## 16. Version History

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 0.1 | Sept 2026 | GenBioCa / Claude | First version. Built from PRD v4.1 Module B sections + gap analysis. 27 MVP FRs. 4 open SME decisions. 1 Phase 2 item (A5 multi-author collaboration). |

---

## 17. Open Question Resolutions — v0.1 → v0.2

| OQ | Decision | Detail |
|----|----------|--------|
| OQ-B-001 (B5) | **Include (subtle)** | Cross-module source chain surfaced as a compact chip in Publication Plan header ("Source: [CSR title] · Module A") and as the first tab in the Reference Panel ("Source Documents"). Not a prominent banner. Onboarding wizard mentions platform integration once. |
| OQ-B-002 (B6) | **Include (Final Output only)** | Cross-module 21 CFR Part 11 compliance chain surfaced at Stage 6 Final Output only — a "Compliance Provenance" section in the publication record export showing linked Module A audit entries (CSR approval, TLF sign-off, SAP version) alongside Module B record. Not in day-to-day editor UI. |
| OQ-B-003 (C3) | **Include (soft gate)** | ICMJE four-criteria authorship contribution statement per author. System warns if any criterion unmet — does not hard-block submission. Publication Manager acknowledges warning (audit-logged). Contribution statements stored and exported in Final Output package. FR-B-016 extended to cover this. |
| OQ-B-004 (C4) | **Option A — Formatted Export only** | Target congress selected at Stage 1. Platform applies congress formatting rules (word/character limits, structured sections, keyword list, disclosure format) at Stage 5/6 and generates a ready-to-paste export package. Manual submission by medical writer. No portal API in v0.1 — Phase 2 if requested. New FR: FR-B-028. |

**PRD B status after OQ resolution: all 4 open questions closed. Ready for Phase 3 — CD Design.**
