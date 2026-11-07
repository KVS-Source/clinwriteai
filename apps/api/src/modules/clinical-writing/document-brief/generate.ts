// Pure generator for the Document Brief.
//
// Takes ALREADY-FETCHED inputs (Document row, sections, sources, TLF
// items, waivers, cited-reference count) and returns a validated
// DocumentBrief object. Keeping this pure is the point: the service
// layer handles fetching + upsert; this file is unit-testable without
// a database.
//
// The hyphenation unmap (studyTitle etc. are passed through; type +
// status + stage are hyphenated here) mirrors documentShapeFull in
// documents/routes.ts — the brief's `type` field must agree with the
// DocumentType union so the AI call site can key per-doc-type prompt
// rules off it.

import {
  briefSchema,
  DEFAULT_GUIDELINE_VERSIONS,
  DEFAULT_SPONSOR_POLICY,
  DRAFT_LABEL,
  type DocumentBrief,
} from './schema.js'
import { jurisdictionsFor } from './jurisdictions.js'

export interface BriefDocumentInput {
  id:                      string
  type:                    string
  title:                   string
  status:                  string
  stage:                   string
  sponsor:                 string | null
  templateId:              string | null
  regulatoryRegion:        string | null
  studyTitle:              string | null
  protocolNumber:          string | null
  protocolVersion:         string | null
  investigationalProduct:  string | null
  studyDesign:             string | null
  targetPopulation:        string | null
}

export interface BriefSectionInput {
  sectionId:     string
  sectionNumber: string
  sectionTitle:  string
  ichStatus:     string
  wordCount:     number
}

export interface BriefSourceInput {
  uploadId: string
  title:    string | null
  category: string | null
}

export interface BriefTlfItemInput {
  itemType:    string      // 'T' | 'L' | 'F'
  referenceId: string      // 'Table 14.2.1' etc.
  title:       string
}

export interface BriefWaiverInput {
  sectionCode: string
  reason:      string
}

export interface GenerateBriefInputs {
  document:    BriefDocumentInput
  sections:    BriefSectionInput[]
  sources:     BriefSourceInput[]
  tlfItems:    BriefTlfItemInput[]
  ichWaivers:  BriefWaiverInput[]
  /** Count of SourceReference rows for this document (excluding
   *  removed ones). The brief exposes `nextNumber = citedCount + 1`
   *  so the carry prompt can hand the next Vancouver number to the
   *  model without re-reading the reference table. */
  citedCount:  number
  /** Monotonically incremented on each regen. Pass 0 for a first
   *  generation, or `prevRev + 1` from the service. */
  rev:         number
  /** Injectable for deterministic tests. Defaults to new Date(). */
  now?:        () => Date
}

const PROTOCOL_DOC_TYPES = new Set(['protocol', 'protocol-amendment'])

function hyphenate(v: string): string {
  return v.replace(/_/g, '-')
}

// The TLF reference id ('Table 14.2.1', 'Figure 1', 'Listing 16.2.1')
// is what the editor actually cites. We keep the whole string as `ref`
// — splitting out the leading word would lose the citation form the
// writer sees. Titles are passed through verbatim.
function inventoryByKind(items: BriefTlfItemInput[]): {
  tables:   Array<{ ref: string; title: string }>
  figures:  Array<{ ref: string; title: string }>
  listings: Array<{ ref: string; title: string }>
} {
  const tables:   Array<{ ref: string; title: string }> = []
  const figures:  Array<{ ref: string; title: string }> = []
  const listings: Array<{ ref: string; title: string }> = []
  for (const it of items) {
    const row = { ref: it.referenceId, title: it.title }
    if (it.itemType === 'T') tables.push(row)
    else if (it.itemType === 'F') figures.push(row)
    else if (it.itemType === 'L') listings.push(row)
  }
  return { tables, figures, listings }
}

export function generateBrief(inputs: GenerateBriefInputs): DocumentBrief {
  const { document: d, sections, sources, tlfItems, ichWaivers, citedCount } = inputs
  const now = (inputs.now ?? (() => new Date()))()

  const type = hyphenate(d.type)
  const isProtocol = PROTOCOL_DOC_TYPES.has(type)

  const { tables, figures, listings } = inventoryByKind(tlfItems)

  const brief: DocumentBrief = {
    rev: inputs.rev,

    document: {
      id:                d.id,
      type,
      title:             d.title,
      status:            hyphenate(d.status),
      stage:             hyphenate(d.stage),
      draftLabel:        DRAFT_LABEL,
      jurisdictions:     jurisdictionsFor(d.regulatoryRegion),
      guidelineVersions: { ...DEFAULT_GUIDELINE_VERSIONS },
    },

    sponsor: {
      name:               d.sponsor,
      templateId:         d.templateId,
      citationStyle:      DEFAULT_SPONSOR_POLICY.citationStyle,
      tableFootnoteStyle: DEFAULT_SPONSOR_POLICY.tableFootnoteStyle,
      abbreviationPolicy: DEFAULT_SPONSOR_POLICY.abbreviationPolicy,
    },

    ...(isProtocol
      ? {
          protocol: {
            studyTitle:             d.studyTitle,
            protocolNumber:         d.protocolNumber,
            protocolVersion:        d.protocolVersion,
            investigationalProduct: d.investigationalProduct,
            studyDesign:            d.studyDesign,
            targetPopulation:       d.targetPopulation,
          },
        }
      : {}),

    outline: sections.map(s => ({
      sectionId: s.sectionId,
      number:    s.sectionNumber,
      title:     s.sectionTitle,
      status:    hyphenate(s.ichStatus),
      wordCount: s.wordCount,
    })),

    inventory: {
      tables,
      figures,
      listings,
      appendices: [],   // No appendix model yet — placeholder for the follow-up PR.
    },

    references: {
      sources: sources.map(s => ({
        uploadId: s.uploadId,
        title:    s.title,
        category: s.category,
      })),
      citedCount,
      nextNumber: citedCount + 1,
    },

    openFlags: {
      ichWaivers: ichWaivers.map(w => ({
        sectionCode: w.sectionCode,
        reason:      w.reason,
      })),
      // AI-emitted flag arrays stay empty here — the brief service
      // overlays them from document_brief_open_flags at read time so
      // a structural regen doesn't wipe them.
      informationRequired:    [],
      conflicts:              [],
      referenceVerification:  [],
      missingCrossRefTargets: [],
    },

    generatedAt: now.toISOString(),
  }

  // Validate before returning so a schema-shape bug fails here, not at
  // the API edge. Zod's parse() throws on mismatch; we want that loud.
  return briefSchema.parse(brief)
}
