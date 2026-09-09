# CD Prompt — sE10 Standards & Metadata (DOI/ORCID/Dublin Core/WCAG)
**Module:** E — Ideation & Publishing · Steel Blue `#005F8E`
**PRD refs:** FR-E-019, DD-E-006, Finding #1 (PRD v4.1 standards gap closure)
**Screen code:** sE10
**Output file:** `aurora-sE10-standards-metadata-doi.html`

---

## Screen Purpose

The standards and metadata screen — the place where Module E closes the PRD v4.1 standards implementation gap identified in Finding #1. Long-form articles, white papers, and formal medical affairs communications published through Module E can be DOI-registered, ORCID-verified, and Dublin Core-tagged. WCAG 2.1 AA accessibility checks run on PDF and HTML outputs. This is the only screen in the Aurora platform where these standards are actually implemented (not just named in a compliance table).

---

## Layout

Three-section vertical layout within the project context. Accessible from sE09 Final Output or directly from a completed project.

**Header:** "Standards & Metadata · VELORA-301 · C-002 Blog Post (Long-Form Article)" breadcrumb. "Content type: Long-form Article — eligible for DOI registration." Sub-label: "This screen closes the PRD v4.1 compliance framework gap: Crossref & ORCID Standards and Dublin Core Metadata are implemented here for the first time in the Aurora platform."

---

## Section 1 — DOI Registration (FR-E-019)

**Header:** "DOI Registration · Crossref API"

**Eligibility check:**
"This content type (Long-form Article, 1,247 words) is eligible for DOI registration. Short-form social posts (LinkedIn, Twitter) are not eligible."

**DOI registration form:**
- Title (pre-filled): "Veloricept in First-Line Advanced NSCLC: Insights from the VELORA-301 Phase III Trial"
- Publication date: "25 Oct 2026"
- Content type: "Journal-style article (blog platform)"
- URL: "https://genbcoca.com/insights/velora-301-phase-iii"
- Rights statement: "© 2026 GenBioCa Sciences. All rights reserved."
- CrossRef member prefix: "10.XXXXX" (Admin-configured)

**ORCID verification (per contributor listed):**
Authors listed from project RACI:
- Dr Sarah Chen: "ORCID 0000-0002-1234-5678 · Verified ✓" (green)
- Prof. James Hartley (KOL): "ORCID 0000-0001-9876-5432 · Verified ✓" (green)
- "Add contributor" link

**Register DOI →** button (steel blue). On success:
"DOI registered: 10.XXXXX/velora301-pfs-2026 · CrossRef confirmation: ref_12345 · Logged to audit trail"
DOI chip displayed: "DOI: 10.XXXXX/velora301-pfs-2026 · Registered 25 Oct 2026"

**OQ-E-006 shared service note** (IBM Plex Mono, small):
"CrossRef/ORCID API: Module E owns this service. Module B publications use the same shared service. OQ-E-006 resolved Sept 2026."

---

## Section 2 — Dublin Core Metadata (FR-E-019)

**Header:** "Dublin Core Metadata · 15 Elements · DC Metadata Terms 2020"

Auto-populated from project and content card data. All 15 DC elements shown in a structured form (editable):

| DC Element | Value |
|------------|-------|
| dc:title | Veloricept in First-Line Advanced NSCLC: Insights from the VELORA-301 Phase III Trial |
| dc:creator | Dr Sarah Chen; Prof. James Hartley |
| dc:subject | Oncology; NSCLC; Veloricept; Pembrolizumab; PFS |
| dc:description | Analysis of PFS data from the VELORA-301 Phase III trial of veloricept plus pembrolizumab |
| dc:date | 2026-10-25 |
| dc:type | Article |
| dc:format | text/html; application/pdf |
| dc:identifier | 10.XXXXX/velora301-pfs-2026 (DOI, if registered) |
| dc:rights | © 2026 GenBioCa Sciences. All rights reserved. |
| dc:language | en |
| dc:source | VELORA-301 KOL Session Summary · Module C · MLR Approved 20 Oct 2026 |
| dc:relation | VELORA-301 Phase III CSR (Module A); Veloricept NDA (Module D) |
| dc:coverage | Global (oncology indication) |
| dc:publisher | GenBioCa Sciences |
| dc:contributor | Creative Team: Alex Turner |

"Tag metadata →" button. On success:
"Dublin Core metadata tagged ✓ · 15 elements applied · Embedded in PDF output and stored in platform · 25 Oct 2026"

Small note: "This is the first implementation of Dublin Core metadata in the Aurora platform. Metadata is embedded in the published PDF and HTML output and is searchable in the platform's Master Library."

---

## Section 3 — WCAG 2.1 Level AA Check (FR-E-019)

**Header:** "WCAG 2.1 Level AA — Content Output Check"

Note: "This is the content output accessibility standard (WCAG 2.1 AA). The Aurora platform UI targets WCAG 2.2 AA — this standard applies to the published PDF and HTML article output only. Uses the same checking engine as Module C FR-C-022."

**Check status (after running):**
- PDF output: "✓ All checks pass at Level AA · 25 Oct 2026"
- HTML output: "✓ All checks pass at Level AA · 25 Oct 2026"
- Section 508 (US federal): "✓ Compliant"
- PDF/UA (ISO 14289-1): "✓ Accessible PDF structure confirmed"

If failures existed (demo: show all passing for sE10):
Each failure would show: criterion, description, location, suggested fix — same pattern as Module C sC08.

"WCAG check record logged to audit trail · 25 Oct 2026 · Accessible PDF version ready for download"

---

## Standards Compliance Summary Strip (bottom)

Horizontal strip across full width:

| Standard | Status | Date |
|----------|--------|------|
| DOI (CrossRef) | 10.XXXXX/velora301-pfs-2026 | 25 Oct 2026 |
| ORCID | 2 contributors verified | 25 Oct 2026 |
| Dublin Core | 15 elements tagged | 25 Oct 2026 |
| WCAG 2.1 AA | Passed (PDF + HTML) | 25 Oct 2026 |
| Section 508 | Compliant | 25 Oct 2026 |
| PDF/UA | Confirmed | 25 Oct 2026 |
| 21 CFR Part 11 | Audit trail: all events logged | — |

---

## Design Notes

- This screen is a first in the platform — the header sub-label should explicitly name this: "This screen closes the PRD v4.1 compliance framework gap: Crossref & ORCID Standards and Dublin Core Metadata are implemented here for the first time in the Aurora platform." This is the demo statement for any investor or client reviewing the platform against the PRD standards table.
- The WCAG 2.1 (not 2.2) designation must be explicit and clearly labelled — show the note about platform UI vs content output distinction. This is the v0.2 fix.
- The DC metadata table should look professional and structured — use a clean two-column layout with DC element names in IBM Plex Mono (they are identifiers, not plain text labels) and values in Plus Jakarta Sans.
- DOI registration only applies to long-form content — show a clear "Not eligible" state for social posts. This avoids inflating DOI counts with throwaway content.
