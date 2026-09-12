# GenBioCa — AURORA
## PRD E — Ideation & Publishing (Add-On Module)
### Version 0.3

**Platform name:** Aurora (placeholder — rebrand in progress. Shortlist: AXION, VERIDOC, SYNTHARA, CLARIVA, GENOVA)
**Tagline:** AI-Native Authoring for Life Sciences
**Module colour:** #005F8E (Steel Blue) — locked per PRD v4.1 §19.1. Decision: OQ-E-001 closed Sept 2026.

*Status: First draft — gap analysis complete, SME decisions incorporated, 5 open decisions flagged. Add-on module — available after Modules A–D.*
*Classification: Confidential — Internal Use Only*
*Prepared: September 2026*

---

## 0. Document Control

| Field | Value |
|-------|-------|
| Document | PRD E — Ideation & Publishing, v0.1 |
| Status | First draft. Built from PRD v4.1 §19 (Module E full spec), §4.5, §6.5, and cross-cutting compliance framework table + competitor gap analysis (AURORA_ModuleE_Competitor_Analysis_and_Gaps.xlsx). 11 gap rows confirmed Include. 4 rows pending SME decision (B1–B4). 2 PRD v4.1 internal inconsistencies flagged. |
| Supersedes | — (first version) |
| Built From | PRD v4.1 §19.1–19.5 (Module E workflow, roles, notifications) + §4.5 (deliverables) + §6.5 (roles) + cross-cutting compliance framework table + Module E Competitor Gap Analysis v0.1 (Sept 2026) |
| Module Type | Add-on — available to all clients as an optional add-on after Module D (or independently, per PRD v4.1 §19 intro). Not required for Modules A–D operation. |
| Naming Note | Platform referred to as "Aurora" throughout (placeholder). Module E is the internal identifier — not shown in UI. |
| Dependency | Module E can ingest content from any of the other four modules via the Master Library (tagged content cards from Modules A/B/C/D). It can also accept direct file uploads (Word, PDF) of old artefacts not authored in the platform. Module E does not require all other modules to be active — a client may purchase Module E standalone. |

---

## 0A. Gap Analysis Summary — Input to This PRD

**Source file:** AURORA_ModuleE_Competitor_Analysis_and_Gaps.xlsx
**Competitors reviewed:** MarketBeam, Sprinklr Social, Typeface
**Total gap rows:** 15 (6 Competitor Has/PRD Lacks · 4 Differentiators · 5 GAPs Missing Everywhere)

| ID | Area | Direction | Severity | SME Decision | Where in This PRD |
|----|------|-----------|----------|-------------|-------------------|
| A1 | Source Content Gating — Approval Status Check | Competitor Has | Major | **Include** | FR-E-003 |
| A2 | AI Repurposing Automation — Multi-Format Atomisation | Competitor Has | Major | **Include** | FR-E-007 |
| A3 | Pre-Review Compliance Screening | Competitor Has | Major | **Include** | FR-E-008 |
| A4 | Post-Publish Monitoring — Social Listening | Competitor Has | Medium | **Include** | FR-E-017 |
| A5 | Channel Breadth — 30+ Channel Publishing | Competitor Has | Minor | **Include** | FR-E-015 (scoped) |
| A6 | Market Positioning / Efficiency Claims | Competitor Has | Minor | **Include** | Analytics dashboard (Backlog) |
| B1 | Platform Integration — Native Source Access | Differentiator | Major | **⚠ TBD** | §14 OQ-E-002 |
| B2 | Governance Model — 4-Stage KOL/MA Workflow | Differentiator | Medium | **⚠ TBD** | §14 OQ-E-003 |
| B3 | Metadata Governance — TA Tagging | Differentiator | Minor | **⚠ TBD** | §14 OQ-E-004 |
| B4 | Notification Model — Dual Channel + Named Contacts | Differentiator | Minor | **⚠ TBD** | §14 OQ-E-005 |
| C1 | Claim Currency Verification | GAP | Major | **Include** | FR-E-004 |
| C2 | Source Currency Detection | GAP | Medium | **Include** | FR-E-005 |
| C3 | Claim-Level Provenance | GAP | Major | **Include** | FR-E-009 |
| C4 | Localisation / Multi-Language | GAP | Medium | **Include** | FR-E-018 |
| C5 | Standards Implementation — DOI/ORCID/Dublin Core | GAP | Major | **Include** | FR-E-019 + OQ-E-006 |

**SME notes captured:**
- A5: "Will consume a lot many tokens" — channel breadth scoped conservatively in FR-E-015 with token-budget guardrail
- A6: "Dashboard to show stats" — Backlog item, analytics dashboard
- C4: "Good point" — included as FR-E-018
- C5: "Good point" — included as FR-E-019, with ownership decision flagged as OQ-E-006

**Validation findings from gap analysis (both carried forward):**

