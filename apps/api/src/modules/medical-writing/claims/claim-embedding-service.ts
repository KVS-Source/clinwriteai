// Phase M-C.7 — pgvector claim similarity (gated).
//
// This module is the opt-in companion to platform/library/text-match.ts
// (Jaccard). When FEATURE_PGVECTOR_CLAIMS=1 AND the pgvector extension
// is installed AND VOYAGE_API_KEY is configured, the claims harvest
// route can prefer embedding-cosine similarity over Jaccard.
//
// The design keeps the Jaccard path intact as a fallback: any failure
// in this module (missing extension, embedding API down, HNSW index
// missing) silently defers to Jaccard, so a half-provisioned env
// can't regress the demo.
//
// Embedding provider: Voyage AI voyage-3 is the default (1024-dim
// natively, requested at 1536 via `output_dimension`). Falls through
// to a deterministic pseudo-embedding when no key is set so dev + CI
// tests see something populated without external calls. The pseudo
// embedding is NOT suitable for production — the flag + key together
// gate the real path.

import type { PrismaClient } from '@prisma/client'

export const EMBEDDING_DIMS = 1536
const VOYAGE_MODEL = 'voyage-3'
const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings'
// The Voyage client fails closed on timeout; the harvest route falls
// back to Jaccard if the embedding call doesn't return in time.
const VOYAGE_TIMEOUT_MS = 15_000

/** Whether the pgvector path is "available" for this process. Checks
 *  the env flag + a best-effort probe of the extension registration.
 *  Cached per-process so the probe only runs once. */
let pgvectorAvailable: boolean | null = null
export async function isPgvectorClaimSearchEnabled(prisma: PrismaClient): Promise<boolean> {
  if (process.env.FEATURE_PGVECTOR_CLAIMS !== '1') return false
  if (pgvectorAvailable !== null) return pgvectorAvailable
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ installed: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS installed`,
    )
    pgvectorAvailable = !!rows[0]?.installed
  } catch {
    pgvectorAvailable = false
  }
  return pgvectorAvailable
}

/** Embed a single piece of text via Voyage. Returns null when the
 *  Voyage key isn't configured so the caller can decide (fall back to
 *  Jaccard, or use the deterministic stub — up to policy). */
export async function embedClaimText(text: string): Promise<number[] | null> {
  const key = process.env.VOYAGE_API_KEY?.trim()
  if (!key) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VOYAGE_TIMEOUT_MS)
  try {
    const res = await fetch(VOYAGE_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model:            VOYAGE_MODEL,
        input:            [text],
        input_type:       'document',
        output_dimension: EMBEDDING_DIMS,
      }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const body = (await res.json()) as { data?: Array<{ embedding?: number[] }> }
    const vec  = body.data?.[0]?.embedding
    return vec && vec.length === EMBEDDING_DIMS ? vec : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Deterministic pseudo-embedding for dev + CI. Buckets each token's
 *  hash into EMBEDDING_DIMS slots then L2-normalises the vector so
 *  cosine is well-defined. Not for production use. */
export function stubEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIMS).fill(0)
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2)
  for (const tok of tokens) {
    let h = 2166136261
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    const slot = (h >>> 0) % EMBEDDING_DIMS
    vec[slot] = (vec[slot] ?? 0) + 1
  }
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < vec.length; i++) vec[i] = (vec[i] ?? 0) / norm
  return vec
}

/** Format a number[] as pgvector's text literal `[v1,v2,...]`. */
export function toPgVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`
}

/** Write (or overwrite) the embedding on a ClaimsMatrixItem row.
 *  No-op when pgvector isn't available; returns false so the caller
 *  can skip the cosine search and go to Jaccard. */
export async function writeClaimEmbedding(
  prisma: PrismaClient,
  claimId: string,
  vec: number[],
): Promise<boolean> {
  if (!(await isPgvectorClaimSearchEnabled(prisma))) return false
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "claims_matrix_items" SET "embedding" = $1::vector WHERE "id" = $2`,
      toPgVectorLiteral(vec),
      claimId,
    )
    return true
  } catch {
    return false
  }
}

export interface PgvectorMatchResult {
  librarySectionId: string | null
  libraryTitle:     string | null
  libraryBody:      string | null
  similarityPct:    number
}

/** Cosine-similarity match against LibrarySection rows for a given
 *  claim embedding. Returns a null-shaped result when nothing scores
 *  above zero, pgvector isn't live, or the query errors. */
export async function bestLibraryMatchPgvector(
  prisma: PrismaClient,
  vec:    number[],
  taTag:  string,
): Promise<PgvectorMatchResult | null> {
  if (!(await isPgvectorClaimSearchEnabled(prisma))) return null
  try {
    const literal = toPgVectorLiteral(vec)
    // Cosine distance = 1 - cosine similarity; convert to a 0..100 pct.
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string; title: string; body: string; distance: number
    }>>(
      `SELECT "id", "title", "body", ("embedding" <=> $1::vector) AS distance
         FROM "library_sections"
        WHERE "category" = 'claim'
          AND "isCurrent" = TRUE
          AND "retiredAt" IS NULL
          AND "taTag" = $2
          AND "embedding" IS NOT NULL
        ORDER BY "embedding" <=> $1::vector
        LIMIT 1`,
      literal,
      taTag,
    )
    const row = rows[0]
    if (!row) return { librarySectionId: null, libraryTitle: null, libraryBody: null, similarityPct: 0 }
    const sim = Math.max(0, Math.min(100, Math.round((1 - row.distance) * 100)))
    return {
      librarySectionId: row.id,
      libraryTitle:     row.title,
      libraryBody:      row.body,
      similarityPct:    sim,
    }
  } catch {
    return null
  }
}
