# ADR 0012: Server-side PDF rendering — pdfkit

**Status**: Accepted
**Date**: 2026-10-05
**Owner**: Platform engineering
**Deciders**: Platform engineering (compliance consulted)
**Supersedes**: —
**Superseded by**: —

## Context

Two auditor-facing deliverables need server-rendered PDF output:
1. GPP-2022 compliance report (Module B §24 B10 "Download PDF" button)
2. Compliance report for SOC 2 evidence binders

The JSON variants shipped first (clients could print-to-PDF via browser),
but auditors want signed, server-produced PDFs so the artefact is
authoritative, deterministic, and doesn't depend on the viewer's browser
version. A PDF stack decision was blocking both reports' PDF endpoints.

## Decision

Use `pdfkit` (`^0.20.2`) for server-side PDF generation. Streaming output
via Node streams, pdfkit's built-in Helvetica so no font files to bundle,
`bufferPages` enabled so we can retro-stamp "Page X of Y" footers.

Shipped as commits 0789c7d (GPP-2022 renderer) and 9ecf681 (compliance
report renderer). Shared `builder.ts` + `pdf-renderer.ts` pair per report
so the JSON and PDF endpoints score from the same data.

## Options considered

### Option A — pdfkit (**chosen**)
- **Pros** Lightweight (~1.5MB installed, zero native deps). Streaming
  output. Mature (10+ years). Node-native. Standard choice.
- **Cons** Imperative drawing API — layout is pixel-arithmetic (moveTo,
  text at x,y). No HTML/CSS. Not great for complex multi-column layouts
  but fine for the auditor reports we need now.
- **Rough effort / cost** ~1 day per report template.

### Option B — Playwright-pdf (headless Chromium) (**not chosen**)
- **Pros** Full HTML/CSS rendering — reuses frontend components.
  Beautiful output.
- **Cons** Requires Chromium (~200MB), high memory per render, slow
  (~500ms+ per page). Overkill for 1-page reports. Would need
  Chromium in the container runtime.
- **Rough effort / cost** ~1 day per report + ongoing ops burden.

### Option C — @react-pdf/renderer (**not chosen**)
- **Pros** React component model for layout; shared code with frontend.
- **Cons** Heavy install (~15MB). Flexbox-ish layout engine has quirks.
  Component model harder to debug than pdfkit's imperative API for
  table-heavy reports. We're not using React on the server.
- **Rough effort / cost** ~2 days per report.

### Option D — HTML stream + client prints to PDF (**shipped initially**)
- **Pros** Zero server deps; client controls formatting.
- **Cons** Not an attestable artefact — rendering varies by browser +
  user print settings. Auditors want deterministic PDF.
- **Rough effort / cost** Zero (already shipped as JSON endpoints).

## Rationale

The auditor-attestability requirement rules out Option D. Among the
server-side renderers, pdfkit's weight + maturity won. Playwright would
be overkill for 1-page reports and brings a Chromium ops burden the rest
of the platform doesn't need. ReactPDF's component model is a nice
developer story but we're not sharing component code with React (the
server has no React), so the benefit is small vs the install weight.

Scope-later: if we need complex multi-column layouts (e.g. a submission
tracker with Gantt), re-evaluate Playwright. For now, pdfkit's
imperative API fits the "cover page + metrics grid + table" shape of
compliance reports.

## Consequences

### Positive
- Attestable, deterministic server-produced PDFs
- Streaming output — flat memory profile regardless of report size
- No browser dependency; same renderer works everywhere Node runs
- Shared `builder.ts` + separate `pdf-renderer.ts` keeps JSON + PDF
  outputs in sync by construction

### Negative
- Layout is pixel-arithmetic. Complex multi-column reports would be
  painful to lay out — would reconsider Playwright at that point.
- No shared code with the frontend's React components. Report layouts
  are duplicated across the HTML/CSS the UI shows and the pdfkit code.
  Acceptable for 2 reports; revisit at 10.

### Neutral / downstream work
- Signed PDFs (digital signature embedded in the PDF per Part 11
  §11.70 interpretation) — this is a separate decision requiring a
  signing cert + key management strategy. pdfkit supports PDF
  signatures via plugins; wire when the KMS strategy lands.
- PDF/A conformance for long-term archival — ISO 19005. pdfkit
  outputs PDF 1.3; PDF/A compliance would need additional metadata +
  font embedding. Not currently a requirement.

## Compliance implications

- Part 11 §11.70: PDFs will eventually need a signature binding the
  content hash. Currently out-of-scope; the shipped JSON report
  already carries the chain integrity hash as evidence.
- SOC 2 CC7.3: deterministic auditor artefact — pdfkit output is
  byte-identical across runs given identical input (modulo creation
  timestamp in header). Good.
- GAMP 5 CSV: pdfkit is a mature open-source library. Validation
  burden limited to the report templates (our code), not pdfkit itself.

## References

- pdfkit docs: http://pdfkit.org/
- `apps/api/src/modules/scientific-writing/publications/gpp/pdf-renderer.ts`
- `apps/api/src/modules/platform/compliance/report/pdf-renderer.ts`
- Commits: 0789c7d (GPP), 9ecf681 (compliance)
- Smoke tests: 2600ab3 (7 pdfkit regression cases)
