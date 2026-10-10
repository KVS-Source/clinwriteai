# CD prompt — Traceability side panel

## What to design

A right-rail panel that shows the provenance of every span in the
active section — where did this sentence come from? AI? A linked
source document? A human writer? Which version?

Right-rail panel. Opens when `panelMode = 'traceability'`. Pattern:
match the existing panels in `apps/web/src/panels/`.

## Behaviour

### Header
- Panel title: "Traceability"
- Section selector: "Showing: §11.4.1 Progression-Free Survival"
- Toggle: "Spans" / "Documents" view.

### Spans view (default)
Scrollable list of spans in the active section. Each row:
- Span excerpt (first 60 chars, "…" if longer).
- Provenance badge:
  - 🧠 **AI-drafted** — model name + date ("claude-opus-4-7 · 24 Oct")
  - ✍️ **Human-authored** — writer name + date
  - 📄 **From source** — source document name + page/section ref
    ("CSR v1.0 §11.4 → p 42")
- Confidence / verification state:
  - ✓ Verified by {reviewer-name} on {date}
  - ⚠ Pending verification
  - ✕ Flagged — needs rework (links to the Comment that flagged it)

Clicking a span highlights it in the editor + scrolls to it.

### Documents view (toggle)
Scrollable list of upstream source documents (CSR, Protocol, SAP, IB)
with:
- Document name + version
- "{{n}} spans in this section cite this source"
- "Last synced" timestamp
- "View source" link (opens source in new tab)

Below the list, a warning banner if a source document has been updated
since the current section was drafted:
"CSR v1.1 published 3 days ago — 2 spans in this section may need
review."

### Footer
- Export CTA: **Export provenance CSV** — downloads a CSV of every
  span → source mapping for this section. Used by regulators as part
  of the Part 11 audit trail.

## Data wiring (for engineering)

- `GET /documents/{documentId}/sections/{sectionId}/provenance`
  returns:
  ```json
  {
    "spans": [
      {
        "spanId": "span-...",
        "excerpt": "The primary efficacy endpoint...",
        "sourceType": "ai" | "human" | "source_document",
        "aiModel": "claude-opus-4-7",   // when sourceType = 'ai'
        "humanAuthor": "Marcus Webb",   // when sourceType = 'human'
        "sourceRef": "CSR v1.0 §11.4", // when sourceType = 'source_document'
        "verifiedBy": "...",           // nullable
        "verifiedAt": "2026-10-07T...",
        "flaggedByCommentId": "..."    // nullable
      }
    ],
    "sources": [
      {
        "documentId": "doc-...",
        "title": "VELORA-301 CSR",
        "version": "v1.0",
        "spanCount": 7,
        "lastSyncedAt": "2026-10-01T...",
        "hasNewerVersion": true,
        "newerVersionLabel": "v1.1"
      }
    ]
  }
  ```
- Export CSV: `GET /documents/{documentId}/sections/{sectionId}/
  provenance.csv` streams the same data as a CSV download.

## Keep as `{{ }}` template variables

- span excerpts, author names, model names, dates
- source document titles + versions + span counts

## Deliverable

One React component file (`TraceabilityPanel.tsx`) + a demo HTML.
