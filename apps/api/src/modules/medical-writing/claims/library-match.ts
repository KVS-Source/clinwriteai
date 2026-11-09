// Text similarity for the Medical Writing claim-harvest flow.
//
// pgvector-based semantic similarity is the goal (see docs/pending-
// cross-module.md X-2). Until then, this file implements token-based
// Jaccard similarity on word sets — deterministic, dependency-free,
// and good enough to find near-duplicate claims that reused the same
// Vancouver-style wording. For paraphrased claims the embedding path
// will win; for exact-reuse detection Jaccard is often tied with it.
//
// Score: |A ∩ B| / |A ∪ B|, rounded to a whole percentage. Empty
// strings return 0. Punctuation + case folded. One-letter tokens
// dropped (noise reduces |A ∪ B| otherwise).
//
// Why pure instead of a library:
//   - zero runtime cost, zero dep surface
//   - swap for pgvector cosine when the extension lands; the function
//     signature stays identical so no caller change

export function tokenize(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue                                // drop empty + single-char noise
    out.add(raw)
  }
  return out
}

export function jaccardSimilarity(a: string, b: string): number {
  const A = tokenize(a)
  const B = tokenize(b)
  if (A.size === 0 || B.size === 0) return 0
  let intersection = 0
  for (const t of A) if (B.has(t)) intersection += 1
  const union = A.size + B.size - intersection
  if (union === 0) return 0
  return Math.round((intersection / union) * 100)
}

export interface LibraryClaimCandidate {
  id:    string
  body:  string
  title: string
}

export interface ClaimMatchResult {
  librarySectionId: string | null
  libraryTitle:     string | null
  libraryBody:      string | null
  similarityPct:    number
}

/**
 * Find the best Master Library match for a claim. Returns null-shaped
 * result when no candidates were supplied.
 */
export function bestLibraryMatch(claimText: string, candidates: ReadonlyArray<LibraryClaimCandidate>): ClaimMatchResult {
  let best: ClaimMatchResult = { librarySectionId: null, libraryTitle: null, libraryBody: null, similarityPct: 0 }
  for (const c of candidates) {
    const sim = jaccardSimilarity(claimText, c.body)
    if (sim > best.similarityPct) {
      best = { librarySectionId: c.id, libraryTitle: c.title, libraryBody: c.body, similarityPct: sim }
    }
  }
  return best
}
