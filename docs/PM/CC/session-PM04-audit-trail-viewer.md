# Session PM01 — Audit Trail Viewer
**Screen:** sPM15 · Audit Trail Viewer
**Route:** `/admin/audit`
**Component:** `src/platform/screens/AuditTrailViewer.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM15-audit-trail-viewer.html`
**Data:** `auditTrail.json`
**Store:** `adminStore`
**Access:** `<AdminGuard>`

---

## What to Build

Full-width. Immutability banner (always visible) + filter bar + audit table + detail drawer. Current user: Dr James Hartley · Admin. 20 entries, date range 01–09 Sept 2026.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Immutability banner (always visible, top of content area — navy tint bg):**
"This audit trail is immutable. Entries cannot be edited, deleted, or reordered. Every entry was written at the time of the action it describes. Compliant with 21 CFR Part 11."

**Filter bar:**
- Date range: From 01 Sept 2026 · To 09 Sept 2026
- All users dropdown
- `{{ actionFilterLabel }}` cycle button (not a dropdown — cycles through action types on click)
- `{{ moduleFilterLabel }}` cycle button (cycles through module filters on click)
- "Export CSV" (grey outline)

**Audit table — `{{ rows }}` loop from `auditTrail.json`:**
Columns: Timestamp (UTC) · User · Action · Entity · Discipline · Details · IP
`{{ r.timestamp }}` / `{{ r.user }}` / `{{ r.action }}` / `{{ r.entity }}` / `{{ r.module }}` / `{{ r.details }}` / `{{ r.ip }}`
`{{ countLabel }}` = "Showing 20 entries"

**Detail drawer (aud-001 active — SIGNATURE_APPLIED):**
`{{ activeAction }}` title · `{{ fields }}` loop: `{{ f.label }}` / `{{ f.value }}`
**21 CFR Part 11 signature block (shown when `partEleven !== null`):**
> "I certify that the content of this document is accurate and complete to the best of my knowledge."
"This record is immutable. It cannot be edited, backdated or removed, and it remains available for the retention period of the project."

---

## Data Wiring

```typescript
const { entries, activeEntry, filters, exportCsv } = useAdminStore()
// MSW: GET /api/audit → auditTrail.json (all 20 entries)
// No write endpoints — immutable
// MSW: DELETE /api/audit/* → 405 Method Not Allowed (attempt itself is logged)
// MSW: PATCH /api/audit/* → 405 Method Not Allowed

// fields array — derive dynamically from selected audit entry
const alwaysFields = ['Timestamp','User','Role','Action','Entity','Discipline','IP','Session ID']
const partElevenFields = ['Signatory','Role','Email','Meaning of signature','Document version hash']
const fields = activeEntry.partEleven
  ? [...alwaysFields, ...partElevenFields]
  : alwaysFields

// 21 CFR Part 11 block shown only when activeEntry.partEleven !== null
// aud-001 and aud-005 have partEleven — all others are null

// cycleAction: steps through ['All actions','SIGNATURE_APPLIED','STAGE_ADVANCED','DOCUMENT_EDITED','SUBMISSION_TRANSMITTED','SYSTEM']
// cycleModule: steps through ['All disciplines','A','B','C','D','E','Platform']
```

---

## Implementation Notes (from design review)

- `{{ cycleAction }}` and `{{ cycleModule }}` are **cycle buttons not dropdowns** — each click steps to the next option in an array
- `{{ fields }}` is a **dynamic field list** per selected row — always-present fields + `partEleven` fields only when `entry.partEleven !== null`
- 21 CFR Part 11 meaning is hard-coded as a blockquote: "I certify that the content of this document is accurate and complete to the best of my knowledge."
- "This record is immutable. It cannot be edited, backdated or removed…" note in detail drawer — hard-code
- No DELETE or PATCH endpoints exist for audit trail — any such request returns 403. The attempt itself is logged (MSW should return 403 for any write on /api/audit)

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Immutability banner is visible at all times — it cannot be dismissed or hidden. (AC-PM-021)
2. Clicking aud-001 (SIGNATURE_APPLIED) opens detail drawer with 21 CFR Part 11 block. Blockquote reads "I certify that the content of this document is accurate and complete to the best of my knowledge." (AC-PM-022)
3. Clicking aud-002 (DOCUMENT_EDITED — no partEleven) shows detail drawer without the 21 CFR Part 11 block.
4. cycleAction button cycles through action types on each click. Table filters immediately.
5. "Export CSV" triggers a mock download. PATCH/DELETE to /api/audit returns 403.

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM04-audit-trail-viewer.md and execute.
Build AuditTrailViewer exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM15-audit-trail-viewer.html.
Run all 3 validation passes and report results before awaiting Session PM05.
```
