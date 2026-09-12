# Session PM04 — Master Library
**Screen:** sPM08 · Master Library
**Route:** `/library`
**Component:** `src/platform/screens/MasterLibrary.tsx`
**Design file:** `C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM08-master-library.html`
**Data:** `masterLibraryItems.json`
**Store:** `platformStore`
**Access:** All authenticated users (read) · Author+ (pull)

---

## What to Build

Three-column layout: filter panel (~260px) · results list (~340px) · item detail (remainder). Current user: Dr Sarah Chen · Regulatory Writer. Demo state: NDA + Oncology filters pre-applied, 47 items shown.

---

## Screen Anatomy

Read the HTML file. Implement exactly what is shown.

**Filter panel (left):**
- Full-text search: "Search documents, sections…"
- Discipline filter: A B C D E checkboxes with module colour dots
- Item type: Document · Section · Best Practice
- Document type: NDA ✕ (active) · CSR · SmPC · RMP (multi-select)
- TA: Oncology ✕ (active) · Cardiometabolic
- Date range: From / To
- Results count: "47 items · 2 filters applied"

**Results list (centre):**
- `{{ it.name }}` / `{{ it.state }}` / `{{ it.module }}` chip / `{{ it.meta }}` / `{{ it.pushed }}` per card
- Archived items show grey "🔒 Archived" tag — wire from `isArchived: true`
- `{{ items }}` = remaining cards beyond hard-coded first item
- "Most recent" sort label

**Item detail (right — CTD 2.5 Clinical Overview active):**
- `{{ activeName }}` · `{{ activeModule }}` chip · `{{ activeDocType }}` · TA: Oncology · `{{ activeVersion }}`
- Pushed: `{{ activePushed }}` · Project: VELORA-301 Efficacy Suite
- Provenance chain: `{{ provenance }}` loop — `{{ p.label }}` / `{{ p.meta }}`
- Version history: v1.0 · Current · "No previous versions."
- `{{ pullLabel }}` button (navy primary) · "Download PDF" (navy outline)
- `{{ immutabilityNote }}` footer

---

## Data Wiring

```typescript
const { items, activeItem, filters, pull } = usePlatformStore()
// MSW: GET /api/library?docType=NDA&ta=Oncology → masterLibraryItems.json (filtered subset)
// Initialise with filters: { docType: ['NDA'], ta: ['Oncology'] } for demo user user-rw

// pullLabel — context sensitive
const pullLabel = hasActiveDocument
  ? 'Pull into active document →'
  : 'Open a document to pull this section'   // disabled state

// immutabilityNote — based on isArchived
const immutabilityNote = activeItem.isArchived
  ? 'This item is from a closed project and is read-only. It can be pulled and downloaded but not overwritten.'
  : 'Pulled sections retain their full provenance chain in the destination document.'

// Provenance chain from masterLibraryItems.json provenanceChain array
```

---

## Implementation Notes (from design review)

- Initialise `masterLibraryStore` with NDA + Oncology filters pre-applied for demo — shows "47 items · 2 filters applied" on load
- `{{ pullLabel }}` is context-sensitive — wire from `hasActiveDocument` boolean in `platformStore`
- `{{ immutabilityNote }}` has two variants based on `activeItem.isArchived` — see data wiring above
- ml-003 (VELORA-301 CSR v1.0) is `isArchived: true` — must show grey "🔒 Archived" tag
- Provenance chain renders from `masterLibraryItems.json` `provenanceChain` string array — render as a vertical chain with connecting lines

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. Filter panel shows NDA ✕ and Oncology ✕ as active chips. Results count shows "47 items · 2 filters applied". (AC-PM-010)
2. ml-003 (VELORA-301 CSR v1.0) shows grey "🔒 Archived" tag. (AC-PM-011)
3. Active item detail (CTD 2.5 Clinical Overview) shows provenance chain with 3 steps. Version history shows "v1.0 · Current · No previous versions."
4. `immutabilityNote` for an active item reads "Pulled sections retain their full provenance chain in the destination document."
5. `immutabilityNote` for ml-003 (archived) reads "This item is from a closed project and is read-only."

---

## CC Prompt

> **Product name:** ClinWrite.AI — never AURORA or ClinWrite.AI anywhere in this screen.


```
Read C:/Chetan/GenBioCa/LifeSciences/docs/PM/CC/session-PM15-master-library.md and execute.
Build MasterLibrary exactly as specified using the HTML design at
C:/Chetan/GenBioCa/LifeSciences/docs/PM/design/aurora-sPM08-master-library.html.
Run all 3 validation passes and report results before awaiting Session PM13.
```
