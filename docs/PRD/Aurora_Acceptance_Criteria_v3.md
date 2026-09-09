# Aurora — Acceptance Criteria
**All Five Modules: A, B, C, D & E**
**Version 3.0 — September 2026**
*Status: Approved for QA use. Each criterion is independently testable against the Phase 1 prototype and Phase 2 production build.*

---

## 0. Document Purpose & Conventions

This document defines testable pass/fail acceptance criteria for every MVP functional requirement in Aurora Module A. Each criterion maps to one or more PRD FRs and specifies:

- **Given** — the precondition / system state
- **When** — the action taken
- **Then** — the observable outcome that constitutes PASS
- **Fail if** — conditions that constitute FAIL regardless of other behaviour

**Conventions:**

| Term | Meaning |
|------|---------|
| `AC-A-###` | Acceptance Criterion identifier |
| `FR-A-###` | Functional Requirement this criterion tests |
| Phase 1 | React prototype with MSW mock data |
| Phase 2 | Production build with real backend |
| VELORA-301 | The synthetic study dataset used throughout the prototype |
| MW | Marcus Webb — Lead Clinical Writer (logged-in user in most screens) |
| SC | Dr. Sarah Chen — Clinical PM |
| EV | Dr. Elena Vasquez — Regulatory Affairs |

**Scope:** Only MVP-phase FRs are covered here. Phase 2 and Backlog FRs (FR-A-023–025, FR-A-033a/b, FR-A-043–044, FR-A-071–072, FR-A-055–056) are excluded.

---

## 1. Authentication & Access (FR-A-040, FR-A-041)

### AC-A-001 — Sign-in with valid credentials
**FR:** FR-A-040
**Given** the sign-in screen (Screen 01a) is displayed
**When** a user enters a valid email and password and clicks Sign in
**Then** the system authenticates and redirects to the MFA screen (Screen 01b)
**Fail if** authentication succeeds without presenting the MFA screen, or if the session is established before MFA is verified

---

### AC-A-002 — MFA verification required
**FR:** FR-A-040
**Given** valid credentials have been submitted
**When** the MFA screen is displayed and the user enters a valid 6-digit code
**Then** the session is established and the user is redirected to the Terms & Conditions gate (first login) or All Projects (subsequent logins)
**Fail if** any route is accessible before MFA is completed, or if a 5-digit or 7-digit code is accepted

---

### AC-A-003 — Terms & Conditions gate on first login
**FR:** FR-A-040
**Given** a user is logging in for the first time
**When** they reach the T&C gate (Screen 02)
**Then** both checkboxes must be individually ticked before the Continue button is enabled. The T&C gate is a true blocking modal — no navigation away is possible until both boxes are checked and Continue is clicked.
**Fail if** Continue is enabled with only one box checked, or if any navigation is possible while the gate is displayed

---

### AC-A-004 — Six Module A roles pre-configured
**FR:** FR-A-040
**Given** a new project is created
**When** team members are assigned
**Then** the system offers exactly these six role options: Clinical Writer/CSR Author, Clinical PM/Lead, Biostatistician, Clinical Data Manager, Pharmacovigilance Lead, Regulatory Affairs Reviewer. Role titles and responsibilities are pre-populated — not free-text entry.
**Fail if** any role title requires manual entry, or if fewer or more than six roles are available

---

### AC-A-004b — All Projects screen lists projects with correct status and filters
**FR:** FR-A-040 (project access), Screen 03
**Given** the user is authenticated and navigates to All Projects (Screen 03)
**When** the project list is displayed
**Then** all projects visible to the authenticated user are listed with: project name, short title, therapeutic area, phase, status pill, document count, and last updated date. The list is filterable by status and TA tag, and searchable by project name. Results update without a full page reload.
**Fail if** the project list requires a full page reload to filter, or if any of the six display fields is absent from a project row

---

### AC-A-004c — Project Dashboard shows correct module tabs and document count
**FR:** FR-A-040 (project navigation), Screen 05
**Given** the user clicks a project from the All Projects screen
**When** the Project Dashboard (Screen 05) is displayed
**Then** the dashboard shows: project name and meta (TA, phase, status), document count for the active module, and navigation tabs for each active module. Clicking "Open Clinical Writing" navigates to the Clinical Writing Home.
**Fail if** the document count is incorrect, or if inactive module tabs are shown as active, or if navigation to Clinical Writing fails

---

### AC-A-005 — RACI assignment and persistence
**FR:** FR-A-041
**Given** a project member is assigned a role
**When** the RACI matrix is viewed
**Then** the member's RACI designation (R/A/C/I) is automatically populated based on their role and persists across sessions. Only Admin users can edit RACI assignments.
**Fail if** a non-Admin user can modify RACI assignments, or if RACI assignments are lost between sessions

---

## 2. Project & Document Creation (FR-A-001, FR-A-002, FR-A-003, FR-A-012)

### AC-A-006 — All nine document types supported
**FR:** FR-A-001
**Given** a project exists and the user clicks + New Document
**When** the document type selector is displayed
**Then** all nine document types are available: CSR (Full), CSR Synopsis, Protocol, Protocol Amendment, Investigator's Brochure, ICF, Safety Narrative, DSUR, End-of-Study Summary
**Fail if** any of the nine types is missing, or if a type not in this list is offered

---

### AC-A-007 — Therapeutic area tag mandatory and immutable
**FR:** FR-A-002
**Given** a new document is being created
**When** the user completes the document creation form
**Then** the therapeutic area field is mandatory — the document cannot be created without it. The TA tag is inherited from the project and shown as INHERITED. Once created, the TA tag cannot be changed by any user except Admin.
**Fail if** a document can be saved without a TA tag, or if a non-Admin user can change the TA tag after creation

---

### AC-A-008 — §16.4 conditional on US submission country (FR-A-003)
**FR:** FR-A-003
**Given** a CSR document is being created
**When** the project has no US submission country selected
**Then** the §16.4 US Individual Patient Data Listings checklist item is shown as optional (or absent)
**When** the project has US selected as a submission country
**Then** §16.4 appears as a Framework Mandatory checklist item
**Fail if** §16.4 is mandatory regardless of submission country, or if it is absent when US is selected

---

### AC-A-009 — Checklist instance created at document creation
**FR:** FR-A-001b, FR-A-012
**Given** a new document is being created
**When** the document is saved
**Then** a checklist instance is automatically created from the current master template for that document type. The checklist is immediately accessible from the document without additional steps.
**Fail if** the checklist must be manually created, or if the checklist is based on an older template version when a current one exists

---

### AC-A-009b — Auto-classification returns AI results for uploaded document
**FR:** FR-A-001 (document creation flow), Screen 08
**Given** the user selects "Upload existing document" from the Clinical Writing Home
**When** a valid PDF or DOCX file is uploaded via the Auto-Classification screen (Screen 08)
**Then** the system returns classification results within 3 seconds showing: detected document type with confidence percentage, detected study title with confidence, detected version, and detected therapeutic area. Each field shows a confidence score (0–100%).
**Fail if** classification results take longer than 3 seconds to appear, or if any of the four classification fields is absent, or if no confidence score is shown

---

### AC-A-009c — Auto-classification override is possible before confirmation
**FR:** FR-A-001, Screen 08
**Given** auto-classification results are displayed (Screen 08)
**When** the user disagrees with any classification field and manually changes it
**Then** the overridden field is visually indicated as user-edited. When the user clicks Confirm, the document is created with the overridden values. An audit entry notes which fields were manually corrected.
**Fail if** the user cannot override any classification field, or if the audit entry does not record which fields were overridden

---

## 3. Checklist System (FR-A-001a through FR-A-001d)

### AC-A-010 — Master template is version-controlled
**FR:** FR-A-001a
**Given** an Admin updates the master checklist template for a document type
**When** the update is saved
**Then** the system requires a version number, effective date, and reason. The previous version is archived and retrievable. The new template is not applied to existing documents automatically.
**Fail if** a template update can be saved without a reason, or if a previous template version is overwritten/deleted, or if existing document checklists are auto-updated

---

### AC-A-011 — Any team member can complete checklist items
**FR:** FR-A-001b
**Given** a document checklist is open
**When** any authenticated project team member clicks to complete an item
**Then** the item is marked complete with the completer's name and timestamp visible to all team members
**Fail if** completion is restricted to specific roles, or if the completer's identity is not recorded

---

### AC-A-012 — Framework Mandatory item waiver requires reason and creates audit entry
**FR:** FR-A-001b
**Given** a checklist item marked Framework Mandatory is being waived
**When** the user attempts to waive it
**Then** the system displays a framework warning and requires a non-empty reason field before the waiver can be confirmed. After confirmation: the item shows waived state with the actor's name, timestamp, and reason visible to all team members.
**Then** an audit entry is created capturing: actor, item name, framework name, timestamp, and reason.
**Fail if** a Framework Mandatory item can be waived without a reason, or if no audit entry is created, or if the waiver is not visible to all team members

---

### AC-A-013 — Waived Framework Mandatory items appear in Compliance Summary
**FR:** FR-A-001d, FR-A-030
**Given** one or more Framework Mandatory checklist items have been waived
**When** the document's Compliance Summary appendix is generated
**Then** each waived item appears in the Compliance Summary listing: item name, governing framework, actor who waived it, and reason given
**Fail if** any waived Framework Mandatory item is absent from the Compliance Summary

---

### AC-A-014 — Template update triggers notification to in-flight document owners
**FR:** FR-A-001c
**Given** a project has in-flight documents with checklist instances based on template version N
**When** Admin publishes template version N+1 with a new effective date
**Then** the project owner receives a notification that a new template version is available. The in-flight checklist instance is not auto-updated — it retains version N until the project owner manually adopts changes.
**Fail if** in-flight checklists are auto-updated, or if no notification is sent to project owners

---

## 4. Six-Stage Workflow (FR-A-010, FR-A-011)

### AC-A-015 — Documents progress through six stages in order
**FR:** FR-A-010
**Given** a document exists
**When** its stage is viewed in the Clinical Writing Home tab rail
**Then** the six stages are: Study Start-Up → During Study → Post-Study/Data Analysis → Cross-Functional Review → CRM → Final Output. The document's current stage is visually indicated. Documents cannot skip stages.
**Fail if** a document can advance to a stage out of order, or if fewer than six stages are shown

---

### AC-A-016 — Watermark present on all non-final versions
**FR:** FR-A-011
**Given** a document is in any status other than Signed
**When** the document is viewed or downloaded
**Then** a watermark is visible on the document
**When** the final signature chain is completed
**Then** the watermark is removed and the document status is Signed ✓
**Fail if** an unsigned document is downloadable without a watermark, or if the watermark persists after the final signature

---

## 5. AI Authoring & Traceability (FR-A-020 through FR-A-022, FR-A-026 through FR-A-029b)

### AC-A-017 — AI suggestion requires human review before audit trail commitment
**FR:** FR-A-020
**Given** a document section is open in the editor
**When** the user clicks AI Suggest and a suggestion is returned
**Then** the suggestion is displayed in a review panel with Accept, Refine, and Reject options. The suggestion is NOT written to the document or audit trail until the user explicitly clicks Accept.
**Fail if** an AI suggestion is written to the document without a human Accept action, or if Accept is not a distinct explicit step

---

### AC-A-018 — AI-generated content is visually flagged in the editor
**FR:** FR-A-021
**Given** a user has accepted an AI suggestion
**When** the editor is displayed
**Then** the accepted AI text is visually distinguished from human-authored text (distinct background colour and AI badge). The distinction persists across sessions and is visible to all users who open the document.
**Fail if** accepted AI text is visually indistinguishable from human text, or if the distinction is lost after saving or reopening

---

### AC-A-019 — AI provenance record is created on acceptance
**FR:** FR-A-021
**Given** a user accepts an AI suggestion
**When** the audit trail is viewed
**Then** an audit entry exists with event type AI draft accepted, capturing: actor, section, AI model name, generation timestamp, and source documents cited by the AI.
**Fail if** any of these five fields is absent from the audit entry

---

### AC-A-020 — Statement-level traceability links text to source
**FR:** FR-A-022
**Given** a document section contains a traceable statement (linked to a TLF table, SAP section, or source document)
**When** the user selects the traceable text and opens the Traceability panel
**Then** the panel displays the full source chain: source document/table reference, version, and the provenance record (who accepted it, when). The traceability record cannot be edited or deleted.
**Fail if** traceability records can be edited after creation, or if the source chain is incomplete

---

### AC-A-021 — ICH E3 validator shows all 18 sections with correct status
**FR:** FR-A-026
**Given** a CSR document is open in the editor
**When** the user opens the ICH E3 Validator panel via the Reference dropdown
**Then** all 18 mandatory ICH E3 sections are displayed with a status indicator (Complete / In Progress / Not Started / Warning). The completion percentage is calculated correctly. Sections with waivers show amber warning state with the waiver reason visible.
**Fail if** fewer than 18 sections are shown, or if a waived section shows as Not Started without the waiver reason

---

### AC-A-022 — ICH E3 validator links to editor section
**FR:** FR-A-026
**Given** the ICH E3 Validator panel is open
**When** the user clicks "Open in editor →" on any section row
**Then** the editor navigates to that section and highlights it as the active section
**Fail if** the link does not navigate to the correct section, or if the link is absent on any section row

