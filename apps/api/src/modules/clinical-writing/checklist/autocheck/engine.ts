// Autocheck engine — iterates over the pending checklist items that
// carry an `autoCompleteOn` tag and asks the matching strategy whether
// the item should flip to 'completed'.
//
// Strategies implemented in v1 (see content-strategies.ts):
//   content-min-words         — section wordCount threshold
//   content-no-placeholders   — no [TBD] / [PLACEHOLDER] / [REF] tokens
//
// Strategies declared in docs/roles-and-permissions.md §11.2 but NOT yet
// implemented — the engine returns 'skipped' with a stable reason so the
// UI can hint "automatable later":
//   references-complete
//   ai-pass:<profile>
//   signal:<name>
//
// This module is pure logic. The route handler calls `evaluateItems`
// with pre-fetched sections + items, then persists the flips.

import {
  evaluateContentMinWords,
  evaluateContentNoPlaceholders,
  evaluateReferencesComplete,
  parseAutoCompleteTag,
  type SectionContentForCheck,
  type StrategyResult,
} from './content-strategies.js'
import {
  emptySignalContext,
  evaluateSignal,
  type SignalContext,
} from './signal-strategies.js'
import {
  emptyAiPassContext,
  evaluateAiPass,
  type AiPassContext,
} from './ai-pass-strategy.js'

export type { SignalContext } from './signal-strategies.js'
export { emptySignalContext } from './signal-strategies.js'
export type { AiPassContext, AiPassResult } from './ai-pass-strategy.js'
export { emptyAiPassContext } from './ai-pass-strategy.js'

export interface ItemForAutoCheck {
  id: string
  autoCompleteOn: string | null
  status: 'pending' | 'complete' | 'waived'
}

export interface ItemEvaluation {
  itemId: string
  tag: string
  result: StrategyResult
  /** Convenience shortcut: result.kind === 'completed' */
  shouldComplete: boolean
}

const DEFERRED_STRATEGIES = new Set<string>([
  // All strategies now dispatch — the AI gateway call itself is still
  // deferred (see ai-pass-strategy.ts), but the strategy wiring is live.
])

export function evaluateItems(
  items: ItemForAutoCheck[],
  sections: SectionContentForCheck[],
  signals: SignalContext = emptySignalContext(),
  aiPass: AiPassContext = emptyAiPassContext(),
): ItemEvaluation[] {
  const out: ItemEvaluation[] = []
  for (const item of items) {
    // Only pending items are candidates. Completed and waived rows are
    // terminal; the engine never un-completes them (the R can un-tick
    // manually, which emits a separate checklist.override event — not
    // this path).
    if (item.status !== 'pending') continue
    const parsed = parseAutoCompleteTag(item.autoCompleteOn)
    if (!parsed) continue

    const result = dispatch(parsed.strategy, parsed.args, sections, signals, aiPass)
    out.push({
      itemId: item.id,
      tag: item.autoCompleteOn ?? '',
      result,
      shouldComplete: result.kind === 'completed',
    })
  }
  return out
}

function dispatch(
  strategy: string,
  args: string[],
  sections: SectionContentForCheck[],
  signals: SignalContext,
  aiPass: AiPassContext,
): StrategyResult {
  switch (strategy) {
    case 'content-min-words':        return evaluateContentMinWords(args, sections)
    case 'content-no-placeholders':  return evaluateContentNoPlaceholders(args, sections)
    case 'references-complete':      return evaluateReferencesComplete(args, sections)
    case 'signal':                   return evaluateSignal(args, signals)
    case 'ai-pass':                  return evaluateAiPass(args, aiPass)
    default:
      // Strategies declared in the design but not yet wired return a
      // stable 'skipped' so the UI can distinguish "not yet implemented"
      // from "unknown tag".
      if (DEFERRED_STRATEGIES.has(strategy)) {
        return { kind: 'skipped', reason: `${strategy}: strategy not yet implemented (v1 placeholder)` }
      }
      return { kind: 'skipped', reason: `unknown strategy "${strategy}"` }
  }
}
