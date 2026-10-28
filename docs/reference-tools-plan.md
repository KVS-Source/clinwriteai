# Reference Tools — Gap Analysis & Work Plan

Three Clinical Writing editor right-rail panels (ICH E3 Validator, MedDRA
Lookup, TLF Cross-Reference) are UI shells today — none is wired end-to-end
in the real-API build. The Sync button also overstates what it refreshes.
This doc tracks the ship plan for all four, in sprint-ready chunks.

Status key:
- `[ ]` Not started
- `[~]` In progress
- `[x]` Shipped

### Current status (2026-10-27)
- `[x]` **TKT-A-001** · ICH E3 Validator — real backend, waiver model, panel wired.
- `[ ]` **TKT-A-002** · MedDRA Lookup — parked on licence.
- `[x]` **TKT-A-003** · TLF Cross-Reference — panel built, VELORA-301 seeded.
- `[x]` **TKT-A-004** · Sync — invalidates all per-doc query keys; tooltips corrected.

---

## TKT-A-001 · ICH E3 Validator — build the backend, compute from real sections

**PRD:** FR-A-026 · **Severity:** High (compliance-visible)

### Current state
- Frontend calls `GET /documents/:id/ich-e3` — endpoint does not exist in
  the real API; returns 404.
- Only MSW mock answers it, with a fixed `data/ichSections.json`. Statuses
  are hard-coded, unrelated to the document's content.
- With Module A mocks off (real-API build): panel reads "0 of 0 sections
  complete, 0%".
- Editor jump-link works for §11 + §12 only (hard-coded map).
- Two fixed callouts always render:
  - "§16.4 Waived … Audit trail entry logged" — no waiver record exists.
  - "§3 Auto-generated … Reviewed and locked".
- `Export ICH E3 report` button only `console.log`s. No file produced.

### Target state
1. 18 ICH E3 mandatory sections, status computed per document from real
   section data:
   - `complete` = non-empty `contentHtml` + `ichStatus === 'complete'`
   - `in_progress` = non-empty content, status not yet complete
   - `warning` = content exists but hash matches a prior signed version
   - `not_started` = empty section
   - `waived` = explicit waiver record (new entity)
2. Each item has a jump-link to its section (not just §11/§12).
3. Waived items (e.g. §16.4) show amber with reviewer + reason + timestamp
   pulled from the waiver record.
4. Export produces a real PDF/CSV via the compliance plugin.

### Work
- **Prisma**: new `IchSectionWaiver { documentId, sectionCode, waivedBy,
  waivedAt, reason, versionAtWaiver }`. Migration + audit event
  `ich_section_waived`.
- **API**:
  - `GET /documents/:documentId/ich-e3` — returns `{ completionPercent,
    completeSections, totalSections, sections: [{ code, title, status,
    sectionId, waiver? }] }`.
  - `POST /documents/:documentId/ich-e3/:sectionCode/waive` — admin or
    Medical reviewer only; writes waiver + audit.
  - `GET /documents/:documentId/ich-e3/report.pdf` — PDF export.
- **Canonical catalog** — code constant mapping all 18 mandatory section
  codes to section ids.
- **Frontend**: swap mock for real route; replace jump map with the API's
  `sectionId`; wire Export to the PDF download; render waiver amber state
  from `waiver` payload. Delete the two hard-coded callouts.

### External blockers
None.

### Scope
M (2–3 days backend, 1 day frontend, 0.5 day migration + catalog).

---

## TKT-A-002 · MedDRA Lookup — real search, real insert, licence-gated

**PRD:** FR-A-027, FR-A-032 · **Severity:** Medium (blocked on licence)

### Current state
- `GET /meddra/search?q=…` not implemented; returns 404.
- Mock searches a 4-term fixture.
- Hard-coded footer: `v27.0`, `80,026` terms, "Recently used: 2 demo
  terms", "Subscription: Active · Expires 31 Dec 2025" — **expired**.
- "Update to v27.1" + "View full hierarchy →" are no-ops.
- Copy PT works (clipboard).
- Insert into §X does **not** insert — only shows a toast + marks the term
  used in the panel's local state (lost on refresh).
- "Mock data — not for production use" banner shown (per FR-A-032). ✓

### Target state
1. Real MedDRA dictionary searchable by term or code.
2. Insert writes to the section (editor doc mutation + audit
   `meddra_term_inserted`).
3. Per-document "Recently used" persisted (`MeddraTermUsage`).
4. Subscription status from a tenant-level config row.
5. "Update to v27.1" fires a version-check against MSSO feed (or shows
   last-sync timestamp).

