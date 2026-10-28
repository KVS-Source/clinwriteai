// Process-local cache for AI pass results.
//
// Why in-process (not DB): the autocheck engine only needs the most
// recent result per (document, profile, version). When the doc's
// currentVersionId changes (new version saved), the key changes and
// the stale entry falls out naturally. On process restart the cache
// clears and the next autocheck run will show the profile as
// 'pending' until the R re-fires the AI pass — safe default.
//
// Clustered deployments would want a Redis-backed cache to survive
// restarts and share across instances. That's a Chunk 3 refinement;
// the interface stays the same (get/put by key).

import type { AiPassResult } from './ai-pass-strategy.js'

const cache = new Map<string, AiPassResult>()

function key(documentId: string, profile: string, versionId: string | null): string {
  return `${documentId}:${profile.toLowerCase()}:${versionId ?? ''}`
}

export function putAiPassResult(
  documentId: string,
  profile: string,
  versionId: string | null,
  result: AiPassResult,
): void {
  cache.set(key(documentId, profile, versionId), result)
}

export function getAiPassResult(
  documentId: string,
  profile: string,
  versionId: string | null,
): AiPassResult | undefined {
  return cache.get(key(documentId, profile, versionId))
}

/**
 * Scan the cache for every profile result cached for this
 * (document, versionId) pair. Used by the autocheck/run endpoint to
 * populate the AiPassContext passed to the engine.
 */
export function getAllAiPassResultsForDocument(
  documentId: string,
  versionId: string | null,
): Record<string, AiPassResult> {
  const prefix = `${documentId}:`
  const suffix = `:${versionId ?? ''}`
  const out: Record<string, AiPassResult> = {}
  for (const [k, v] of cache.entries()) {
    if (!k.startsWith(prefix) || !k.endsWith(suffix)) continue
    // Extract profile name = middle segment
    const profile = k.slice(prefix.length, k.length - suffix.length)
    out[profile] = v
  }
  return out
}

/** Test helper — clears the module-local cache. */
export function _resetAiPassCache(): void {
  cache.clear()
}
