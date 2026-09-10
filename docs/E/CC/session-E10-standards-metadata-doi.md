# Session E10 — Standards, Metadata & DOI
**Screen:** sE10 · Standards, Metadata & DOI
**Route:** `/projects/:projectId/ideation-publishing/projects/:ideationProjectId/standards`
**Component:** `src/modules/ideation-publishing/screens/StandardsMetadataDOI.tsx`
**Design file:** `C:/chetan/genBioCa/LifeSciences/docs/E/design/aurora-sE10-standards-metadata-doi.html`
**Data:** `src/data/ideationContentCards.json`, `src/data/atomisedContent.json`
**Store:** `standardsStore`

---

## What to Build

Standards and metadata screen for the approved ideation project. DOI registration (long-form content only), ORCID verification for the KOL, Dublin Core metadata (15 elements), WCAG 2.1 AA check. Module E owns the CrossRef/ORCID shared service (OQ-E-006).

---

## Screen Anatomy

Four stacked panels.

**DOI registered value (from sE10 design — hard-code in MSW):**
- DOI: `10.48291/velora301-pfs-2026`
- Crossref confirmation: `ref_12345`
- Registration date: `25 Oct 2026`
- Word count for eligibility: **1,247 words**
- After registration: field becomes read-only, irreversible note shown (DD-E-006)

**Dublin Core:** 15 elements · **DCMI terms 2020** (not 2012). Auto-populated from project and content card record.
"**First implementation** of Dublin Core metadata in the platform." — render this note visibly in the completion state.

**WCAG:** Uses same engine as Medical Writing accessibility check (Module C). Note in sE10 design: "using the same engine as the Medical Writing accessibility check."

**Panel 1 — DOI Registration (FR-E-019, AC-E-017):**

Card selection: c-001 Blog Post (ac-002) is eligible for DOI (long-form content).
- Status: "DOI registration available for blog post and long-form content only."
- Eligible: ac-002 Blog Post → "Register DOI →" button (teal)
- Not eligible: ac-001 LinkedIn Post, ac-007 LinkedIn, ac-003 HCP → "Not eligible — DOI registration applies to long-form citable artefacts only." grey label
- Note: "CrossRef/ORCID API: Module E owns this shared service. Module B publications use the same service." (AC-E-020)

**Panel 2 — ORCID Verification (FR-E-019):**
- KOL: "Prof. James Hartley · Professor of Oncology"
- ORCID field with "Verify →" button
- Note: "ORCID verification is optional for KOL contributors. Module E owns the ORCID API used by both this module and Module B."
- Verification result (demo — not yet verified): "0000-0000-0000-0000 · pending"

**Panel 3 — Dublin Core Metadata (FR-E-019, AC-E-018):**
For ac-002 (Blog Post — long-form):
15 fields all populated:
- dc:title: "VELORA-301 Phase III Primary PFS Data — Blog Summary"
- dc:creator: "GenBioCa Sciences Medical Affairs"
- dc:subject: "Oncology · NSCLC · Veloricept · Pembrolizumab"
- dc:description: "Summary of primary PFS efficacy results from the VELORA-301 Phase III trial."
- dc:date: "2026-10-25"
- dc:type: "Blog Post"
- dc:format: "text/html"
- dc:identifier: "— (pending DOI registration)"
- dc:rights: "© 2026 GenBioCa Sciences. For medical affairs use."
- dc:language: "en"
- dc:source: "VELORA-301 KOL Advisory Board Summary v1.0"
- dc:relation: "VELORA-301 CSR v1.0"
- dc:coverage: "Global — FDA + EMA submission territories"
- dc:publisher: "GenBioCa Sciences"
- dc:contributor: "Prof. James Hartley (KOL reviewer)"
"Tag & embed →" button (teal) — embeds in PDF/HTML output.

**Panel 4 — WCAG 2.1 Level AA Check (FR-E-019, AC-E-019):**
Header: "WCAG 2.1 Level AA — Content Output Check" (not WCAG 2.2)
- "WCAG 2.1 AA applies to published content outputs. The Aurora platform UI targets WCAG 2.2 AA — these are separate standards." (AC-E-019)
- "Run WCAG check →" button for Blog Post output
- Format selector: PDF / HTML

---

## Data Wiring

```typescript
const { doiRecord, dublinCoreRecord, orcidVerifications, wcagResult,
        registerDOI, verifyORCID, tagDublinCore, runWCAG } = useStandardsStore()

// DOI eligibility check
const isEligibleForDOI = (adaptation: AtomisedContent) =>
  adaptation.channel === 'blog' || adaptation.channel === 'medical-affairs'
  // NOT: 'linkedin', 'twitter', 'email', 'instagram', 'facebook' (AC-E-017)

// DOI registration
const handleDOIRegister = () =>
  ideationPublishingApi.registerDOI('c-001', {
    title: 'VELORA-301 Phase III Primary PFS Data — Blog Summary',
    creators: ['GenBioCa Sciences Medical Affairs'],
    url: 'https://genbioca.com/velora301-pfs-blog',
    rights: '© 2026 GenBioCa Sciences',
  })
// MSW: POST /api/ideation-cards/c-001/doi/register

// ORCID — Module E owns the shared service
const handleORCIDVerify = (orcid: string) =>
  ideationPublishingApi.verifyORCID(orcid)
// MSW: GET /api/orcid/verify/:orcid
// Note: Module B uses the SAME endpoint — Module E owns it

// WCAG — 2.1 Level AA only for content outputs
const handleWCAG = () => ideationPublishingApi.runWCAG('c-001', 'html')
// MSW: POST /api/ideation-cards/c-001/wcag/run
```

---

## Validation — 3 Passes

**Pass 1:** `npm run typecheck && npm run lint`
**Pass 2:** `npm run build`
**Pass 3 — 5 smoke tests:**
1. DOI panel shows "Register DOI →" only for the Blog Post. LinkedIn, HCP, and Email show "Not eligible — DOI registration applies to long-form citable artefacts only."
2. The CrossRef/ORCID shared service note is visible: "Module E owns this shared service. Module B publications use the same service." (AC-E-020)
3. Dublin Core panel shows all 15 dc: elements populated for the Blog Post. dc:identifier shows "— (pending DOI registration)".
4. WCAG panel header reads "WCAG 2.1 Level AA — Content Output Check" (not WCAG 2.2). The clarifying note distinguishing platform UI (2.2) from content outputs (2.1) is visible. (AC-E-019)
5. "Tag & embed →" button is present in the Dublin Core panel.

---

## CC Prompt

```
Read C:/chetan/genBioCa/LifeSciences/docs/E/CC/session-E10-standards-metadata-doi.md and execute.
Build StandardsMetadataDOI exactly as specified, run all 3 validation passes, and report results.
This is the final Module E screen — confirm that npm run build passes clean for the complete module after E10.
```
