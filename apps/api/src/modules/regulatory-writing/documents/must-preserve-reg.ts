// Regulatory-side attached-context builder for the shared retry wrapper
// (Package R-4, migration 105). Analogue of
// apps/api/src/modules/scientific-writing/publications/must-preserve-pub.ts
// but adapted to Regulatory's CSR-grounding model.
//
// Regulatory content cites CSR tables / protocol sections directly:
// "see CSR Table 14.2.1", "Protocol v2.0 §4.1", "Study CDP-102 §14.3.2".
// Those structural references are (intended to be) extracted into
// CanonicalJsonEntry rows on the parent submission. This helper
// enumerates the extracted identifiers as the allow-list for the
// validator's citation-grounding check: any NEW reference the AI
// introduces that isn't in the index trips 'invented_citation' → hard
// retry.
//
// Degraded mode: when the index is empty (the real PDF/Word extractor
// is externally blocked per aliases-and-stubs.ts), allowedTokens is
// empty → citation-grounding becomes informational-only but the
// regex-level manifest preservation still catches dropped cross-refs.
// The grounding tightens automatically as the indexer matures.

import type { PrismaClient } from '@prisma/client'
import type { AttachedSourceContext } from '../../clinical-writing/documents/ai-validators.js'

/** Build an AttachedSourceContext for the Regulatory ai-suggest wrapper.
 *  Walks CanonicalJsonEntry rows for the parent submission, extracts
 *  structural identifiers from the indexed content (table numbers,
 *  section pointers, study ids), returns them as allowedTokens.
 *  Non-fatal: empty on DB error or empty index. */
export async function buildRegulatoryAttachedContext(
  prisma: PrismaClient,
  regulatoryDocumentId: string,
): Promise<AttachedSourceContext> {
  try {
    // Resolve the parent submission so we can scope the CanonicalJsonEntry
    // lookup. Submissions own the CSR index; documents inherit it.
    const doc = await prisma.regulatoryDocument.findUnique({
      where:  { id: regulatoryDocumentId },
      select: { submissionId: true },
    })
    if (!doc) return { allowedTokens: [], authorSurnames: [] }

    const entries = await prisma.canonicalJsonEntry.findMany({
      where:  { submissionId: doc.submissionId },
      select: { content: true, sourceType: true, version: true },
    })
    if (entries.length === 0) return { allowedTokens: [], authorSurnames: [] }

    const allowedTokens = new Set<string>()
    const authorSurnames = new Set<string>()
    for (const e of entries) {
      walkContent(e.content, allowedTokens, authorSurnames)
    }
    return { allowedTokens: [...allowedTokens], authorSurnames: [...authorSurnames] }
  } catch {
    return { allowedTokens: [], authorSurnames: [] }
  }
}

// Table-14.2.1-style + §-style + Study-ID extractor used across the
// indexed JSON tree. Handles arrays + objects recursively; strings get
// regex-scanned.
const TABLE_RE  = /\bTable\s+\d+(?:\.\d+)*[a-z]?/gi
const SECTION_RE = /§\s?\d+(?:\.\d+)*[a-z]?|\bSection\s+\d+(?:\.\d+)*[a-z]?/gi
const FIGURE_RE = /\bFigure\s+\d+(?:\.\d+)*[a-z]?|\bFig\.?\s+\d+(?:\.\d+)*[a-z]?/gi
const STUDY_RE  = /\bStudy\s+[A-Z][A-Z0-9-]+|\bNCT\d{8}|\bEudraCT\s+\d{4}-\d{6}-\d{2}|\bIND\s+\d+/g
const AUTHOR_RE = /\b([A-Z][a-zA-Z'-]{2,})\s+(?:et\s+al\.?|\d{4})/g

function walkContent(v: unknown, tokens: Set<string>, surnames: Set<string>) {
  if (v === null || v === undefined) return
  if (typeof v === 'string') {
    for (const re of [TABLE_RE, SECTION_RE, FIGURE_RE, STUDY_RE]) {
      for (const m of v.matchAll(re)) tokens.add(m[0].trim())
    }
    for (const m of v.matchAll(AUTHOR_RE)) surnames.add(m[1]!)
    return
  }
  if (Array.isArray(v)) {
    for (const x of v) walkContent(x, tokens, surnames)
    return
  }
  if (typeof v === 'object') {
    for (const x of Object.values(v as Record<string, unknown>)) walkContent(x, tokens, surnames)
  }
}

// Exported only for unit tests.
export const __test__ = { walkContent, TABLE_RE, SECTION_RE }