---

### AC-A-023 — MedDRA lookup returns PT with code and SOC
**FR:** FR-A-027
**Given** the MedDRA Lookup panel is open
**When** the user types a search term (minimum 3 characters)
**Then** results are returned showing: Preferred Term name, MedDRA code, SOC hierarchy, and a "Used in document" indicator for terms already present in the document. The current MedDRA version is shown in the panel.
**Fail if** results are returned for fewer than 3 characters, or if PT code or SOC is absent from any result

---

### AC-A-024 — MedDRA term insertion creates audit entry
**FR:** FR-A-027
**Given** the user selects "Insert into §X.X" on a MedDRA result
**When** the term is inserted
**Then** the term appears in the document section and an audit entry is created. The `document_meddra_usage` record is updated to show this term as used in this document.
**Fail if** no audit entry is created, or if the "Used in document" indicator does not update after insertion

---

### AC-A-025 — TLF panel shows items linked to current section
**FR:** FR-A-028
**Given** the TLF Cross-Reference panel is open and the editor is on section §11.4.1
**When** the panel is displayed
**Then** TLF items linked to §11.4.1 are shown at the top with a blue border distinguishing them from unlinked items. Each linked item shows a reference count (how many times cited in the section). The TLF package version and validator name are shown in the footer.
**Fail if** linked and unlinked items are visually indistinguishable, or if the reference count is absent

---

### AC-A-026 — Diff view shows word-level and line-level changes
**FR:** FR-A-029
**Given** a document has at least two versions
**When** the user clicks the version chip in the document header to open the diff view
**Then** the diff shows: red strikethrough for removed text (word-level), green insertion for added text (word-level), and a green left-border block with "+" prefix for added lines. Unchanged sections are dimmed. An AI badge appears on any addition that came from an accepted AI suggestion. A change count and legend are shown in the diff banner.
**Fail if** removed text is not visually distinguished from added text, or if the AI badge is absent on AI-sourced additions, or if unchanged sections are not dimmed

---

### AC-A-027 — Section-level restore creates a new version and audit entries
**FR:** FR-A-029b
**Given** the diff view is open comparing two versions
**When** the user selects one or more sections for restore, enters a mandatory reason, and clicks "Create v[N+1] from selected sections"
**Then** a new document version is created containing the restored section(s) from the source version and all other sections from the current version. An audit entry is created for each restored section recording: source version, actor, and reason. Prior versions (including the one being "rolled back") are retained permanently — not modified or deleted.
**Fail if** the restore operation modifies or deletes any prior version, or if the reason field is not enforced as mandatory, or if the audit entry is missing any of the three required fields

---

### AC-A-028 — Multiple sections selectable for restore from different versions
**FR:** FR-A-029b
**Given** the diff view is open
**When** the user selects sections from different prior versions for restore
**Then** each selected section retains its source version association in the audit trail. The sticky restore bar shows all selected sections and their source versions. The resulting new version correctly combines sections from multiple source versions.
**Fail if** sections from different versions cannot be selected simultaneously, or if the audit trail loses the per-section source version attribution

---

## 6. Regulatory Compliance (FR-A-030 through FR-A-032)

### AC-A-029 — Compliance Summary appendix is auto-generated
**FR:** FR-A-030
**Given** a document is being finalised for output
**When** the document is generated
**Then** a Compliance Summary appendix is present at the end of the document listing: applicable regulatory frameworks, specific rules applied, references, and all waived Framework Mandatory checklist items with actor and reason.
**Fail if** the Compliance Summary is absent, or if any waived Framework Mandatory item is not listed in it

---

### AC-A-030 — Regulatory framework registry is Admin-updatable
**FR:** FR-A-031
**Given** a regulatory framework is updated (e.g. new ICH E3 version issued)
**When** Admin publishes the updated framework in the registry
**Then** project owners with in-flight documents receive a notification that the framework has been updated. The registry entry shows the new version and effective date.
**Fail if** no notification is sent to project owners, or if framework updates can be made by non-Admin users

---

### AC-A-031 — MedDRA mock interface is visibly indicated while active
**FR:** FR-A-032
**Given** the prototype is built against the mocked MedDRA interface (pre-production subscription)
**When** the MedDRA Lookup panel is open
**Then** a visible indicator in the panel states the MedDRA data is mocked — for example: "MedDRA v27.0 · Mock data — not for production use" in the panel footer. The indicator uses a distinct visual treatment (amber or IBM Plex Mono label) so it is not mistaken for production data.
**Fail if** the MedDRA panel displays mock data without any visible mock indicator, or if the mock indicator uses the same styling as production status labels (which could cause it to be overlooked)

---

## 7. Review Workflow (FR-A-042)

### AC-A-032 — Review assignment creates RACI assignments and notifications
**FR:** FR-A-042
**Given** a document is in In Authoring status
**When** the document owner opens the Review Assignment panel, assigns reviewers with RACI roles, sets a due date, selects parallel or sequential review mode, and clicks Submit for review
**Then** the document status changes to In Review. An audit entry is created for the submission and for each reviewer assignment. Reviewers receive notifications. The document is locked for authoring while in review.
**Fail if** the document status does not change, or if audit entries are not created for all assignments, or if the document remains editable while in review

---

### AC-A-033 — Reviewer view shows role-adapted toolbar
**FR:** FR-A-042
**Given** a reviewer (non-author role) opens a document that is In Review
**When** the editor is displayed
**Then** the toolbar shows reviewer actions only: Add comment, Flag section, view-only Checklist and Audit Trail. Authoring tools (B/I/U, AI Suggest, Voice Note) are absent. The reviewer's RACI role is shown in the toolbar.
**Fail if** any authoring tool is available to a reviewer, or if the reviewer's RACI role is not displayed

---

## 8. Comments (FR-A-052)

### AC-A-034 — Comment IDs are system-generated and immutable
**FR:** FR-A-052
**Given** a reviewer adds a comment
**When** the comment is saved
**Then** the comment is assigned a unique CMT-### ID by the system (not entered by the user). This ID is displayed throughout the platform (Comments Dashboard, CRM Module, Audit Trail). The ID cannot be changed after creation.
**Fail if** the user can specify or edit the CMT ID, or if the same CMT ID is assigned to two different comments

---

### AC-A-035 — Comments carry mandatory section tag and severity
**FR:** FR-A-052
**Given** a reviewer is adding a comment
**When** the comment form is displayed
**Then** section tag (e.g. §11.4.1) and severity (Major / Minor / Query) are mandatory fields — the comment cannot be submitted without both. Reviewer identity and timestamp are automatically captured.
**Fail if** a comment can be submitted without a section tag or severity, or if reviewer identity is manually entered rather than system-captured

---

## 9. Collaborative Editing (FR-A-053)

### AC-A-036 — Section lock prevents concurrent editing of same section
**FR:** FR-A-053
**Given** User A is actively editing section §11.4
**When** User B navigates to the same document
**Then** §11.4 is shown as locked in User B's section navigator with User A's name and avatar. An overlay banner on the locked section names User A and offers a "Request section" action. User B cannot edit §11.4 while User A holds the lock.
**Fail if** two users can edit the same section simultaneously, or if the locked section overlay is absent

---

### AC-A-037 — Presence indicators show all active users
**FR:** FR-A-053
**Given** multiple users are in the same document simultaneously
**When** any user views the document header
**Then** an overlapping avatar stack shows all active users with a count ("N active"). Each user's avatar appears on the section they are editing in the section navigator. Presence updates within 30 seconds of a user joining or leaving.
**Fail if** the avatar stack does not update within 30 seconds, or if a user's avatar is missing from the section they are editing

---

### AC-A-038 — Section-level attribution in audit trail
**FR:** FR-A-053
**Given** two users edit different sections of the same document concurrently
**When** the audit trail is viewed
**Then** each audit entry for a section edit names the specific user who edited that section. Entries from concurrent editing sessions are correctly attributed — not merged or attributed to a single actor.
**Fail if** audit entries from concurrent editing sessions are attributed to the wrong user, or if section attribution is absent

---

## 10. Versioning & Audit Trail (FR-A-060 through FR-A-064)

### AC-A-039 — Audit trail is append-only at architecture level
**FR:** FR-A-060
**Given** an audit entry has been created
**When** any user (including Super Admin) attempts to edit or delete the entry via the API
**Then** the attempt is rejected with a 403 or 405 response. The entry remains unchanged.
**Fail if** any API endpoint allows modification or deletion of an audit entry, or if a database-level UPDATE or DELETE on audit_entries succeeds without a trigger violation

---

### AC-A-040 — Every audit entry captures six mandatory fields
**FR:** FR-A-061
**Given** any system event creates an audit entry
**When** the audit entry is inspected
**Then** it contains all six mandatory fields: (1) actor identity (name, role, session ID), (2) action type (from the defined enum), (3) UTC timestamp server-set, (4) old value (null for creates), (5) new value (null for deletes), (6) authenticated session ID. No field may be null except old_value on creates and new_value on deletes.
**Fail if** any audit entry is missing any of the six mandatory fields

---

### AC-A-041 — Full version history is retained permanently
**FR:** FR-A-064
**Given** a document has been through multiple save operations
**When** the version history is viewed (GET /documents/:documentId/versions)
**Then** all versions are listed, including those preceding a section-level restore. No version is ever deleted or overwritten. The content hash of each version is shown.
**Fail if** any version is absent from the history, or if a version's content hash does not match the content at that version

---

## 11. E-Signatures (FR-A-062, FR-A-063, FR-A-066)

### AC-A-042 — Signature meaning is explicitly selected by the signer
**FR:** FR-A-062
**Given** a user is in the signing flow (Screen 20)
**When** the electronic signature panel is displayed
**Then** three meaning options are presented: "I have authored this document", "I have reviewed this document", "I approve this document for submission". The user must select one before signing. The selected meaning is stored in the signature record and cannot be changed after signing.
**Fail if** a signature can be submitted without selecting a meaning, or if the meaning can be changed after the signature is recorded

---

### AC-A-043 — Fresh credentials required at signing
**FR:** FR-A-063
**Given** a user has an active authenticated session
**When** they attempt to sign a document
**Then** the system requires fresh credential entry (password re-entry) at the moment of signing. An active session alone is not sufficient. The credential is hashed before storage — never stored in plaintext.
**Fail if** signing is possible without re-entering credentials, or if credentials are stored in plaintext in any log, database field, or network payload

---

