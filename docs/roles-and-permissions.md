# ClinWrite — Roles, Permissions, and RACI

**Status:** Draft design, 2026-10-28
**Scope:** Unified role model to replace today's three overlapping systems (platform / tenant / project). Applies to SaaS and standalone deployments.
**Companion:** [`standalone/prd.md`](./standalone/prd.md) — standalone deployment context.

---

## 1. Why we're doing this

Today the codebase has three role systems that don't talk to each other:

| System | Where | Enforced? |
|---|---|---|
| Platform roles (8 strings) | [`apps/api/src/auth/rbac.ts:21`](../apps/api/src/auth/rbac.ts#L21) | Yes |
| Tenant Membership roles (5 strings) | [`platform.prisma:189`](../apps/api/prisma/schema/platform.prisma#L189) | Modeled, not checked |
| Project RACI (R/A/C/I) | `RaciAssignment` table | **Informational only** |

Documents have a single `assigneeId` — no co-authors, no reviewer list, no per-doc ACL. External KOL / sponsor access is specified in the data model but not wired. There's no PM role at all.

We're consolidating all of this into one model where **role defines capability**, **project membership defines context**, and **RACI defines document-level permission**.

---

## 2. The role model — five platform roles

Deliberately small. Everything granular happens at the project + document level.

| Role | What they do | Document access |
|---|---|---|
| **`tenant-admin`** | **Org-level only** — tenant settings, AI keys and all key management, SSO/IdP config, user management, module toggles, subscription + billing, audit exports, compliance. Does NOT create projects, assign work, edit RACI, or touch document content. | None by default. Can self-grant RACI letters on documents — allowed, but emits a flagged `admin.self_grant` audit event (see §4.2). |
| **`pm`** | Lightweight coordinator. **Creates projects, assigns the first writer (lead R) on each document, sets deadlines, monitors status via dashboards.** Does NOT edit RACI on docs (that's the R's job — see below). Does NOT invite guests. Does NOT edit content. Does NOT approve. | Read-only on all docs in projects they manage. Cannot edit, invite, or approve. |
| **`contributor`** | Everyone who works on documents — authors (R), reviewers (C), approvers (A), QC, publishers. One role, differentiated by **capabilities**. **R's on a document own that document's RACI editor + guest invitations** — PM assigns the first R, R brings in co-authors, reviewers, approvers, and external SMEs. | Determined by their RACI letter on each doc. See §4. |
| **`auditor`** | **Internal** read-only observer. QA, internal compliance, legal. (External SOC 2 firms and regulatory inspectors use the project-scoped guest flow instead — see §6.) | Read-only on **all** documents and audit logs across the tenant. Cannot comment or edit. |
| **`guest`** | External KOL, sponsor contact, external statistician. No account. Magic-link per document. | Read + comment on one document, time-boxed. See §6. |

### 2.1 Contributor capabilities

A `contributor` carries a capabilities array that governs **which RACI letters a PM can assign them**:

| Capability | Grants PM the ability to assign | Typical hire |
|---|---|---|
| `can-author` | R (Responsible) | Clinical / scientific / medical / regulatory writers |
| `can-review` | C (Consulted) | Medical reviewers, stat reviewers, QC |
| `can-approve` | A (Accountable) | Signatories, medical directors, regulatory heads |
| `can-publish` | Publisher action in Module D (regulatory submission) | Submission officer |

A contributor can have multiple capabilities (a senior medical writer often has `can-author` + `can-review`). This is cleaner than minting a dozen specific roles (`senior-writer`, `qc-reviewer`, `stat-reviewer`, …) and keeps the role enum small.

**Why not just a single `contributor` role with no capabilities?** Because PMs need a short-list filter when assigning RACI on a 300-section CSR. Picking "who can approve" from a tenant of 400 users is a nightmare if everyone is just "contributor". Capabilities turn that into a 3-person short-list.

**Why not role per capability?** Because people wear multiple hats. One role + capabilities array models reality.

---

## 3. The three dimensions of access

```
Platform role           Project membership        Document RACI letter
(what you ARE)       ×  (what projects you      × (what you do on
                        can see at all)            this specific doc)
```

- **Platform role** sets the ceiling (an `auditor` can never edit, period).
- **Project membership** sets scope (a `contributor` only sees projects they're on).
- **RACI letter** sets per-doc capability (a `contributor` with `can-author` only edits docs where they're the R).

All three must align for an action to succeed.

### 3.1 Project membership

New table replacing today's loose `ProjectTeamMember`:

```sql
project_members
  id              uuid PRIMARY KEY
  project_id      uuid REFERENCES projects
  user_id         uuid REFERENCES users
  project_role    text    -- optional label: 'Lead Writer', 'Medical Reviewer', 'Submission Lead'
  added_by        uuid    -- the PM who added them
  added_at        timestamptz
  removed_at      timestamptz NULL
```

`project_role` is a free-text label for UI display only. It does NOT grant permissions — RACI does.

### 3.2 Document RACI assignment

Promoted from informational to **the** document ACL. One row per (document, user, letter):

```sql
document_raci
  id                   uuid PRIMARY KEY
  document_id          uuid REFERENCES documents
  user_id              uuid REFERENCES users
  letter               text    -- 'R' | 'A' | 'C' | 'I'
  section_id           uuid NULL      -- NULL = whole doc; set = scoped to one section
  approval_order       int NULL       -- only used when letter = 'A'. NULL = parallel; int = chain position

  -- Signature requirement for this row's completion action.
  -- Per-row because workflows mix: medical director must e-sign, internal QC clicks approve, R author attests.
  signature_required   bool NOT NULL DEFAULT false
  signature_meaning    text NULL      -- Part 11 §11.50: 'Author attestation' | 'Medical approval' | 'Regulatory approval' | 'Final signatory' | …

  -- "I'm done" per-letter completion flags. Used by the stage transition engine.
  submitted_at         timestamptz NULL   -- R clicks "Submit my part"
  reviewed_at          timestamptz NULL   -- C clicks "I'm done reviewing"
  approved_at          timestamptz NULL   -- A clicks "Approve"
  signature_id         text NULL REFERENCES signature_records(id)  -- NOT NULL once signed; links to the Part 11 artifact
  rejected_at          timestamptz NULL   -- any C or A rejects; mutually exclusive with the done timestamp above
  rejection_note       text NULL

  assigned_by          uuid
  assigned_at          timestamptz
  removed_at           timestamptz NULL
  UNIQUE (document_id, user_id, letter, section_id)

  CHECK (signature_required = false OR signature_id IS NOT NULL OR (submitted_at IS NULL AND reviewed_at IS NULL AND approved_at IS NULL))
```

The CHECK constraint enforces: **if a row requires a signature, the completion timestamp cannot be set without a signature_id**. The database refuses to let a required-signature row be marked done without the e-signature artifact.

#### Stage transition rule, restated with signatures

A stage flips when, for every non-removed row of the gating letter:
- The completion timestamp is set (`submitted_at` / `reviewed_at` / `approved_at`), **AND**
- If `signature_required = true`, `signature_id` is also set.

That's it. The engine is a single Postgres statement + audit event; the signature requirement is enforced at insert time, so by the time the engine checks the stage condition, every signed row already has its artifact linked.

#### Signatures across R, C, A — when to require them

Industry defaults the PM can override per row:

| Letter | Default `signature_required` | When to override to true |
|---|---|---|
| R (author) | false | Protocols, CSRs, DSURs: FDA / CDSCO expect author attestation. Set true for the final author on the document. |
| C (reviewer) | false | Usually clicks are enough. Set true only for a formal QC gate or validation reviewer. |
| A (approver) | **true** | Every A should sign. The industry norm — medical approval, regulatory approval, final signatory are all Part 11 signed records. |

The `signature_meaning` text is captured on the signature event itself and shown on the audit trail (Part 11 §11.50 requires the "meaning of the signature" alongside name + date/time). The PM picks it from a dropdown when configuring the row (`Author attestation` / `Medical approval` / `Regulatory approval` / `Final signatory` / `QC release`).

The actual e-signature mechanism (re-authentication challenge + TOTP + signed JSON artifact bound to a `documentHash`) is the existing Module A `SignatureChain` + `SignatureRecord` schema at [`apps/api/prisma/schema/moduleA.prisma:645-689`](../apps/api/prisma/schema/moduleA.prisma#L645). We're layering `document_raci.signature_id` as a FK into that table — no new signature infrastructure, just a new ownership link. The artefact format itself is still open; see `project_phase_5_deferrals.md`.

- **Every letter supports multiple users.** Multiple R's (co-authors), multiple A's (joint approvers — medical + regulatory + signatory in parallel), multiple C's (reviewer panel), multiple I's (sponsor contacts kept in the loop).
- **Multi-letter per user across different sections.** User X can be R on section 3 **and** C on section 7 (common in CSRs — a writer authors one section and reviews another). The app layer forbids one user holding two letters on the **same** section (self-review / self-approval) and forbids a whole-doc letter (section_id NULL) plus a per-section letter for the same user (contradiction).
- `section_id` is optional. Leave NULL for simple docs; set it for CSRs where section 10 is written by a different author than section 14.
- `letter` must match the user's capability (`A` requires `can-approve`, etc.) — enforced on insert.

#### Stage transitions — the "all-done" rule

Every stage transition is **parallel-ALL at the stage boundary**: when the last person holding the gating letter finishes their part, the stage flips and notifications fan out to the next cohort.

| From → To | Gating letter | Each person does | Transition fires when… | Notifies |
|---|---|---|---|---|
| Draft → In Review | **R** | Clicks "Submit my part" (+ e-signature if `signature_required`) | **All R's have submitted** (and signed where required) | All C's: "Document ready for your review" |
| In Review → Ready for Approval | **C** | Resolves all their open comments; clicks "I'm done reviewing" (+ e-signature if `signature_required`) | **All C's have signed off** (and signed where required) | All A's: "Document ready for your approval" |
| Ready for Approval → Approved | **A** | Clicks Approve (e-signature required by default) | **All A's have approved and signed** | All R's + PM + Publisher (if Module D): "Approved, ready to publish" |
| Approved → Published | `can-publish` user | Submits to FDA ESG / EMA CESP (+ submission e-signature) | On successful submission ack **with signed submission receipt** | All project members + I's: "Published" |

**Rejection at any gate** routes back to the previous stage, resets the current cohort's completion flags, and notifies all R's with the rejection note. Any single person in the gating cohort can reject — one C rejecting pulls it back to Draft; one A rejecting pulls it back to In Review.

**Progress visibility.** At every stage, the status strip shows "N of M submitted / reviewed / approved" so the PM and the rest of the team can see who the bottleneck is. One-click "Nudge pending" sends a reminder to the people who haven't completed.

**Serial chains inside the A gate.** The default is parallel-ALL across all A's. For chained approval (medical → regulatory → signatory) use `approval_order`: NULL = parallel, integer = chain position. Mixing is allowed (parallel-ALL inside each step) — e.g., "medical + regulatory in parallel (step 1), then signatory (step 2)". Chain editing UI is deferred to v1.1 (see §10 Q1).

**Partial completion is persisted.** If 2 of 3 R's have submitted and the PM reassigns the 3rd R, the first two submissions remain — the new R only has to do the one outstanding section. Same for C's and A's.

**No "force transition" shortcut.** The PM cannot skip a pending person to flip the stage — that would break the 21 CFR Part 11 audit chain. The escape hatch for a stuck person is **reassignment** (remove them, add someone else), which is logged with both sides of the swap and preserves the "all-done" invariant for the stage.

The same multi-user principle applies to platform roles: a tenant can have many `tenant-admin`s, many `pm`s, many `auditor`s. Nothing in the model is a singleton except the License Studio operator roster, which has its own guardrails (see [standalone/prd.md](./standalone/prd.md) D9).

---

## 4. RACI → permission mapping

The letter you hold on a document determines what you can do on it.

| Action | Admin | PM (on project) | R | A | C | I | Auditor | Guest |
|---|---|---|---|---|---|---|---|---|
| List doc in sidebar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Open & read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (one doc, link-scoped) |
| Edit content | — | — | ✓ (own section if scoped) | — | — | — | — | — |
| Add comment | — | — | ✓ | ✓ | ✓ | — | — | ✓ |
| Resolve comment | — | — | ✓ | ✓ | — | — | — | — |
| Submit my part — + e-sign if required (R → ready to transition) | — | — | ✓ (self only) | — | — | — | — | — |
| Mark review done — + e-sign if required (C → ready to transition) | — | — | — | — | ✓ (self only) | — | — | — |
| Approve + e-sign (A → ready to transition) | — | — | — | ✓ (self only) | — | — | — | — |
| Reject (bounces back one stage) | — | — | — | ✓ | ✓ | — | — | — |
| Publish (Module D) | — | — | — | — | — | — | — | — |
| Assign / reassign RACI on this doc | ✓ | — | ✓ (R owns the RACI editor) | — | — | — | — | — |
| Invite external guest on this doc | ✓ | — | ✓ (R-driven invite) | — | — | — | — | — |
| Set deadline | — | ✓ | — | — | — | — | — | — |
| Nudge pending cohort | — | ✓ | ✓ (any R while in Draft) | ✓ (any A while awaiting approval) | ✓ (any C while in Review) | — | — | — |
| Checklist — tick / add user item / reorder (see §11) | — | — | ✓ | — | — | — | — | — |
| Checklist — read-only view | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Export audit for this doc | ✓ | ✓ | — | — | — | — | ✓ | — |

**"Publish" is the only action gated by a capability (`can-publish`) rather than a RACI letter**, because publishing is a one-time irreversible submission to FDA ESG / EMA CESP that's done by a dedicated Submission Officer, not whoever happened to be the approver.

### 4.1 Section-level letters per user

A single user can hold **different letters on different sections** of the same document (e.g., R on section 3, C on section 7). Enforcement rules:

- OK: `(doc, user, section_A, R)` + `(doc, user, section_B, C)` — different sections.
- Refused by app layer: `(doc, user, section_A, R)` + `(doc, user, section_A, A)` — same section, two letters = self-review/self-approval.
- Refused by app layer: `(doc, user, NULL, R)` + `(doc, user, section_B, C)` — whole-doc letter alongside per-section letter = contradiction.

The DB uniqueness constraint `UNIQUE (document_id, user_id, letter, section_id)` catches the trivial duplicate; the two multi-letter rules above are enforced on insert in the RACI service layer and audited on refusal.

### 4.2 Admin self-grant audit event

A `tenant-admin` is allowed to assign themselves R/A/C/I on documents (common in small teams where the admin is also the senior writer), **but** every such self-grant emits a dedicated audit event:

```
event:      admin.self_grant
actor:      <admin user_id>
subject:    <document_id>
letter:     R | A | C | I
section_id: <id | null>
reason:     <free-text, required field in the UI>
hash_chain: <chained per existing audit protocol>
```

These events are **flagged in the audit log viewer** with a visible marker so an external auditor can filter for them in a single click. Rationale: an admin self-approving their own document is not forbidden (it would block legitimate small-team work) but it is a concentration-of-authority signal that compliance should always be able to review. The required `reason` field — "I am also the Medical Writer on this trial" — gives the auditor the context they need without blocking the action.

The same event fires if an admin **self-removes** a RACI row (e.g., to escape a stuck gate). Reassignment of their own letter to a different user does not fire the event (that's just a normal reassignment).

---

## 5. PM functions to build

The PM role is new. These are the capabilities we're adding (not minor):

### 5.1 Project ownership
- **Create / edit / archive** a project.
- **Assign team** — add contributors, auditors, PMs to the project.
- **Set project-level labels** (`project_members.project_role`).

### 5.2 First-writer assignment (PM's only touch on RACI)

The PM assigns **exactly the first R** when the document is created — this is the existing "Assign writer" field on the Create Document form, which sets `Document.assigneeId`. On create, the system also inserts the matching `document_raci` row (letter R, section_id NULL, no signature required by default). That lead R then owns the RACI editor on their doc — see §5a below.

The PM does not open a RACI editor at all. The PM dashboard shows them per-doc progress (gating cohort size, overdue flag, bottleneck tally) so they can monitor without reaching into assignment.

### 5.3 Workflow control
- **Move a document between stages** (Draft → In Review → Approved → Published). Today this is done ad-hoc; it becomes a PM-owned transition.
- **Set deadlines** per document and per stage.
- **Chase and remind** — one-click "send reminder to all open C's", scheduled nudges on overdue docs.

### 5.4 Dashboards
- **Project dashboard** — per project: documents by stage, overdue, bottlenecks (which approver is sitting on 12 docs), team utilization.
- **Portfolio dashboard** — across all projects the PM manages: throughput, aging, cycle time.
- **No cost / billing dashboards in v1** — out of scope.

### 5.5 What PM cannot do
- Edit document content.
- Approve or reject documents (unless *also* assigned as a contributor with the A letter — rare).
- See projects they're not assigned to.
- Change tenant settings, users, or module access (tenant-admin only).
- Edit RACI on documents (that's the R's responsibility — see §5a).
- Invite external guests (also the R's responsibility).

---

## 5a. The R owns the document

Once the PM has created the doc and assigned the first R, the lead R has full ownership of **who else works on this document**:

- **Open the RACI editor** on their doc.
- Pick users from the project's member list; filter by capability (`can-author` for co-R, `can-review` for C, `can-approve` for A).
- Each of the four letters is a **multi-select** — add as many R's, A's, C's, I's as the workflow needs. The UI shows them as chip lists; the status strip reports "3 A's assigned, 1 approved + signed, 2 pending".
- Per row, configure **signature requirement** — a checkbox "Requires e-signature" + a dropdown for the signature meaning (`Author attestation` / `Medical approval` / `Regulatory approval` / `Final signatory` / `QC release`). A's are checked by default; R's and C's are unchecked by default.
- Scope any row to a section if the doc needs it (co-author of section 3; sign-off on section 7).
- Reassign when someone goes on leave — remove-then-add, with audit log capturing both sides of the swap.
- **Invite external guests** on this doc — KOL / sponsor / SME magic links. See §6.

A **document template** (CSR, protocol, DSUR, MA brief, etc.) can carry a default RACI + signature profile so the R doesn't configure it from scratch every time. Templates land in Chunk 2 of the build plan.

Why R and not PM: the author knows who should review, approve, and consult on their deliverable. Centralising this in the PM creates a bottleneck and divorces assignment from content judgment. The PM still *sees* every assignment via the dashboard and audit log.

**Co-R additions.** When the lead R adds a second R, both become "R on this doc" with equal RACI-editing rights. Who removes whom is governed by the standard reassignment flow + audit log; there is no primacy mechanism in v1.

---

## 6. External guest access (KOL / sponsor / external SME)

Chosen path: **magic-link per document, no account**. Mirrors the License Studio magic-link mechanic — same crypto, different token payload.

### 6.1 Flow
1. An R on the document opens the RACI editor → "Invite external reviewer" → enters email + role label ("KOL Reviewer") + expiry (default 14 days). The PM does not invite guests directly; if a PM wants an external reviewer added, they ask the lead R.
2. System generates a signed URL: `/guest/review/<signed-token>`.
3. Token payload: `{ documentId, email, scope: 'read+comment', exp, jti }`. Signed ES256 with the same key as license JWTs.
4. Email sent via the tenant's SMTP (or SES, standalone's config). Nothing stored client-side except the URL.
5. Guest clicks → lands on a stripped-down read + comment UI. Can leave comments tagged `[External: email@domain.com]`. Cannot edit. Cannot see other documents.
6. On comment, the R and all C's get a notification.
7. At `exp`, link stops working. Comments remain in the doc history forever.

### 6.2 Data model
```sql
guest_invitations
  id              uuid PRIMARY KEY
  scope           text    -- 'document' | 'project'
  document_id     uuid NULL REFERENCES documents   -- set when scope='document'
  project_id      uuid NULL REFERENCES projects    -- set when scope='project'
  email           text
  purpose         text    -- 'kol-review' | 'sponsor-review' | 'external-stat' | 'external-audit' | 'other'
  invited_by      uuid REFERENCES users
  invited_at      timestamptz
  expires_at      timestamptz
  revoked_at      timestamptz NULL
  jwt_text        text    -- the signed token we generated
  CHECK (
    (scope = 'document' AND document_id IS NOT NULL AND project_id IS NULL) OR
    (scope = 'project'  AND project_id  IS NOT NULL AND document_id IS NULL)
  )
```

**Two guest flavours** share one table:
- **Document-scoped** (`scope='document'`) — KOL / SME reviewers, sponsor contacts. Read + comment on one doc. 14-day default. This is the common case.
- **Project-scoped** (`scope='project'`) — external auditors (SOC 2 firms, regulatory inspectors). Read-only across every document in one project, plus audit-log export for that project only. Longer default expiry (90 days) because engagements run long. Comments disabled. `purpose='external-audit'` triggers the read-only+audit-export behaviour.

Internal auditors (QA, compliance) use the `auditor` platform role (tenant-wide, see §2). External auditors never get an account — they always come in via the project-scoped guest link.

Comments made by a guest write to the existing `comments` table with an `external_email` field populated and `user_id` NULL.

### 6.3 Guest cannot
- Download the document.
- See prior versions.
- See other comments except their own thread (configurable per-invite in v2; v1 = see-all-comments-on-the-doc).
- Export anything.
- Reply to a comment made more than 24h after their last activity (prevents stale sessions).

### 6.4 DPDPA posture
Guest email is PII and is stored for the audit chain. Guest can request deletion → we null out the email in `guest_invitations` and in comments (`external_email` → `[redacted]`), keep the comment text (document audit integrity). This matches DPDPA's "data principal erasure request" where the processor has a lawful ground to retain minimum data for compliance.

---

## 7. Standalone collapse

In the single-tenant standalone deployment, the model simplifies naturally:

- **`tenant-admin`** → one person, created from the license's contact email at first boot.
- **`pm`, `contributor`, `auditor`, `guest`** → all still used.
- **Tenant-wide dashboards** become customer-wide (there's only one tenant).
- **No cross-tenant separation** needed because there is no cross-tenant.

The License Studio is a separate concern (operators who sign license files) and uses its own `operators` table, not this role model. See [`standalone/prd.md`](./standalone/prd.md).

---

## 8. Migration from today

Nothing in this doc is backwards-compatible with the current enum. One migration, breaking.

| Today's role | New role | Capabilities added |
|---|---|---|
| `admin` (tenantId NULL) | *License Studio operator* (separate system) | — |
| `admin` (tenantId set) | `tenant-admin` | — |
| `clinical-writer` | `contributor` | `can-author` |
| `scientific-writer` | `contributor` | `can-author` |
| `medical-writer` | `contributor` | `can-author`, `can-review` |
| `regulatory-writer` | `contributor` | `can-author`, `can-publish` |
| `ideation-lead` | `contributor` | `can-author` |
| `reviewer` | `contributor` | `can-review` |
| `read-only` | `auditor` | — |
| `Membership.owner` | `tenant-admin` | — |
| `Membership.admin` | `tenant-admin` | — |
| `Membership.writer` | `contributor` | `can-author` |
| `Membership.reviewer` | `contributor` | `can-review` |
| `Membership.viewer` | `auditor` | — |

Existing `assigneeId` on Document migrates to a `document_raci` row with letter `R`, section_id NULL. Existing `RaciAssignment` rows are translated 1:1 but promoted to permission-bearing.

### 8.1 PM assignment
No one has `pm` role after migration — tenant-admin must explicitly grant it. Rationale: PM is a new capability; don't retroactively grant it based on a guess.

### 8.2 Deprecation note
Keep the old role strings in Prisma as a `legacy_role` text field for 90 days post-migration so audit trails that reference them stay interpretable, then drop.

---

## 9. Build plan (preliminary)

Three chunks. Order matters.

**Chunk 1 — Role & capability refactor + migration.**
- New Prisma schema: `User.role` enum (5 values), `User.capabilities` text[], `project_members`, `document_raci` (promoted), `guest_invitations`.
- Migration script with the mapping in §8.
- Rewrite `requireAuth` to use the new model.
- Keep existing route guards passing by mapping new roles to old intent at the middleware layer during cutover.
- ~2 weeks.

**Chunk 2 — PM functions.**
- RACI editor UI (per-doc modal).
- Project team-assignment screen.
- Deadlines + stage transitions.
- Project dashboard + portfolio dashboard.
- ~3 weeks.

**Chunk 3 — Guest magic link + capability-based pickers everywhere.**
- Guest invitation flow + stripped viewer.
- Replace every user picker in the app to filter by capability.
- Audit-log entries for every RACI change.
- ~1.5 weeks.

**Total: ~6-7 weeks.**

---

## 10. Decisions and remaining open questions

### Decided (2026-10-28)

| # | Decision | Resolution |
|---|---|---|
| 1 | **Approval chain UX** | v1 ships parallel-ALL only. Chain editor deferred to v1.1 (schema already supports it via `approval_order`). |
| 2 | **Multi-letter per user on same doc** | Allowed across different sections; forbidden on same section (self-review) or whole-doc+per-section (contradiction). See §4.1. |
| 3 | **Auditor scope** | Internal auditors = tenant-wide `auditor` role. External auditors = project-scoped guest magic-link (`scope='project'`, `purpose='external-audit'`). Never full tenant accounts. See §6.2. |
| 4 | **Tenant-admin as contributor** | Self-grant allowed; every self-grant emits a flagged `admin.self_grant` audit event with a required reason field. See §4.2. |

### Still open

1. **PM delegation.** When a PM goes on leave, can they delegate their project ownership to another PM, or must tenant-admin do it manually? Recommend: tenant-admin manual reassignment in v1, PM self-delegation in v2.
2. **Guest comment visibility.** Does a document-scoped guest see all comments on the doc, or only their own thread? Recommend: v1 = all comments on the doc (less surprise for the external reviewer); configurable per-invite in v2.
3. **Nudge throttling.** The "Nudge pending cohort" action — should it be rate-limited (e.g., one nudge per person per 24h) to prevent notification spam? Recommend: yes, 24h cooldown per (document, actor, target) tuple.

---

## 11. Checklist (the R's day-to-day guardrail)

The per-document checklist is a first-class in-editor feature, not a side panel. The R sees it while writing, ticks items as they complete work, and the system gates "Submit for Review" on completion state.

**Prisma lives here already** — `ChecklistInstance` (one per doc) + `ChecklistInstanceItem` (template items + user-added items). See [`apps/api/prisma/schema/moduleA.prisma:515`](../apps/api/prisma/schema/moduleA.prisma#L515). This section documents the role model + autocheck + submit-gate behaviour layered on top.

### 11.1 Who can do what

| Action | R (any R on doc) | PM | C / A / I | Admin | Guest |
|---|---|---|---|---|---|
| View checklist | ✓ | ✓ (dashboard rollup) | ✓ (read-only) | ✓ | — |
| Mark item complete / incomplete | ✓ | — | — | — | — |
| Add a user-added item | ✓ | — | — | — | — |
| Reorder items (`sortOrder`) | ✓ | — | — | — | — |
| Waive an item (with reason) | ✓ | — | — | — | — |
| Autocheck engine runs | *(system)* | | | | |

**Mandatory template items are not deletable** by the R — only waivable with a reason. User-added items can be removed by the R who added them while they're still pending.

### 11.2 Autocheck strategies

Four strategies, hinted per-template-item via `autoCompleteOn` (string tag). The autocheck service maps the tag to a strategy class:

| Strategy | Example `autoCompleteOn` tag | Check |
|---|---|---|
| **Content presence** | `content-min-words:300:section-3` | Section N has ≥N words of real content and no `[TBD]` / `[PLACEHOLDER]` tokens. Deterministic. Cheap. |
| **References complete** | `references-complete` | Every inline `[Ref: …]` citation resolves to a Reference row; no `[REF]` placeholders remain. Fires when the References panel is clean. |
| **AI pass clean** | `ai-pass:consistency` | Runs the AI gateway over the section with the named profile; passes only if no `critical` issues emerge. Guarded by the AI quota + per-item rate limit so an open editor doesn't spam the gateway. |
| **External signal** | `signal:tlf-validated` / `signal:esig-captured:A` / `signal:crm-resolved` | Checks a related entity's state. Module-specific; registry maps the tag to the lookup. |

The autocheck engine runs on three triggers:
1. **Save** of a section (debounced ~2s) — content + references strategies.
2. **External event** — the signal strategy subscribes via a lightweight event bus (`document.signal_fired`).
3. **Manual** — "Re-run autocheck" button on the checklist panel (useful after a review pass).

When autocheck flips an item from `pending` → `completed`, the audit log carries `source: 'auto'` + the strategy tag. The R can un-tick an auto-completed item manually, but doing so emits `checklist.override` with a required reason — this is a Part 11 signal that an R disagreed with the engine.

### 11.3 Submit-for-Review gate

When an R clicks "Submit my part" (or the lead R clicks "Submit for Review" on the whole doc), the system evaluates all checklist items in `pending` state **belonging to this stage or earlier**:

- **Any mandatory item (`frameworkMandatory=true`) in `pending`** → **hard block**. The submit modal shows the list of blocking items with "jump to section" links. No override.
- **Optional items in `pending`** → **warning**. The submit modal shows the list; the R types a one-line reason into "Why skip these?" to proceed. The reason is captured on the audit event (`document.submit_with_pending_optional`).
- **All items complete or waived** → clean submit.

Rejected / waived items are not blockers. "Mandatory" is a template property; it carries the regulatory framework label (`ICH E3 §12.1`, `FDA Guidance 2018-04`, etc.) which the UI surfaces on the block modal so the R understands *why* it's a block.

### 11.4 UI affordances (red / flash)

- Items that cannot be auto-checked and are still `pending` within a short deadline window surface in the editor's right rail with an **amber** indicator ("needs manual check").
- Items that are **mandatory + pending** at submit time flash **rose** on the submit modal with a direct link to the relevant section.
- The AI assistant can be configured to **proactively ask the R clarifying questions** mapped to specific checklist items (e.g. "Section 10.2 lists protocol deviations — any CTCAE grade ≥3 you want to call out?") — this lands in Chunk 3 once the checklist write endpoints + autocheck engine are stable.

### 11.5 Data model notes

No schema change needed for this round — the existing fields already support the behaviour:

- `ChecklistInstanceItem.autoCompleteOn` → autocheck tag (already exists).
- `ChecklistInstanceItem.status` ∈ `pending | completed | waived` (already exists).
- `ChecklistInstanceItem.isUserAdded` → distinguishes R-added items (already exists).
- `ChecklistInstanceItem.sortOrder` → R-controlled ordering (already exists).
- `ChecklistInstanceItem.completedBy` + `completedAt` → audit retention (already exists).

What's missing in code: Rs-can-reorder / Rs-can-add endpoints + the autocheck engine + the submit-gate check. Ships in the next commits.
