# AURORA — Missing Screens & Functionality PRD
**Document:** AURORA-PRD-MISSING-v1.0
**Date:** September 2026
**Classification:** Confidential — Internal Use Only
**Scope:** 16 screens identified as missing from the current Architecture v5, Data Model v5, API Contracts v5, and Acceptance Criteria v4. All 16 are specified in PRD v4.1. This document defines each screen in full so engineering documents can be updated.

---

## 1. Summary of Missing Screens

| Screen ID | Name | PRD Reference | Phase | Colour |
|-----------|------|--------------|-------|--------|
| sPM04 | Admin Panel | §6.6, §7.9, §8.3, §9.1 | Phase 0 | Navy #1A3C5E |
| sPM05 | Super Admin Panel | §6.6, §10.1, §11A | Phase 0 | Navy #1A3C5E |
| sPM06 | User Management | §6.6, §3A.1 | Phase 0 | Navy #1A3C5E |
| sPM07 | RACI Matrix Viewer | §6A | Phase 1 | Navy #1A3C5E |
| sPM08 | Master Library | §7.6 | Phase 4 | Navy #1A3C5E |
| sPM09 | Best Practices Library | §12.1–12.4 | Phase 4 | Navy #1A3C5E |
| sPM10 | Onboarding Wizard | §7.11 | Phase 1 | Per-module colour |
| sPM11 | Services Dashboard | §8.1, §8.2 | Phase 4 | Navy #1A3C5E |
| sPM12 | Rate Card Admin | §10.1, §10.2 | Phase 4 | Navy #1A3C5E |
| sPM13 | Subscription & Payment | §8.3 | Phase 4 | Navy #1A3C5E |
| sPM14 | Notification Centre | §7.4, §19.5 | Phase 1 | Navy #1A3C5E |
| sPM15 | Audit Trail Viewer | §7.5, §13.2 | Phase 0 | Navy #1A3C5E |
| sPM16 | Reports & Analytics | §7.1, §21 | Phase 4 | Navy #1A3C5E |
| sPM17 | TA Tag Configuration | §7.9, §3A.1 | Phase 0 | Navy #1A3C5E |
| sPM18 | Regulatory Framework Admin | §11A | Phase 3 | Navy #1A3C5E |
| sB10 | Slide Deck Generator | §4.2, §7.3 | Phase 2 | Violet #7B3C9A |

All platform/admin screens (sPM) use Navy `#1A3C5E`. The slide deck generator inherits Module B Violet `#7B3C9A`.

---

## 2. Screen Specifications

---

### sPM04 — Admin Panel
**Route:** `/admin`
**Component:** `AdminPanel`
**Access:** Admin role only (per-client organisation)
**Phase:** 0

The Admin Panel is the primary configuration interface for client-level administrators. It is accessed from the left nav under "Admin" and is visible only to users with the Admin role.

**Tabs / sections:**

**2.1 Client Configuration**
- Client name (editable)
- Client logo upload (applied to all document templates)
- Default language (English default; additional languages Phase 6)
- Print settings: printing disabled for non-approved documents by default; Admin can override per document type

**2.2 AI Engine Configuration**
- Default AI engine selector: Claude Sonnet 4.5, Claude Opus, Claude Haiku, OpenAI GPT-4o, Google Gemini Pro, and others as configured
- Fallback engine selector (triggered if primary is unavailable)
- Per-module AI engine override option
- Test connection button: fires a test prompt to confirm connectivity and logs the result

**2.3 Voice Transcription Engine**
- Engine selector: Whisper, AssemblyAI, Azure Speech, or configured alternative
- GDPR / data sovereignty settings: audio file retention period (configurable: 24h, 7 days, 30 days, or delete immediately post-transcription); jurisdiction selector (EU, US, APAC); data stays in the selected jurisdiction

**2.4 eCTD Configuration**
- Default eCTD version: v3.2.2 or v4.0 (Admin sets the default; Regulatory Affairs Lead can override per submission at Stage 1)
- Validation tool: EXTEDO EXTEDOpulse, Lorenz, or configured alternative

**2.5 Payment Gateway Configuration**
- Active gateway selector (multi-select): Stripe, RazorPay, PayU, CCAvenue, UPI, Net Banking, Credit/Debit Cards
- Webhook URL configuration per gateway
- Test payment button

**2.6 Subscription Management**
- Current plan name, services activated, renewal date
- "Purchase additional services" → redirects to sPM13 (Subscription & Payment)

**2.7 User Roles Configuration**
- Link to User Management (sPM06) and RACI Matrix (sPM07)

**2.8 Template Library**
- Upload and manage client-branded templates (Word, PDF) per PRD §7.9: client logos and specific format elements are uploaded and applied at Admin configuration stage
- Per-module template assignment — customisable per document type
- Template customisation includes: client logo, font, colour scheme, header/footer format elements
- Version history for templates

**2.9 External API Connectors**
- Table of 22 external API touchpoints per PRD §9.1
- Each row: connector name, status (Active / Inactive / Error), last tested, credentials (masked), "Edit credentials" action
- Connectors include: FDA ESG, EMA CESP, CDSCO, MHRA, EXTEDO/Lorenz, PubMed, ORCID, CrossRef, SMS gateway, Email SMTP, Calendar (Google/Outlook), Payment gateways

