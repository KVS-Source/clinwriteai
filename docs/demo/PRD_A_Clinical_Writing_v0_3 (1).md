# GENBIO CA — AURORA
## PRD A — Clinical Writing
### Version 0.3

**Platform name:** Aurora (placeholder — rebrand in progress. Shortlist sent to SMEs: AXION, VERIDOC, SYNTHARA, CLARIVA, GENOVA)
**Tagline:** AI-Native Authoring for Life Sciences

*Status: Updated — design phase complete, ready for architecture and technical documentation*
*Classification: Confidential — Internal Use Only*
*Prepared: September 5, 2026*

---

## 0. Document Control

| Field | Value |
|-------|-------|
| Document | PRD A — Clinical Writing, v0.3 |
| Status | Design-complete draft. Two open decisions closed (architecture, FR-A-032 mock). Three FR gaps addressed (FR-A-001 extended, FR-A-053 elevated, FR-A-065 split). New FRs added from design phase (FR-A-026 through FR-A-029b). NFRs expanded. Design decisions log added (Section 16). |
| Supersedes | PRD A v0.2 (Sept 5, 2026) |
| Built From | PRD A v0.2 + 23-screen Claude Design prototype (Sessions 1–8) + comparative analysis against August 2024 wireframe + design session decisions |
| Naming Note | Platform referred to as "Aurora" throughout (placeholder). Module letters (A–E) are internal identifiers only — never shown in the UI. |

---

## 0A. Change Summary v0.2 → v0.3

| Section | Change |
|---------|--------|
| §5 Architecture | New §5.3: Modular Monolith decision with 4 discipline rules and extraction path |
| §6.1 FR-A-001 | Extended to FR-A-001a–001d: system-managed checklist with master template, working copy, version change notification, compliance summary integration |
| §6.3 | New FR-A-026 (ICH E3 validator), FR-A-027 (MedDRA inline lookup), FR-A-028 (TLF cross-reference), FR-A-029 (version diff view), FR-A-029b (section-level version restore) |
| §6.6 FR-A-053 | Status elevated from Out of Scope → MVP. Collaborative section-level editing designed and built. |
| §6.7 FR-A-065 | Split into FR-A-065a (software: overdue review alert) and FR-A-065b (process: validation plan) |
| §8 NFRs | §8.0 Architecture NFR added. §8.1 expanded (GSPR, API-level RBAC). §8.2 expanded (SOC 2 roadmap). §8.3 expanded (DPA, KOL data). §8.5 Accessibility added. §8.6 Availability added. |
| §9 Data Model | New entities from design phase added |
| §14 Open Questions | Two questions closed. Seven remaining open. |
| §15 Design Decisions Log | New section — 10 decisions from design phase documented |
| §16 Version History | v0.3 entry added |

---

## 1. Purpose & Background

Aurora is planned as a five-module, AI-native authoring platform for life sciences documentation. This document specifies Module A — Clinical Writing — as a standalone, buildable unit: the module that produces Clinical Study Reports (CSRs), Protocols, Investigator's Brochures (IBs), and Informed Consent Forms (ICFs), and that every other module depends on as its upstream source of truth.

v0.3 updates v0.2 to reflect decisions made and features designed during the prototype design phase (Sessions 1–8 with Claude Design). The 23-screen Module A prototype is complete and validated. This version closes open architectural questions, extends the functional requirements with new capabilities discovered during design, and brings the NFR section current.

---

## 2. Scope

### 2.1 In Scope for v0.1 Build

- The full six-stage Module A workflow: Study Start-Up → During Study Execution → Post-Study/Data Analysis → Cross-Functional Review → Comments Resolution & Finalisation → Final Output.
- Authoring, review, and approval of the four Module A deliverable families: CSR (full & synopsis), Protocol (initial & amendments), IB (core & updates), ICF (site-specific adaptations) — plus the smaller associated deliverables (trial registrations, DSMB reports, safety narratives, DSURs, end-of-study summaries).
- The minimum Project Management layer Module A depends on.
- AI-assisted drafting bound by human review and sign-off.
- 21 CFR Part 11-compliant audit trail and e-signatures from first release.
- All SME-approved additions from the gap-list review, phased per Section 11.
- Section-level collaborative editing (FR-A-053 — elevated from Out of Scope, see §6.6).

### 2.2 Explicitly Out of Scope for v0.1

- Modules B, C, D, E in full.
- Any gap-list item marked Backlog or Out of Scope in Section 11.
- Full CDISC SDTM/ADaM ingestion pipeline (gap C1) — research item, not v0.1 target.
- Cross-organizational e-signature workflows spanning sponsor + CRO + site/IRB (gap C4).
- AI-generated layperson summaries (gap C5) — declined by SMEs.

---

## 3. Goals

- Produce ICH E3-compliant CSRs with full statement-level traceability from narrative text back to source data — closing the single biggest gap identified against competitor products.
- Build 21 CFR Part 11 compliance into the data layer from day one.
- Keep the AI layer strictly advisory: it drafts, a human reviews and signs, and the audit trail records both as separate, distinct events.
- Ship something a pilot client can use end-to-end through all six workflow stages.

---

## 4. Glossary

