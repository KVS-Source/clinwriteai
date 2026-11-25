// Medical-side attached-context builder for the shared retry wrapper
// (Package D-2, migration 105 follow-up). Analogue of
// apps/api/src/modules/scientific-writing/publications/must-preserve-pub.ts
// but adapted to Medical's grounding anchors.
//
// Medical content doesn't use Vancouver numbered citations like
// publications do — it cites regulatory sources directly: "SmPC v2.1
// §4.2", "CSR Table 14.2.1", "Label §3.1". Those references live in
// ClaimsMatrixItem.sourceRef rows attached to the content item. This
// helper enumerates the approved / library-adopted references as the
// "allow-list" for the citation-grounding validator: any NEW source
// reference the AI introduces that isn't in that list trips
// 'invented_citation' → hard retry.
//
// Scope: only approved / library-adopted claims contribute to the allow
// list — 'new' / 'needs_edit' / 'rejected' claims stay excluded so an
// unvetted draft claim can't legitimise an AI-invented citation.

import type { PrismaClient } from '@prisma/client'
import type { AttachedSourceContext } from '../../clinical-writing/documents/ai-validators.js'

const ALLOWED_CLAIM_STATUSES: ReadonlySet<string> = new Set(['approved', 'library_adopted'])

/** Build an AttachedSourceContext for the Medical ai-suggest wrapper.
 *  Pulls ClaimsMatrixItem.sourceRef from approved / library-adopted
 *  claims for the content item, enumerates them as allowedTokens, and
 *  lifts the first word of each sourceRef as a surname fallback (catches
 *  the rare cases where AI emits an author-year citation alongside a
 *  structural ref). Returns an empty context on DB error. */
export async function buildMedContentAttachedContext(
  prisma: PrismaClient,
  contentItemId: string,
): Promise<AttachedSourceContext> {
  try {
    const claims = await prisma.claimsMatrixItem.findMany({
      where:   { contentItemId, approvalStatus: { in: [...ALLOWED_CLAIM_STATUSES] } },
      select:  { sourceRef: true },
      distinct: ['sourceRef'],
    })
    if (claims.length === 0) return { allowedTokens: [], authorSurnames: [] }

    const allowedTokens: string[] = []
    const authorSurnames = new Set<string>()
    for (const c of claims) {
      const ref = (c.sourceRef ?? '').trim()
      if (!ref) continue
      allowedTokens.push(ref)
      const surname = firstWord(ref)
      if (surname) authorSurnames.add(surname)
    }
    return { allowedTokens, authorSurnames: [...authorSurnames] }
  } catch {
    return { allowedTokens: [], authorSurnames: [] }
  }
}

/** First alphabetic word of the ref (e.g. "SmPC v2.1 §4.2" → "SmPC").
 *  Author-year grounding is a rare fallback for Medical content; the
 *  structural-ref allowedTokens list is the primary mechanism. */
function firstWord(ref: string): string | null {
  const m = /^\s*([A-Za-zÀ-ÿ'`-]{2,})/.exec(ref)
  if (!m) return null
  const w = m[1]!
  return w.charAt(0).toUpperCase() + w.slice(1)
}

export const __test__ = { firstWord, ALLOWED_CLAIM_STATUSES }