---

### sPM05 — Super Admin Panel
**Route:** `/super-admin`
**Component:** `SuperAdminPanel`
**Access:** Super Admin role (GenBioCa internal) only
**Phase:** 0

The Super Admin Panel is exclusively accessible to GenBioCa Super Admins. It is never visible to client Admin or lower roles.

**Tabs / sections:**

**5.1 Client Management**
- Full list of all client organisations on the platform
- Per-client: Name, Plan, Status (Active/Suspended/Churned), Admin contact, Created date, Revenue to date
- Create new client, suspend client, delete client (soft delete with 90-day retention)

**5.2 Rate Card Management** → links to sPM12

**5.3 Regulatory Framework Registry** → links to sPM18

**5.4 Platform Analytics**
- Total users, active projects, documents created, AI tokens consumed — platform-wide
- Revenue dashboard: MRR, ARR, churn rate, token consumption by client

**5.5 Platform Configuration**
- Available AI engine list management (add/remove engines available for Admin selection)
- Available voice transcription engines management
- Platform-wide feature flags

**5.6 Audit Log — Platform Level**
- Full cross-client audit log (read-only)
- Filter: client, user, action type, date range
- Export: CSV

---

### sPM06 — User Management
**Route:** `/admin/users`
**Component:** `UserManagement`
**Access:** Admin role (manages own org users); Super Admin (reads all)
**Phase:** 0

**User list table:**
Columns: Name · Email · Role · Modules assigned · Status (Active/Invited/Suspended) · Last active · Actions

**Actions per user:**
- Edit role
- Assign/remove module access
- Suspend / reactivate
- Resend invitation
- View audit trail for this user

**Invite new user:**
- Email, First name, Last name, Role selector, Module access checkboxes
- Invitation email sent automatically with platform link and T&C acceptance prompt

**Role options (from PRD §6.6):**
Super Admin (GenBioCa only), Admin, Project Lead / Manager, Author, Reviewer, QC Checker, E-Signatory, Module-specific roles (Medical Writer, Regulatory Affairs Lead, Ideation Lead, etc.)

**RACI integration:**
When a user's role is set or changed, their RACI assignments for all active projects are automatically updated. Admin can preview RACI impact before confirming a role change.

---

### sPM07 — RACI Matrix Viewer
**Route:** `/admin/raci` (Admin view) · `/projects/:projectId/raci` (Project Lead view)
**Component:** `RACIMatrix`
**Access:** Admin (edit); Project Lead (view); all other roles (own assignments only)
**Phase:** 1

**Matrix display:**
A table with roles as columns and document/stage tasks as rows. Each cell shows: R (Responsible), A (Accountable), C (Consulted), I (Informed), or blank.

Pre-configured RACI charts per PRD §6A for all five modules. Admin can adjust assignments for the specific project while keeping the default template intact.

**User-level view:**
When any user clicks "My RACI" from their profile or onboarding wizard, they see only the rows where they have an assignment. Colour-coded: R = module accent, A = amber, C = navy, I = grey.

**Bulk assignment:**
Admin can assign an entire column (role) to a user across all tasks in one action.

---

### sPM08 — Master Library
**Route:** `/library`
**Component:** `MasterLibrary`
**Access:** All authenticated users (read); Author+ (push/pull)
**Phase:** 4

**Search & filter panel (left, ~300px):**
- Full-text search across all library items
- Filters: Module (A/B/C/D/E), Project, Therapeutic Area, Document Type, Version, Date range, Item type (Document / Section / Best Practice)

**Results list (centre):**
Each item card shows: Name, Module chip (colour-coded), Project, TA, Doc type, Version, Pushed date, Pushed by, Item type

**Item detail panel (right):**
- Full metadata
- Provenance chain (for sections: Source document → Module → Project)
- "Pull into document" button — inserts at cursor position in the active editor
- "Download PDF" for full documents
- Version history

**Archive indicator:**
Items from closed projects show a grey "Archived" tag. They remain accessible in read-only mode.

**Push to Library:**
Authors push from the Final Output screen of each module. The push action requires: Document Type, Version, TA tag, optional free-text tags. Confirmation step: "This item will be available to all users with library access. Continue?"

---

### sPM09 — Best Practices Library
**Route:** `/library/best-practices`
**Component:** `BestPracticesLibrary`
**Access:** All authenticated users (read); Super Admin (create/edit/delete)
**Phase:** 4

**Structure:**
Tab strip: Module A · Module B · Module C · Module D · Platform-Wide

Each tab shows a card list of best practice items. Each card: Title, Module, Category, Last updated, Updated by (Super Admin name).

**Item detail:**
- Best practice guidance text (rich text, may include examples)
- Applicable document types
- Related regulatory framework references
- "Effective from" date and "Valid until" date (rate card pattern from PRD §10.1)
- Version history

**Naming convention (PRD §12):** `[Module]-[Category]-[Version]-[Date]`
Example: `Module-D-CTD-Authoring-v1.2-2026-01`

**Quarterly refresh reminder:**
The platform notifies the Super Admin on the first day of each quarter with a list of best practice items older than 90 days, prompting review.

---

### sPM10 — Onboarding Wizard
**Route:** `/onboarding/:module` (contextual per module)
**Component:** `OnboardingWizard`
**Access:** All users (first access to each module)
**Phase:** 1