| Term | Definition |
|------|-----------|
| CSR | Clinical Study Report — Module A's primary output |
| TLF | Tables, Listings, and Figures — statistical outputs from biostatistics |
| SAP | Statistical Analysis Plan |
| IB / ICF | Investigator's Brochure / Informed Consent Form |
| CRM | Comments Resolution Meeting — structured review-comment resolution session |
| RACI | Responsible, Accountable, Consulted, Informed |
| SDTM / ADaM | CDISC data standards |
| ARS | CDISC Analysis Results Standard — emerging, not v0.1 target |
| FR-A-### | Functional Requirement identifier, Module A scope |
| ALCOA+ | Attributable, Legible, Contemporaneous, Original, Accurate + Complete, Consistent, Enduring, Available |

---

## 5. Architecture Context

### 5.1 Dependency: Minimal Project Layer

- A Project record: name, start date, customer, mandatory TA tag, status (Initiated / Ongoing / On Hold / Closed). Closed is a hard, unoverridable read-only state.
- Module A cannot be exercised outside a Project.
- Entry-point flexibility: an existing CSR can be uploaded directly as a starting point.

### 5.2 AI Architecture Constraint (Non-Negotiable)

**The AI drafts. A human reviews and signs. The audit trail records both as separate, distinct events. No workflow may allow AI-generated content to become a final signed record without a human review step producing its own Part 11-compliant signature.** This follows from 21 CFR Part 11 and EU draft Annex 22. Every FR involving AI drafting assumes this constraint.

### 5.3 Architecture Decision: Modular Monolith *(NEW — v0.3)*

**Decision (Sept 2026):** Aurora v0.1 is built as a modular monolith. Microservice extraction is deferred until a scale or team-autonomy trigger is reached. This decision is final for v0.1 and is not open for re-debate during sprint planning.

**Rationale:** No pilot client, no production load data, and no team-autonomy problem exist yet. Part 11 compliance across service boundaries adds distributed-systems complexity before the product is validated. A modular monolith with clean internal boundaries preserves the microservice extraction path without paying its cost upfront.

**Four discipline rules — enforced from the first commit, non-negotiable under delivery pressure:**

1. **No cross-module direct calls in code.** Module A code never calls Module B/C/D/E internal functions directly. All cross-module communication goes through a declared interface. When a module is extracted to a service, the interface becomes an HTTP/gRPC call — no logic rewrite required.

2. **Module-scoped database tables, no shared schema.** Every table has a declared module owner. No cross-module JOINs. When a module is extracted, its tables move with it and cross-module data access becomes an API call. Mixed schemas are the primary reason monolith extraction becomes surgery instead of a swap.

3. **Audit trail, e-signature engine, and AI connector framework live in shared platform infrastructure** — not inside any module. These are consumed by every module and must be platform-level from day one.

4. **Module boundary violations fail CI — not a code review comment, a build failure.** This rule applies from the first commit and is enforced automatically, not culturally.

**Extraction timeline:** When the business reaches the scale or team-autonomy trigger, each module is extracted in rollout order (A first, then B, C, D, E). Each extraction involves: moving tables to a separate database instance, replacing interface calls with API calls, adding a message queue for cross-module events, and deploying independently. With clean boundaries: 4–8 weeks of engineering per module. Without clean boundaries: unpredictable.

---

## 6. Functional Requirements

### 6.1 Deliverables & Input Documents

Aurora Module A supports authoring of: CSR (full & synopsis), Protocol (initial & amendments), IB (core & updates), ICF (site-specific), trial registrations, DSMB reports, safety narratives, DSURs, and end-of-study summaries.

| ID | Requirement | Source | Phase |
|----|-------------|--------|-------|
| FR-A-001 | Support authoring of all 9 Module A deliverable types, each with its own system-managed input-document checklist enforced at document creation. | PRD v4.1 §4.1 | MVP |

**FR-A-001 extended — System-Managed Checklist (NEW — v0.3):**

The input-document checklist for each deliverable type is a first-class platform feature, not a reference document. It is fully specified below as FR-A-001a through FR-A-001d.

| ID | Requirement | Source | Phase |
|----|-------------|--------|-------|
| FR-A-001a | **Master Checklist Template (Admin-managed):** Admin maintains one master checklist template per deliverable type, seeded at platform setup from SME-approved content. Each item is flagged as "Framework Mandatory" (with the governing framework named: ICH E3, 21 CFR Part 11, etc.) or "Recommended." Template updates are change-controlled: Admin saves with a version number, effective date, and reason. Previous versions are archived, never deleted, always retrievable. The master template is never used directly as a working document — it is always the source for instance creation. | Design phase decision | MVP |
| FR-A-001b | **Working Checklist Instance (per document):** A copy of the current master template version is created at document creation and becomes the working checklist for that document. Users can add items freely. Users can remove any item including Framework Mandatory ones — removal triggers a framework warning and requires a reason to proceed. Every removal is a logged, timestamped, attributed audit event: actor, item removed, framework flag, reason given. Completion state and removals are visible to all project team members and reviewers — removals surfaced distinctly from uncompleted items. All team members can complete checklist items (no role gate). | Design phase decision | MVP |
| FR-A-001c | **Template Version Change Notification:** When a new master template version becomes effective, all project owners with in-flight checklist instances based on a prior version are notified. In-flight instances are never auto-updated — the project owner decides whether to manually adopt relevant changes. Adoption or non-adoption of a template update is a logged event on the checklist instance. | Design phase decision | MVP |
| FR-A-001d | **Compliance Summary Integration:** Framework Mandatory item removals feed into FR-A-030 (Compliance Summary appendix) as disclosure items on the output document, naming the item, framework, actor, and reason. | Design phase decision | MVP |

