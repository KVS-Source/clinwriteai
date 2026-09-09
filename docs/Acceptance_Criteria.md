# Aurora — Acceptance Criteria
**Module A: Clinical Writing**
**Version 1.0 — September 2026**
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

**Total: 64 acceptance criteria covering 33 MVP FRs and 3 NFRs across all 27 Module A screens.**

---

## 20. Document Revision History

| Version | Date | Summary |
|---------|------|---------|
| 1.0 | Sept 2026 | Initial version. 60 acceptance criteria across 19 sections. Covers all 33 MVP FRs, 3 NFRs, and all 27 Module A screens. Given/When/Then format with explicit Fail If conditions per criterion. |