The wizard is presented the first time a user accesses each module. It is dismissible and re-launchable from the module home screen's help icon.

**Step 1 — Welcome to [Module Name]:**
Module purpose, colour identity, and the documents this module produces. Short animated overview of the module stages (6 stages for A–D; 4 stages for E).

**Step 2 — Your Role in This Module:**
Platform identifies the user's pre-configured role and displays their RACI assignments for this module — the tasks where they are R, A, C, or I. Drawn from the pre-configured RACI chart.

**Step 3 — Creating Your First Document:**
Guided walkthrough: New Document button → document type selection → template selection → naming and TA tagging → submit.

**Step 4 — AI Assist:**
Introduction to the AI panel: how to trigger suggestions, how to accept/reject, what the AI footprint indicator means, and the data provenance trail.

**Step 5 — Workflow Gates:**
Explanation of stage gates: what triggers a stage advance, who approves, what happens if a gate is not met. Shows the user's specific approval responsibilities.

**Step 6 — Done:**
Summary of: my current tasks, my RACI assignments, where to find help. Button: "Go to [Module] Home →"

Each module has its own wizard content. Module content is owned by the Product + SME team and approved through the standard approval process per PRD §7.11.

---

### sPM11 — Services Dashboard
**Route:** `/services`
**Component:** `ServicesDashboard`
**Access:** Admin; Project Lead (read-only)
**Phase:** 4

**Per-module consumption panel:**
For each active module: tokens consumed this month, remaining token balance, estimated spend at current burn rate.

**Per-project breakdown:**
Table: Project · Module · Tokens consumed · Cost (at current rate) · Due date for renewal · Status

**Platform total:**
- Total tokens consumed: all modules, all projects, current period
- Total spend to date vs contracted amount
- Renewal date and next invoice amount

**Top up button:**
Launches sPM13 (Subscription & Payment) pre-filled with the current deficit.

**Export:**
Download CSV of consumption data for any date range.

---

### sPM12 — Rate Card Admin
**Route:** `/super-admin/rate-card`
**Component:** `RateCardAdmin`
**Access:** Super Admin only
**Phase:** 4

**Rate card table:**
Current effective rate card. Columns: Service type · Module · Unit (token / hour / document) · Rate (currency) · Effective from · Valid until

**Versioning:**
Every rate change creates a new version. Previous versions are archived with: version number, effective period, Super Admin who set it, timestamp. Archived versions are read-only and always accessible.

**Rate card management:**
- "New Rate Card" button — creates a new version effective from a future date
- Rate cards cannot be backdated
- When a new rate card becomes effective, the previous one is automatically archived
- Super Admin receives an in-app reminder 7 days before a rate card expires

**Disruption Rate Card:**
The platform ships with the AURORA Disruption Rate Card (PRD §10.2) as the default. Super Admin can replace it.

---

### sPM13 — Subscription & Payment
**Route:** `/admin/subscription`
**Component:** `SubscriptionPayment`
**Access:** Admin
**Phase:** 4

**Current plan summary:**
Plan name, services included, token balances per module, renewal date, next invoice amount.

**Top up / purchase:**
- Service selector (module and units)
- Quantity
- Price preview (real-time, from current rate card)
- "Proceed to payment →"

**Payment gateway:**
Renders the Admin-configured payment gateway UI (Stripe, RazorPay, etc.) inline. On success: confirmation page with invoice number and updated token balance.

**Invoice history:**
Table: Invoice number · Date · Amount · Services · Status (Paid/Pending/Failed) · Download PDF

**Payment method management:**
"Update payment method" → gateway-hosted flow. Returns tokenised method to the platform (no raw card data stored).

---

### sPM14 — Notification Centre
**Route:** `/notifications`
**Component:** `NotificationCentre`
**Access:** All authenticated users
**Phase:** 1

**Inbox (default view):**
List of all notifications for the current user, most recent first. Each notification: type icon · title · module chip · project name · time · read/unread indicator.

**Notification types displayed:**
- Stage advance (document moved to next stage)
- Review assigned (user assigned as reviewer)
- Comment resolution due
- KOL review invitation sent/received
- MA approval due
- Publishing date approaching (3-day advance)
- Publishing overdue (24h past scheduled)
- KOL escalation triggered
- System alerts (gateway ACK received, compliance check complete)
- Rate card expiry reminder (Admin only)

**Actions:**
- Mark as read / Mark all as read
- Click notification → navigates to the relevant screen
- Delete individual notification

**Notification preferences:**
Per notification type: Email on/off · In-app on/off · SMS on/off (where mobile number captured)

**Admin view:**
Admin sees all notifications sent to any user in their organisation, with filter by user and type.

---

### sPM15 — Audit Trail Viewer
**Route:** `/admin/audit` (Admin) · `/projects/:projectId/audit` (Project Lead, scoped to project)
**Component:** `AuditTrailViewer`
**Access:** Admin (full org audit); Project Lead (project-scoped); all users (own actions)
**Phase:** 0

**Audit log table:**
Columns: Timestamp (UTC) · User · Action · Entity type · Entity ID · Before value · After value · IP address · Session ID

