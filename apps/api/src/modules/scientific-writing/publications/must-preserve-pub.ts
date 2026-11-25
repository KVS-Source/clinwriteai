// Publication-aware wrapper around the shared must-preserve extractor
// (migration 105, Package B-3). Keeps the publication-DB coupling out of
// the pure extractor in apps/api/src/modules/clinical-writing/documents/
// must-preserve.ts.
//
// What this module adds beyond the shared extractor:
//
//   buildPublicationAttachedContext(prisma, publicationId) →
//     AttachedSourceContext for callWithValidation's citation-grounding
//     check. Scope:
//
//       - allowedTokens: every Vancouver [N] (1..N) that corresponds to
//         a Citation row for this publication. Any [N] the AI introduces
//         with N > citation count will fail grounding → hard retry.
//
//       - authorSurnames: first word of each Citation.shortRef (e.g.
//         "Socinski M et al., JCO 2021" → "Socinski"). Catches rare
//         cases where the AI adds author-year citations alongside
//         numbered ones; soft heuristic, intentionally lenient.
//
// Scope note: this module does NOT re-export the extractor / diff /
// renderer — callers import those from the shared module directly, same
// as Clinical does. Only the publication-specific attached-context
// builder lives here.

import type { PrismaClient } from '@prisma/client'
import type { AttachedSourceContext } from '../../clinical-writing/documents/ai-validators.js'

/** Build the AttachedSourceContext used by Vancouver-numbered [N]
 *  grounding. Pulls Citation rows for the publication, enumerates
 *  allowed tokens, and lifts author surnames. Non-fatal on DB error —
 *  returns an empty context so the validator falls back to "any new
 *  citation is suspect". */
export async function buildPublicationAttachedContext(
  prisma: PrismaClient,
  publicationId: string,
): Promise<AttachedSourceContext> {
  try {
    const citations = await prisma.citation.findMany({
      where:  { publicationId, removedAt: null },
      select: { shortRef: true },
      // Vancouver numbering is insertion-order per the existing
      // apps/api/src/modules/scientific-writing/citations/routes.ts
      // convention. Preserve that order so index 0 → "[1]".
      orderBy: { insertedAt: 'asc' },
    })
    const allowedTokens: string[] = []
    const authorSurnames = new Set<string>()
    for (let i = 0; i < citations.length; i++) {
      allowedTokens.push(`[${i + 1}]`)
      const surname = firstWord(citations[i]!.shortRef)
      if (surname) authorSurnames.add(surname)
    }
    return { allowedTokens, authorSurnames: [...authorSurnames] }
  } catch {
    return { allowedTokens: [], authorSurnames: [] }
  }
}

/** First alphabetic word, uppercased-first letter. Used to lift the
 *  cited author's surname from a shortRef like
 *  "Socinski M et al., JCO 2021". Returns null when nothing usable. */
function firstWord(shortRef: string | null | undefined): string | null {
  if (!shortRef) return null
  const m = /^\s*([A-Za-zÀ-ÿ'`-]{2,})/.exec(shortRef)
  if (!m) return null
  const w = m[1]!
  // Capitalise first letter for consistent matching against the
  // extractor's author-year surname check (case-insensitive downstream,
  // so this is defensive).
  return w.charAt(0).toUpperCase() + w.slice(1)
}

// Exported only for unit tests — keeps the helper pure + inspectable
// without exposing the whole publication-DB path.
export const __test__ = { firstWord }
