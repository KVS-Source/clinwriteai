// Document Brief — compact, derived summary of a document.
//
// Rides along on every AI section-rewrite call so the model has
// enough context to (a) number cross-references correctly, (b) pick
// the next bibliographic citation number, (c) know which guidelines
// + sponsor rules apply, and (d) avoid re-asking things the author
// already answered — without re-sending the full document body on
// every call. Target budget: ≤ ~1.5k tokens when stringified.
//
// Derived, never authored. Regenerated on structural events (section
// add/rename, protocol-metadata edit, source link/unlink, reference
// add) by the brief service. Users do NOT edit this directly.
//
// Shape decisions:
//   - `rev` monotonically increases on every regen. Downstream consumers
//     can cache against (documentId, rev) safely.
//   - `document.jurisdictions` is the human-readable authority list
//     (FDA / EMA / CDSCO) derived from Document.regulatoryRegion. The
//     SME prompt keys submission-time rules off these.
//   - `guidelineVersions` is a flat string→string map. The current
//     defaults are hardcoded in the generator; moving them into a
//     DocumentTypePromptPolicy row is the follow-up PR (sPM-prompt-lib).
//   - `protocol` is optional — only populated for protocol +
//     protocol-amendment doc types. Other doc types omit the block so
//     the brief stays tight.
//   - `openFlags.informationRequired` / `conflicts` /
//     `referenceVerification` are empty arrays today; they'll be
//     populated when the build-time chat parser lands and writes
//     back the `[Information Required: …]` / `[Conflict: …]` tokens
//     the carry prompt emits.

import { z } from 'zod'

export const briefSchema = z.object({
  rev: z.number().int().nonnegative(),

  document: z.object({
    id:                z.string(),
    type:              z.string(),                                 // 'protocol', 'csr-full', …
    title:             z.string(),
    status:            z.string(),
    stage:             z.string(),
    draftLabel:        z.string(),                                 // 'Draft – Subject to …'
    jurisdictions:     z.array(z.string()),                        // ['FDA', 'EMA', 'CDSCO']
    guidelineVersions: z.record(z.string(), z.string()),           // { M11: '2024', E6: 'R3-2025', … }
  }),

  sponsor: z.object({
    name:               z.string().nullable(),
    templateId:         z.string().nullable(),
    citationStyle:      z.string(),                                // 'Vancouver/ICMJE'
    tableFootnoteStyle: z.string(),                                // 'superscript a-z'
    abbreviationPolicy: z.string(),                                // 'define on first use; glossary at §1.1'
  }),

  protocol: z.object({
    studyTitle:             z.string().nullable(),
    protocolNumber:         z.string().nullable(),
    protocolVersion:        z.string().nullable(),
    investigationalProduct: z.string().nullable(),
    studyDesign:            z.string().nullable(),
    targetPopulation:       z.string().nullable(),
  }).optional(),

  outline: z.array(z.object({
    sectionId: z.string(),
    number:    z.string(),
    title:     z.string(),
    status:    z.string(),
    wordCount: z.number().int().nonnegative(),
  })),

  inventory: z.object({
    tables:     z.array(z.object({ ref: z.string(), title: z.string() })),
    figures:    z.array(z.object({ ref: z.string(), title: z.string() })),
    listings:   z.array(z.object({ ref: z.string(), title: z.string() })),
    appendices: z.array(z.object({ ref: z.string(), title: z.string() })),
  }),

  references: z.object({
    sources: z.array(z.object({
      uploadId: z.string(),
      title:    z.string().nullable(),
      category: z.string().nullable(),
    })),
    citedCount: z.number().int().nonnegative(),
    nextNumber: z.number().int().positive(),
  }),

  openFlags: z.object({
    ichWaivers: z.array(z.object({
      sectionCode: z.string(),
      reason:      z.string(),
    })),
    informationRequired: z.array(z.object({
      sectionId: z.string(),
      note:      z.string(),
    })),
    conflicts: z.array(z.object({
      sectionId: z.string(),
      note:      z.string(),
    })),
    referenceVerification: z.array(z.object({
      sourceId: z.string(),
      note:     z.string(),
    })),
  }),

  generatedAt: z.string(),                                          // ISO
})

export type DocumentBrief = z.infer<typeof briefSchema>

// The SME-supplied draft label from the Protocol prompt, deliverable
// §8. Protocol is the canonical case; other doc types inherit the same
// phrasing until a doc-type policy row overrides it.
export const DRAFT_LABEL =
  'Draft – Subject to Medical, Statistical, Regulatory, and Quality Review'

// Defaults carried on every brief until the DocumentTypePromptPolicy
// table lands (sPM-prompt-lib). Pinned so the generator stays pure.
export const DEFAULT_GUIDELINE_VERSIONS: Record<string, string> = {
  M11: '2024',
  E6:  'R3-2025',
  E8:  'R1',
  E9:  'R1',
}

export const DEFAULT_SPONSOR_POLICY = {
  citationStyle:      'Vancouver/ICMJE',
  tableFootnoteStyle: 'superscript a-z',
  abbreviationPolicy: 'define on first use; glossary at §1.1',
} as const