| ID | Requirement | Source | Phase |
|----|-------------|--------|-------|
| FR-A-002 | Every document and artefact carries a mandatory therapeutic-area (TA) tag, set at creation and immutable thereafter except by Admin. | PRD v4.1 §3A / §7.3 | MVP |
| FR-A-003 | CSR Section 16 appendices are managed as a per-project, per-country configurable checklist (16.1 Study Information, 16.2 Patient Data Listings, 16.3 CRFs, 16.4 US-only Individual Patient Data Listings) — 16.4 required only when a US submission country is selected. | ICH E3 Section Mapping brief §4 | MVP |

### 6.2 Six-Stage Workflow

| ID | Requirement | Source | Phase |
|----|-------------|--------|-------|
| FR-A-010 | Implement all six Module A stages (Study Start-Up → During Study → Post-Study/Data Analysis → Cross-Functional Review → Comments Resolution & Finalisation → Final Output) as a linear, stage-gated workflow. Documents cannot advance without approval by the designated role. | PRD v4.1 §5.1 | MVP |
| FR-A-011 | Watermark every interim version automatically. Remove only on final sign-off. | PRD v4.1 §7.4 | MVP |
| FR-A-012 | At Study Start-Up, the system enforces upload of the required input documents before document authoring can begin (FR-A-001a–001d). | Gap-list A12 | MVP |

### 6.3 AI Authoring, Drafting & Traceability

| ID | Requirement | Source | Phase |
|----|-------------|--------|-------|
| FR-A-020 | Provide AI-assisted drafting at the sentence and paragraph level, with confidence indication and mandatory human review before any AI-generated content is committed to the audit trail. | PRD v4.1 §7.2 | MVP |
| FR-A-021 | Every AI-generated text span is flagged in the document UI (distinct colour/badge) and in the audit trail (model name, generation timestamp, source documents cited). | 21 CFR Part 11 Primer §4 | MVP |
| FR-A-022 | Statement- and sentence-level traceability: every claim in the document can be linked to a source document, TLF table, or SAP section. The traceability record is immutable once created. | Gap-list A1 | MVP |
| FR-A-023 | Automated cross-document change detection: when a source document (SAP, TLF) changes, the system flags affected document sections for review. | Gap-list A3 | Phase 2 |
| FR-A-024 | Live-linked TLF values: numeric values in the CSR update automatically when the linked TLF is revised, subject to human confirmation. | Gap-list A2 | Phase 2 |
| FR-A-025 | Direct ingestion of ADaM datasets to generate draft statistical narrative sections. | Gap-list A4 | Phase 2 |
| FR-A-026 | **ICH E3 Section Validator (NEW — v0.3):** The platform provides an inline ICH E3 compliance validator accessible from the document editor as a non-modal resizable right panel. The validator displays all 18 mandatory ICH E3 sections with completion status (Complete / In Progress / Not Started / Warning). Waived items (e.g., §16.4 for non-US submissions) are shown in a distinct amber warning state with the waiver reason. The validator links directly to each section in the editor. An exportable ICH E3 compliance report is generated on demand. | Design phase / August wireframe comparison | MVP |
| FR-A-027 | **MedDRA Inline Lookup (NEW — v0.3):** The platform provides an inline MedDRA terminology lookup accessible from the document editor as a non-modal resizable right panel. The lookup searches the licensed MedDRA version (v27.0 at initial release) by term or code. Results show Preferred Term, MedDRA code, SOC hierarchy, and whether the term is already used in the current document. Selecting a result inserts the PT into the document section or copies it to clipboard. The panel tracks recently used terms per document. MedDRA version is displayed and Admin-updatable. Note: FR-A-032 (MedDRA subscription) governs the procurement dependency; this FR governs the UI feature. | Design phase / Gap-list C2 extension | MVP |
| FR-A-028 | **TLF Cross-Reference Panel (NEW — v0.3):** The platform provides a TLF cross-reference browser accessible from the document editor as a non-modal resizable right panel. The panel shows all TLF items in the current project's TLF package, filterable by type (Tables / Listings / Figures). Items linked to the current editor section are highlighted with the current-section indicator. Clicking any item opens the source TLF. The panel shows which document sections reference each TLF item and how many times. TLF package version and validator name are displayed in the panel footer. | Design phase / August wireframe comparison | MVP |
| FR-A-029 | **Version Diff View (NEW — v0.3):** The platform provides an inline unified diff view accessible from the document version selector in the editor header. The diff shows word-level changes (red strikethrough for removed, green insertion for added) and line-level additions (green left-border block with "+" prefix). AI-accepted additions are marked with an "AI" badge within the diff. Unchanged sections are dimmed. The diff banner shows a change count and legend. | Design phase / compareOn stub → full feature | MVP |
| FR-A-029b | **Section-Level Version Restore (NEW — v0.3):** From the diff view, users can select individual sections to restore from a prior version without restoring the entire document. Multiple sections can be selected simultaneously from different prior versions. Selecting a section for restore shows a checkbox in selected state on the section header row. A sticky restore bar appears at the bottom of the editor column showing the selected sections, a mandatory reason field, and a "Create v[N+1] from selected sections" primary action. Confirming creates a new immutable version where each section's provenance (source version, actor, reason) is recorded in the audit trail. Prior versions are never modified or deleted. This is the only supported "rollback" mechanism — true version overwrite does not exist in this platform. | Design phase decision / Part 11 compliance | MVP |