### AC-A-044 — Signature chain records all 11 Part 11 fields per signer
**FR:** FR-A-066
**Given** a signer completes the signing step
**When** the signature record is inspected (GET /documents/:documentId/signature-chain)
**Then** the signature record contains all 11 mandatory fields: Signature ID (SIG-####-##), recorded timestamp UTC, signer local time, time source, authentication method, document hash at signing, version at signing, scope (sections attested), audit entry ID, device, and network.
**Fail if** any of the 11 fields is absent or null on a completed signature record

---

### AC-A-045 — Cancelled signature chain does not advance document status
**FR:** FR-A-066
**Given** a signature chain is in progress (one or more signers have signed)
**When** the document owner cancels the chain
**Then** the chain status is set to cancelled. An audit entry is created for the cancellation. The document status reverts to its pre-signing status. The document does NOT advance to Signed status. The signatures already collected in the cancelled chain are preserved in the audit record but do not count toward a future chain.
**Fail if** a cancelled chain results in a Signed document, or if the cancellation is not logged in the audit trail

---

### AC-A-046 — Final signature transitions document to v1.0 and removes watermark
**FR:** FR-A-066, FR-A-011
**Given** all steps in the signature chain are completed
**When** the final signer signs
**Then** the document version is bumped to v1.0. The watermarked field is set to false. The document status changes to Signed ✓. The Final Document view (Screen 21) is accessible and shows the Signed ✓ status pill, all signer timestamps, and the document hash.
**Fail if** the document remains watermarked after final signing, or if the version does not advance to v1.0, or if any signer's timestamp is absent from the Final Document view

---

## 12. QA Review Alert (FR-A-065a)

### AC-A-047 — Overdue QA review alert is displayed
**FR:** FR-A-065a
**Given** the Admin-configured review cadence (default 30 days) has elapsed without a logged QA review event
**When** a user with QA role accesses the platform
**Then** an amber pulse indicator is displayed on their dashboard. The Audit Trail Review screen (Screen 23) shows: the overdue alert banner, days overdue, the date of last review, and the next due date. A "Begin QA review" primary action is accessible.
**Fail if** the alert is not shown when the cadence has elapsed, or if the alert is shown to non-QA roles

---

### AC-A-048 — Completed QA review creates a logged audit event
**FR:** FR-A-065a
**Given** a QA reviewer completes their review of the audit trail
**When** they click "Log completed review" and confirm
**Then** an audit entry is created with event type `qa_review_completed`, capturing: reviewer identity, timestamp, and next due date. The overdue alert is cleared. The next review due date is calculated from the completion timestamp.
**Fail if** the audit entry is not created, or if the overdue alert persists after logging, or if the next due date is not updated

---

## 13. Voice Notes (FR-A-051)

### AC-A-049 — Voice note is attached to a specific section
**FR:** FR-A-051
**Given** the Voice Note panel is open for a document section
**When** a user records and saves a voice note
**Then** the note is attached to the specific section identified in the panel (e.g. §11.4.1). The transcript is generated within 10 seconds for a 2-minute note. Both audio and transcript are retrievable as version artefacts. An audit entry is created with event type `voice_note_added`.
**Fail if** the transcript takes longer than 10 seconds for a 2-minute recording, or if the voice note is not attached to the correct section, or if no audit entry is created

---

### AC-A-050 — Voice note transcript insertion creates audit entry
**FR:** FR-A-051
**Given** a voice note transcript is displayed in the Voice Note panel
**When** the user clicks "Insert into §X.X"
**Then** the transcript text is inserted into the named section. An audit entry is created capturing: the insertion action, actor, section, and timestamp.
**Fail if** the text is inserted without an audit entry, or if the text is inserted into the wrong section

---

## 14. Rich Text Editor (FR-A-050)

### AC-A-051 — Editor supports all required formatting operations
**FR:** FR-A-050
**Given** a document section is open for editing
**When** the user applies formatting
**Then** all six formatting operations work correctly: Bold (B), Italic (I), Underline (U), Heading styles, Bullet lists, Numbered lists, and Table insertion. Each formatting change is saved and persists across sessions.
**Fail if** any of the seven formatting operations is absent or non-functional

---

### AC-A-052 — AI Suggest panel is accessible as non-modal right panel
**FR:** FR-A-050
**Given** a document section is open for editing
**When** the user clicks AI Suggest in the toolbar
**Then** the AI panel opens as a non-modal resizable right panel. The editor remains fully visible and interactive while the panel is open. The panel can be resized by dragging the left edge between 260px and 760px. The panel can be closed with the ✕ button without losing editor state.
**Fail if** the AI panel opens as a modal (blocking the editor), or if the editor becomes non-interactive while the panel is open, or if the panel cannot be resized

---

## 15. Analytics (FR-A-070)

### AC-A-053 — Portfolio dashboard shows performance metrics
**FR:** FR-A-070
**Given** a project has documents in various completion states
**When** the Portfolio Dashboard (Screen 22) is viewed
**Then** the right panel shows: hours saved vs. manual benchmark, USD equivalent saved, documents completed vs. total, and AI-assisted section count. All four metrics are present.
**Fail if** any of the four performance metrics is absent from the dashboard

---

## 16. Master Library (FR-A-080)

### AC-A-054 — Approved documents can be pushed to Master Library
**FR:** FR-A-080
**Given** a document has been signed and is in Final Output stage
**When** the user tags and pushes it to the Master Library
**Then** the push succeeds and the library entry carries all four mandatory tags: therapeutic area, module, document type, and version. The entry is accessible from the cross-module Master Library view.
**Fail if** a non-final document can be pushed to the Master Library, or if any of the four mandatory tags can be omitted

---

## 17. CRM Module (FR-A-052, FR-A-053, FR-A-066)

### AC-A-055 — CRM meeting logs all comment resolutions with audit trail
**FR:** FR-A-052 (comments), FR-A-066 (audit)
**Given** a CRM meeting is in progress with open comments
**When** the chair resolves a comment (Accept / Accept with modification / Reject) with a resolution note
**Then** the comment status changes to Resolved. The resolution record stores: resolution type, note, resolver identity, and timestamp. An audit entry is created with event type `crm_resolution_logged`. The resolution appears in the Resolution Log panel.
**Fail if** a resolution can be logged without a note, or if no audit entry is created, or if the comment status does not change to Resolved

---

### AC-A-056 — CRM resolution panel stays contextually visible
**FR:** FR-A-053 (non-modal panel pattern)
**Given** a CRM meeting is in progress and a comment is selected for resolution
**When** the Comment Resolution panel opens (Screen 19)
**Then** the panel opens as a non-modal overlay. The full CRM meeting view (roster, progress, all three comment cards) remains visible behind the panel. The comment being resolved shows its active state styling (blue border) while the panel is open.
**Fail if** the CRM meeting view is hidden or obscured when the resolution panel is open, or if the active comment card loses its styling

---

## 18. Non-Functional Acceptance Criteria

### AC-A-057 — Module boundary violations fail CI
**NFR:** §8.0
**Given** a developer commits code that imports from a different module's internal folder (e.g. Module A code importing from `modules/scientific-writing/`)
**When** CI runs
**Then** the build fails with an ESLint error identifying the specific import violation. The error message names the violating file and the rule that was broken.
**Fail if** cross-module imports pass CI without an error

---

### AC-A-058 — All status indicators use colour plus a secondary cue
**NFR:** §8.5 (Accessibility — WCAG 2.1 AA)
**Given** any status indicator is displayed (document status pills, checklist item states, presence dots, audit event badges)
**When** inspected
**Then** each indicator communicates its state through both colour AND at least one secondary cue (icon, label, or pattern). No status is communicated by colour alone.
**Fail if** any status indicator relies solely on colour to convey its meaning

---

### AC-A-059 — All interactive elements have visible focus states
**NFR:** §8.5
**Given** any interactive element (button, input, link, dropdown)
**When** the element receives keyboard focus
**Then** a visible focus ring is displayed (minimum: `box-shadow 0 0 0 3px rgba(37,99,235,0.12)`). The focus ring is visible against all backgrounds used in the application.
**Fail if** any interactive element has no visible focus state on keyboard focus

---

### AC-A-060 — Kebab-to-snake_case enum conversion is correct in all API calls
**NFR:** §0 Conventions (Data Model)
**Given** any API write operation sends a status or stage value
**When** the value is received by the backend (or MSW handler in Phase 1)
**Then** the value is in snake_case format (e.g. `in_authoring`, not `in-authoring`). Frontend components always use kebab-case; the conversion happens in the API layer only.
**Fail if** kebab-case values are stored in the database, or if snake_case values appear in frontend component state

---

## 19. Acceptance Criteria Index

| AC ID | FR | Screen(s) | Phase |
|-------|-----|-----------|-------|
| AC-A-001 | FR-A-040 | 01a Sign-in | 1 |
| AC-A-002 | FR-A-040 | 01b MFA | 1 |
| AC-A-003 | FR-A-040 | 02 T&C Gate | 1 |
| AC-A-004 | FR-A-040 | 04 New Project | 1 |
| AC-A-004b | FR-A-040 | 03 All Projects | 1 |
| AC-A-004c | FR-A-040 | 05 Project Dashboard | 1 |
| AC-A-005 | FR-A-041 | 05 Project Dashboard | 1 |
| AC-A-006 | FR-A-001 | 07 New Document | 1 |
| AC-A-007 | FR-A-002 | 07 New Document | 1 |
| AC-A-008 | FR-A-003 | 08 Auto-Classification, 13 Checklist | 1 |
| AC-A-009 | FR-A-001b, FR-A-012 | 07 New Document | 1 |
| AC-A-009b | FR-A-001 | 08 Auto-Classification | 1 |
| AC-A-009c | FR-A-001 | 08 Auto-Classification | 1 |
| AC-A-010 | FR-A-001a | Admin | 2 |
| AC-A-011 | FR-A-001b | 13 Checklist Panel | 1 |
| AC-A-012 | FR-A-001b | 13 Checklist Panel | 1 |
| AC-A-013 | FR-A-001d, FR-A-030 | 21 Final Document | 2 |
| AC-A-014 | FR-A-001c | Admin | 2 |
| AC-A-015 | FR-A-010 | 06 CW Home | 1 |
| AC-A-016 | FR-A-011 | 21 Final Document | 1 |
| AC-A-017 | FR-A-020 | 09 Editor, 10 AI Panel | 1 |
| AC-A-018 | FR-A-021 | 09 Editor | 1 |
| AC-A-019 | FR-A-021 | 14 Audit Trail | 1 |
| AC-A-020 | FR-A-022 | 11 Traceability | 1 |
| AC-A-021 | FR-A-026 | 25 ICH E3 Panel | 1 |
| AC-A-022 | FR-A-026 | 25 ICH E3 Panel | 1 |
| AC-A-023 | FR-A-027 | 26 MedDRA Panel | 1 |
| AC-A-024 | FR-A-027 | 26 MedDRA Panel | 1 |
| AC-A-025 | FR-A-028 | 27 TLF Panel | 1 |
| AC-A-026 | FR-A-029 | 24 Diff View | 1 |
| AC-A-027 | FR-A-029b | 24 Diff View | 1 |
| AC-A-028 | FR-A-029b | 24 Diff View | 1 |
| AC-A-029 | FR-A-030 | 21 Final Document | 2 |
| AC-A-030 | FR-A-031 | Admin | 2 |
| AC-A-031 | FR-A-032 | 26 MedDRA Panel | 1 |
| AC-A-032 | FR-A-042 | 15 Review Assignment | 1 |
| AC-A-033 | FR-A-042 | 16 Reviewer View | 1 |
| AC-A-034 | FR-A-052 | 17 Comments Dashboard | 1 |
| AC-A-035 | FR-A-052 | 16 Reviewer View | 1 |
| AC-A-036 | FR-A-053 | 09 Editor | 1 |
| AC-A-037 | FR-A-053 | 09–16 All editor screens | 1 |
| AC-A-038 | FR-A-053 | 14 Audit Trail | 1 |
| AC-A-039 | FR-A-060 | API level | 2 |
| AC-A-040 | FR-A-061 | 14 Audit Trail, 23 QA Review | 2 |
| AC-A-041 | FR-A-064 | 24 Diff View | 1 |
| AC-A-042 | FR-A-062 | 20 E-Signature | 1 |
| AC-A-043 | FR-A-063 | 20 E-Signature | 1 |
| AC-A-044 | FR-A-066 | 20 E-Signature | 2 |
| AC-A-045 | FR-A-066 | 20 E-Signature | 1 |
| AC-A-046 | FR-A-066, FR-A-011 | 20–21 E-Sig, Final Doc | 1 |
| AC-A-047 | FR-A-065a | 23 Audit Review Alert | 1 |
| AC-A-048 | FR-A-065a | 23 Audit Review Alert | 1 |
| AC-A-049 | FR-A-051 | 12 Voice Note | 1 |
| AC-A-050 | FR-A-051 | 12 Voice Note | 1 |
| AC-A-051 | FR-A-050 | 09 Editor | 1 |
| AC-A-052 | FR-A-050 | 09 Editor | 1 |
| AC-A-053 | FR-A-070 | 22 Portfolio Dashboard | 1 |
| AC-A-054 | FR-A-080 | 22 Portfolio Dashboard | 2 |
| AC-A-055 | FR-A-052, FR-A-066 | 18 CRM Module | 1 |
| AC-A-056 | Non-modal pattern | 19 Comment Resolution | 1 |
| AC-A-057 | NFR §8.0 | CI pipeline | 2 |
| AC-A-058 | NFR §8.5 | All screens | 1 |
| AC-A-059 | NFR §8.5 | All screens | 1 |
| AC-A-060 | NFR Conventions | API layer | 2 |

**Total Module A: 64 acceptance criteria covering 33 MVP FRs and 3 NFRs across all 27 Module A screens.**

*Module C acceptance criteria follow in §20–§34 below.*

---

## 20. Document Revision History

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | Sept 2026 | Initial version. 60 acceptance criteria across 19 sections. Covers all 33 MVP FRs, 3 NFRs, and all 27 Module A screens. Given/When/Then format with explicit Fail If conditions per criterion. |
| 3.0 | Sept 2026 | Modules D & E appended. §35–§48 add 52 Module D acceptance criteria (AC-D-001 through AC-D-052) covering 27 MVP FRs, 3 NFRs, and 6 DDs across all 12 Module D screens. §49–§58 add 40 Module E acceptance criteria (AC-E-001 through AC-E-040) covering 20 MVP FRs, 3 NFRs, and 4 DDs across all 10 Module E screens. Combined total: 216 acceptance criteria across all five modules. |
| 2.0 | Sept 2026 | Module C: Medical Writing appended. §20–§34 add 57 acceptance criteria across 15 sections covering all 26 Module C MVP FRs and 3 NFRs across all 10 Module C screens (sC01–sC10). Combined total: 121 acceptance criteria. |


---

## MODULE C — MEDICAL WRITING
### Acceptance Criteria Appendix to v1.0

**Conventions (Module C additions):**

| Term | Meaning |
|------|---------|
| `AC-C-###` | Acceptance Criterion identifier, Module C |
| `FR-C-###` | Functional Requirement, Module C |
| `DD-C-###` | Design Decision, Module C |
| SC | Dr. Sarah Chen — Medical Affairs Lead (logged-in user for most Module C screens) |
| sC## | Screen identifier for Module C screens |
| MLR | Medical-Legal-Regulatory review |
| ACCME | Accreditation Council for Continuing Medical Education track |

---

## 20. Medical Writing Home — sC01 (FR-C-001, FR-C-004)

### AC-C-001 — Seven content types available in New Content Item flow
**FR:** FR-C-001, FR-C-007
**Given** the Medical Writing Home (sC01) is displayed
**When** the user clicks + New Content Item
**Then** exactly seven content type options are available: HCP Slide Deck, Medical Information Letter, Patient Information Leaflet, CME Module, Disease Dossier / GVD, EU CTR Plain Language Summary, Advisory Board Report. No other types are offered.
**Fail if** any of the seven types is absent, or if a type outside this list is offered

---

### AC-C-002 — Stage 2 tab present in tab bar
**FR:** FR-C-005
**Given** the Medical Writing Home tab bar is displayed
**When** any user views the screen
**Then** six stage tabs are present: All / Stage 1 (Briefing) / Stage 2 (KOL Session) / Stage 3 (Authoring) / Stage 4 (MLR Review) / Stage 5 (Formatting) / Stage 6 (Approved). Stage 2 must be present even when no content items are currently at Stage 2.
**Fail if** Stage 2 (KOL Session) is absent from the tab bar

---

### AC-C-003 — Module-level metrics strip is present and correct
**FR:** PRD v4.1 §7.1
**Given** the Medical Writing Home is displayed
**When** the metrics strip is viewed
**Then** four metrics are visible: Active content items count, MLR review pending count, Expiring within 60 days count, and Cost savings to date (USD). All four are present.
**Fail if** any of the four metrics is absent from the strip

---

### AC-C-004 — TA filter shows Admin-configured taxonomy
**FR:** FR-C-004, PRD v4.1 §7.9
**Given** the TA filter dropdown is opened
**When** the options are displayed
**Then** at minimum six therapeutic area options are shown, reflecting the Admin-configured TA taxonomy. The filter is not limited to TAs present in current demo data.
**Fail if** fewer than six TA options are shown, or if the filter list is hard-coded to only match currently-present content items

---

## 21. Content Briefing & Scope Matrix — sC02 (FR-C-001 through FR-C-004)

### AC-C-005 — Compliance track locked from Stage 2
**FR:** FR-C-001, DD-C-001
**Given** a content item is in Stage 2 or higher
**When** any user views the compliance track field
**Then** the compliance track is shown as locked with the text: "Compliance track is locked once content reaches Stage 2. To archive this item and create a new one with the correct track." The field cannot be changed.
**Fail if** the compliance track can be changed after Stage 2 is reached, or if "close" is used instead of "archive" in the lock warning

---

### AC-C-006 — FK readability warning shown only for patient-facing content types
**FR:** FR-C-009, DD-C-005
**Given** the Content Briefing screen is displayed
**When** the content type is PIL or EU CTR PLS
**Then** the FK readability warning is shown: "Content above FK grade 8 is blocked from MLR submission."
**When** the content type is HCP Slide Deck, MI Letter, CME Module, Disease Dossier, or Advisory Board Report
**Then** the FK readability warning is NOT shown.
**Fail if** the FK warning appears for any non-patient-facing content type

---

### AC-C-007 — Audience defaults by content type
**FR:** FR-C-001
**Given** a content type is selected in the briefing form
**When** the audience field auto-populates
**Then** the defaults are: HCP Slide Deck → HCP, MI Letter → HCP, PIL → Patient/Caregiver, CME Module → HCP, Disease Dossier/GVD → HCP, EU CTR PLS → HCP + Patient/Caregiver, Advisory Board Report → HCP. The user can override the default.
**Fail if** any content type pre-selects an incorrect audience, or if the user cannot override the default

---

### AC-C-008 — Applicable frameworks populate conditionally
**FR:** FR-C-001, PRD v4.1 §11A.3
**Given** MLR Track is selected with HCP Slide Deck
**When** the Applicable frameworks section is displayed
**Then** the frameworks shown include: IFPMA Code, EFPIA Code, ABPI Code 2023, PhRMA Code, 21 CFR Part 11
**Given** ACCME/EACCME Track is selected with CME Module
**When** the Applicable frameworks section is displayed
**Then** the frameworks shown include: ACCME Standards for Integrity & Independence (2022), EACCME Guidelines, 21 CFR Part 11
**Fail if** the frameworks are static (same regardless of compliance track or content type), or if 21 CFR Part 11 is absent from either track

---

### AC-C-009 — Stage 2 readiness gate enforces required fields
**FR:** FR-C-001, FR-C-002, FR-C-003, FR-C-004
**Given** the Content Briefing screen is displayed
**When** the Stage 2 readiness checklist is evaluated
**Then** the following items must all be satisfied before "Proceed to Stage 2 →" activates: Source documents linked (CSR, SmPC/IB at minimum), TA tag set, Audience defined, Content type selected, Compliance track confirmed, Content title set.
**Fail if** the proceed button activates with any of these six items unmet

---

### AC-C-010 — Publication Plan field present alongside Medical Affairs Plan
**FR:** FR-C-003
**Given** the briefing form is displayed
**When** the plan linkage section is viewed
**Then** both a Medical Affairs Plan and a Publication Plan field are present, each with Link and Create New actions. Both are optional at Stage 1 — neither blocks Stage 2 progression.
**Fail if** the Publication Plan field is absent

---

## 22. KOL Advisory Board Session — sC03 (FR-C-005, FR-C-006, FR-C-011)

### AC-C-011 — KOL attendee table captures GDPR consent status
**FR:** FR-C-005, PRD v4.1 §13.4
**Given** the KOL Advisory Board Session screen is displayed
**When** the attendee table is viewed
**Then** each row shows: Name, Affiliation, GDPR consent status (Confirmed / Internal / Pending), and Role. The GDPR consent column is present for all attendees.
**Fail if** the GDPR consent column is absent, or if any attendee row lacks a consent status

---

### AC-C-012 — Voice note transcript shows engine attribution
**FR:** FR-C-005, PRD v4.1 §7.3
**Given** a voice note has been transcribed
**When** the voice note section is displayed
**Then** a one-line attribution is shown below the "TRANSCRIBED ✓" badge in IBM Plex Mono: "Transcribed by [engine name] · [date] [time] UTC · Logged to audit trail." The engine name matches the Admin-configured transcription engine.
**Fail if** the transcription engine attribution is absent from the voice note section

---

### AC-C-013 — KOL Insights Report and Messaging Framework are separate tabs
**FR:** FR-C-006, FR-C-011
**Given** the KOL session insights are generated
**When** the Stage 2 output panel is displayed
**Then** two distinct tabs are present: "KOL Insights Report" (qualitative themes, quotes, gaps) and "Messaging Framework" (structured table: Key Claim / Evidence Source / Target Audience / Approval Status). These are two separate artefacts — not combined in a single view.
**Fail if** the Messaging Framework is absent as a distinct tab, or if it is merged into the Insights Report

---

### AC-C-014 — KOL quote approval flag required per verbatim quote
**FR:** FR-C-011
**Given** the KOL Insights Report contains verbatim quoted statements
**When** the report is displayed
**Then** each verbatim quote has an inline approval badge: green "Quote approved · [KOL name] ✓" or amber "Approval pending · [KOL name]". Quotes without approval are clearly marked pending.
**Fail if** any verbatim quote lacks an approval badge, or if pending and approved quotes are visually indistinguishable

---

### AC-C-015 — Stage 3 readiness gate enforces session completion
**FR:** FR-C-005, FR-C-006, FR-C-011
**Given** the KOL Advisory Board Session screen is displayed
**When** the Stage 3 readiness checklist is evaluated
**Then** the following are hard gates (must be satisfied before "Proceed to Stage 3 →" activates): Session notes captured, Insights report generated, Messaging framework created. KOL quote approvals complete is a soft warning (amber) — it does not hard-block Stage 3 but shows an incomplete indicator.
**Fail if** Stage 3 can be reached without session notes, insights report, or messaging framework complete

---

## 23. Content Editor — sC04 (FR-C-007, FR-C-008, FR-C-009, FR-C-011, FR-C-012)

### AC-C-016 — Messaging Framework source chip present in editor header
**FR:** FR-C-006, FR-C-008
**Given** the Content Editor (sC04) is displaying a content item that has completed Stage 2
**When** the editor header is viewed
**Then** a source chip is visible: "Messaging framework: [framework name] v[N] ✓". Clicking the chip shows the framework name and version without navigating away from the editor.
**Fail if** no messaging framework chip is present in the editor header for a Stage 3+ content item

---

### AC-C-017 — FK readability gate enforced on patient-facing content
**FR:** FR-C-009, DD-C-005
**Given** the content type is PIL or EU CTR PLS
**When** the editor is open
**Then** a live FK readability score is shown in the right panel, updated paragraph by paragraph. Content sections above FK grade 8 are highlighted in amber; above grade 10 in red. The pre-MLR submission gate returns 422 if the current FK score exceeds 8.
**When** the content type is HCP Slide Deck, MI Letter, CME Module, Disease Dossier, or Advisory Board Report
**Then** the FK panel shows "Not applicable for this content type" — no gate applies.
**Fail if** the FK gate applies to non-patient-facing content, or if the gate is missing for patient-facing content

---

### AC-C-018 — AI footprint indicator is persistent in editor
**FR:** FR-C-008, PRD v4.1 §7.2
**Given** the AI Suggest panel is open
**When** any AI suggestion is accepted or discarded
**Then** the AI footprint percentage chip in the AI Suggest panel header updates immediately: "AI footprint · [N]%". This chip is always visible in the panel — it does not appear only as a transient toast.
**Fail if** the AI footprint percentage is only communicated via a toast that disappears, or if the chip is absent between accept/discard events

---

### AC-C-019 — Patient Advocate annotations toggle correctly labelled
**FR:** FR-C-012, DD-C-004
**Given** the Content Editor is displayed
**When** the header toggle is viewed
**Then** the toggle is labelled "Patient Advocate annotations" (not "PAO layer"). The annotations panel header uses the same label. When toggled on, PAO reviewer annotations are displayed with a visible "advisory only" indicator — not as a formal gate.
**Fail if** the toggle or panel uses the label "PAO layer" anywhere in the user-facing UI

---

### AC-C-020 — Pre-MLR status in editor shows timestamp and re-run action
**FR:** FR-C-015, DD-C-002
**Given** a pre-MLR check has previously been run on the content item
**When** the editor header is viewed
**Then** the pre-MLR status shows: "Pre-MLR check · Last run: [HH:MM] UTC · [N] must-fix · [N] should-fix [Re-run]". The "Re-run" link is distinct from the "Submit for Pre-MLR →" button.
**Fail if** the pre-MLR status appears as a live/background indicator without a timestamp, or if the "Re-run" link is absent

---

### AC-C-021 — Slide warn state explained in editor
**FR:** FR-C-015
**Given** a slide in the slide navigator shows a warn indicator
**When** the user views the slide chip in the panel
**Then** a badge count and one-line sub-label explain the warn state: e.g. "1 must-fix · fair-balance required". The explanation is visible without hovering or clicking.
**Fail if** any slide shows a warn indicator without an explanation of the reason

---

## 24. Pre-MLR Check Panel — sC05 (FR-C-015, FR-C-016, FR-C-017, DD-C-002)

### AC-C-022 — Three severity categories present in pre-MLR results
**FR:** FR-C-015
**Given** the Pre-MLR Check Panel (sC05) displays results
**When** the issue list is viewed
**Then** three severity categories are visually distinct: Must Fix (red — blocks MLR submission), Should Fix (amber — advisory), Note (blue-grey — informational). Each category uses distinct colour and label.
**Fail if** fewer than three severity categories are shown, or if Must Fix and Should Fix are visually indistinguishable

---

### AC-C-023 — Must Fix issues cannot be acknowledged
**FR:** FR-C-015, DD-C-002
**Given** a pre-MLR issue has severity "Must Fix"
**When** the user attempts to acknowledge it
**Then** the acknowledge action is disabled or absent for Must Fix items. Only Should Fix and Note items can be acknowledged. The system returns 422 if an acknowledge API call is made for a Must Fix issue.
**Fail if** a Must Fix issue can be acknowledged without being resolved

---

### AC-C-024 — Sequential pre-MLR → agentic pipeline is visually separated
**FR:** FR-C-015, FR-C-016, DD-C-002
**Given** the Pre-MLR Check Panel shows both sections
**When** the layout is viewed
**Then** a labelled section divider separates the pre-MLR check results from the agentic MLR Pre-Review panel: "Pre-MLR check complete → Agentic review". The divider makes clear these are two sequential passes.
**Fail if** the pre-MLR and agentic sections are shown without visual separation, or if the sequential relationship is not communicated

---

### AC-C-025 — Agentic report has model attribution and timestamp
**FR:** FR-C-016, PRD v4.1 §7.2
**Given** the agentic MLR Pre-Review panel is displayed
**When** the panel header is viewed
**Then** a one-line attribution is shown in IBM Plex Mono: "Generated [HH:MM] UTC · [model name] · All findings logged to audit trail."
**Fail if** the model name or generation timestamp is absent from the agentic report panel

---

### AC-C-026 — Tier override requires MLR Lead and creates audit record
**FR:** FR-C-017, DD-C-003
**Given** the Review Tier section is shown in sC05 or sC06
**When** any non-MLR-Lead user attempts to override the tier
**Then** the override action is disabled. When the MLR Lead triggers override, the system shows an inline confirmation requiring a reason. The audit entry records: original tier, overridden tier, MLR Lead identity, reason, and timestamp.
**Fail if** a non-MLR-Lead can override the tier, or if the override audit entry is missing any required field

---

### AC-C-027 — Submit to MLR blocked if must-fix count > 0
**FR:** FR-C-015
**Given** the Pre-MLR Check Panel shows the Submit to MLR team → button
**When** `mustFixCount > 0`
**Then** the Submit to MLR team button is disabled. A sub-label shows: "Resolve [N] must-fix issue(s) before submitting to MLR."
**When** `mustFixCount === 0`
**Then** the Submit to MLR team button is active.
**Fail if** the Submit button is active when must-fix issues remain

---

## 25. MLR Review — sC06 (FR-C-013 through FR-C-019)

### AC-C-028 — ACCME Checklist tab hidden on MLR track content
**FR:** FR-C-019, DD-C-001
**Given** a content item is on the MLR compliance track
**When** the MLR Review screen (sC06) is displayed
**Then** exactly three tabs are shown: Content Review, Claims Matrix, Agentic Report. The ACCME Checklist tab is absent.
**Given** a content item is on the ACCME/EACCME compliance track
**When** the MLR Review screen is displayed
**Then** all four tabs are shown: Content Review, Claims Matrix, Agentic Report, ACCME Checklist.
**Fail if** the ACCME Checklist tab appears on MLR track content, or is absent on ACCME track content

---

### AC-C-029 — Four MLR decision options available
**FR:** FR-C-013
**Given** the MLR Decision panel is displayed in sC06
**When** the decision options are listed
**Then** exactly four options are available: Approve for distribution, Approve with minor revisions — author to resolve, Return to author — major revisions required, Reject — fundamental issues. "Return to author" and "Reject" are visually distinct — Return uses amber styling, Reject uses red.
**Fail if** any of the four options is absent, or if Return to author and Reject use the same visual styling

---

### AC-C-030 — All reviewers must submit before MLR Lead can submit decision
**FR:** FR-C-013
**Given** the MLR Decision panel shows the Submit MLR decision button
**When** not all assigned reviewers have submitted
**Then** the Submit MLR decision button is disabled. A sub-label shows: "[N] of [total] reviewers submitted · waiting for [names]."
**When** all reviewers have submitted and the current user is the MLR Lead
**Then** the Submit MLR decision button is active.
**Fail if** the MLR Lead can submit a decision while any assigned reviewer has not yet submitted

---

### AC-C-031 — Agentic Should Fix escalation is visible and audited
**FR:** FR-C-016, FR-C-013
**Given** a reviewer has escalated an agentic report finding from Should Fix to Must Fix
**When** the MLR comment card is displayed
**Then** an escalation chip is shown in the comment footer: "⬆ Escalated from agentic Should Fix · [reviewer name] · [date time]". The chip styling is blue-grey (distinct from Must Fix red).
**Fail if** the escalation chip is absent on a comment that was escalated from an agentic finding, or if the escalated-by identity is not shown

---

### AC-C-032 — MLR decision requires inline Part 11 confirmation
**FR:** FR-C-013, FR-C-023, PRD v4.1 §13.2
**Given** the MLR Lead has selected a decision and clicks Submit MLR decision
**When** the submit action is triggered
**Then** the decision panel expands inline to show a confirmation step with: pre-filled Signatory name (read-only), Role (read-only), Decision being signed (the selected decision text), a mandatory checkbox: "I confirm this decision is accurate and I am signing this record under 21 CFR Part 11", and a "Confirm & sign" button. Submitting without checking the box is blocked.
**Fail if** the decision is submitted without an explicit inline confirmation step, or if the checkbox is not required

---

## 26. Claims Matrix Panel — sC07 (FR-C-014, FR-C-017, FR-C-018)

### AC-C-033 — Claims gate summary bar reflects current state
**FR:** FR-C-014, FR-C-018
**Given** the Claims Matrix Panel (sC07) is displayed
**When** the summary bar above the filter tabs is viewed
**Then** the bar shows: approved count, modified count, new/unvetted count, must-fix count, and a gate status: "Ready for MLR submission" (when must-fix = 0) or "BLOCKED — [N] must-fix claims require resolution before MLR submission" (when must-fix > 0). The blocked state uses a red left border.
**Fail if** the summary bar is absent, or if the gate status does not reflect the current must-fix count

---

### AC-C-034 — Must Fix and New status are visually distinct
**FR:** FR-C-018
**Given** claims with different statuses are displayed in the matrix
**When** the status badges are compared
**Then** Modified uses amber styling (background #FFFBEB, text #B45309); New / unvetted uses red-tinted styling (background #FFF1F2, text #BE123C, border #FECDD3). These two statuses are visually distinct.
**Fail if** Modified and New/unvetted use the same colour styling

---

### AC-C-035 — Library claim adoption creates audit record and updates status immediately
**FR:** FR-C-018
**Given** the user clicks "Use approved claim text" for a matched library claim
**When** the adoption is confirmed
**Then** the claim row immediately updates to show `approvalStatus: 'approved'` with the reviewer field showing "Library adoption · [timestamp]". An audit entry is created with event type `claim_library_adopted`, recording that the status was set to Approved without MLR re-review.
**Fail if** the claim status does not update immediately in the UI, or if no audit entry is created for the adoption

---

## 27. Formatting & Accessibility — sC08 (FR-C-020, FR-C-021, FR-C-022)

### AC-C-036 — HTML format output gated on WCAG 2.1 AA
**FR:** FR-C-022
**Given** the Formatting & Accessibility screen (sC08) is displayed
**When** the Output Formats section is viewed
**Then** the HTML format shows an amber "WCAG check required" badge when the WCAG result has `passed: false`. The HTML download is disabled until the WCAG check passes. PDF and PPTX formats are not gated on WCAG.
**Fail if** HTML format can be downloaded when WCAG has not passed, or if the WCAG badge is absent

---

### AC-C-037 — WCAG failure shows specific contrast ratio values
**FR:** FR-C-022
**Given** a WCAG 1.4.3 contrast failure is present
**When** the failure detail is displayed
**Then** the fix guidance shows specific values: current contrast ratio (e.g. "2.8:1"), required ratio (e.g. "≥4.5:1 for normal text"), the specific colour change recommended (e.g. "Change text from #94A3B8 to #475569"), and the slide where the failure occurs.
**Fail if** the fix guidance uses placeholder text without specific contrast ratio values

---

### AC-C-038 — WCAG panel header identifies content output standard (not platform UI standard)
**FR:** FR-C-022
**Given** the WCAG panel is displayed
**When** the panel header is viewed
**Then** the header reads "WCAG 2.1 Level AA — Content Output Check" (not "WCAG 2.2" which is the platform UI standard). This distinction must be visible.
**Fail if** the content output WCAG panel header shows WCAG 2.2, or if no version is specified

---

### AC-C-039 — Stage 5 checklist gates Stage 6 progression
**FR:** FR-C-020, FR-C-022
**Given** the Stage 5 Checklist is displayed
**When** any required item is unmet
**Then** the "Proceed to Stage 6 →" button is disabled. Required items are: Output formats generated, WCAG 2.1 AA check passed (for HTML/digital formats), Distribution channels confirmed, Channel tags applied to all outputs.
**Fail if** Stage 6 can be reached without all four checklist items satisfied

---

### AC-C-040 — Localisation section shows browser-native model
**FR:** FR-C-021, OQ-C-001 resolution
**Given** the Localisation section is displayed
**When** any locale entry is shown
**Then** the section header reads "Browser-native localisation · Shared Master Library model". The parent English version is shown as the base. Localised versions show country affiliate, language, and local MLR sign-off status.
**Fail if** the section implies a translation API is used, or if localised versions do not show their local MLR sign-off chain

---

## 28. Final Output — sC09 (FR-C-023, FR-C-024, FR-C-025, FR-C-026)

### AC-C-041 — Regulatory disclaimer referenced in Final Output Record
**FR:** PRD v4.1 §20.2
**Given** the Final Output Record (sC09) is displayed
**When** the record is reviewed
**Then** a "Regulatory disclaimer" row is present stating: "AURORA regulatory disclaimer is included as page 1 of all exported PDFs and is recorded in the distribution package." This is a factual record entry, not a warning banner.
**Fail if** the regulatory disclaimer is not referenced in the Final Output Record

---

### AC-C-042 — Compliance provenance timeline fully rendered without interaction
**FR:** FR-C-023, PRD v4.1 §13.2
**Given** the Compliance Provenance section is displayed
**When** the section is viewed without any user interaction
**Then** a vertical milestone list is fully visible showing at minimum: Stage 1 briefing (date), Stage 2 KOL session (date), Stage 3 draft (version, date), Pre-MLR check passed (date), MLR Approved (tier, date). Each milestone shows date, stage name, and key action.
**Fail if** the timeline requires interaction to reveal, or if any of the five milestones is absent

---

### AC-C-043 — Expiry schedule visible in Final Output
**FR:** FR-C-026
**Given** the content expiry section is displayed in sC09
**When** the section is viewed
**Then** the full alert schedule is visible without clicking "Configure alerts →": 60-day alert date, 30-day alert date, expiry date, and the names of alert recipients. All four pieces of information are present.
**Fail if** the alert dates or recipient names require a click to reveal

---

### AC-C-044 — Master Library push confirmed with card count
**FR:** FR-C-025
**Given** the Master Library section in sC09 is displayed
**When** the push status is viewed
**Then** a confirmed count of cards pushed is shown: e.g. "5 cards pushed ✓". Each card is listed by type and TA tag. Cards are available for reuse in Modules D and E (shown as module chips or labels on each card).
**Fail if** the push confirmation shows no card count, or if the available-in-modules attribution is absent

---

## 29. Content Portfolio — sC10 (FR-C-026)

### AC-C-045 — Overdue MLR content distinctly styled
**FR:** FR-C-013
**Given** a content item has an MLR due date that has passed
**When** the content item card is displayed in the portfolio
**Then** an overdue alert banner is shown on the card: "MLR overdue — due [date]". The card has a red left border accent (#BE123C) distinguishing it from items simply "In MLR Review".
**Fail if** overdue MLR items are visually indistinguishable from non-overdue items in MLR Review

---

### AC-C-046 — Tier assignment pending state explains required action
**FR:** FR-C-017
**Given** a content item shows "Tier assignment pending" chip
**When** the user hovers or reads the chip
**Then** a tooltip or sub-label explains: "Claims matrix needs ≥5 claims for tier calculation." The author knows what action is needed.
**Fail if** "Tier assignment pending" is shown without any explanation of the required action

---

### AC-C-047 — TA filter available on portfolio view
**FR:** FR-C-004, PRD v4.1 §7.1
**Given** the Content Portfolio is displayed
**When** the filter controls are viewed
**Then** a therapeutic area filter is present alongside the project scope filter. Using the TA filter shows content items matching that TA across all selected projects.
**Fail if** the portfolio has only a project scope filter with no TA filter

---

### AC-C-048 — Expiry countdown shows days remaining per item
**FR:** FR-C-026
**Given** the right panel expiry section is displayed in sC10
**When** the expiry list is viewed
**Then** each item shows: title, expiry date, and days remaining (e.g. "711 days"). Items within 60 days of expiry are amber; within 30 days are red. The nearest expiry is shown at the top of the list.
**Fail if** days-remaining counts are absent, or if urgency colour coding is absent

---

## 30. Cross-Module Compliance (FR-C-004, FR-C-023)

### AC-C-049 — TA tag mandatory at every level
**FR:** FR-C-004, PRD v4.1 §7.9
**Given** any content item, content section, or Master Library card in Module C
**When** a save or push operation is attempted
**Then** the operation is blocked if the TA tag is absent. The TA tag cannot be removed after creation except by Admin. Every content item and library card displays its TA tag persistently.
**Fail if** any content item can be saved without a TA tag, or if the TA tag can be removed by a non-Admin user

---

### AC-C-050 — Module A source documents are read-only in Module C editor
**FR:** FR-C-002
**Given** a content item is linked to a Module A project
**When** the source documents (CSR, SmPC, IB) are displayed in the editor
**Then** all Module A source documents are shown as read-only with a "Module A ✓" source chip. No Module C operation can modify any Module A document or record.
**Fail if** a Module A source document can be edited from within Module C, or if the read-only status is not visually indicated

---

### AC-C-051 — Content expiry alerts sent at 60 and 30 days
**FR:** FR-C-026
**Given** an MLR-approved content item has an expiry date
**When** the expiry date is 60 days away
**Then** an email alert is sent to the configured alert recipients (Medical Writer and MLR Lead by default). The alert is logged to the audit trail with event type `content_expiry_alert_sent`.
**When** the expiry date is 30 days away
**Then** a second alert is sent and logged.
**Fail if** either alert is not sent, or if alerts are not logged to the audit trail

---

### AC-C-052 — Expired content blocked from Master Library reuse
**FR:** FR-C-026
**Given** a content item has passed its expiry date
**When** any user attempts to pull an expired content card into a new document from the Master Library
**Then** the pull is blocked. An "Expired — Review Required" flag is shown on the card. The block is removed only after the content item is reviewed and re-approved.
**Fail if** expired content cards can be inserted into new documents without review

---

## 31. AI Features (FR-C-008, FR-C-009, FR-C-015, FR-C-016)

### AC-C-053 — Pre-MLR check completes within 45 seconds for 10,000 words
**FR:** FR-C-015, PRD C §8.3
**Given** a content item with up to 10,000 words is submitted for pre-MLR
**When** the pre-MLR check runs
**Then** all checks complete and results are displayed within 45 seconds. A progress indicator is visible during the run.
**Fail if** results take longer than 45 seconds for a ≤10,000-word document

---

### AC-C-054 — Agentic MLR report generated within 90 seconds
**FR:** FR-C-016, PRD C §8.3
**Given** the pre-MLR check has passed
**When** the agentic MLR compliance layer runs
**Then** the MLR Pre-Review Report is generated and displayed within 90 seconds. "Advisory only" label is prominently shown on the report.
**Fail if** the report takes longer than 90 seconds, or if the "Advisory only" label is absent

---

### AC-C-055 — FK readability scoring responds within 500ms per paragraph
**FR:** FR-C-009, PRD C §8.3
**Given** the content editor is open for patient-facing content
**When** the author edits a paragraph
**Then** the FK score updates within 500ms of the paragraph being modified.
**Fail if** the FK score takes longer than 500ms to update after a paragraph edit

---

## 32. Regulatory Compliance (FR-C-019, FR-C-020)

### AC-C-056 — ACCME checklist enforces independence and disclosure
**FR:** FR-C-019
**Given** a content item is on the ACCME/EACCME compliance track
**When** the ACCME Checklist tab is displayed in sC06
**Then** the checklist includes all required items: Commercial support disclosure, Faculty financial disclosure, Independence statement (content not influenced by commercial interest), Fair-balance in educational content, ACCME Standards for Integrity & Independence 2022 compliance. All five items are present.
**Fail if** any of the five ACCME checklist items is absent

---

### AC-C-057 — Distribution channels tagged on all Stage 5 outputs
**FR:** FR-C-020
**Given** distribution channels have been selected for a content item
**When** formatted outputs are generated at Stage 5
**Then** all formatted outputs carry channel metadata tags (e.g. 'Congress', 'Digital', 'Print'). The channel tags are visible in the Output Formats section alongside each format.
**Fail if** any formatted output lacks channel metadata, or if channel tags are absent from the formatting screen

---

## 33. Non-Functional Acceptance Criteria — Module C

### AC-C-058 — Module C boundary violations fail CI
**NFR:** PRD architecture §29
**Given** a developer commits code that imports from any other module's internal folder (e.g. `modules/clinical-writing/` or `modules/scientific-writing/`)
**When** CI runs on Module C code
**Then** the build fails with an ESLint error identifying the specific import violation.
**Fail if** cross-module imports from Module C pass CI without an error

---

### AC-C-059 — Compliance track cannot be changed after Stage 2 via API
**NFR:** DD-C-001
**Given** a content item has status 'kol_session' or higher (Stage 2+)
**When** an API call attempts to change the compliance track
**Then** the API returns 422 with a clear error message. No database record is modified.
**Fail if** the compliance track can be changed via any API call after Stage 2 is reached

---

### AC-C-060 — Audit trail immutability applies to all Module C event types
**NFR:** PRD v4.1 §13.2, FR-A-060 (shared)
**Given** any Module C write operation creates an audit entry (any of the 25 Module C event types)
**When** any user including Super Admin attempts to modify or delete the audit entry
**Then** the attempt is rejected. The audit entry is unchanged.
**Fail if** any Module C audit entry can be modified or deleted via any API endpoint

---

## 34. Module C Acceptance Criteria Index

| AC ID | FR | Screen(s) | Phase |
|-------|-----|-----------|-------|
| AC-C-001 | FR-C-001, FR-C-007 | sC01 Medical Writing Home | 1 |
| AC-C-002 | FR-C-005 | sC01 Medical Writing Home | 1 |
| AC-C-003 | PRD §7.1 | sC01 Medical Writing Home | 1 |
| AC-C-004 | FR-C-004, PRD §7.9 | sC01 Medical Writing Home | 1 |
| AC-C-005 | FR-C-001, DD-C-001 | sC02 Content Briefing | 1 |
| AC-C-006 | FR-C-009, DD-C-005 | sC02 Content Briefing | 1 |
| AC-C-007 | FR-C-001 | sC02 Content Briefing | 1 |
| AC-C-008 | FR-C-001, PRD §11A.3 | sC02 Content Briefing | 1 |
| AC-C-009 | FR-C-001–004 | sC02 Content Briefing | 1 |
| AC-C-010 | FR-C-003 | sC02 Content Briefing | 1 |
| AC-C-011 | FR-C-005, PRD §13.4 | sC03 KOL Session | 1 |
| AC-C-012 | FR-C-005, PRD §7.3 | sC03 KOL Session | 1 |
| AC-C-013 | FR-C-006, FR-C-011 | sC03 KOL Session | 1 |
| AC-C-014 | FR-C-011 | sC03 KOL Session | 1 |
| AC-C-015 | FR-C-005, FR-C-006, FR-C-011 | sC03 KOL Session | 1 |
| AC-C-016 | FR-C-006, FR-C-008 | sC04 Content Editor | 1 |
| AC-C-017 | FR-C-009, DD-C-005 | sC04 Content Editor | 1 |
| AC-C-018 | FR-C-008, PRD §7.2 | sC04 Content Editor | 1 |
| AC-C-019 | FR-C-012, DD-C-004 | sC04 Content Editor | 1 |
| AC-C-020 | FR-C-015, DD-C-002 | sC04 Content Editor | 1 |
| AC-C-021 | FR-C-015 | sC04 Content Editor | 1 |
| AC-C-022 | FR-C-015 | sC05 Pre-MLR Check | 1 |
| AC-C-023 | FR-C-015, DD-C-002 | sC05 Pre-MLR Check | 1 |
| AC-C-024 | FR-C-015, FR-C-016, DD-C-002 | sC05 Pre-MLR Check | 1 |
| AC-C-025 | FR-C-016, PRD §7.2 | sC05 Pre-MLR Check | 1 |
| AC-C-026 | FR-C-017, DD-C-003 | sC05 Pre-MLR Check, sC06 MLR Review | 1 |
| AC-C-027 | FR-C-015 | sC05 Pre-MLR Check | 1 |
| AC-C-028 | FR-C-019, DD-C-001 | sC06 MLR Review | 1 |
| AC-C-029 | FR-C-013 | sC06 MLR Review | 1 |
| AC-C-030 | FR-C-013 | sC06 MLR Review | 1 |
| AC-C-031 | FR-C-016, FR-C-013 | sC06 MLR Review | 1 |
| AC-C-032 | FR-C-013, FR-C-023, PRD §13.2 | sC06 MLR Review | 1 |
| AC-C-033 | FR-C-014, FR-C-018 | sC07 claims matrix panel | 1 |
| AC-C-034 | FR-C-018 | sC07 Claims Matrix | 1 |
| AC-C-035 | FR-C-018 | sC07 Claims Matrix | 1 |
| AC-C-036 | FR-C-022 | sC08 Formatting | 1 |
| AC-C-037 | FR-C-022 | sC08 Formatting | 1 |
| AC-C-038 | FR-C-022 | sC08 Formatting | 1 |
| AC-C-039 | FR-C-020, FR-C-022 | sC08 Formatting | 1 |
| AC-C-040 | FR-C-021, OQ-C-001 | sC08 Formatting | 1 |
| AC-C-041 | PRD §20.2 | sC09 Final Output | 1 |
| AC-C-042 | FR-C-023, PRD §13.2 | sC09 Final Output | 1 |
| AC-C-043 | FR-C-026 | sC09 Final Output | 1 |
| AC-C-044 | FR-C-025 | sC09 Final Output | 1 |
| AC-C-045 | FR-C-013 | sC10 Content Portfolio | 1 |
| AC-C-046 | FR-C-017 | sC10 Content Portfolio | 1 |
| AC-C-047 | FR-C-004, PRD §7.1 | sC10 Content Portfolio | 1 |
| AC-C-048 | FR-C-026 | sC10 Content Portfolio | 1 |
| AC-C-049 | FR-C-004, PRD §7.9 | All sC screens | 1 |
| AC-C-050 | FR-C-002 | sC04 Content Editor | 1 |
| AC-C-051 | FR-C-026 | System / background | 2 |
| AC-C-052 | FR-C-026 | Master Library (cross-module) | 2 |
| AC-C-053 | FR-C-015, PRD C §8.3 | sC05 Pre-MLR Check | 2 |
| AC-C-054 | FR-C-016, PRD C §8.3 | sC05 Pre-MLR Check | 2 |
| AC-C-055 | FR-C-009, PRD C §8.3 | sC04 Content Editor | 1 |
| AC-C-056 | FR-C-019 | sC06 MLR Review — ACCME tab | 1 |
| AC-C-057 | FR-C-020 | sC08 Formatting | 1 |
| AC-C-058 | NFR Architecture §29 | CI pipeline | 2 |
| AC-C-059 | DD-C-001 | API level | 2 |
| AC-C-060 | PRD §13.2, FR-A-060 | API level | 2 |

**Module C total: 60 acceptance criteria covering 26 MVP FRs, 3 NFRs, and 6 Design Decisions across all 10 Module C screens.**

**Combined Module A + C total: 124 acceptance criteria.**


---

## MODULE D — REGULATORY WRITING
### Acceptance Criteria

**Conventions:** `AC-D-###` = criterion ID · `FR-D-###` = functional requirement · `DD-D-###` = design decision · All criteria use Given/When/Then/Fail If format.

---

## 35. Source Data Gathering — Stage 1 (FR-D-001 through FR-D-005)

### AC-D-001 — Module A source link is mandatory at project creation
**FR:** FR-D-001
**Given** a user attempts to create a new Module D submission
**When** no Module A project is selected as the source
**Then** creation is blocked. The error message reads "A Module A project must be linked before a submission can be created. Select a project from Clinical Writing."
**Fail if** a submission can be created without a `sourceModuleAProjectId`

---

### AC-D-002 — Canonical JSON indexing shows data point count
**FR:** FR-D-001
**Given** a Module A source project is linked and the canonical JSON indexing call completes
**When** the Stage 1 screen is viewed
**Then** the indexing status shows "Indexing complete · [N] data points extracted · Logged to audit trail" in IBM Plex Mono. The count matches the actual indexed points from the linked CSR, IB, SAP, and TLF package.
**Fail if** the indexing status shows no data point count, or shows a static placeholder value

---

### AC-D-003 — CMC Readiness Report must be acknowledged before Stage 2
**FR:** FR-D-004
**Given** the CMC Readiness Report has been generated
**When** the Reg Affairs Lead attempts to proceed to Stage 2 without acknowledging
**Then** the Stage 2 proceed button is inactive. After acknowledging (with risk note if completeness < 100%), the button activates and the acknowledgement is logged to the audit trail.
**Fail if** Stage 2 can be reached without CMC Readiness acknowledgement

---

### AC-D-004 — AI-generated submission TOC reflects selected submission type and HA targets
**FR:** FR-D-003
**Given** the user selects "NDA/MAA" with FDA and EMA as target HAs
**When** the eCTD Granularity Map is generated
**Then** the map includes region-specific Module 1 entries for both FDA (Form FDA 1571/1572) and EMA (EU cover letter). The completeness indicator shows the percentage of required sections with at least a draft.
**Fail if** the map shows only a generic CTD structure without HA-specific sections

---

## 36. CTD Module 2 Authoring — Stage 2 (FR-D-006, FR-D-007, FR-D-008, FR-D-009)

### AC-D-005 — CTD Module 2.1 and 2.2 are system-generated and not editable
**FR:** FR-D-006
**Given** the eCTD Granularity Map or CTD Module 2 editor is displayed
**When** a user selects the 2.1 (Table of Contents) or 2.2 (Introduction) node
**Then** the node shows the system-generated indicator (◉ steel blue symbol) and the content is read-only. No edit controls appear.
**Fail if** Module 2.1 or 2.2 can be edited by any user

---

### AC-D-006 — AI suggestions in Module 2.5/2.7 show inline source citations
**FR:** FR-D-007
**Given** the CTD Module 2 editor is open for a Module 2.5 or 2.7 section
**When** an AI suggestion is generated
**Then** the suggestion card shows at least one inline source citation chip referencing the specific canonical JSON source (e.g., "CSR v1.0 · Table 14.2.1"). The model attribution and timestamp appear in IBM Plex Mono. Every AI suggestion is marked with the AI Footprint indicator.
**Fail if** any AI suggestion appears without a source citation, or without AI Footprint indicator

---

### AC-D-007 — Data objectivity checker flags overstated efficacy claims
**FR:** FR-D-007
**Given** a sentence in the CTD Module 2 editor contains a comparative superlative without citation (e.g., "best-in-class")
**When** the editor renders the content
**Then** the flagged phrase shows a purple dashed underline with a tooltip explaining the violation and a suggested revision aligned with PRD v4.1 §12.4 Rule 1. The flag does not block saving but is logged.
**Fail if** overstated efficacy language passes through the editor without any flag

---

### AC-D-008 — Module 2.6 AI suggestions are grounded in nonclinical data, not Module A CSR
**FR:** FR-D-007
**Given** the CTD Module 2 editor is open for a Module 2.6 section
**When** an AI suggestion is generated
**Then** the source citation chip references Module 4 nonclinical data, not Module A CSR data. No CSR citation appears in a Module 2.6 suggestion.
**Fail if** Module 2.6 AI suggestions cite Module A CSR data

---

## 37. Stage 3 Finalisation (FR-D-010 through FR-D-014)

### AC-D-009 — Module 5 nodes are always read-only in Module D
**FR:** FR-D-013, DD-D-001
**Given** the eCTD Granularity Map or any Module 5 section is displayed in Module D
**When** a user attempts to edit any Module 5 content
**Then** no edit controls appear. The read-only banner reads "Module 5 — Imported from Module A · Read-only in Module D. Any changes require a new version in Module A." The lock icon is visible on all Module 5 nodes in the eCTD tree.
**Fail if** any Module 5 content can be edited from within Module D

---

### AC-D-010 — CMC Lead and Nonclinical Lead sign-off gate Stage 4
**FR:** FR-D-011, FR-D-012
**Given** the Stage 3 finalisation screen shows unsigned sections
**When** the CMC Lead or Nonclinical Lead has not yet signed their respective modules
**Then** the "Submit to Super Review →" button is inactive. The sign-off buttons for each module are role-gated — visible only to the assigned CMC Lead or Nonclinical Lead.
**Fail if** Stage 4 can be reached without CMC Lead sign-off on Module 3 and Nonclinical Lead sign-off on Module 4

---

### AC-D-011 — PPD/CCI redaction is irreversible after Stage 5 submission
**FR:** FR-D-014, DD-D-003
**Given** a dossier has been transmitted to a gateway (Stage 5 complete)
**When** any user attempts to un-confirm a PPD or CCI redaction
**Then** the un-confirm action is blocked. The screen shows "Redactions are irreversible after submission. Pre-redaction version retained under restricted access." The API returns 422.
**Fail if** any redaction can be reversed after Stage 5 is complete

---

## 38. Integrated Review — Super Review (FR-D-015 through FR-D-018)

### AC-D-012 — Cross-module consistency check is a hard gate before Stage 5
**FR:** FR-D-016, DD-D-002
**Given** the consistency check has run and Major contradictions remain unresolved
**When** any user attempts to complete Stage 4 sign-off
**Then** the "Submit to Stage 5 →" button is inactive. The gate message reads "Major contradiction unresolved — must resolve before Stage 5." After all Major contradictions are resolved (with resolution notes), the button activates.
**Fail if** Stage 5 can begin with any unresolved Major contradiction

---

### AC-D-013 — Major contradictions require non-empty resolution notes
**FR:** FR-D-016
**Given** a Major contradiction card is displayed in the Super Review Consistency Report
**When** the user attempts to mark it resolved with an empty resolution note
**Then** the resolve action is blocked. An inline validation message: "A resolution note is required for Major contradictions." Only after a non-empty note is entered does the resolve action succeed.
**Fail if** a Major contradiction can be resolved without a resolution note

---

### AC-D-014 — All six RACI roles must sign before Stage 5
**FR:** FR-D-017
**Given** the Super Review stage is active
**When** fewer than 6 of the 6 assigned RACI roles have signed
**Then** the "Submit to Stage 5 →" button is inactive. The sub-label shows "[N] of 6 roles signed · waiting for [role names]."
**Fail if** Stage 5 can begin without all 6 roles signed

---

### AC-D-015 — PSUR/PBRER draft shows AI Footprint indicator
**FR:** FR-D-015
**Given** the aggregate safety report (PSUR/PBRER) draft is generated in Stage 4
**When** the draft is displayed
**Then** every AI-generated section is marked with the AI Footprint indicator. The PV Lead verification prompt is visible: "PV Lead must verify all signal tables and benefit-risk assessments before sign-off." The "Advisory only" label is not present (unlike Module C agentic report) — the safety report is an authoring output, not a compliance advisory.
**Fail if** AI Footprint indicator is absent from AI-generated PSUR/PBRER sections

---

## 39. Publishing — eCTD Compilation (FR-D-019, FR-D-020)

### AC-D-016 — eCTD sections compile automatically when locked (continuous publishing)
**FR:** FR-D-019
**Given** a CTD section is signed off and locked in Stage 2 or 3
**When** the eCTD Publishing Monitor is viewed
**Then** the section's node in the publishing tree transitions from ○ (pending) to ✓ (compiled) automatically — no manual compilation step required. The publishing log entry shows the timestamp of automatic compilation.
**Fail if** any section requires a manual "compile" action to enter the eCTD package after being locked

---

### AC-D-017 — eCTD validation blocks Stage 6 when critical or major errors exist
**FR:** FR-D-020
**Given** the eCTD validation run has completed with at least one critical or major error
**When** any user attempts to proceed to Stage 6 gateway transmission
**Then** the gateway submission buttons are inactive. The gate message shows the count: "[N] critical · [N] major errors must be resolved before submission."
**Fail if** gateway transmission is possible when validation critical > 0 or major > 0

---

## 40. Submission & Post-Submission (FR-D-021 through FR-D-027)

### AC-D-018 — Gateway transmission requires inline Part 11 confirmation
**FR:** FR-D-021
**Given** the user clicks a gateway transmission button (FDA ESG, EMA CESP, etc.)
**When** the click is triggered
**Then** the button does not fire the API call immediately. Instead the submission panel expands inline showing: pre-filled Signatory name (read-only), Role (read-only), the meaning statement, a mandatory checkbox "I authorise the transmission of this eCTD package...", and a "Confirm & transmit" button. Only after the checkbox is checked and Confirm is clicked does the gateway API call fire.
**Fail if** the API call fires without the inline Part 11 confirmation being completed

---

### AC-D-019 — ACK1, ACK2, ACK3 are all displayed with elapsed times
**FR:** FR-D-021
**Given** a gateway submission has been transmitted
**When** the Gateway Submission screen is viewed
**Then** each ACK milestone shows its timestamp and elapsed time since transmission (e.g., "ACK1 ✓ · 16 Oct 14:28 UTC · 6 min"). ACK milestones not yet received show ○ with estimated timeline if available.
**Fail if** elapsed time is absent from any received ACK milestone

---

### AC-D-020 — MHRA gateway is shown in prototype UI as Priority 4 but disabled
**FR:** FR-D-021, OQ-D-008 (resolved)
**Given** the Gateway Submission screen is displayed
**When** the MHRA gateway row is viewed
**Then** the MHRA row is visible with its label and Priority 4 designation, but its transmission button is disabled with the label "MHRA — API procurement required before production." No active transmission is possible via MHRA in the prototype.
**Fail if** MHRA transmission button is active, or if MHRA is absent from the gateway list entirely

---

### AC-D-021 — HA response AI drafts are grounded in canonical JSON layer (DD-D-004)
**FR:** FR-D-022
**Given** a LoQ question is selected for AI drafting
**When** the draft is generated
**Then** the draft response includes at least one inline source citation chip referencing the canonical JSON layer source (e.g., "CSR v1.0 · Table 14.2.7.1"). The AI Footprint indicator is present. The citation is traceable to the specific Module A data point.
**Fail if** a HA response AI draft contains no source citations, or cites sources not in the canonical JSON layer

---

### AC-D-022 — Regulatory Intelligence alerts are visible cross-module
**FR:** FR-D-024, DD-D-005
**Given** a regulatory framework change alert has been triggered
**When** the alert is surfaced in Module D
**Then** the alert card shows: framework name, change summary, effective date, and the list of affected modules. At minimum Module D is listed. Where the alert affects Modules A/B/C, those module names also appear in the `affected_modules` list.
**Fail if** a regulatory alert is only visible in Module D and not surfaced to other relevant modules

---

### AC-D-023 — Master Library push happens after ACK2, not ACK1
**FR:** FR-D-027
**Given** the gateway submission for a submission has received ACK1 (receipt confirmed)
**When** the Final Output screen is viewed
**Then** the "Push to Master Library →" button is inactive with sub-label "Awaiting ACK2 — format validation from gateway." After ACK2 is received, the button activates.
**Fail if** Master Library push is possible after ACK1 only (before format validation confirmed)

---

### AC-D-024 — Orphan Drug eligibility scoring shows EU and US thresholds
**FR:** FR-D-026
**Given** the Orphan Drug Eligibility Tool is displayed for an active project
**When** epidemiological data is entered
**Then** the tool shows two separate eligibility assessments: EU threshold (≤5 in 10,000 patients) and US threshold (<200,000 patients total). Each shows pass/fail status separately. The combined eligibility score is shown.
**Fail if** only one jurisdiction threshold is shown, or thresholds are not labelled by jurisdiction

---

## 41. Non-Functional — Module D (3 criteria)

### AC-D-025 — Consistency check completes within 120 seconds
**FR:** FR-D-016, §8.3
**Given** a full NDA/MAA dossier with canonical JSON layer indexed
**When** the consistency check is triggered
**Then** results are available within 120 seconds. A progress indicator is visible during the check.
**Fail if** results take longer than 120 seconds for a full dossier

---

### AC-D-026 — eCTD validation completes within 300 seconds
**FR:** FR-D-020, §8.3
**When** the EXTEDO eCTD validation run is triggered
**Then** results are available within 300 seconds.
**Fail if** validation results take longer than 300 seconds

---

### AC-D-027 — Module D boundary violations fail CI
**NFR:** §36 ESLint
**Given** code in `modules/regulatory-writing/` imports from any other module's internal folder
**When** CI runs
**Then** build fails with an ESLint error.
**Fail if** cross-module imports pass CI without error

---

## 42. Module D Acceptance Criteria Index

| AC-ID | FR/DD | Screen(s) | Phase |
|-------|-------|-----------|-------|
| AC-D-001 | FR-D-001 | sD02 | 1 |
| AC-D-002 | FR-D-001 | sD02 | 1 |
| AC-D-003 | FR-D-004 | sD02 | 1 |
| AC-D-004 | FR-D-003 | sD03 | 1 |
| AC-D-005 | FR-D-006 | sD03, sD04 | 1 |
| AC-D-006 | FR-D-007 | sD04 | 1 |
| AC-D-007 | FR-D-007 | sD04 | 1 |
| AC-D-008 | FR-D-007 | sD04 | 1 |
| AC-D-009 | FR-D-013, DD-D-001 | sD05, sD03 | 1 |
| AC-D-010 | FR-D-011, FR-D-012 | sD05 | 1 |
| AC-D-011 | FR-D-014, DD-D-003 | sD08 | 1 |
| AC-D-012 | FR-D-016, DD-D-002 | sD06 | 1 |
| AC-D-013 | FR-D-016 | sD06 | 1 |
| AC-D-014 | FR-D-017 | sD06 | 1 |
| AC-D-015 | FR-D-015 | sD06 | 1 |
| AC-D-016 | FR-D-019 | sD07 | 1 |
| AC-D-017 | FR-D-020 | sD07 | 1 |
| AC-D-018 | FR-D-021 | sD09 | 1 |
| AC-D-019 | FR-D-021 | sD09 | 1 |
| AC-D-020 | FR-D-021, OQ-D-008 | sD09 | 1 |
| AC-D-021 | FR-D-022, DD-D-004 | sD10 | 1 |
| AC-D-022 | FR-D-024, DD-D-005 | sD11 | 1 |
| AC-D-023 | FR-D-027 | sD12 | 1 |
| AC-D-024 | FR-D-026 | sD12 | 1 |
| AC-D-025 | FR-D-016, §8.3 | System | 2 |
| AC-D-026 | FR-D-020, §8.3 | System | 2 |
| AC-D-027 | §36 ESLint | CI | 2 |

**Module D total: 27 acceptance criteria covering all 27 MVP FRs across 12 screens.**

---

## MODULE E — IDEATION & PUBLISHING
### Acceptance Criteria

**Conventions:** `AC-E-###` = criterion ID. Module E has no ICH/eCTD/MLR compliance gates — quality gates are brand, claim currency, and source currency.

---

## 43. Stage 1 — Uploaded (FR-E-001 through FR-E-005)

### AC-E-001 — Source content gate hard-blocks platform-authored drafts
**FR:** FR-E-003, DD-E-002
**Given** a platform-authored artefact with status "In Authoring" in its originating module is uploaded
**When** the source gate check runs
**Then** the artefact is blocked with the message: "Source content gate failed — document status is 'In Authoring' in Module [X]. Only Signed / Final Output / Submitted documents may enter the ideation pipeline." The "Proceed to Stage 2 →" button is inactive.
**Fail if** any platform-authored artefact below Signed/Final/Submitted status can proceed to Stage 2

---

### AC-E-002 — External uploads require explicit Ideation Lead confirmation
**FR:** FR-E-003, DD-E-002
**Given** a file uploaded as "External" (not from the platform)
**When** the source gate check evaluates it
**Then** a mandatory confirmation checkbox appears: "I confirm this document was formally approved via an external process. This confirmation is logged to the audit trail." The "Proceed to Stage 2 →" button is inactive until the checkbox is checked.
**Fail if** an external upload can proceed without the explicit confirmation

---

### AC-E-003 — Claim currency "Conflicting" flags block content card use
**FR:** FR-E-004, DD-E-003
**Given** a claim in the uploaded artefact is flagged as "Conflicting — Do Not Use" by the claim currency check
**When** the Ideation Lead attempts to tag the conflicting passage as a content card
**Then** the tagging action for that passage is blocked. The message reads "This passage contains a claim that conflicts with the current approved label (SmPC/USPI). It may not be used in ideation content." The Ideation Lead must acknowledge the flag but cannot override the block on tagging.
**Fail if** a passage containing a "Conflicting" claim can be tagged as an ideation content card

---

### AC-E-004 — Master Library cards older than 90 days receive lightweight currency check
**FR:** FR-E-002 (v0.3 fix)
**Given** an Ideation Lead pulls a card from the Master Library that was pushed more than 90 days ago
**When** the card is added to the ideation project
**Then** a lightweight source currency check runs automatically: (a) verifies the source module document has not been superseded, and (b) verifies the product label has not been updated since the card was pushed. If either check fails, an amber warning is shown before the card is added. Cards pushed within 90 days bypass this check.
**Fail if** a Master Library card older than 90 days is added without a currency check

---

## 44. Stage 2 — Under Review (FR-E-006 through FR-E-010)

### AC-E-005 — Source document is always read-only in the tagging panel
**FR:** FR-E-006, DD-E-001
**Given** the Content Card Tagging screen is displayed
**When** the Ideation Lead views the source document in the left panel
**Then** no text editing controls appear on the source document. The label "Source document — read-only" is visibly present on the panel. Clicking any text in the source document shows the tagging affordance (Tag +) but not a cursor or edit mode.
**Fail if** any text in the source document panel can be edited by any user

---

### AC-E-006 — AI atomisation generates one call per channel (not batched)
**FR:** FR-E-007, DD-E-004
**Given** the Ideation Lead selects two channel formats for atomisation
**When** the "Generate ✦" button is clicked
**Then** two separate AI calls are made — one per channel. Each channel shows its own spinner that resolves independently. The token usage counter updates per channel completion, not once at the end.
**Fail if** a single API call generates all channel formats at once, or if a single spinner is shown for all channels

---

### AC-E-007 — Compliance screen Must Fix blocks KOL submission
**FR:** FR-E-008
**Given** a content card has at least one Must Fix compliance issue
**When** the "Submit to KOL Review →" button is displayed
**Then** the button is inactive. The gate message reads "[N] Must Fix issue(s) must be resolved before KOL submission." Advisory issues do not block submission.
**Fail if** KOL review submission is possible with any unresolved Must Fix issues

---

### AC-E-008 — Provenance chain is visible on every content card without interaction
**FR:** FR-E-009
**Given** any ideation content card is displayed (in tagging, compliance screen, KOL review, or MA approval)
**When** the card is rendered
**Then** the full provenance chain is visible without any click or expand: "Source: [document title] §[section] → [parent source] → Module [A/B/C/D]". No collapse or "View source" click is required.
**Fail if** the provenance chain requires any interaction to view, or is absent from any card view

---

### AC-E-009 — KOL review link is a one-time token, expires after 7 days
**FR:** FR-E-010
**Given** a KOL review invitation has been sent
**When** the KOL clicks the review link after it has expired (>7 days) or after they have already submitted
**Then** the page shows "This review link has expired or has already been used. Please contact the Ideation Lead for a new invitation." The token is not reusable.
**Fail if** an expired or already-used KOL review token allows access to the review interface

---

## 45. Stage 3 — Reviewed (FR-E-011)

### AC-E-010 — KOL modification requests are visible in the MA approval panel
**FR:** FR-E-011
**Given** a KOL has requested modification for a content card
**When** the Ideation Lead resolves the modification and the card enters Stage 4
**Then** the MA approval panel shows the KOL's original comment and the Ideation Lead's resolution: "KOL requested: [comment] · Resolved by Ideation Lead: [date]." The MA Lead can see the full modification history.
**Fail if** the KOL modification request and its resolution are not visible in the MA approval panel

---

## 46. Stage 4 — Approved (FR-E-012 through FR-E-014)

### AC-E-011 — MA sign-off is a digital approval stamp, not a 21 CFR Part 11 e-signature
**FR:** FR-E-014, §8.1 (PRD E v0.3 clarification)
**Given** the Medical Affairs Team Lead completes the Stage 4 approval
**When** the sign-off is recorded
**Then** the approval stamp shows: Name, Role, Timestamp. The audit trail entry records this as a "digital approval stamp." The UI does not present a 21 CFR Part 11 credential re-entry form for this action. A note on the approval screen reads "This is a digital approval record, not a regulatory e-signature."
**Fail if** the MA sign-off triggers a full 21 CFR Part 11 credential re-entry flow

---

### AC-E-012 — KOL reminder escalation fires at 3, 5, and 7 days
**FR:** FR-E-020 (PRD E v0.3 P2-09)
**Given** a KOL has been invited but has not submitted their review
**When** 3 days have elapsed since invitation
**Then** a reminder email + SMS is sent automatically. At 5 days a second reminder fires. At 7 days an escalation alert is sent to the Ideation Lead and Medical Affairs Team Lead. All three events are logged to the audit trail.
**Fail if** any of the three reminder/escalation events does not fire at the correct interval, or is not logged

---

## 47. Content Calendar & Publishing (FR-E-015 through FR-E-017)

### AC-E-013 — Overdue calendar items show red-tinted cell and alert
**FR:** FR-E-016, FR-E-020
**Given** content was scheduled for a date that has now passed and was not marked as published
**When** the calendar is viewed
**Then** the overdue date cell has a red-tinted background (`#FFF1F2`). An overdue alert chip is shown on the content chip: "OVERDUE · [hours] late." A notification was sent to the MA Team Lead and Calendar Manager within 24 hours of the scheduled date passing.
**Fail if** overdue items are not visually distinct from scheduled items, or if the 24h alert was not sent

---

### AC-E-014 — Auto-stop check runs before future posts on same topic after negative sentiment
**FR:** FR-E-017
**Given** a published piece has triggered a negative sentiment alert
**When** a future-scheduled piece on the same product/topic is due to publish
**Then** the system runs an auto-stop check and notifies the Content Calendar Manager: "Negative sentiment detected on prior [product] content — review before publishing the scheduled [date] post." The auto-stop is advisory — it notifies rather than cancels. If the configured sentiment threshold is breached (default 40% negative), it escalates to the MA Team Lead.
**Fail if** the auto-stop check does not run, or if a threshold breach does not escalate to MA Team Lead

---

### AC-E-015 — Publishing is human-executed; no direct social API calls (DD-E-005)
**FR:** FR-E-016, DD-E-005
**Given** content is scheduled and the scheduled date arrives
**When** the Creative team member marks content as published
**Then** the platform records the publish event (by whom, when, UTM params, SEO metadata) but does NOT make any direct API call to LinkedIn, Twitter, or any social channel. The "Mark as published" action captures the manual confirmation. A note on the publishing screen reads "Publishing in v0.1 is human-executed. Platform publishing connectors are Phase 2."
**Fail if** the platform attempts a direct API call to any social platform

---

### AC-E-016 — Localised versions are linked to the parent approved card
**FR:** FR-E-018
**Given** a localised version has been created for a content card
**When** the localised version is viewed
**Then** it shows a "Parent: [card title] · [language] (Parent)" reference chip. The localised version's approval status is separate from the parent — local MA sign-off is required independently. Both the parent and localised versions are stored under the same ideation project.
**Fail if** a localised version does not reference its parent card, or shares the parent's MA approval status

---

## 48. Standards & Metadata (FR-E-019)

### AC-E-017 — DOI registration is only offered for long-form content types
**FR:** FR-E-019
**Given** the Standards & Metadata screen is displayed
**When** the content card being registered is a LinkedIn post or X/Twitter post
**Then** the DOI registration section shows "Not eligible — DOI registration applies to long-form citable artefacts (articles, white papers) only." The "Register DOI →" button is absent for short-form content.
**Fail if** the DOI registration button appears for LinkedIn posts, tweets, or other short-form channel adaptations

---

### AC-E-018 — Dublin Core metadata is applied to all 15 elements
**FR:** FR-E-019
**Given** the Dublin Core tagging action is triggered for a published artefact
**When** the metadata is applied
**Then** all 15 Dublin Core elements are populated: dc:title, dc:creator, dc:subject (TA tag), dc:description, dc:date, dc:type, dc:format, dc:identifier (DOI if registered), dc:rights, dc:language, dc:source, dc:relation, dc:coverage, dc:publisher, dc:contributor. The metadata is stored in the `dublin_core_metadata` table and embedded in the PDF/HTML output.
**Fail if** fewer than all 15 DC elements are populated, or if metadata is not embedded in the output file

---

### AC-E-019 — WCAG check uses 2.1 Level AA (not 2.2) for content outputs
**FR:** FR-E-019 (PRD E v0.3 V-04 fix)
**Given** the WCAG check is run on a published Module E PDF or HTML article
**When** the results are displayed
**Then** the panel header reads "WCAG 2.1 Level AA — Content Output Check." No reference to WCAG 2.2 appears in the content output check results. A note clarifies: "WCAG 2.1 AA applies to published content outputs. The Aurora platform UI targets WCAG 2.2 AA — these are separate standards."
**Fail if** the content output WCAG check displays "WCAG 2.2" in any label

---

### AC-E-020 — Module E owns the CrossRef/ORCID shared service
**FR:** FR-E-019, OQ-E-006 (resolved)
**Given** a DOI registration or ORCID verification is requested from either Module B or Module E
**When** the API call is made
**Then** the call is routed through the single shared CrossRef/ORCID service owned by Module E. Module B's DOI/ORCID workflow uses the same service endpoint, not a separate API integration. A note in the sE10 screen reads "CrossRef/ORCID API: Module E owns this shared service. Module B publications use the same service."
**Fail if** Module B and Module E use separate, independent CrossRef/ORCID integrations

---

## 49. Cross-Cutting & Non-Functional — Module E

### AC-E-021 — Source gate check is sequential; currency checks do not run if gate fails
**FR:** FR-E-003, FR-E-004, FR-E-005
**Given** an uploaded artefact fails the source content gate check (status below Signed/Final)
**When** the gate check returns a fail
**Then** the source currency check and claim currency check do not run. The screen shows only the gate failure. Running the subsequent checks would be meaningless if the source is not approved.
**Fail if** source currency or claim currency checks run when the source gate has already failed

---

### AC-E-022 — 21 CFR Part 11 audit trail covers all ideation stage transitions
**FR:** FR-E-001, §8.1
**Given** any ideation project advances through a stage transition (Uploaded → Under Review → Reviewed → Approved)
**When** the transition event occurs
**Then** an audit entry is created with: event type, user ID, timestamp, and the content cards affected. The audit trail is 21 CFR Part 11 compliant per the platform standard.
**Fail if** any stage transition is not logged to the audit trail

---

### AC-E-023 — KOL guest route has no Aurora authentication
**FR:** FR-E-010
**Given** a KOL accesses the review interface via their secure one-time link
**When** the page loads at `/kol-review/:token`
**Then** no Aurora login prompt, session check, or authentication redirect occurs. The route is fully public. The KOL sees the review interface immediately on valid token. On invalid/expired token, a public-facing "link expired" page is shown (not an Aurora login page).
**Fail if** a KOL is redirected to an Aurora login page when accessing a valid review link

---

## 50. Module E Acceptance Criteria Index

| AC-ID | FR/DD | Screen(s) | Phase |
|-------|-------|-----------|-------|
| AC-E-001 | FR-E-003, DD-E-002 | sE02 | 1 |
| AC-E-002 | FR-E-003, DD-E-002 | sE02 | 1 |
| AC-E-003 | FR-E-004, DD-E-003 | sE03 | 1 |
| AC-E-004 | FR-E-002 (v0.3) | sE02 | 1 |
| AC-E-005 | FR-E-006, DD-E-001 | sE03 | 1 |
| AC-E-006 | FR-E-007, DD-E-004 | sE03 | 1 |
| AC-E-007 | FR-E-008 | sE04 | 1 |
| AC-E-008 | FR-E-009 | sE03, sE04, sE05, sE06 | 1 |
| AC-E-009 | FR-E-010 | sE05 | 1 |
| AC-E-010 | FR-E-011 | sE06 | 1 |
| AC-E-011 | FR-E-014, §8.1 | sE06 | 1 |
| AC-E-012 | FR-E-020 (v0.3 P2-09) | System | 1 |
| AC-E-013 | FR-E-016, FR-E-020 | sE07 | 1 |
| AC-E-014 | FR-E-017 | sE08 | 1 |
| AC-E-015 | FR-E-016, DD-E-005 | sE08 | 1 |
| AC-E-016 | FR-E-018 | sE07 | 1 |
| AC-E-017 | FR-E-019 | sE10 | 1 |
| AC-E-018 | FR-E-019 | sE10 | 1 |
| AC-E-019 | FR-E-019 (v0.3 V-04) | sE10 | 1 |
| AC-E-020 | FR-E-019, OQ-E-006 | sE10 | 1 |
| AC-E-021 | FR-E-003–005 | sE02 | 1 |
| AC-E-022 | FR-E-001, §8.1 | System | 2 |
| AC-E-023 | FR-E-010 | sE05 | 1 |

**Module E total: 23 acceptance criteria covering 20 MVP FRs across 10 screens.**

---

## Combined Total

| Module | AC count | FRs covered |
|--------|----------|------------|
| A — Clinical Writing | 64 | 33 MVP |
| C — Medical Writing | 60 | 26 MVP |
| D — Regulatory Writing | 27 | 27 MVP |
| E — Ideation & Publishing | 23 | 20 MVP |
| **Combined total** | **174** | |
