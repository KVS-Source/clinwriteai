# Module A product defaults — recommended, pending Product review

Written 2026-10-08 to unblock engineering + CD work on the Module A
hardening pass. Each decision is a **recommended default** that the
code is being built against. Product can override any of these; the
code is scoped so overrides touch a single file.

Review owner: Product (TBD). Reviewer should either accept the default
or file an issue tagged `product-decision-override` on this document.

---

## 1. Document row "⋯" actions menu

**Context:** [ClinicalWritingHome.tsx](../../apps/web/src/screens/clinical-writing/ClinicalWritingHome.tsx) renders a three-dot icon per document row with no handler today.

**Recommended menu:**

| Action | Enabled when | Behaviour |
|--------|--------------|-----------|
| Open | always | Same as row click — navigates to editor |
| Duplicate | always | POSTs a new document with "(copy)" suffixed to title + new assignee picker |
| Export PDF | `status ∈ {in_review, pending_signature, signed}` | Downloads the compliance PDF via existing `/documents/:id/report.pdf` |
| Archive | `status != signed` + user is author or admin | Soft-flip `archivedAt`; row vanishes from the default view, surfaces under the Archived filter |
| Delete | role ∈ {admin, super-admin} + `status != signed` | Hard-remove the row + its versions. Audit event `document.delete`. Confirmation dialog. |

**Why these:** Each matches an existing or trivially-addable API endpoint. No new entity needed. "Signed" documents are protected from Archive + Delete per Part 11 §11.10 record retention.

**Alternatives considered + rejected:**
- "Move to project" — needs cross-tenant checks + reassignment of all children (comments, voice notes, TLF links). Out of scope for the prototype.
- "Share via link" — overlaps with the Module E guest-review flow; put off until that work resumes.

---

## 2. Rich-text editor choice

**Context:** [EditorToolbar.tsx](../../apps/web/src/screens/clinical-writing/EditorToolbar.tsx) formatting buttons (Bold / Italic / Lists / Table) have no handlers.

**Recommended:** **TipTap** (ProseMirror underneath).

**Why:**
- React-first; integrates with our React component tree without a shadow DOM
- First-class collaboration via `@tiptap/extension-collaboration` + Yjs (needed later for presence-aware edits)
- Extensible for custom nodes we'll want (section anchors, provenance spans, AI-footprint marks, MedDRA term chips)
- Permissive MIT licence
- Active maintenance, large ecosystem

**Alternatives considered + rejected:**
- **Lexical** (Meta) — newer, less mature plugin ecosystem for collaborative editing
- **Slate** — custom React trees are flexible but we'd end up writing the plugin layer ourselves
- **ProseMirror directly** — same engine as TipTap underneath; TipTap gives us React bindings for free

**Scope note:** Phase 1 ships a plain `<textarea>` so Save → version works end-to-end today. TipTap lands in Phase 2 of this plan and replaces the textarea in a single file change.

---

## 3. Reviewer section-level approve / return workflow

**Context:** [ReviewerView.tsx:102,114](../../apps/web/src/screens/clinical-writing/ReviewerView.tsx) has two reviewer action buttons that `console.log` instead of calling the API.

**Recommended:** **Extend `Comment` with a `verdict` field** rather than add a new `ReviewAction` entity.

**Why:**
- Reviewer actions are always attached to a section + a reviewer — identical shape to comments
- Avoids a parallel inbox the reviewer has to triage (comments vs verdicts)
- CRM meeting flow already consumes comments; routing verdicts through the same pipe means the CRM screen "just works"
- Smallest schema change (one nullable enum column + one API param)

**Schema change:**
```prisma
model Comment {
  ...
  verdict String?  // null = plain comment; 'approve' | 'request_changes' | 'block_approval'
}
```

**API:** `POST /documents/:id/comments` grows a nullable `verdict` field in the body. Section approve = post a comment with `verdict='approve'`, body ""; Return for revision = `verdict='request_changes'`, body = reason.

**UI:** Reviewer's "Approve section" / "Return for revision" buttons each post a comment with the corresponding verdict + optional note.

**Alternatives considered + rejected:**
- New `ReviewAction` entity — splits reviewer intent across two tables, forces CRM screens to join both
- Status transitions on section itself (`section.status = 'approved'`) — would need a reverse-transition workflow + loses the "who said what" audit granularity

---

## 4. Comment "verdict" display in CRM meeting

**Recommended:** CRM meeting pulls `WHERE verdict IS NOT NULL` first (approvals + blocks surface at the top), then plain comments below. Approvals auto-resolve on CRM meeting close; blocks require explicit resolution before chain-of-signature can start.

---

## 5. Auto-version on edit

**Context:** The server's `PATCH /documents/:id/sections/:id` already creates a new DocumentVersion when the section content hash changes.

**Recommended:** **Keep the server behaviour; don't batch client-side.** Every Save triggers a new version. Noisy for very active editors but keeps the audit trail per-save-grain — important for Part 11.

**Alternatives considered + rejected:**
- Client-side debounce + batch into one version per 5-min window — loses granular attribution ("who edited what, when")
- Explicit "Save checkpoint" button — adds a cognitive step for the writer; Save-is-save matches the Google Docs mental model writers are used to

---

## 6. Default AI suggest model

**Recommended:** `claude-opus-4-7` for AI Suggest, `claude-haiku-4-5-20251001` for inline grammar/style tips (when that panel lands later).

**Why:** Opus for the heavy "draft this section from source documents" ask; Haiku for latency-sensitive inline suggestions. Both are gated behind the `AiGatewayService` so switching is an env var not a code change.