### Work
Deferred until the licence track is chosen. Options:
- **a.** Direct MSSO licence (per-tenant, costly, legal review).
- **b.** Third-party gateway (paid, faster).
- **c.** Tenant-provided CSV import tool (clients upload their own
  licensed snapshot).

Once licence track is set:
- **Prisma**: `MeddraDictionaryVersion`, `MeddraTerm`, `MeddraTermUsage`.
- **API**: `GET /meddra/search?q=…&limit=20`, `POST /documents/:id/
  sections/:sid/meddra-insert`, `GET /meddra/version`, `POST /admin/meddra/
  sync`.
- **Frontend**: replace fixture with real search; wire Insert to
  section-mutation API; drop hard-coded footer values; add "Last synced"
  indicator; retire stale subscription label.

### External blockers
MedDRA MSSO licence (legal/commercial). **Keep the mock-data banner until
licence lands.**

### Scope
S–M build (2 days) once licence track chosen. Licence procurement is
weeks–months on the business side.

---

## TKT-A-003 · TLF Cross-Reference — build the panel, seed a package

**PRD:** FR-A-028 · **Severity:** Medium (routes exist but nothing uses
them)

### Current state
- Backend ready (`apps/api/src/modules/clinical-writing/tlf/routes.ts`):
  - List + create TLF packages for a project.
  - Add items.
  - Link an item to a document section.
  - `GET /documents/:id/tlf` — current package + each item's linked
    sections + reference counts.
- **Zero callers in the web app.** Selecting the TLF panel shows "TLF
  Cross-Reference panel — built in a later session."
- VELORA-301 has no TLF package → `/documents/:id/tlf` → 404
  `no_current_package`.
- No admin UI to create/upload a package.

### Target state
1. TLF panel in the editor's right-rail renders the current package's
   T/L/F items.
2. Filter chips: `All · Tables · Listings · Figures`.
3. Items linked to the current section are highlighted; clicking opens
   the source TLF.
4. "Cited in N sections" count per item.
5. Package version + validator shown in the footer.
6. Admin screen on the project to upload / create / version a TLF package.

### Work
- **Backend**: already shipped; add `POST /projects/:projectId/
  tlf-packages/upload` (CSV/XML import) if needed, otherwise existing
  create + add-items suffice.
- **Frontend**:
  - New `TlfPanel.tsx` wired to `GET /documents/:id/tlf`.
  - Filter + highlight logic keyed on `activeSectionId`.
  - Admin screen `/projects/:id/tlf` for package upload + validator
    metadata.
- **Seed**: 1 fixture TLF package for VELORA-301 (10–15 items spanning
  §11 / §12 / §14 citations) so QA has something to open against.

### External blockers
None.

### Scope
M (1 day panel UI, 1 day admin upload screen, 0.5 day seed fixture).

---

## TKT-A-004 · Sync button — correct tooltips, broaden the refresh

**PRD:** none (UX accuracy) · **Severity:** Low

### Current state
- Clicking Sync calls `GET /documents/:id` — reloads sections, their
  text, status, current version. Nothing else.
- Shows "Syncing…" + disabled while in flight.
- "Synced HH:MM" = last successful reload.
- Document also auto-reloads on save + tab return.
- **Tooltip overstates**: says it pulls "collaborator edits, new
  comments, etc." — only edits via GET /documents are refreshed.
- Sync-indicator tooltip says "Click Save to refresh" — inaccurate.
- Live collaboration via Yjs only when `VITE_COLLAB_URL` is set.

### Target state (option b, recommended)
Sync invalidates every per-document query key:
`['document', id]`, `['comments', id]`, `['document-sources', id]`,
`['section-history', id, …]`, `['document-stage', id]`,
`['signature-chain', id]`, `['checklist', id]`, `['presence', id]`.

### Work
- `DocumentEditor.tsx`: swap direct refetch for a bulk invalidate.
- Update both tooltips.
- Keep "Synced HH:MM" semantics; stamp after all invalidations settle.

### External blockers
None.

### Scope
XS (~1 hour).

---

## Priority order

1. **TKT-A-004** · Sync (XS) — immediate UX win.
2. **TKT-A-003** · TLF panel (M) — backend already paid for.
3. **TKT-A-001** · ICH E3 Validator (M) — compliance-visible, no blocker.
4. **TKT-A-002** · MedDRA Lookup — park until licence track picked.