**Filter controls:**
- Date range
- User
- Action type (document created, stage advanced, signature applied, gateway submitted, rate card updated, user role changed, T&C accepted, etc.)
- Module
- Project

**Export:**
CSV download for any filtered view.

**Immutability note (always visible):**
"This audit trail is immutable. Entries cannot be edited, deleted, or reordered. Every entry was written at the time of the action it describes. Compliant with 21 CFR Part 11."

**21 CFR Part 11 fields:**
Every entry includes the full digital signature record when applicable (signatory name, role, meaning of signature, timestamp, document version hash).

---

### sPM16 — Reports & Analytics
**Route:** `/reports`
**Component:** `ReportsAnalytics`
**Access:** Admin (full org); Project Lead (project-scoped); Super Admin (platform-wide)
**Phase:** 4

**Dashboard landing (PRD §7.1 + §21):**

**Module-level health scores:**
Per active module: overall health score (0–100), document completion rate, review pass rate, CRM completion rate, average stage completion time.

**Cost & productivity panel:**
- Total documents authored (by module, by period)
- Total AI tokens consumed (cost estimate at current rate card)
- Market value savings (hours saved × standard hourly rate per service type)
- Comparison: actual cost vs market rate

**Project performance panel:**
- Project health score (composite of module health scores)
- On-time vs late document completions
- CRM resolution rate

**Report types available:**
1. Project Summary Report (PDF/CSV) — from Project Dashboard
2. Module Activity Report (per module, date range)
3. AI Usage Report (tokens, cost, model breakdown)
4. User Activity Report (documents touched, stages advanced, signatures applied)
5. Compliance Report (gate pass/fail rates, audit events by type)
6. Publishing Performance Report (Module E — content published, sentiment scores, overdue rates)

**Generate report:**
Select report type → set date range and filters → "Generate PDF" or "Export CSV". Report is queued and emailed on completion for large datasets.

---

### sPM17 — TA Tag Configuration
**Route:** `/admin/taxonomy`
**Component:** `TATagConfiguration`
**Access:** Admin
**Phase:** 0

**Therapeutic Area taxonomy management:**
TA tagging is mandatory on every module, project, document, and artefact (PRD §7.9, §3A.1). Admin configures the initial list at setup.

**Tag list:**
Current list of active TA tags. Columns: Tag name · Abbreviation · Status (Active/Archived) · Created date · In use (count of projects and documents)

**Add new tag:**
Name (free text) · Abbreviation (max 6 chars, auto-suggested) · Save.

**Archive tag:**
Tags with existing documents cannot be deleted — only archived. Archived tags are not available for new documents but existing documents retain them.

**Managed taxonomy note:**
"Tags are validated against this master list during document creation. Adding a tag here makes it immediately available across all modules and projects."

---

### sPM18 — Regulatory Framework Admin
**Route:** `/super-admin/frameworks` (Super Admin) · `/admin/frameworks` (Admin — read-only)
**Component:** `RegulatoryFrameworkAdmin`
**Access:** Super Admin (edit); Admin (read); all users via sD11 (read-only filtered view)
**Phase:** 3

**Framework registry table:**
Columns: Framework code · Full name · Issuer · Version · Effective date · Scope (modules) · Status · Last updated · Updated by

Pre-loaded frameworks include all entries from PRD §11A.4: 21 CFR Part 11, 21 CFR Part 312, 21 CFR Part 314, ICH M4E(R2), ICH M2 (v3.2.2/v4.0), ICH Q8/Q9/Q10/Q11, ICH S1–S9, EU Reg 726/2004, EU GMP Annex 11, GSPR (MDR/IVDR), ICH E2C(R2), ICH E2F (DSUR), ICH E2A, EMA GVP Module V, GDPR (EU) 2016/679.

**Status values:** Current · Draft revision · Updated · Superseded

**Super Admin actions:**
- Edit any framework entry: version, effective date, status, change summary
- Add new framework
- Bulk status update (e.g., mark all ICH Q8/Q9/Q10/Q11 as "Updated" after a guideline change)
- Frameworks cannot be deleted — only marked Superseded

**Notification:**
When a framework status changes to "Updated" or "Draft revision", the platform automatically triggers a regulatory intelligence alert in all modules where that framework is scoped. This feeds the sD11 framework monitor.

**Read-only note (visible to all users):**
"Regulatory framework registry is maintained by the Super Admin. If you identify an incorrect or outdated entry, contact your Admin."

---

### sB10 — Slide Deck Generator
**Route:** `/projects/:projectId/scientific-writing/publications/:publicationId/slides`
**Component:** `SlidedeckGenerator`
**Access:** Author (Module B); Reviewer (read-only)
**Phase:** 2
**Module colour:** Violet `#7B3C9A`

The Slide Deck Generator is specified in PRD §4.2 (Module B outputs) and §7.3 (AI slide deck generation). It takes the active manuscript or abstract and auto-generates a presentation.

**Source selection panel (left, ~280px):**
- Active publication: title, version, current stage
- Source selector: Full manuscript / Abstract / Selected sections
- Congress target (optional): name, date, format requirements (e.g., "ESMO 2026 — 15 slides max, 16:9")

