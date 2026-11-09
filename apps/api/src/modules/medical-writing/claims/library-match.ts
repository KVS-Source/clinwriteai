// Re-export shim — moved to platform/library/text-match so Ideation
// can share it. Existing Medical Writing imports keep working.
export {
  tokenize,
  jaccardSimilarity,
  bestLibraryMatch,
  type LibraryClaimCandidate,
  type ClaimMatchResult,
} from '../../platform/library/text-match.js'
