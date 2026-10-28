// ai-pass autocheck strategy — tag format `ai-pass:<profile>`.
//
// A profile is a named AI review (e.g. 'consistency', 'terminology',
// 'tone'). The actual AI gateway call is NOT in this file — it would
// burn tokens on every autocheck run. Instead:
//
//   1. The UI (or an R) explicitly fires POST /documents/:id/checklist/
//      autocheck/ai-pass/:profile which calls the AI gateway and stashes
//      the result in AiPassContext (cache keyed by documentId:profile).
//   2. The next autocheck/run reads the cached result and the strategy
//      flips the item to 'completed' iff criticalIssues === 0.
//
// Until the ai-pass endpoint is wired (follow-up slice), the context
// map is empty and the strategy returns 'pending' with a hint telling
// the R to run the AI pass. Items stay pending; the engine never
// claims them without a real result.

import type { StrategyResult } from './content-strategies.js'

export interface AiPassResult {
  /** 0 = clean, > 0 = at least one critical issue found. */
  criticalIssues: number
  /** Human-friendly summary rendered to the UI. */
  summary: string
}

/** Keyed by profile name (lowercase). Empty = no AI pass has been run yet. */
export type AiPassContext = Record<string, AiPassResult | undefined>

export function emptyAiPassContext(): AiPassContext {
  return {}
}

export function evaluateAiPass(
  args: string[],
  context: AiPassContext,
): StrategyResult {
  const profile = (args[0] ?? '').toLowerCase()
  if (!profile) {
    return { kind: 'skipped', reason: 'ai-pass: missing profile name (expected ai-pass:<profile>)' }
  }

  const result = context[profile]
  if (!result) {
    // No AI pass has been run yet for this profile. Keep the item
    // pending with a specific hint — the UI uses this reason to render
    // a "Run AI check" button next to the item.
    return {
      kind: 'pending',
      reason: `ai-pass:${profile}: no result cached — run POST /documents/<id>/checklist/autocheck/ai-pass/${profile} first`,
    }
  }

  if (result.criticalIssues === 0) {
    return {
      kind: 'completed',
      reason: `ai-pass:${profile}: 0 critical issues (${result.summary})`,
    }
  }
  return {
    kind: 'pending',
    reason: `ai-pass:${profile}: ${result.criticalIssues} critical issue(s) — ${result.summary}`,
  }
}