**Generation panel (centre):**
"Generate slide deck ✦" button.
AI generates: title slide, key message slides (one per key conclusion), methods overview, results (table/figure import), safety summary, conclusion, reference slide.
- AI footprint indicator (% AI-generated content)
- Model attribution: [model name] · [timestamp] · grounded in [manuscript version]

**Slide editor (right panel):**
- Slide thumbnail strip (left sidebar within panel)
- Active slide canvas: editable text, resizable placeholders for figures/tables
- Insert figure from document: drag from manuscript figures list
- Apply client template: logos, colours, font styles from Admin-configured template
- Speaker notes pane

**Export:**
- Export as PowerPoint (.pptx) — uses the client-branded template
- Export as PDF
- Push to Master Library (tagged: Module B, Publication, Congress/Slide Deck, TA)

**Congress formatting compliance:**
If congress target is specified, the generator enforces: slide count limit, max words per slide (configurable), required disclosure slide content.

**Accessibility check:**
Alt text required for all figures before export. FK-style readability check on speaker notes if content type is patient-facing.

---

## 3. Functional Requirements for Missing Screens

| FR ID | Screen | Requirement |
|-------|--------|-------------|
| FR-PM-001 | sPM04 | Admin can select AI engine from approved list; selection is persisted per module |
| FR-PM-002 | sPM04 | Admin can configure voice transcription engine with GDPR jurisdiction and retention period |
| FR-PM-003 | sPM04 | Admin can configure eCTD default version (v3.2.2 or v4.0) |
| FR-PM-004 | sPM04 | Admin can activate multiple payment gateways simultaneously |
| FR-PM-005 | sPM04 | Admin can upload client-branded templates per document type per module |
| FR-PM-006 | sPM05 | Super Admin can manage all client organisations (create, suspend, delete) |
| FR-PM-007 | sPM05 | Super Admin rate card changes are versioned with effective dates and archived history |
| FR-PM-008 | sPM05 | Super Admin can manage the list of available AI engines and transcription engines |
| FR-PM-009 | sPM06 | Admin can invite users by email with pre-assigned role and module access |
| FR-PM-010 | sPM06 | Changing a user's role automatically updates their RACI assignments across all active projects |
| FR-PM-011 | sPM07 | RACI charts are pre-configured per module per PRD §6A and editable by Admin per project |
| FR-PM-012 | sPM07 | Each user sees only their own RACI assignments when accessing "My RACI" |
| FR-PM-013 | sPM08 | Master Library supports full-text and tag-based search across all modules and projects |
| FR-PM-014 | sPM08 | Authors can pull tagged sections (not just full documents) into a new document with provenance chain preserved |
| FR-PM-015 | sPM08 | Items from closed projects remain in read-only archived state permanently |
| FR-PM-016 | sPM09 | Best Practices items follow naming convention [Module]-[Category]-[Version]-[Date] |
| FR-PM-017 | sPM09 | Platform notifies Super Admin on first day of each quarter for items older than 90 days |
| FR-PM-018 | sPM10 | Onboarding wizard is shown on first access to each module; dismissible and re-launchable |
| FR-PM-019 | sPM10 | Step 2 of wizard shows the user's own RACI assignments for the module |
| FR-PM-020 | sPM11 | Services Dashboard shows per-module token balance and burn rate in real time |
| FR-PM-021 | sPM12 | Every rate card change creates a new versioned record; no backdating permitted |
| FR-PM-022 | sPM12 | Super Admin receives 7-day reminder before rate card expiry |
| FR-PM-023 | sPM13 | Payment is processed via Admin-configured gateway; no raw card data stored on platform |
| FR-PM-024 | sPM13 | Invoice PDF is generated and emailed on successful payment |
| FR-PM-025 | sPM14 | Users can set per-notification-type preferences (email / in-app / SMS) |
| FR-PM-026 | sPM14 | Clicking a notification navigates the user to the relevant screen with context |
| FR-PM-027 | sPM15 | Audit trail is immutable; every entry is written at the time of the action |
| FR-PM-028 | sPM15 | All audit entries include full 21 CFR Part 11 digital signature records where applicable |
| FR-PM-029 | sPM16 | Reports are available in PDF and CSV format |
| FR-PM-030 | sPM16 | Market value savings are calculated using the current Super Admin rate card |
| FR-PM-031 | sPM17 | TA tags cannot be deleted if any document uses them; only archived |
| FR-PM-032 | sPM17 | New TA tags are immediately available across all modules after creation |
| FR-PM-033 | sPM18 | Changing a framework status to Updated or Draft revision auto-triggers a regulatory intelligence alert |
| FR-PM-034 | sPM18 | Frameworks cannot be deleted; only marked Superseded |
| FR-B-026 | sB10 | Slide deck generator produces a congress-ready deck from manuscript or abstract |
| FR-B-027 | sB10 | Congress formatting rules (slide count, words per slide) are enforced when a target congress is specified |
| FR-B-028 | sB10 | Slide deck is exportable as .pptx with client-branded template applied |
| FR-B-029 | sB10 | All figures require alt text before export (accessibility gate) |

---

## 4. Acceptance Criteria for Missing Screens

### sPM04 Admin Panel

**AC-PM-001** — AI engine configuration saves and persists
*Given* Admin selects Claude Sonnet 4.5 as default AI engine
*When* the configuration is saved
*Then* all subsequent AI calls in the platform use Claude Sonnet 4.5 until changed. The selection is stored per module-override if set. Test connection button returns a success/failure response within 5 seconds.

