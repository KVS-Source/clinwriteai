# Session PM02 — TA Tag Configuration
**Screen:** sPM17 · TA Tag Configuration
**Route:** `/admin/taxonomy`
**Component:** `src/platform/screens/TATagConfiguration.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM17-ta-tag-configuration.html`
**Data:** `taTags.json`
**Store:** `adminStore`
**Access:** `<AdminGuard>`

---

## What to Build

Full-width. Header + tag table + add tag drawer. Current user: Dr James Hartley · Admin. 12 active tags.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Header:**
"Therapeutic area tags · 12 active"
"TA tags are mandatory on every project, document and content artefact. Tags are available across all disciplines immediately after creation."
"+ Add tag →" (navy primary)

**Tag table — `{{ tags }}` loop from `taTags.json`:**
Columns: Tag name · Abbreviation · Status · In use · Actions
`{{ t.name }}` / `{{ t.abbrev }}` / `{{ t.status }}` / `{{ t.inUse }}` / `{{ t.note }}` / `{{ t.primaryAction }}` / Delete

- Active tags with documents: `{{ t.note }}` = "14 projects · 247 documents — cannot delete" / `{{ t.primaryAction }}` = "Archive"
- Active tags with 0 documents: no note / primaryAction = "Archive" / Delete also shown
- Archived tags: grey status chip / `{{ t.primaryAction }}` = "Restore"
- "A tag in use cannot be deleted — archive it instead. Archiving keeps historical tagging intact and removes the tag from new selections."

**Add tag drawer (right):**
- "Add therapeutic area tag · Available in every discipline on save"
- Tag name field: `{{ nameValue }}` / `{{ setName }}` / live validation: `{{ nameRule }}`
- Abbreviation: `{{ abbrevValue }}` / `{{ suggest }}` "Auto-suggest" link / live validation: `{{ abbrevRule }}`
- "New tags appear in every discipline's tag selector immediately. Creation is written to the audit trail with the acting Admin named."
- "Save tag →" (navy primary) · "Cancel"

---

## Data Wiring

```typescript
const { tags, createTag, archiveTag, restoreTag } = useAdminStore()
// MSW: GET /api/admin/taxonomy → taTags.json
// MSW: POST /api/admin/taxonomy → 201 new tag
// MSW: PATCH /api/admin/taxonomy/:id/archive → { status: 'archived' }

// t.note: t.projectCount > 0 ? `${t.projectCount} projects · ${t.documentCount} documents — cannot delete` : ''
// t.primaryAction: t.status === 'archived' ? 'Restore' : 'Archive'
// Delete visible only when: t.projectCount === 0 && t.status === 'active'

// Live validation — name field
const nameRule = name === ''
  ? 'Tag name is required'
  : tags.some(t => t.name.toLowerCase() === name.toLowerCase())
    ? 'This tag name already exists'
    : ''   // valid

// Live validation — abbreviation
const abbrevRule = abbrev.length > 6
  ? 'Maximum 6 characters'
  : tags.some(t => t.abbreviation.toLowerCase() === abbrev.toLowerCase())
    ? 'This abbreviation is already in use'
    : ''  // valid

// Auto-suggest
const suggest = () => setAbbrev(name.replace(/[^A-Z]/g,'').slice(0,6))
```

---

## Implementation Notes (from design review)

- `{{ nameRule }}` and `{{ abbrevRule }}` are **live validation messages** — appear below each input as user types, empty string when valid
- `{{ suggest }}` = "Auto-suggest" link fires local computation — first 6 uppercase letters of tag name — no API call
- `{{ t.note }}` = inline note on rows with documents — empty for `projectCount === 0`
- `{{ t.primaryAction }}` = "Archive" / "Restore" depending on `t.status`
- Delete action column visible **only** when `t.projectCount === 0 && t.status === 'active'`
- Archiving a tag in use shows confirmation: "Archive Oncology? This tag is in use by 14 projects. It will be removed from new selections but existing tags are preserved."

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Tag table shows 12 rows from `taTags.json`. Oncology shows "14 projects · 247 documents" note and "Archive" action. Dermatology shows grey archived chip and "Restore" action. (AC-PM-025)
2. Delete action appears only for Immunology (projectCount=0, status=active). Does not appear for Oncology. (AC-PM-025)
3. Attempting to archive Oncology shows a confirmation step before proceeding.
4. Typing "Hae" in tag name live-validates abbreviation auto-suggest as "HAEMATOLOGY" → "HAEMA" (first 6 uppercase). No duplicate error if unique.
5. Entering a duplicate tag name shows "This tag name already exists" inline below the field — without submitting the form.

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM05-ta-tag-configuration.md and execute.
Build TATagConfiguration exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM17-ta-tag-configuration.html.
Run all 3 validation passes and report results before awaiting Session PM06.
```