*Note: FR-A-023 through FR-A-025 form one capability cluster (cross-document intelligence). They are grouped into Phase 2 because FR-A-024 depends on FR-A-023's change-detection, and FR-A-025 was explicitly flagged by SMEs as requiring a separate CDISC research spike before scoping.*

### 6.4 Regulatory Intelligence & Compliance

| ID | Requirement | Source | Phase |
|----|-------------|--------|-------|
| FR-A-030 | Auto-generate a Compliance Summary appendix at the end of every output document listing all applicable regulatory frameworks, specific rules applied, references, and any waived Framework Mandatory checklist items with actor and reason. | PRD v4.1 §7.7 | MVP |
| FR-A-031 | Live regulatory framework registry: the platform maintains a versioned, Admin-updatable registry of applicable frameworks per module. Changes to the registry trigger a notification to project owners with in-flight documents. | Gap-list C3 | MVP |
| FR-A-032 | Built-in automatic MedDRA / WHO Drug Dictionary coding validation. **Decision (Sept 2026): Build against mocked MedDRA/WHO-DD interface while procurement is in flight.** The mock boundary must be flagged in all validation evidence. No version using the mock may be released as production-validated. The interface contract (what goes in, what comes back, what errors look like) is defined against the real API so the swap is a config change, not a rebuild. | Gap-list C2 | MVP — blocked on procurement |
| FR-A-033a | Near-term: support Define-XML and Dataset-JSON as import formats for statistical outputs. | CDISC Research brief | Backlog |
| FR-A-033b | Long-term: full ADaM dataset ingestion for automated narrative generation. | Gap-list C1 | Backlog |

### 6.5 Roles, RACI & Access Control

| ID | Requirement | Source | Phase |
|----|-------------|--------|-------|
| FR-A-040 | Pre-configured role library for Module A: Clinical Writer/CSR Author, Clinical PM/Lead, Biostatistician, Clinical Data Manager, Pharmacovigilance Lead, Regulatory Affairs Reviewer. Role titles and responsibilities are pre-populated; only user-specific attributes entered at onboarding. | PRD v4.1 §6.1 | MVP |
| FR-A-041 | RACI matrix is pre-configured per module and automatically populated when the Admin assigns roles. Only Admin can edit RACI assignments. | PRD v4.1 §6A | Existing |
| FR-A-042 | Review assignment: the document owner assigns reviewers by RACI role, sets review due dates, and selects parallel or sequential review mode. All assignments are logged. | Design phase (Screen 15) | MVP |
| FR-A-043 | Review delegation: a reviewer can delegate their review to another eligible team member. Delegation is logged in the audit trail with actor, delegatee, and reason. | August wireframe comparison | Phase 2 |
| FR-A-044 | Review extension request: a reviewer can request additional review time. The request is logged and notified to the document owner. | August wireframe comparison | Phase 2 |

### 6.6 Document Editor & Collaboration