**AC-PM-002** — Voice transcription GDPR compliance
*Given* Admin sets audio retention to "Delete immediately post-transcription" and jurisdiction to "EU"
*When* a voice note is transcribed in Module E
*Then* the audio file is deleted from storage immediately after the transcript is returned. The transcript text is stored in the EU jurisdiction. Audit entry confirms deletion.

**AC-PM-003** — Payment gateway multi-select
*Given* Admin activates both Stripe and RazorPay
*When* a user proceeds to payment in sPM13
*Then* both gateways are offered as payment options. Admin can deactivate either gateway without disrupting the other.

---

### sPM05 Super Admin Panel

**AC-PM-004** — Rate card versioning
*Given* Super Admin creates a new rate card with effective date 1 Jan 2027
*When* the save action is confirmed
*Then* the current rate card is archived with its validity end date set to 31 Dec 2026. The new rate card is queued. Super Admin cannot backdate the effective date. Archived rate card is accessible in read-only view.

**AC-PM-005** — Client suspension
*Given* Super Admin clicks "Suspend" on a client organisation
*When* confirmed
*Then* all users in that organisation receive a "Platform access suspended" error on next login. Audit entry is written. Data is retained (not deleted). Super Admin can reactivate.

---

### sPM06 User Management

**AC-PM-006** — Role change propagates to RACI
*Given* Admin changes a user's role from Author to Reviewer
*When* the change is saved
*Then* the user's RACI assignments across all active projects are updated to reflect the new role. A preview of impacted assignments is shown before confirmation. The change is written to the audit trail.

**AC-PM-007** — User invitation flow
*Given* Admin invites a new user with email, role, and module access
*When* the invitation is sent
*Then* the user receives an email with a one-time sign-up link (expires 7 days). On first sign-in, the user must accept T&C. After T&C acceptance, the user is redirected to the onboarding wizard for their first assigned module.

---

### sPM07 RACI Matrix Viewer

**AC-PM-008** — Pre-configured RACI per module
*Given* a new project is created with Module D selected
*When* the RACI Matrix is viewed for that project
*Then* the Module D RACI chart from PRD §6A is pre-populated. Admin can adjust assignments for this project without modifying the default template. The default template is preserved for future projects.

**AC-PM-009** — My RACI view
*Given* a Regulatory Affairs Lead user clicks "My RACI"
*When* the RACI matrix loads
*Then* only rows where that user has an assignment (R, A, C, or I) are shown. The full matrix is not shown. Assignments are colour-coded: R = Crimson, A = Amber, C = Navy, I = Grey.

---

### sPM08 Master Library

**AC-PM-010** — Partial section pull preserves provenance
*Given* an Author searches the Master Library and selects a tagged section from a prior project
*When* "Pull into document" is clicked
*Then* the section is inserted at the cursor position. The provenance chain is displayed inline below the inserted text: "Source: [original document] · [module] · [project] · pushed [date] by [user]." The provenance is read-only and cannot be removed by the Author.

**AC-PM-011** — Archived items remain accessible
*Given* a project is marked Closed
*When* a user searches the Master Library for items from that project
*Then* the items appear with a grey "Archived" tag. They can be read, pulled, and downloaded but not edited or overwritten. The project closure date appears in the item metadata.

---

### sPM09 Best Practices Library

**AC-PM-012** — Quarterly refresh reminder
*Given* a Best Practices item was last updated 91 days ago
*When* the platform reaches the first day of the next quarter
*Then* the Super Admin receives an in-app notification and email listing all Best Practices items older than 90 days, with a "Review" link for each. The reminder is logged to the audit trail.

**AC-PM-013** — Naming convention enforcement
*Given* Super Admin creates a new Best Practice item
*When* the name is entered
*Then* the platform enforces the pattern [Module]-[Category]-[Version]-[Date]. If the pattern is not followed, a validation error is shown: "Best Practice items must follow the naming convention: [Module]-[Category]-[Version]-[Date]. Example: Module-D-CTD-Authoring-v1.2-2026-01."

---

### sPM10 Onboarding Wizard

**AC-PM-014** — First-access trigger
*Given* a user accesses Module C for the first time
*When* the Medical Writing Home screen loads
*Then* the onboarding wizard launches automatically. The user cannot dismiss it during Step 1 (Welcome). Steps 2–6 have a "Skip for now" option. Once completed or skipped, the wizard is not shown again automatically but can be re-launched from the help icon.

**AC-PM-015** — RACI step shows correct assignments
*Given* the user has the role "Medical Writer" in Module C
*When* Step 2 of the wizard loads
*Then* the wizard shows only the rows from the Module C RACI chart where Medical Writer has an assignment. Each row shows: Task name · RACI letter · Description of what that means for this user.

---

### sPM11 Services Dashboard

**AC-PM-016** — Real-time token balance
*Given* an Author uses the AI assist panel and consumes 150 tokens
*When* the Services Dashboard is viewed by Admin
*Then* the consumed token count has been updated within 60 seconds. The remaining balance reflects the deduction. Burn rate estimate is recalculated.

---

### sPM12 Rate Card Admin

