// Output-token caps for AI calls, with env-var overrides.
//
// Why these live here:
// - Before this file, each of the 10 drafting + validation workers
//   hard-coded its own cap (2000 | 3000 | 8000, inconsistently) and
//   bumping one required a code deploy. The §4.2 "Reached the length
//   limit" false positive investigation (2026-11-27) surfaced the
//   inconsistency: Clinical had moved to 8000 but the module B/C/D/E
//   workers were still at 2000 for drafts, silently truncating.
// - These are an OPERATOR knob (ops can tune via env), not a tenant
//   knob (no per-tenant setting, no admin UI). See the memory /
//   session notes for the trade-off analysis.
// - Keeping two separate caps (draft vs. critique) in case drafting
//   and validation diverge later — today both default to the same
//   8000. Different env vars so an operator can tune independently.
//
// Env vars:
//   AI_MAX_OUTPUT_TOKENS_DRAFT      — cap for per-section drafting
//                                     (ai-initial-draft + all module
//                                     variants). Default 8000.
//   AI_MAX_OUTPUT_TOKENS_CRITIQUE   — cap for validation-pass critique
//                                     calls. Default 8000.
//
// Guardrails:
// - Must be positive integers; non-numeric / zero / negative values
//   fall back to the default silently (plus a console warning once
//   at module load) so a typo doesn't brick the worker.
// - No upper bound — operators are trusted. Model-specific ceilings
//   are enforced by Anthropic (400 at the API edge if too high).

function envTokenCap(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    // Warn once at module load; don't throw — we'd rather run with
    // the default than fail to start the worker on a typo.
    console.warn(`[token-limits] ${name}="${raw}" is not a positive integer; falling back to ${fallback}`)
    return fallback
  }
  return n
}

export const DRAFT_OUTPUT_TOKENS    = envTokenCap('AI_MAX_OUTPUT_TOKENS_DRAFT',    8000)
export const CRITIQUE_OUTPUT_TOKENS = envTokenCap('AI_MAX_OUTPUT_TOKENS_CRITIQUE', 8000)