| ID | Requirement | Source | Phase |
|----|-------------|--------|-------|
| FR-A-050 | Rich text editor with AI assist panel always accessible as a non-modal resizable right panel. The editor supports: B/I/U formatting, heading styles, bullet and numbered lists, table insertion. | PRD v4.1 §7.3 | MVP |
| FR-A-051 | Voice notes with AI transcription: voice notes are recorded, transcribed by the Admin-selected engine, and attached to document sections. Both audio and transcript are version artefacts. Transcription latency target: < 10 seconds for a 2-minute note. | PRD v4.1 §7.3 | Existing |
| FR-A-052 | Dedicated, logged Comments system: reviewers add comments to specific document sections. Comments carry a section tag, severity (Major / Minor / Query), reviewer identity, and timestamp. Comment IDs (CMT-###) are system-generated and immutable. | PRD v4.1 §5.1 | MVP |
| FR-A-053 | **Section-level collaborative editing — ELEVATED from Out of Scope to MVP (v0.3).** Multiple users can edit different sections of the same document simultaneously. Each user locks the section they are actively editing — other users see the section as locked with the editor's name and avatar. The section navigator shows presence indicators (user avatars) per section. A locked section displays an overlay banner naming the editor with a "Request section" action. Presence is shown in the document header as an overlapping avatar stack ("N active"). Attribution is section-level: each section's audit trail entry records which user edited that section. | Gap-list A11 → elevated based on design phase | MVP |
| FR-A-054 | Curated off-the-shelf template library per document type. | Gap-list A7 | Out of Scope |
| FR-A-055 | Native Microsoft Word round-trip import/export. | Gap-list A6 | Backlog — SME validation required |
| FR-A-056 | Sentence/paragraph-level tracked changes (Word-style). | Gap-list A5 | Backlog — SME validation required |

### 6.7 Versioning, Audit Trail & E-Signatures

| ID | Requirement | Source | Phase |
|----|-------------|--------|-------|
| FR-A-060 | Audit trail storage must be append-only / tamper-evident at the architecture level. No role, including Super Admin, can edit or delete an entry. | 21 CFR Part 11 Primer §1.1 | MVP |
| FR-A-061 | Every audit entry captures: user identity (name, role, authenticated session ID), action type, timestamp (UTC, server-verified), and old value vs. new value including record-creation events. | 21 CFR Part 11 Primer §1.1/§2.1 | MVP |
| FR-A-062 | Every e-signature carries an explicit meaning field (Approved / Reviewed / Authored / etc.), not just name + timestamp. The meaning is chosen by the signer at signing time from a predefined list. | 21 CFR Part 11 Primer §1.2 | MVP |
| FR-A-063 | Signature capture requires fresh credential entry at the moment of signing — an active session is not sufficient. Signature cannot be delegated. | 21 CFR Part 11 Primer §1.2 | MVP |
| FR-A-064 | Full version history per document, including voice-note audio and transcript versioning. | PRD v4.1 §7.5 | MVP |
| FR-A-065a | **Software requirement (split from FR-A-065, v0.3):** The system surfaces an overdue-audit-review alert to designated QA roles when the Admin-configured review cadence has elapsed without a logged review event. The review cadence is Admin-configurable (default: 30 days). Each completed QA review is logged as a distinct, timestamped audit event. The alert is displayed as a prominent UI element (amber pulse indicator) on the QA role's dashboard and on the Audit Trail Review screen. | 21 CFR Part 11 Primer §1.1 / Design phase (Screen 23) | MVP |
| FR-A-065b | **Process obligation (split from FR-A-065, v0.3):** The SOP requiring QA to conduct, document, and respond to those reviews is defined in the platform validation plan, not in this PRD. This requirement is out of scope for engineering. | 21 CFR Part 11 Primer §1.1 | Process — validation plan |
| FR-A-066 | **E-Signature Chain (NEW — v0.3):** The platform implements a sequential or parallel signature chain for final document sign-off. Each signer sees the chain state (who has signed, who is next, who is queued). Each signature record stores: Signature ID, recorded timestamp (UTC), signer local time, time source (NTP stratum), authentication method, document hash at signing, version at signing, scope (sections attested), audit entry ID, device, and network. Cancelling a chain in progress is logged; a cancelled chain does not advance the document to final status. | Design phase (Screen 20) / 21 CFR Part 11 | MVP |

### 6.8 Analytics & Dashboards

| ID | Requirement | Source | Phase |
|----|-------------|--------|-------|
| FR-A-070 | Integrated cost/performance dashboard per project and per module: hours saved vs. manual benchmark, USD equivalent saved, documents completed/total, AI-assisted sections. | Gap-list B4 / PRD v4.1 §7.1 | MVP |
| FR-A-071 | Regulatory Framework compliance score per document. | Gap-list B4 / PRD v4.1 §7.1 | Phase 2 |
| FR-A-072 | Exportable regulatory compliance report (PDF/CSV). | Gap-list B4 / PRD v4.1 §7.1 | Phase 2 |

### 6.9 Master Library

| ID | Requirement | Source | Phase |
|----|-------------|--------|-------|
| FR-A-080 | Author-tagged push to Master Library: approved documents and sections can be tagged and pushed to the cross-module, cross-project library with mandatory TA, module, document type, and version tags. | PRD v4.1 §7.6 | MVP |

---

## 7. Confirmed Differentiators (Protect — No New Build Without PRD Update)

These are the capabilities that most clearly separate Aurora from AuroraPrime RMA, Certara CoAuthor, Veeva Vault, and Yseop Copilot. They must not be simplified or deferred without explicit PRD sign-off.

1. **Statement-level traceability with source chain** (FR-A-022) — absent from all four competitors.
2. **Section-level collaborative editing with presence** (FR-A-053) — no competitor supports simultaneous multi-user authoring with section-level attribution.
3. **Part 11 signature chain with per-signer records** (FR-A-066) — competitors implement single sign-off, not a full chain with individual Part 11 records.
4. **Section-level version restore** (FR-A-029b) — no competitor supports selective section restore from prior versions; all implement full-document rollback or block it entirely.
5. **System-managed input-document checklist with waiver audit trail** (FR-A-001a–001d) — competitors use reference documents, not platform-enforced versioned checklists.
6. **Non-modal resizable right panel system** — all reference tools (AI Suggest, Traceability, Voice Note, Checklist, Audit Trail, ICH E3, MedDRA, TLF) are accessible without leaving the editor or losing context. No competitor achieves this.
7. **CRM as a structured three-panel workflow** — competitors implement CRM as a comment list; Aurora implements it as a meeting-level workflow with a live resolution log and audit trail.

---

## 8. Non-Functional Requirements

### 8.0 Architecture NFR *(NEW — v0.3)*

- Cloud-native SaaS deployment; multi-tenant with client data isolation at the database level.
- API-first design: all platform features accessible via REST API, including the platform API for third-party integrations.
- AI connector framework: pluggable, Admin-selectable AI engine support. Anthropic Claude default; OpenAI GPT-4o, Google Gemini Pro as fallbacks. Engine selection does not require redeployment.
- Voice transcription: Admin-selectable engine. Transcription latency target: < 10 seconds for a 2-minute note.
- Modular monolith architecture for v0.1 per Section 5.3. Four discipline rules enforced via CI from the first commit.

### 8.1 Compliance & Validation

- 21 CFR Part 11 and (in anticipation of EU Annex 11/22 pending rewrite) Annex 11-aligned architecture from first release.
- Validation approach follows risk-based model (FDA CSA philosophy / GAMP 5 2nd Edition) — validation depth matches actual risk to record integrity.
- A vendor-style validation evidence package (risk assessment, test summary, release notes) produced with each release. Module A's release process must confirm it receives that evidence — not assume it.
- GSPR compliance for any medical device CER workflows (relevant when Module D activates medical device document types). *(NEW — v0.3)*
- Role-based access controls enforced at the API level, not just application layer. RACI-driven access, Admin-editable only. *(NEW — v0.3)*

### 8.2 Security & Performance

- Encryption at rest (AES-256) and in transit (TLS 1.3). MFA required for all roles.
- SOC 2 Type II certification roadmap — target certification within 18 months of first production release. *(NEW — v0.3)*
- Document editor load < 2s. AI auto-suggest response < 3s. Voice transcription < 10s. Dashboard refresh < 5s.

### 8.3 Data Residency

- Voice note audio stored in Admin-configured region (EU / Asia-Pacific selectable). Retention policy Admin-configurable: permanent, post-transcription delete, or 30/60/90-day delete.
- All personal data processed in accordance with GDPR (EU) 2016/679. Data Processing Agreement (DPA) provided to all EU clients. *(NEW — v0.3)*
- KOL and external reviewer contact details (name, email, mobile) treated as personal data. Stored with appropriate consent and GDPR-compliant data protection. *(NEW — v0.3)*

### 8.4 List/Table UI Behaviour & Responsiveness

Applies to every list/table surface in Module A: the document list, project dashboard, Master Library browser, RACI/role assignment table, regulatory framework registry view, comments dashboard, audit trail view, and any list added by a later requirement.

- Every list/table column independently sortable (ascending/descending).
- Every list/table provides a search box and a quick-filter mechanism (filter chips or filter panel) scoped to that list's columns.
- Every search/filter state has a one-click Reset returning the list to unfiltered, default-sorted state. Reset appears only when filters are active (`filtersDirty === true`).
- Lists use lazy loading (load-on-scroll or paginated fetch) — not full result set fetch.
- Navigation and filter/tab changes use asynchronous requests rather than full page reloads.

### 8.5 Accessibility *(NEW — v0.3)*

- WCAG 2.1 AA compliance for all Module A screens.
- All status indicators use both colour and a secondary cue (icon, label, or pattern) — colour alone is never the only signal.
- All IBM Plex Mono label text (uppercase, small size) must meet 4.5:1 contrast ratio against its background.
- All interactive elements have visible focus states (box-shadow 0 0 0 3px rgba(37,99,235,0.12) at minimum).

### 8.6 Availability *(NEW — v0.3)*

- Target uptime: 99.5% monthly (allowing ~3.6 hours unplanned downtime/month).
- Planned maintenance windows communicated to clients 72 hours in advance.
- Auto-save frequency: every keystroke is versioned in the audit trail; explicit save is available at any time.
- No data loss on browser crash or session timeout: draft content recoverable from last server-side save.

---

## 9. Data Model Stub

*This is a high-level entity list only — not a full ER diagram. Field-level schema is the architecture doc's responsibility.*

**Entities from v0.2 (unchanged):**
- Project (id, name, customer, TA tags, status, start date, **submission_countries** — added v0.3 per FR-A-003)
- Document (id, project_id, type, title, status, stage, TA tags, assignee)
- DocumentVersion (id, document_id, version_number, content_hash, created_by, created_at)
- ProvenanceRecord (id, document_version_id, span_id, source_type, source_ref, ai_model, accepted_by, accepted_at)
- AuditEntry (id, entity_type, entity_id, actor_id, action, old_value, new_value, timestamp_utc, session_id)
- Signature (id, document_version_id, actor_id, meaning, credential_hash, timestamp_utc, chain_position)
- Comment (id, document_id, section_ref, actor_id, text, severity, status, created_at)
- VoiceNote (id, document_id, section_ref, actor_id, audio_ref, transcript, created_at)

**New entities from design phase (v0.3):**
- ChecklistTemplate (id, deliverable_type, version, effective_date, created_by, items[])
- ChecklistTemplateItem (id, template_id, text, framework, framework_mandatory, order)
- ChecklistInstance (id, document_id, template_id, template_version, created_at)
- ChecklistInstanceItem (id, instance_id, template_item_id, status, completed_by, completed_at, waived_by, waived_at, waiver_reason)
- SignatureChain (id, document_id, chain_type[sequential|parallel], initiated_by, initiated_at, status)
- SignatureRecord (id, chain_id, signer_id, step, meaning, status, timestamp_utc, local_time, time_source, auth_method, document_hash, version_at_signing, scope_sections, audit_entry_id, device, network, signature_id)
- PresenceSession (id, document_id, user_id, section_ref, started_at, heartbeat_at, status[active|locked|idle])
- CRMMeeting (id, document_id, meeting_ref, chair_id, attendees[], start_time, end_time, status)
- CRMResolution (id, meeting_id, comment_id, resolution_type, resolution_note, resolved_by, resolved_at)
- VersionRestoreJob (id, source_document_id, created_version_id, sections[], reason, created_by, created_at)
- TLFPackage (id, project_id, version, validated_by, validated_at, items[])
- TLFItem (id, package_id, type[T|L|F], reference_id, title, linked_sections[])

---

## 10. Regulatory Framework Registry — Module A

The following frameworks are embedded in Aurora's compliance check engine for Module A. Admin-updatable when new revisions are issued by the relevant body.

| Framework | Issuer | Version | Scope in Module A |
|-----------|--------|---------|-------------------|
| 21 CFR Part 11 | FDA (US) | Current | Mandatory — digital signatures, audit trail, electronic records for all documents |
| 21 CFR Part 312 | FDA (US) | Current | IND safety reporting, protocol amendments |
| ICH E3 | ICH | Nov 1995 (current) | Mandatory — CSR structure, 18 mandatory sections, appendices |
| ICH E6(R3) | ICH | Draft 2023 / E6(R2) current | Mandatory — GCP compliance for Protocols, IBs, ICFs |
| ICH E8(R1) | ICH | Oct 2021 | Protocols and study design quality considerations |
| ICH E2F | ICH | Aug 2010 | DSUR structure and content |
| 21 CFR Part 50 | FDA (US) | Current | Mandatory — Informed Consent Form content |
| 21 CFR Part 56 | FDA (US) | Current | IRB review requirements for ICFs and Protocols |
| EU Clinical Trials Regulation 536/2014 | EMA / EU | 2022 | Clinical trial registration and reporting in EU |
| Declaration of Helsinki (2013) | WMA | 2013 | Ethical principles — ICF and Protocol compliance |
| GDPR (EU) 2016/679 | EU | 2018 | Data protection for voice notes, patient data, document storage |
| EU Draft Annex 22 (AI in GxP) | EMA | Draft — monitor | AI architecture constraint (see §5.2); monitor for finalisation |

---

## 11. Phase & Priority Plan

| Phase | Meaning |
|-------|---------|
| MVP | Required for v0.1 release. Must be built, tested, and validated before any pilot client use. |
| Phase 2 | Confirmed in scope; deferred to a post-MVP sprint. Dependencies or procurement items are blocking. |
| Backlog | Identified as a valid need; not yet scoped, sized, or sequenced. Requires SME validation before committing. |
| Out of Scope | Explicitly declined by SMEs or ruled out for architectural/regulatory reasons. Requires PRD amendment to re-open. |

**Summary of phase assignments:**

- **MVP:** FR-A-001 through FR-A-003, FR-A-010 through FR-A-012, FR-A-020 through FR-A-022, FR-A-026 through FR-A-029b, FR-A-030 through FR-A-032, FR-A-040 through FR-A-042, FR-A-050 through FR-A-053, FR-A-060 through FR-A-066, FR-A-070, FR-A-080
- **Phase 2:** FR-A-023, FR-A-024, FR-A-025, FR-A-043, FR-A-044, FR-A-071, FR-A-072
- **Backlog:** FR-A-033a, FR-A-033b, FR-A-055, FR-A-056
- **Out of Scope:** FR-A-054

---

## 12. Dependencies & Procurement Items

| Item | Dependency | Blocks | Status |
|------|-----------|--------|--------|
| MedDRA / WHO Drug Dictionary subscription | MSSO (MedDRA) / UMC (WHO-DD) | FR-A-032 production release | **Decision: build against mocked interface until procurement completes. Mock must be flagged in all validation evidence.** |
| AI engine API keys | Anthropic (default), OpenAI / Google (fallback) | FR-A-020 through FR-A-022 | Admin-selectable at setup |
| Voice transcription API | Claude Audio (default), OpenAI Whisper, Google STT | FR-A-051 | Admin-selectable at setup |
| SOC 2 Type II audit | Third-party auditor | NFR §8.2 | Target: 18 months post first production release |

---

## 13. Traceability

Every FR in Section 6 is traceable to one or more of:
- PRD v4.1 (platform-level requirements)
- SME-reviewed gap list (25 rows, all resolved in v0.1)
- 21 CFR Part 11 Architecture Primer
- ICH E3 Section Mapping brief
- CDISC SDTM/ADaM Research brief
- Design phase decisions (Sessions 1–8, Sept 2026)
- August 2024 wireframe comparative analysis

New FRs in v0.3 (FR-A-026 through FR-A-029b, FR-A-042, FR-A-066, FR-A-001a–001d, FR-A-053 elevation, FR-A-065 split) are traced to "Design phase decisions" and/or "August 2024 wireframe comparative analysis" in their Source fields.

---

## 14. Open Questions Before Sprint Planning

The following questions from v0.2 remain open. Two have been resolved (marked below). Seven remain.

**Resolved in v0.3:**
- ~~Standalone microservice vs. monolith~~ → **Closed: Modular monolith per §5.3.**
- ~~Should FR-A-032 be built against mocked data while procurement is in flight~~ → **Closed: Yes, mock with production flag condition per §6.4 FR-A-032 and §12.**

**Still open — require SME or stakeholder decision before sprint planning:**

1. **FR-A-023/024/025 phase grouping** — grouped into Phase 2 as a judgment call, not an explicit SME phase decision. Confirm before committing sprint capacity.

2. **B3 (mandatory TA tagging)** — SME's note about template-library-based implementation needs a direct answer: does the current template-library approach satisfy "mandatory at project, document, and artefact level," or is there a gap?

3. **B4/Analytics** — the GenRAC-pattern adaptation in §6.8 is our translation, not something SMEs have validated. Needs a validation pass before FR-A-071/072 are scoped in detail.

4. **A9/validation ownership** — who owns the platform-wide validation program, and on what timeline? Module A's release process must not assume this is handled without a named owner.

5. **C1 (CDISC ingestion)** — does "needs further study" mean a dedicated research spike should be scheduled now, or does it wait until post-MVP?

6. **Pilot client / study data** — still no confirmed design partner or real study to build against. FR-A-032/FR-A-033a assume real ADaM/MedDRA data will eventually be available for testing.

7. **EU Annex 22 monitoring** — the draft is not yet final and not yet GCP-scoped. Should we monitor its finalisation (expected mid-2026 per v0.2 note — now overdue) and re-check the AI architecture constraint, or treat the current advisory-AI-only design as settled?

---

## 15. Design Decisions Log *(NEW — v0.3)*

*Decisions made during the design phase (Sessions 1–8) that affect implementation but are not captured in FRs.*

| # | Decision | Rationale | Impact |
|---|----------|-----------|--------|
| 1 | Modular monolith with four discipline rules (§5.3) | No scale trigger yet; Part 11 across service boundaries adds premature complexity | Architecture, CI pipeline, schema design |
| 2 | FR-A-032 mock build with production flag | MedDRA procurement timelines unpredictable; interface-first approach allows config swap | FR-A-032 build strategy, validation evidence |
| 3 | FR-A-001 extended to system-managed checklist (FR-A-001a–001d) | Reference documents create compliance gaps; system-managed checklists with waiver audit trail are defensible to inspectors | Data model, Admin panel, compliance summary |
| 4 | FR-A-065 split into 065a (software) and 065b (process) | FR-A-065 as written was ambiguous — engineers couldn't tell what to build. 065a is buildable; 065b belongs in the validation plan | Engineering scope clarity |
| 5 | FR-A-053 elevated from Out of Scope to MVP | Section-level collaborative editing was designed and fully built in the prototype (Sessions 4+). Removing it would require significant UX redesign and is a strong differentiator | Editor architecture, presence data model |
| 6 | Non-modal resizable right panel as the standard interaction pattern | Keeps editor context visible for all reference and collaboration tools. The T&C gate (Screen 2) is the only true modal in Aurora. | All panel components, toolbar design |
| 7 | Section-level version restore (FR-A-029b) over full-document rollback | In a multi-user document, full rollback destroys other users' work. Section-level restore is Part 11-compliant (creates new version, never overwrites) and matches real clinical writing workflow | Diff view, version restore UI, VersionRestoreJob entity |
| 8 | Platform name Aurora (placeholder) | AuroraPrime RMA conflicts with original name. SME shortlist sent: AXION, VERIDOC, SYNTHARA, CLARIVA, GENOVA. Decision pending. | Branding, all UI strings |
| 9 | Tagline: "AI-Native Authoring for Life Sciences" | Covers all 5 modules; "Clinical Authoring" was too narrow. "AI-Native" is the strongest positioning signal. | All marketing, platform shell UI |
| 10 | Module colour system locked | Clinical Writing #2563EB, Scientific Writing #0D9488, Medical Writing #7C3AED, Regulatory Writing #D97706, Ideation & Publishing #E11D48. Module letters (A–E) never appear as visible UI labels. | Design system, all module screens |

---

## 16. Version History

| Version | Date | Summary |
|---------|------|---------|
| 0.1 | Sept 5, 2026 | First formal PRD-A. Built from PRD v4.1 + Module A narrative extraction + SME-reviewed gap list (25/25 rows resolved) + three architecture research briefs. |
| 0.2 | Sept 5, 2026 | Validation pass. Added FR-A-003, FR-A-065, Section 8.4. Split FR-A-033 into FR-A-033a/b. Re-added two open questions. Added Annex 22 monitoring question. |
| 0.3 | Sept 5, 2026 | Design phase complete. Architecture decision closed (modular monolith + 4 discipline rules). FR-A-032 mock decision closed. FR-A-001 extended to FR-A-001a–001d (system-managed checklist). FR-A-053 elevated to MVP (collaborative editing). FR-A-065 split into FR-A-065a (software) and FR-A-065b (process). New FRs: FR-A-026 (ICH E3 validator), FR-A-027 (MedDRA lookup), FR-A-028 (TLF cross-reference), FR-A-029 (diff view), FR-A-029b (section-level restore), FR-A-042 (review assignment), FR-A-044 (review extension), FR-A-066 (signature chain). NFRs expanded: §8.0 architecture, §8.1 GSPR + API-level RBAC, §8.2 SOC 2 roadmap, §8.3 DPA + KOL data, §8.5 accessibility, §8.6 availability. Data model expanded with 12 new entities. Design decisions log added (§15). Two open questions closed. |