**AC-PM-017** — No backdating
*Given* Super Admin attempts to create a rate card with an effective date in the past
*When* the save action is triggered
*Then* the platform returns a validation error: "Effective date cannot be in the past. Please select a current or future date." The rate card is not saved.

---

### sPM13 Subscription & Payment

**AC-PM-018** — No raw card data stored
*Given* a user completes a payment via Stripe
*When* the payment is successful
*Then* the platform stores only the Stripe payment method token (last 4 digits, expiry, type). No full card number, CVV, or billing address is stored on the platform. The invoice is generated and emailed within 60 seconds.

---

### sPM14 Notification Centre

**AC-PM-019** — Navigation from notification
*Given* a user receives a notification: "Document X has entered Stage 4 — your review is required"
*When* the user clicks the notification
*Then* the user is navigated directly to the document at Stage 4 with the review panel open. The notification is marked as read automatically on click.

**AC-PM-020** — SMS for time-sensitive events
*Given* a Medical Affairs Team Lead has a mobile number on file
*When* a publishing due date is 3 days away
*Then* an SMS is sent to the captured mobile number in addition to the email and in-app notification. The SMS text includes: project name, content title, scheduled date, and a link to sE07.

---

### sPM15 Audit Trail Viewer

**AC-PM-021** — Immutability enforced
*Given* a platform Admin attempts to edit or delete an audit trail entry via any interface
*When* the action is attempted
*Then* the action is rejected with 403 and the message: "Audit trail entries are immutable and cannot be modified. This platform is compliant with 21 CFR Part 11." The attempted edit is itself logged to the audit trail.

**AC-PM-022** — 21 CFR Part 11 signature record
*Given* a user applies a digital e-signature to a document
*When* the audit trail entry for that signature is viewed
*Then* the entry shows: Signatory name · Role · Email · Meaning of signature ("I certify that the content of this document is accurate and complete") · Document version hash · Timestamp (UTC) · IP address · Session ID.

---

### sPM16 Reports & Analytics

**AC-PM-023** — Market value savings calculation
*Given* an Author has spent 8 hours drafting in Module A and the current rate card shows $150/hour for Clinical Writing
*When* the Project Summary Report is generated
*Then* the market value savings figure shows $1,200 (8 hours × $150/hr) for Clinical Writing. The rate card version used in the calculation is shown in the report footnote.

**AC-PM-024** — Report export via email for large datasets
*Given* a user requests a 12-month Activity Report for a large client
*When* the report generation takes more than 30 seconds
*Then* the platform shows "Report is being generated — we'll email it to you when it's ready." The email arrives within 10 minutes with a secure download link (expires 24 hours).

---

### sPM17 TA Tag Configuration

**AC-PM-025** — Archive instead of delete
*Given* Admin attempts to delete a TA tag that is in use by 3 active projects
*When* the delete action is triggered
*Then* the platform shows: "This tag is in use by 3 projects and cannot be deleted. You may archive it instead." If archived, the tag is greyed out in selectors and unavailable for new assignments, but existing projects retain it.

---

### sPM18 Regulatory Framework Admin

**AC-PM-026** — Status change triggers sD11 alert
*Given* Super Admin changes ICH E2C(R2) status from "Current" to "Draft revision"
*When* the change is saved
*Then* a regulatory intelligence alert is automatically created in Module D (sD11) with: framework name "ICH E2C(R2) — PBRER", change type "Draft revision", effective date as entered, and pushed to all other modules where ICH E2C(R2) is in scope. The alert appears as unread in sD11 within 60 seconds.

---

### sB10 Slide Deck Generator

**AC-B-010** — Congress formatting gate
*Given* a user specifies "ESMO 2026 — 15 slides max" as the target congress
*When* the AI generates 18 slides
*Then* the generator shows a warning: "This deck exceeds the ESMO 2026 limit of 15 slides. Please remove or merge slides before export." The Export button is inactive until the slide count is within the limit.

**AC-B-011** — Alt text required for export
*Given* a slide deck contains 3 figures
*When* the user clicks "Export as PowerPoint"
*Then* the platform checks that all 3 figures have alt text. If any figure is missing alt text, the export is blocked with: "Figure 2 on Slide 4 is missing alt text. Alt text is required for accessibility compliance." Export proceeds only after all alt texts are added.

**AC-B-012** — Client template applied on export
*Given* Admin has uploaded a client-branded PowerPoint template
*When* the slide deck is exported
*Then* the exported .pptx uses the client template: client logo on all slides, corporate colour scheme, approved font. The AI-generated content is placed within the template's content placeholders.

---

## 5. Route Additions Required (Architecture v5 → v6)