**Finding #1 — PRD v4.1 Standards Implementation Gap (Major):**
PRD v4.1's cross-cutting compliance framework table assigns WCAG 2.2/Section 508/PDF/UA, Crossref & ORCID Standards, and Dublin Core Metadata Standards to Module E's compliance scope. PRD v4.1 §19 (Module E's full workflow specification) implements none of it — no DOI/ORCID capture, no Dublin Core metadata tagging, no corresponding entries in the External API Registry (§9.1). This is compounded by Module B (FR-B-024) which also claims to "capture DOI/ORCID metadata" with no supporting API in §9.1. Both modules name the same standards; neither implements them. This PRD adds FR-E-019 to close the gap for Module E's published artefacts, and flags OQ-E-006 for an explicit ownership decision: does Module B handle DOI/ORCID capture for publications, Module E for published ideation content, or is there a single shared DOI/ORCID service?

**Finding #2 — Module E Has No RACI Chart:**
Modules A–D each have a named RACI chart (Charts 1–4, PRD v4.1 §6A). Module E has no RACI chart despite §19.4 naming seven distinct roles. PRD v4.1 §6.5 provides role descriptions but no task-level matrix. This PRD adds a RACI matrix for Module E (§6 FR-E-013) and flags it as OQ-E-007 for SME review — it may be intentional (Module E roles are stage-gated, not task-matrixed) but warrants an explicit decision.

---

## 1. Purpose & Background

Aurora Module E — Ideation & Publishing — is the content repurposing and calendar publishing add-on module. It enables clients to take old or approved artefacts (CSRs, manuscripts, medical affairs decks, regulatory summaries) and transform them into channel-appropriate published content (blog posts, social media, HCP-targeted articles, medical affairs communications) through a four-stage governance workflow: Uploaded → Under Review → Reviewed → Approved.

Module E is the only module in the Aurora platform that is not a regulated document authoring tool. It operates after the regulated document lifecycle — after the CSR is written, the manuscript published, the medical affairs content MLR-cleared, the dossier submitted. Its job is to extract value from the institutional knowledge embedded in those documents and route it through a lightweight but governed KOL and Medical Affairs approval chain before publishing.

Three competitors were analysed: MarketBeam (compliant pharma social publishing), Sprinklr Social (enterprise social management with compliance AI), and Typeface (AI content repurposing). None of them is an authoring platform — they are downstream publishing tools. Aurora's differentiator is the only platform where the source documents for repurposing are the same documents authored, reviewed, and approved within the platform's own audit trail. No import/export needed. No provenance gap.

Module E is functionally distinct from Modules A–D in four ways:
1. No six-stage regulated document workflow — the Ideation workflow has four stages
2. No ICH/ICMJE/ACCME/eCTD compliance requirements — this is commercial/communications content
3. Content quality gates are about brand, claim currency, and source currency — not clinical data accuracy
4. The primary consumer of Module E outputs is the Creative/Marketing team and Medical Affairs communications, not regulatory agencies

---

## 2. Scope

### 2.1 In Scope for v0.1 Build

- The four-stage Ideation workflow: Uploaded → Under Review → Reviewed → Approved (per PRD v4.1 §19.2).
- Content Calendar & Publishing (per PRD v4.1 §19.3): monthly/weekly calendar view, scheduling, publishing date assignment.
- All five Module E deliverable families (from PRD v4.1 §4.5): Tagged Ideation Content Cards, KOL-Reviewed and Approved Content Cards, Calendar-Scheduled Content (blog/articles/social), Published Content, Publishing Calendar.
- All seven Module E roles with contact capture (per PRD v4.1 §19.4).
- Full notification system — stage advance, KOL review invitation, Medical Affairs due date, overdue alerts, SMS gateway (per PRD v4.1 §19.5).
- Source content gating — approval status check at upload (A1).
- AI multi-format content atomisation — one approved artefact → multiple channel-specific content cards (A2).
- Pre-review compliance screening before KOL review (A3).
- Claim currency verification — checks each revived claim is still substantiated (C1).
- Source currency detection — checks uploaded artefact has not been superseded (C2).
- Claim-level provenance — links each content card to its source passage (C3).
- Post-publish social listening and sentiment monitoring (A4).
- Channel publishing — blog, articles, LinkedIn, X/Twitter, Instagram, Facebook, HCP-specific, Medical Affairs communications (A5, conservatively scoped).
- Localisation workflow for global affiliate calendar publishing (C4).
- DOI/ORCID registration and Dublin Core metadata tagging for published artefacts (C5).
- Mandatory TA tagging at all levels (B3).
- RACI matrix for Module E — 7 roles (B2/B4, per Finding #2).
- Dual-channel notifications (email + SMS) per PRD v4.1 §19.5 (B4).
- Master Library integration — pull content cards from Modules A/B/C/D; push published ideation cards back to the library (B1).
- 21 CFR Part 11 audit trail — applied to the ideation workflow and content calendar (cross-cutting platform compliance).

### 2.2 Explicitly Out of Scope for v0.1

- Full 30+ channel publishing (A5 — scoped to 8 named channels; broader channel support is Phase 2).
- Paid social amplification (beyond organic posting).
- Market positioning analytics dashboard (A6 — Backlog).
- Full LMS/SCORM publishing for e-learning content (Module C scope if applicable; not Module E).
- Regulatory document authoring — Module E does not produce documents for health authority submission.

---

## 3. Goals

*The following design principles apply across all Module E FRs:*
1. *Source content used for repurposing must have a traceable connection to an approved, current artefact.*
2. *Every published content card must link back to the specific passage in the original artefact it was drawn from.*
3. *The KOL and Medical Affairs sign-off chain is mandatory before any content reaches the publishing calendar.*
4. *Claim currency (the claim is still valid today) and source currency (the source document has not been superseded) are both verified before content is approved.*

- Enable a Medical Affairs or marketing team to take an approved artefact from anywhere in the Aurora platform and produce published content without leaving the platform or losing the provenance trail.
- Be the only content repurposing tool that connects directly to the regulated document lifecycle — no export/import, no broken provenance.
- Close the PRD v4.1 standards implementation gap: actually implement DOI/ORCID and Dublin Core metadata for published Module E artefacts, not just name them in the compliance framework table.
- Ship a pilot-ready Module E that an Ideation Lead and Content Calendar Manager can use end-to-end through all four ideation stages and the publishing calendar.

---

## 4. Glossary

| Term | Definition |
|------|-----------|
| Ideation content card | A tagged section of an artefact identified as having publishing/repurposing potential |
| Content atomisation | The process of adapting one source artefact into multiple channel-specific content formats |
| Claim currency | The property of a claim being currently substantiated by the approved, current product label and evidence base |
| Source currency | The property of a source artefact being the most current version (not superseded by a newer version or label update) |
| KOL | Key Opinion Leader — an external clinical/scientific expert who reviews ideation content |
| Medical Affairs | Internal Medical Affairs team that approves content before publishing |
| Content calendar | The scheduling interface for assigning approved content cards to publishing dates and channels |
| DOI | Digital Object Identifier — unique persistent identifier for a published artefact |
| ORCID | Open Researcher and Contributor ID — unique identifier for authors |
| Dublin Core | A 15-element metadata standard (DC Metadata Terms) for describing published digital resources |
| Master Library | The cross-module, cross-project tagged content repository |
| UTM | Urchin Tracking Module — URL parameters for tracking digital content performance |
| SMS gateway | Admin-configurable third-party SMS service for mobile notifications |
| LRM / MLR | Legal-Regulatory-Medical / Medical-Legal-Regulatory review |
| TA | Therapeutic Area — mandatory tagging category |
| WCAG 2.2 | Web Content Accessibility Guidelines 2.2 — Level AA compliance target for Module E digital outputs |
| FR-E-### | Functional Requirement identifier, Module E scope |

---

## 5. Architecture Context

### 5.1 Module Position

Module E is the terminal add-on module. It consumes content from all other modules:

```
Module A (CSRs / IBs / Protocols) ──┐
Module B (Manuscripts / Abstracts) ──┤
Module C (HCP Decks / CME / PILs) ──┤→ Master Library → Module E (Ideation & Publishing)
Module D (CTD Summaries / Labels) ──┘                           ↓
                                              Content Calendar → Channel Publishing
                                                                 ↓
                                              Published Cards → Master Library (push back)
```

Module E can also ingest external uploads (Word, PDF) of artefacts not authored in the platform. These uploads bypass the Master Library and enter the ideation workflow directly. The source currency check (FR-E-005) applies at upload to flag artefacts that may have been superseded.

### 5.2 Architecture Rules (adapted from Modules A–D; Module E is lighter)

1. **Module boundary enforcement:** Module E can read from the Master Library (cross-module data) but must not import directly from individual module components.
2. **Audit trail required:** Every ideation stage transition, KOL review decision, Medical Affairs approval, and publishing event is logged to the audit trail. Module E's audit trail is lighter than Modules A–D (no 21 CFR Part 11 e-signatures required on ideation content cards — only on final publishing approval).
3. **Human sign-off mandatory at Stage 4:** KOL approval + Medical Affairs Team Lead approval are both required before content enters the publishing calendar. Neither is automated.
4. **TA tag mandatory:** Same as all modules.

### 5.3 Shared Infrastructure

Module E reuses the following from the platform:
- Authentication, MFA, Terms Gate, AppShell (Modules A/B/C/D)
- Voice Note Panel (Module A Session 12) — used by Voice Note Contributors at Stage 2
- Audit Trail Panel (Module A Session 14)
- Master Library read/write (§7.6 platform feature)
- Notification engine (email + SMS per §19.5) — Module E-specific configuration

Module E adds new screens and panels for: Artefact Upload & Source Currency Check, Ideation Content Card Tagging, AI Atomisation Panel, Pre-Review Compliance Screening Panel, KOL Review Interface, Medical Affairs Approval Panel, Content Calendar, Publishing Monitor, Social Listening Panel, DOI/Dublin Core Metadata Panel.

### 5.4 Key Architecture Note: Module E Has No Full Document Editor

Unlike Modules A–D, Module E does not have a document editor for creating new regulated documents. Its content creation is limited to:
- Tagging sections of uploaded artefacts as ideation content cards
- AI-generated reformatting of tagged sections into channel-specific formats (FR-E-007)
- Human editing of AI-generated channel content before KOL review

The absence of a full document editor is intentional. Module E repurposes existing approved content; it does not author new regulated documents.

### 5.5 Architecture Flag: Cross-Module Claim Provenance Service

Gap C3 (claim-level provenance) is the fourth time this traceability requirement has appeared across modules (Module A FR-A-001 family, Module B FR-B-006 AI Footprint, Module C §5.4 flag, Module E FR-E-009). This confirms the pattern flagged in Module C §5.4: there is a single underlying "Source Anchor" service that all five modules need. Before Module E design begins, the architecture team should confirm whether this service is being built as a shared platform component or as four separate module-specific implementations. Module E's FR-E-009 is written assuming the shared service exists and Module E is a consumer of it.

---

## 6. Functional Requirements

### 6.1 Stage 1 — Uploaded

**FR-E-001 — Artefact Upload & Project Tagging** *(MVP)*
The Ideation Lead uploads an old artefact (Word or PDF) under a named project. At upload:
- TA tag is mandatory before the upload completes
- Module of origin is tagged if known (A/B/C/D or External)
- Document metadata entered: title, original author, original publication/approval date, document type
- The uploaded document enters Uploaded status immediately

Per PRD v4.1 §19.1 and §19.2 Stage 1.

**FR-E-002 — Master Library Pull** *(MVP)*
As an alternative to file upload, the Ideation Lead can pull an approved content card directly from the Master Library:
- Search and filter by TA, module of origin, content type, approval date
- Selected cards retain their original provenance metadata from the originating module
- Master Library pull bypasses the source currency check (FR-E-005) for cards pushed within the last 90 days — these are current by definition. Cards older than 90 days receive a lightweight source currency check: (a) verify the source module document has not been superseded, and (b) verify the product label version has not been updated since the card was pushed. If either check fails, a warning is shown to the Ideation Lead before adding the card to the project.

**FR-E-003 — Source Content Gating — Approval Status Check** *(MVP — Gap A1)*
Before a file-uploaded artefact proceeds past Uploaded status:
- The system checks whether the document has a record in the platform (i.e., was it authored in Aurora?) or is an external upload
- For platform-authored artefacts: the system checks its approval status in the originating module. Only documents with status "Signed" (Module A), "Final Output" (Modules B/C), or "Submitted/Approved" (Module D) can proceed. Draft or in-review documents are blocked.
- For external uploads: the Ideation Lead must explicitly confirm that the document was formally approved via an external process. This confirmation is logged to the audit trail.
- Rationale: "a hard gate requiring that only previously-approved/published content can be ingested as source material for repurposing" (MarketBeam pattern). No unapproved content enters the ideation pipeline.

**FR-E-004 — Claim Currency Verification** *(MVP — Gap C1)*
After upload and before Stage 2, the system runs an automated claim currency check:
- All substantive claims in the uploaded artefact are extracted and compared against the current approved product label (SmPC/USPI, sourced from Module D if available, or from Admin-uploaded label)
- Claims that appear in the artefact but no longer appear in the current approved label are flagged as "Potentially Superseded"
- Claims that contradict the current approved label are flagged as "Conflicting — Do Not Use"
- The Ideation Lead must acknowledge each flag before Stage 2 proceeds
- Acknowledged flags and resolution decisions are logged to the audit trail

No competitor identified offers this check. This is Aurora's primary quality differentiator for repurposed content in a regulated context.

**FR-E-005 — Source Currency Detection** *(MVP — Gap C2)*
At upload, the system checks whether the uploaded artefact has been superseded:
- For platform-authored artefacts: the system checks whether a newer version exists in the same module and project. If yes, the Ideation Lead is warned and must confirm they intend to use the older version.
- For external uploads: the system checks if the document title/ID matches any existing document in the platform — if a newer version is found, the same warning is triggered.
- For all uploads: the system checks the upload date against the current product label version. If the label has been updated since the artefact was originally approved, a "Label Updated Since Source Approval" flag is raised.
- Source currency flags are informational warnings, not hard blocks (unlike source content gating in FR-E-003). The Ideation Lead may proceed with acknowledged warnings.

---

### 6.2 Stage 2 — Under Review

**FR-E-006 — Voice Note Tagging & Section Ideation** *(MVP)*
Per PRD v4.1 §19.2 Stage 2: up to three Voice Note Contributors per project record voice notes against the uploaded document. The Voice Note Panel (Module A infrastructure, Session 12) is reused. Voice notes are auto-transcribed. After transcription:
- Each voice note is associated with a specific section of the uploaded document
- The Ideation Lead tags sections as "ideation potential" based on voice note content and manual review
- Tagged sections become Ideation Content Cards — discrete units of content with: source document reference, tagged passage, TA tag, module of origin, and ideation category (blog/social/HCP/medical affairs)

**FR-E-007 — AI Multi-Format Content Atomisation** *(MVP — Gap A2)*
Once sections are tagged as ideation content cards, the system offers AI-powered atomisation:
- The Ideation Lead selects a tagged section and a target channel format
- AI generates channel-specific adaptations: LinkedIn post (≤3000 chars), X/Twitter post (≤280 chars), blog post excerpt (500–800 words), email snippet (150–200 words), HCP-targeted summary (clinical framing), Medical Affairs communication (formal register)
- Each AI-generated adaptation is marked with an AI Footprint indicator (consistent with Modules B/C/D — immutable, audit-logged)
- Brand guideline checks run automatically on each generated adaptation (per FR-E-008)
- SME note on A5: "will consume a lot many tokens" — the atomisation call is a single structured AI call per channel format, not a multi-step chain. Token usage is monitored and reported per content card in the Admin console.
- **Editing scope (DD-E-001):** Channel adaptations generated by AI atomisation are editable by the Ideation Lead before KOL review — this is the only place in Module E where text is directly edited. The source document (from FR-E-006 tagging) remains read-only at all times (DD-E-001). Editing a channel adaptation is editing the AI-generated derivative, not the source document.

**FR-E-008 — Pre-Review Compliance Screening** *(MVP — Gap A3)*
Before AI-generated or manually drafted content cards proceed to KOL review:
- Automated screening checks: non-compliant language detection (promotional superlatives, comparative efficacy claims without citation, off-label language), brand guideline violations (terminology, tone), fair-balance check (efficacy claims without safety qualifier)
- Issues are categorised: Must Fix (blocks KOL submission) / Advisory (shown but does not block)
- The Ideation Lead must resolve all Must Fix issues before content enters Stage 3 (Under Review → KOL)
- This is the Module E equivalent of Module C's pre-MLR check (FR-C-015), adapted for ideation/communications content rather than regulated promotional materials

**FR-E-009 — Claim-Level Provenance Tagging** *(MVP — Gap C3)*
Every substantive claim in an ideation content card is linked to its source:
- Source document title and version
- Specific section and paragraph in the source document
- The exact passage from which the claim was derived
- Approval status of the source document at the time of card creation

This provenance record is:
- Displayed to the KOL reviewer alongside the content card (KOL can see exactly what source material each claim comes from)
- Displayed to the Medical Affairs Team Lead at Stage 4
- Included in the published content metadata (not visible in the published post, but logged and searchable in the platform)
- Consistent with the shared claim provenance architecture flag in §5.5

**FR-E-010 — KOL Review Invitation & Interface** *(MVP)*
Per PRD v4.1 §19.2 Stage 2 / §19.5:
- KOL contact details (name, email, mobile) captured at project setup
- When content enters Under Review status, the KOL receives a secure email invitation with: project name, document title, TA tag, content card sections, KOL name, and a secure one-time review link
- KOL review interface shows: the content card, the claim provenance (FR-E-009), the claim currency flags (FR-E-004), and the original source passage
- KOL can: approve sections, reject sections with comments, request modifications
- KOL actions are captured and logged to the audit trail

---

### 6.3 Stage 3 — Reviewed

**FR-E-011 — KOL Feedback Capture & Resolution** *(MVP)*
Per PRD v4.1 §19.2 Stage 3:
- All KOL comments are captured as structured review notes against each content card section
- The Ideation Lead reviews KOL feedback, makes modifications, and responds to comments
- Resolution decisions are logged (accepted / accepted with modification / rejected)
- Once all KOL comments are resolved, the Ideation Lead progresses content to Stage 4 (Approved)


---

### 6.4 Stage 4 — Approved

**FR-E-012 — Medical Affairs Team Lead Review** *(MVP)*
Per PRD v4.1 §19.2 Stage 4:
- Medical Affairs Team Lead contact details (name, email, mobile) captured at project setup
- The Medical Affairs Team Lead reviews the KOL-reviewed content cards before calendar scheduling
- Review focuses on: alignment with medical strategy, fair-balance, accuracy, channel appropriateness
- Medical Affairs review uses the same pre-review compliance screening output (FR-E-008) as a working checklist

**FR-E-013 — RACI Matrix — Module E Roles** *(MVP — Finding #2)*
Module E is the only module without a RACI chart in PRD v4.1. This PRD adds one. Seven roles, Admin-editable:

| Role | Contact Capture | Primary Responsibility |
|------|----------------|----------------------|
| Ideation Lead | User profile | Uploads artefacts; tags content; manages ideation workflow; triggers stage transitions |
| Voice Note Contributor (up to 3) | User profile or guest entry | Records voice notes against ideation content |
| KOL (external) | Name, email, mobile (project setup) | Reviews content cards; approves/rejects at Stage 3 |
| Medical Affairs Team Lead | Name, email, mobile (project setup) | Reviews and approves content before publishing schedule; receives due-date notifications |
| Medical Affairs Team Member(s) | Name, email, mobile (project setup; multiple) | Receives publishing due-date notifications; reviews; triggers creative team |
| Creative/Marketing Team Member | Name, email (project setup or user profile) | Executes publishing of approved content on scheduled dates |
| Content Calendar Manager | User profile | Sets publishing dates; assigns content to calendar slots; manages schedule |

**Task-level RACI:**

| Task | Ideation Lead | Voice Note Contributor | KOL | MA Lead | MA Member | Creative | Cal Manager |
|------|--------------|------------------------|-----|---------|-----------|----------|-------------|
| Upload artefact & tag sections | **R/A** | I | I | I | I | I | I |
| Record voice notes | C | **R/A** | I | I | I | I | I |
| AI atomisation & compliance screen | **R** | I | I | C | I | I | I |
| KOL review & approval | I | I | **R/A** | C | I | I | I |
| Medical Affairs review | C | I | I | **R/A** | C | I | I |
| Schedule content on calendar | C | I | I | C | I | I | **R/A** |
| Execute publishing | I | I | I | I | C | **R** | A |
| Post-publish monitoring | C | I | I | **A** | C | R | C |

**FR-E-014 — KOL + Medical Affairs E-Sign Approval** *(MVP)*
At Stage 4:
- KOL digital sign-off on approved content cards (name, email, date — lighter than 21 CFR Part 11 e-signature; this is not a regulated submission)
- Medical Affairs Team Lead digital sign-off on approved content cards before calendar scheduling
- Both approvals are logged to the audit trail with timestamp and approval scope

---

### 6.5 Content Calendar & Publishing

**FR-E-015 — Content Calendar Interface** *(MVP)*
Per PRD v4.1 §19.3:
- Monthly and weekly calendar views
- Each date slot shows: content title, type, assigned creative/marketing team member, Medical Affairs reviewer
- Content Calendar Manager assigns approved content cards to publishing dates and channels
- Supported channels in v0.1 (conservatively scoped per SME note on token budget and A5): Blog posts, Articles, LinkedIn, X/Twitter, Instagram, Facebook, HCP-targeted content, Medical Affairs communications
- Phase 2: broader channel support (30+ channels per Sprinklr benchmark)

**FR-E-016 — Publishing Workflow & Tracking** *(MVP)*
Per PRD v4.1 §19.3:
- On scheduled publishing date: Creative/Marketing team member receives notification to publish
- System tracks: published on schedule / early / late
- Post-publishing record: actual publish date, channel/platform, publishing team member — logged to audit trail and project dashboard
- UTM parameters and SEO metadata captured at publish time (per §4.5 deliverables: "Tracking Links (UTM parameters) & SEO Metadata Files")

**FR-E-017 — Post-Publish Social Listening & Sentiment Monitoring** *(MVP — Gap A4)*
After content is published:
- Social listening monitors mentions, engagement, and sentiment for published content across tracked channels
- Configurable sentiment threshold: if negative sentiment exceeds the configured threshold, an alert is sent to the Medical Affairs Team Lead
- Auto-stop-publishing safeguard: if a future-scheduled piece of content on the same topic has a negative sentiment alert on the same product, the Content Calendar Manager is notified to review before the scheduled post goes live
- Social listening data is stored against the published content card in the project record

**FR-E-018 — Localisation Workflow for Global Affiliate Publishing** *(MVP — Gap C4)*
- Approved content cards can be flagged for localisation (specific countries/languages)
- Country affiliate teams receive localised review links with the source card and the target language
- Localised adaptations are reviewed by the country affiliate Medical Affairs contact before publishing to that country's channel
- Localised versions are linked to the parent approved card and stored under the same project record
- Per SME note on C4: "good point." Per Module C OQ-C-001 (localisation PRD contradiction): this PRD scopes localisation as a human translation workflow (affiliate team adapts content in the target language), not automated machine translation. Consistent with Module C §5.1 resolution path.

---

### 6.6 Standards & Metadata

**FR-E-019 — DOI/ORCID Registration & Dublin Core Metadata** *(MVP — Gap C5)*
This FR closes the PRD v4.1 standards implementation gap identified in the gap analysis:

**DOI registration (for published artefacts designated for permanent citation):**
- Ideation content cards that are designated as citable artefacts (long-form articles, white papers, formal medical affairs communications) can be DOI-registered via the CrossRef API
- DOI is captured and stored against the published content card
- Note: CrossRef/ORCID APIs are also referenced in Module B FR-B-024. OQ-E-006 requires an ownership decision: shared platform service or module-specific implementations.

**ORCID author verification:**
- For citable artefacts, all listed authors/contributors must have their ORCID iDs verified
- ORCID API called to verify each listed contributor's ORCID exists and is publicly available
- ORCID iDs stored against the published content card

**Dublin Core metadata tagging:**
- All published Module E artefacts receive Dublin Core metadata tags on publication:
  - dc:title, dc:creator, dc:subject (TA tag), dc:description, dc:date, dc:type, dc:format, dc:identifier (DOI if registered), dc:rights
- Metadata is embedded in the published asset's PDF/HTML output and stored in the platform
- This implements the "Dublin Core Metadata Standards" and "Crossref & ORCID Standards" assigned to Module E in PRD v4.1's compliance framework table — the only place in the platform where these standards are actually implemented

**WCAG 2.2 / Section 508 / PDF/UA:**
- All Module E digital content outputs (long-form articles, HCP summaries, PDF and HTML published artefacts) must pass WCAG 2.1 Level AA accessibility checks before publishing — consistent with Module C FR-C-022 which uses WCAG 2.1 AA for content outputs. Note: the Aurora platform UI itself targets WCAG 2.2 AA; this distinction is the same as in Module C.
- Uses the same WCAG 2.1 content output checking engine as Module C FR-C-022


---

### 6.7 Notification Engine

**FR-E-020 — Notification Engine — Full Specification** *(MVP — Differentiator B4)*
Per PRD v4.1 §19.5, the complete notification specification:

- **Stage advance notifications:** when a content card moves Uploaded → Under Review → Reviewed → Approved, all relevant role holders receive email and in-app notifications
- **KOL review invitation:** when content enters Under Review, the KOL receives a secure email to the captured KOL email with: project name, document title, TA tag, content sections, KOL name, and a secure one-time login link
- **Medical Affairs due-date notifications:** sent to all captured Medical Affairs team members at the configured advance notice period before each publishing date. **Default: 3 days advance notice.** Configurable by the Content Calendar Manager.
- **Publishing overdue alerts:** if content is not published within 24 hours of scheduled date, an overdue alert is sent to the Medical Affairs Team Lead and Content Calendar Manager
- **SMS notifications:** for Medical Affairs team members and KOLs with captured mobile numbers, SMS is sent in addition to email for time-sensitive events (publishing due dates, KOL review requests). SMS gateway is Admin-configurable (Twilio/AWS SNS/Vonage — see §12 procurement)
- **KOL review reminder:** if the KOL has not submitted their review within 3 days of the initial invitation, an automated reminder email is sent (and SMS if mobile is captured). A second reminder is sent at 5 days. After 7 days with no response, an escalation alert is sent to the Ideation Lead and Medical Affairs Team Lead. Reminder events are logged to the audit trail.
- **Dual-channel model (B4 differentiator):** email + SMS notifications tied to specific named contacts with configurable advance-notice periods and overdue escalation — not available in any of the three competitors analysed

---

## 7. Confirmed Differentiators (Protect — No New Build Without PRD Update)

| ID | Differentiator | Why It Matters |
|----|----------------|----------------|
| B1 | Native platform integration — source content is already in the platform (FR-E-002/003) | All three competitors require manual export from wherever the source content lives. Aurora users pull directly from the Master Library with full provenance intact. |
| C1 | Claim currency verification (FR-E-004) | No competitor verifies that a revived claim is still currently substantiated. Aurora blocks the publication of superseded medical claims. |
| C3 | Claim-level provenance on every published content card (FR-E-009) | No competitor links published content back to the specific passage in the source document. Aurora makes this provenance mandatory and visible to KOL reviewers. |
| C5 | Actually implements DOI/ORCID/Dublin Core (FR-E-019) | PRD v4.1 names these standards but does not implement them anywhere. This PRD implements them for the first time, making Module E the compliance home for published artefact standards. |
| Cross-module | Single audit trail from original regulated document (Module A/B/C/D) to published ideation content (Module E) | No competitor can trace a published blog post back to the clinical study report it was derived from. Aurora does. |

---

## 8. Non-Functional Requirements

### 8.1 Compliance & Audit

- 21 CFR Part 11 audit trail (cross-platform): every ideation stage transition, approval, scheduling, and publishing event is logged. Note: the audit trail logging in Module E is 21 CFR Part 11 compliant per the platform-wide standard. However, the digital sign-offs in Module E (KOL sign-off and Medical Affairs sign-off per FR-E-014) are not full 21 CFR Part 11 e-signatures — they are digital approval stamps (name, email, timestamp) appropriate for Module E's non-regulated document type. Full 21 CFR Part 11 e-signatures are only required for publishing approval of formally designated artefacts registered for DOI (FR-E-019).
- GDPR: KOL and Medical Affairs contact details (name, email, mobile) are personal data. Explicit consent capture required at project setup. Data stored per Admin-configured residency. Contact records are purged per GDPR retention policy if the project is closed.
- WCAG 2.1 Level AA: all Module E digital content outputs (PDF, HTML articles, HCP summaries) must pass (implemented via FR-E-019 using Module C WCAG content output engine). Note: the platform UI remains WCAG 2.2 AA — this standard applies only to published content outputs, consistent with Module C FR-C-022.

### 8.2 Security

- KOL secure review links: one-time-use tokens with configurable expiry (default 7 days). Links are not reusable after KOL sign-off.
- Medical Affairs contact mobile numbers: treated as personal data; encrypted at rest; used only for notification triggers.
- Published content: Module E does not store or transmit to social platforms directly in v0.1 — the publishing step is human-executed by the Creative/Marketing team member who is notified. Platform integration publishing connectors are Phase 2.

### 8.3 Performance

- AI atomisation (FR-E-007): channel-specific content generated within 10 seconds per channel format.
- Claim currency check (FR-E-004): complete within 30 seconds.
- Source currency check (FR-E-005): complete within 15 seconds.
- Pre-review compliance screening (FR-E-008): complete within 30 seconds.
- WCAG check on PDF output: complete within 60 seconds.

### 8.4 Token Cost Management

- AI atomisation (FR-E-007) is the primary token cost driver in Module E. Each atomisation call generates 1 channel-specific adaptation. A single content card adapted to all 8 channels = 8 calls. Token usage is monitored per project and per content card. Admin-configurable budget alerts apply.
- SME note on A5: "will consume a lot many tokens" — channel breadth is conservatively scoped at 8 channels in v0.1 (not 30+).

---

## 9. Data Model Stub

New entities required for Module E:

| Entity | Key Fields | Notes |
|--------|-----------|-------|
| `ideation_project` | id, project_id, source_type (master-library/upload/external), ta_tag, status (uploaded/under-review/reviewed/approved), created_by | Core Module E project entity |
| `ideation_artefact` | id, ideation_project_id, source_module (A/B/C/D/external), source_doc_id (nullable), file_path (nullable), title, original_approval_date, version, source_currency_status (current/superseded/warned), approval_status_check (passed/blocked/confirmed-external) | Source artefact record |
| `ideation_content_card` | id, ideation_artefact_id, source_section, source_passage, claim_currency_status, channel_formats (JSONB array), kol_status (pending/approved/rejected), ma_status (pending/approved/rejected), overall_status (uploaded/under-review/reviewed/approved/rejected — derived from kol_status + ma_status + parent project stage; stored as denormalised field for query performance), provenance (JSONB — source doc, section, passage, approval_date) | Core content unit — overall_status derivation: kol_status=approved AND ma_status=approved → approved; kol_status=approved AND ma_status=pending → reviewed; kol_status=pending → under-review or uploaded per parent stage; either rejected → rejected |
| `atomised_content` | id, ideation_content_card_id, channel (linkedin/twitter/blog/email/hcp/medical-affairs/instagram/facebook), content_text, ai_generated, ai_footprint_hash, brand_screen_passed, compliance_screen_passed | Channel-specific content adaptation |
| `claim_currency_check` | id, ideation_artefact_id, run_at, claims_extracted (JSONB), superseded_claims (JSONB), conflicting_claims (JSONB), acknowledged_by, acknowledged_at | Claim currency gate |
| `kol_contact` | id, ideation_project_id, name, email, mobile_encrypted, review_link_token, review_link_expiry, signed_off_at | KOL contact + review access |
| `ma_contact` | id, ideation_project_id, role (lead/member), name, email, mobile_encrypted, notification_preference | Medical Affairs contact |
| `calendar_entry` | id, ideation_content_card_id, channel, scheduled_date, assigned_creative_id, status (scheduled/published/overdue/cancelled), published_at, published_by | Content calendar record |
| `publish_record` | id, calendar_entry_id, channel, published_at, published_by, utm_params, seo_metadata (JSONB), sentiment_score (nullable), sentiment_alert_sent | Post-publish tracking |
| `doi_record` | id, ideation_content_card_id, doi, registered_at, crossref_response (JSONB) | DOI registration |
| `dublin_core_metadata` | id, ideation_content_card_id, dc_title, dc_creator, dc_subject, dc_description, dc_date, dc_type, dc_format, dc_identifier, dc_rights, tagged_at | Dublin Core record |
| `social_listening_alert` | id, publish_record_id, alert_type (sentiment/engagement), threshold_breached, triggered_at, notified_ma_lead_at, auto_stop_triggered | Sentiment monitoring alert |

---

## 10. Regulatory & Standards Framework — Module E

Source: PRD v4.1 cross-cutting compliance framework table (Module E row) and §19

| Framework | Issuer | Version | Scope in Module E |
|-----------|--------|---------|-------------------|
| WCAG 2.1 Level AA (content outputs) / WCAG 2.2 Level AA (platform UI) / Section 508 | W3C / US Congress | 2018 / 2023 / Current | WCAG 2.1 AA mandatory for all Module E published content outputs (PDF, HTML articles, HCP summaries). Platform UI targets WCAG 2.2 AA. Section 508 applies for US federal accessibility compliance. |
| PDF/UA (ISO 14289-1) | ISO | 2014 | PDF accessibility for published artefacts |
| Crossref & ORCID Standards | Crossref / ORCID | Current | DOI registration and ORCID verification for citable published artefacts (FR-E-019) |
| Dublin Core Metadata Terms | Dublin Core Metadata Initiative | 2020 | Structured metadata tagging for all published Module E artefacts (FR-E-019) |
| GDPR (EU) 2016/679 | EU | 2018 | KOL and Medical Affairs contact personal data; consent and retention |
| 21 CFR Part 11 | FDA (US) | Current | Audit trail for ideation workflow, approvals, and publishing events (cross-platform) |

Note: Module E does not inherit the ICH/ICMJE/ACCME/eCTD/MLR frameworks from Modules A–D — it produces communications/marketing content, not regulated clinical or submission documents.

---

## 11. Phase & Priority Plan

### Full FR List with Phase Assignments

| FR | Description | Phase | Source |
|----|-------------|-------|--------|
| FR-E-001 | Artefact upload & project tagging | MVP | PRD v4.1 §19.1, §19.2 Stage 1 |
| FR-E-002 | Master Library pull | MVP | PRD v4.1 §7.6, §4.5 |
| FR-E-003 | Source content gating — approval status check | MVP | Gap A1 |
| FR-E-004 | Claim currency verification | MVP | Gap C1 |
| FR-E-005 | Source currency detection | MVP | Gap C2 |
| FR-E-006 | Voice note tagging & section ideation | MVP | PRD v4.1 §19.2 Stage 2 |
| FR-E-007 | AI multi-format content atomisation | MVP | Gap A2 |
| FR-E-008 | Pre-review compliance screening | MVP | Gap A3 |
| FR-E-009 | Claim-level provenance tagging | MVP | Gap C3 |
| FR-E-010 | KOL review invitation & interface | MVP | PRD v4.1 §19.2, §19.5 |
| FR-E-011 | KOL feedback capture & resolution | MVP | PRD v4.1 §19.2 Stage 3 |
| FR-E-012 | Medical Affairs team lead review | MVP | PRD v4.1 §19.2 Stage 4 |
| FR-E-013 | RACI matrix — Module E 7 roles | MVP | PRD v4.1 §6.5, §19.4 + Finding #2 |
| FR-E-014 | KOL + Medical Affairs digital sign-off | MVP | PRD v4.1 §19.2 Stage 4 |
| FR-E-015 | Content calendar interface | MVP | PRD v4.1 §19.3 |
| FR-E-016 | Publishing workflow & tracking | MVP | PRD v4.1 §19.3 |
| FR-E-017 | Post-publish social listening & sentiment | MVP | Gap A4 |
| FR-E-018 | Localisation workflow | MVP | Gap C4 |
| FR-E-019 | DOI/ORCID/Dublin Core metadata | MVP | Gap C5 + PRD v4.1 compliance table |
| FR-E-020 | Notification engine — full spec | MVP | PRD v4.1 §19.5 |
| — | 30+ channel publishing connectors | **Phase 2** | Gap A5 (full scope) |
| — | Direct platform-to-social-channel API publishing | **Phase 2** | Requires OAuth connectors per channel |
| — | Market positioning analytics dashboard | **Backlog** | Gap A6 |

**Total MVP FRs: 20**


---

## 12. Dependencies & Procurement Items

| Item | Type | Owner | Notes |
|------|------|-------|-------|
| CrossRef API — DOI registration | External API (NOT in PRD v4.1 §9.1) | Engineering | Required for FR-E-019. CrossRef membership required. See also Module B FR-B-024 and OQ-E-006 — ownership decision needed before procurement. |
| ORCID Member API — author verification | External API (NOT in PRD v4.1 §9.1) | Engineering | Required for FR-E-019. ORCID Member organisation registration required. See OQ-E-006. |
| SMS gateway | Third-party service (PRD v4.1 §19.5 — configurable) | Engineering | Admin-selectable SMS provider. Options: Twilio, AWS SNS, Vonage. Procurement required. GDPR compliance for EU mobile numbers required. |
| Social listening API | External API | Engineering | Required for FR-E-017. Options: Brandwatch, Mention, Sprout Social API. Not in PRD v4.1 §9.1. Decision needed before sprint. |
| WCAG 2.2 automated testing library | Open-source | Engineering | Same as Module C (axe-core or Pa11y). Re-use existing procurement from Module C. |
| Brand guideline data | Content (per client) | Client onboarding | Required for FR-E-008 brand compliance screening. Each client provides approved terminology list and brand rules at onboarding. |
| Current product label (SmPC/USPI) | Content | Module D or Admin upload | Required for FR-E-004 claim currency check. If Module D is active in the project, label is pulled from Module D. If not, Admin uploads the current label file at project setup. |

---

## 13. Traceability

| FR | PRD v4.1 Source | Gap Analysis Row |
|----|----------------|-----------------|
| FR-E-001 | §19.1, §19.2 Stage 1 | — |
| FR-E-002 | §7.6 Master Library, §4.5 | — |
| FR-E-003 | §19.2 Stage 1 (upload) | A1 |
| FR-E-004 | — | C1 |
| FR-E-005 | — | C2 |
| FR-E-006 | §19.2 Stage 2 — voice notes | — |
| FR-E-007 | — | A2 |
| FR-E-008 | — | A3 |
| FR-E-009 | — | C3 |
| FR-E-010 | §19.2 Stage 2, §19.5 KOL invitation | — |
| FR-E-011 | §19.2 Stage 3 | — |
| FR-E-012 | §19.2 Stage 4 — MA review | — |
| FR-E-013 | §6.5 + §19.4 + Finding #2 (no RACI in PRD v4.1) | — |
| FR-E-014 | §19.2 Stage 4 — approval | B2 |
| FR-E-015 | §19.3 — content calendar | B3 (TA tagging carried through) |
| FR-E-016 | §19.3 — publishing & tracking | — |
| FR-E-017 | — | A4 |
| FR-E-018 | — | C4 |
| FR-E-019 | PRD v4.1 compliance framework table (Module E row) | C5 |
| FR-E-020 | §19.5 — full notification spec | B4 |

---

## 14. Open Questions Before Design Phase

| ID | Question | Source | Blocker? |
|----|----------|--------|----------|
| OQ-E-001 | **Module Colour Inconsistency — RESOLVED:** Steel Blue #005F8E confirmed per PRD v4.1 §19.1. Design system and engineering docs to be updated to #005F8E. | PRD v4.1 §19.1 vs design system | **Closed Sept 2026** |
| OQ-E-002 | **B1 — Platform Integration Differentiator UI:** Should the fact that source content comes directly from the platform's own audit trail (vs. competitors' manual import) be surfaced explicitly in the Module E upload/pull UI? How does this affect the upload vs Master Library pull distinction in the UX? | Gap B1 | No — design can proceed with FR-E-001/002 as specified |
| OQ-E-003 | **B2 — Governance Model:** The four-stage KOL/MA workflow is a strong differentiator but the stages are fixed (Uploaded → Under Review → Reviewed → Approved). Should the Content Calendar Manager be able to add intermediate approval steps for specific clients, or is the four-stage model fixed for all? | Gap B2 | No — fixed model is specified in PRD v4.1 §19.2; configurable stages are Phase 2 |
| OQ-E-004 | **B3 — TA Tagging Inheritance:** When an ideation content card is pulled from the Master Library, it inherits the TA tag from the source module. When an artefact is uploaded externally, the Ideation Lead assigns the TA tag manually. Should the system validate the manually assigned TA tag against the platform's master TA taxonomy, or allow free-text entry? | Gap B3 | No — design can proceed; platform master TA taxonomy validation is recommended |
| OQ-E-005 | **B4 — SMS Gateway Procurement:** PRD v4.1 §19.5 specifies SMS notifications as a named feature with a configurable SMS gateway. Which SMS provider should be the default? (Options: Twilio, AWS SNS, Vonage.) This affects the procurement dependency in §12. | Gap B4 + PRD v4.1 §19.5 | **Yes — SMS gateway must be procured before FR-E-020 can be built** |
| OQ-E-006 | **C5 — DOI/ORCID Ownership Decision:** Both Module B (FR-B-024) and Module E (FR-E-019) reference DOI/ORCID capture. Module B captures DOI/ORCID for published journal manuscripts. Module E captures DOI/ORCID for published ideation artefacts. PRD v4.1's compliance framework table places Crossref & ORCID Standards under Module E — not Module B. Decision needed: (a) single shared CrossRef/ORCID API service used by both modules, (b) Module B owns DOI/ORCID for journal publications + Module E owns DOI/ORCID for published ideation content as two separate calls to the same APIs, (c) Module E is the sole owner and Module B uses Module E's service for its DOI/ORCID needs. Option (a) — shared service — is recommended and consistent with the cross-module architecture approach taken for Regulatory Intelligence (Module D FR-D-024) and claim provenance (§5.5 flag). | Gap C5 + Finding #1 + Module B FR-B-024 | **Yes — affects Module B and Module E API procurement** |
| OQ-E-007 | **No RACI Chart in PRD v4.1 §6A (Finding #2):** Module E is the only module without a named RACI chart in PRD v4.1. This PRD adds one (FR-E-013). Is the proposed RACI matrix correct, or should Module E remain without a formal task-level RACI given that the four-stage workflow implicitly encodes the responsibility model? | Finding #2 | No — FR-E-013 as specified is a reasonable starting position; SME review confirms or adjusts |

---

## 15. Design Decisions Log

| ID | Decision | Rationale | Date |
|----|----------|-----------|------|
| DD-E-001 | Module E has no document editor — content creation is limited to tagging, AI atomisation, and human editing of channel-specific adaptations | Module E repurposes existing approved content. A full document editor would make it a sixth authoring module, which contradicts its design intent. | Sept 2026 |
| DD-E-002 | Source content gating (FR-E-003) is a hard block for platform-authored artefacts below "Signed/Final" status; external uploads require explicit Ideation Lead confirmation | Draft documents are not stable sources for repurposing. Requiring confirmation for external uploads is a balance between usability and quality governance — the Ideation Lead takes responsibility, which is audit-logged. | Sept 2026 |
| DD-E-003 | Claim currency check (FR-E-004) is mandatory at upload but acknowledgement-based, not a hard block | A hard block would prevent repurposing of artefacts with any superseded claim — too restrictive. The Ideation Lead acknowledges and resolves each flag; this balances quality control with usability. | Sept 2026 |
| DD-E-004 | AI atomisation (FR-E-007) is one call per channel format, not a multi-step chain | Minimises token cost per the SME note ("will consume a lot many tokens"). Each channel format is a single structured prompt with enforced output constraints. Token usage is reported per card. | Sept 2026 |
| DD-E-005 | v0.1 publishing is human-executed — the platform notifies the Creative/Marketing team member to publish, but does not directly connect to social platform APIs | Direct API publishing connectors (OAuth per channel) are a Phase 2 item. Human-executed publishing in v0.1 avoids the compliance and rate-limiting complexity of 8+ social platform API integrations at launch. | Sept 2026 |
| DD-E-006 | DOI/ORCID and Dublin Core (FR-E-019) are implemented in Module E as the compliance framework table mandates — not in Module B despite Module B FR-B-024 also referencing DOI/ORCID | PRD v4.1's compliance table explicitly places Crossref & ORCID Standards and Dublin Core under Module E. Module B's DOI/ORCID reference (FR-B-024) is a workflow step (capture metadata); Module E's is the actual API implementation. OQ-E-006 governs whether they share the same API service. | Sept 2026 |
| DD-E-007 | Module E colour is documented as uncertain pending OQ-E-001 resolution — all design specs are written with a colour placeholder | **Resolved:** #005F8E Steel Blue confirmed per PRD v4.1 §19.1. Design system to be updated accordingly. | Sept 2026 |

---

## 16. Version History

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 0.3 | Sept 2026 | GenBioCa / Claude | Second validation pass (pass 2 of 2). 2 genuine findings fixed (P2-07 confirmed false positive): FR-E-007 now cross-references DD-E-001 to clarify that only AI-generated channel adaptations are editable — source document always read-only; FR-E-020 notification spec extended with KOL review reminder escalation chain (3-day reminder, 5-day reminder, 7-day escalation to Ideation Lead + MA Lead). P2-07 (OQ-E-006 resolution) confirmed present in §17 — was a false positive from first-occurrence context check. |
| 0.2 | Sept 2026 | GenBioCa / Claude | Validation pass against PRD v4.1. 7 findings fixed: FR-E-020 moved to new §6.7 Notification Engine (was misplaced in §11); Voice Note Contributor column added to FR-E-013 RACI task matrix; FR-E-012 moved to §6.4 Stage 4 (was wrongly in §6.3 Stage 3); WCAG version corrected to 2.1 AA for content outputs in FR-E-019, §8.1, §10 (was incorrectly 2.2); FR-E-002 Master Library bypass scoped to 90-day window (unlimited bypass too broad); §8.1 21 CFR Part 11 audit vs e-signature scope clarified; overall_status field added to ideation_content_card data entity in §9. |
| 0.1 | Sept 2026 | GenBioCa / Claude | First version. Built from PRD v4.1 §19 (complete Module E spec), §4.5, §6.5, and compliance framework table + gap analysis. 20 MVP FRs. 7 open questions. 2 PRD v4.1 internal inconsistencies flagged (module colour discrepancy OQ-E-001; standards implementation gap C5/Finding #1). Module E RACI matrix added for first time (FR-E-013 / Finding #2). Cross-module claim provenance as shared service flag confirmed (§5.5). |

---

## 17. Open Question Resolutions — v0.1 → v0.2

| OQ | Decision | Detail |
|----|----------|--------|
| OQ-E-001 | **#005F8E Steel Blue** | PRD v4.1 §19.1 is the authority. Design system and engineering docs updated to #005F8E. |
| OQ-E-002 | **Include (subtle)** | Master Library pull shows source module chip on each content card. Consistent with Modules B/C/D. |
| OQ-E-003 | **Fixed 4-stage model** | Uploaded → Under Review → Reviewed → Approved fixed for v0.1. Configurable stages are Phase 2. |
| OQ-E-004 | **Validate against master TA taxonomy** | No free text. Reuses Module A taxonomy infrastructure. Consistent cross-module tagging for prototype demo. |
| OQ-E-005 | **Twilio (default)** | Admin-configurable SMS gateway. Prototype: SMS sends mocked/logged — no live gateway needed until production. |
| OQ-E-006 | **Shared CrossRef/ORCID service — Module E owns** | One shared API service. Module E is the owner. Module B is a consumer. One procurement, one integration. |
| OQ-E-007 | **FR-E-013 RACI confirmed** | Task-level RACI matrix as specified in FR-E-013. Stage-gated role assignments in prototype project setup. |

**PRD E status after OQ resolution: all 7 open questions closed. Ready for Phase 3 — CD Design.**