```typescript
// Add to router/index.tsx inside the AuthGuard + AppShell tree:

// Platform / Admin routes
{ path: 'library',              element: <MasterLibrary /> },                    // sPM08
{ path: 'library/best-practices', element: <BestPracticesLibrary /> },          // sPM09
{ path: 'notifications',        element: <NotificationCentre /> },              // sPM14
{ path: 'reports',              element: <ReportsAnalytics /> },                 // sPM16
{ path: 'onboarding/:module',   element: <OnboardingWizard /> },               // sPM10

// Admin routes (Admin role guard)
{ path: 'admin', children: [
    { index: true,              element: <AdminPanel /> },                       // sPM04
    { path: 'users',            element: <UserManagement /> },                   // sPM06
    { path: 'raci',             element: <RACIMatrix /> },                       // sPM07
    { path: 'taxonomy',         element: <TATagConfiguration /> },               // sPM17
    { path: 'subscription',     element: <SubscriptionPayment /> },              // sPM13
    { path: 'audit',            element: <AuditTrailViewer /> },                 // sPM15
]},

// Super Admin routes (Super Admin role guard)
{ path: 'super-admin', children: [
    { index: true,              element: <SuperAdminPanel /> },                  // sPM05
    { path: 'rate-card',        element: <RateCardAdmin /> },                    // sPM12
    { path: 'frameworks',       element: <RegulatoryFrameworkAdmin /> },         // sPM18
]},

// Services dashboard (Admin + Project Lead)
{ path: 'services',             element: <ServicesDashboard /> },               // sPM11

// Project RACI (Project Lead view)
{ path: 'projects/:projectId/raci', element: <RACIMatrix /> },                  // sPM07 (project scope)

// Module B — add slide deck route
// Inside scientific-writing > publications/:publicationId > children:
{ path: 'slides',               element: <SlidedeckGenerator /> },              // sB10
```

---

## 6. Data Types Required

```typescript
// Rate Card
interface RateCard {
  version: string
  effectiveFrom: string         // ISO date — cannot be past
  validUntil: string            // ISO date
  rates: RateLineItem[]
  createdBy: UserId             // Super Admin
  createdAt: string
  archivedAt?: string
}
interface RateLineItem {
  module: ModuleKey | 'Platform'
  serviceType: string           // e.g. 'Clinical Writing — CSR Authoring'
  unit: 'token' | 'hour' | 'document'
  rate: number
  currency: 'USD' | 'GBP' | 'EUR' | 'INR'
}

// Best Practice
interface BestPractice {
  id: string
  name: string                  // Must match [Module]-[Category]-[Version]-[Date]
  module: ModuleKey | 'Platform'
  category: string
  content: string               // Rich text
  applicableDocTypes: string[]
  frameworkRefs: string[]       // e.g. ['ICH E3', '21 CFR Part 11']
  effectiveFrom: string
  validUntil: string
  version: string
  createdBy: UserId             // Super Admin only
  updatedAt: string
}

// Notification Preference
interface NotificationPreference {
  userId: UserId
  eventType: NotificationEventType
  email: boolean
  inApp: boolean
  sms: boolean                  // Only if mobile number captured
}

// Slide Deck
interface SlidedeckJob {
  id: string
  publicationId: string
  source: 'full-manuscript' | 'abstract' | 'selected-sections'
  congressTarget?: string
  slideCountLimit?: number
  slides: Slide[]
  aiModel: string
  aiFootprintPct: number
  generatedAt: string
  status: 'generating' | 'ready' | 'exported'
}
interface Slide {
  id: string
  position: number
  title: string
  bodyText: string
  figures: { figureId: string; altText: string }[]
  speakerNotes: string
}
```

---

## 7. API Endpoints Required

```
POST   /api/admin/ai-engine              Configure AI engine
POST   /api/admin/voice-engine           Configure voice transcription + GDPR settings
POST   /api/admin/ectd-version           Set default eCTD version
POST   /api/admin/payment-gateway        Configure payment gateways
POST   /api/admin/templates              Upload branded template
GET    /api/admin/config                 Get full admin config

POST   /api/super-admin/clients          Create client
PATCH  /api/super-admin/clients/:id      Update/suspend client
GET    /api/super-admin/clients          List all clients

POST   /api/admin/users/invite           Invite user
PATCH  /api/admin/users/:id/role         Change role (propagates RACI)
PATCH  /api/admin/users/:id/status       Suspend/reactivate user

GET    /api/raci/:projectId              Get RACI matrix for project
PATCH  /api/raci/:projectId              Update RACI assignment

GET    /api/library                      Search master library
POST   /api/library/sections/:id/reuse  Pull section into document
GET    /api/library/best-practices       List best practices
POST   /api/library/best-practices       Create best practice (Super Admin)
PATCH  /api/library/best-practices/:id   Update best practice

GET    /api/notifications                Get notifications for current user
PATCH  /api/notifications/:id/read       Mark read
GET    /api/notifications/preferences    Get preferences
PATCH  /api/notifications/preferences    Update preferences

GET    /api/audit                        Get audit trail (scoped by role)
GET    /api/audit/export                 Export as CSV

GET    /api/reports/available            List available report types
POST   /api/reports/generate             Generate report (queued for large datasets)
GET    /api/reports/:id/download         Download completed report

GET    /api/admin/taxonomy               Get TA tag list
POST   /api/admin/taxonomy               Create TA tag
PATCH  /api/admin/taxonomy/:id/archive   Archive TA tag

POST   /api/services/topup              Initiate top-up purchase
GET    /api/services/dashboard           Get consumption dashboard
GET    /api/services/invoices            Get invoice history

POST   /api/publications/:id/slides/generate  Generate slide deck
GET    /api/publications/:id/slides/:jobId    Get slide deck status
PATCH  /api/publications/:id/slides/:jobId/slides/:slideId  Edit slide
GET    /api/publications/:id/slides/:jobId/export   Export as .pptx or PDF
```

