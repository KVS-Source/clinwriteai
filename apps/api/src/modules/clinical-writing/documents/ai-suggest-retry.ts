// AI-suggest retry wrapper (migration 104, Package 7).
//
// Orchestrates one AI section-rewrite call plus (at most) one feedback-
// driven retry when deterministic validators catch a hard failure. Keeps
// the caller (ai-suggest route handler) thin: build the first prompt +
// make the call shape, pass it in, get back the final HTML + accumulated
// flags + a trace of what happened.
//
// Design contract:
//   - First attempt always runs.
//   - Hard validator failures (dropped_cross_ref, invented_citation)
//     trigger one retry. The retry prompt prepends a structured feedback
//     block ("You dropped §4.2.1 and [Smith 2023]; restore each.") then
//     re-runs the same prompt.
//   - Soft validator failures (number_drift, undefined_acronym) are
//     flagged but never retried — most are legitimate paraphrase and
//     chasing them costs tokens for little gain.
//   - Max 1 retry. If attempt 2 still fails, surface the final HTML +
//     final flags to the author.
//   - Pure orchestration — no DB writes, no step-log writes. The caller
//     persists aiConfidence / aiFlags via existing scoreSection util and
//     writes the trace to the step log using the trace[] returned here.

import {
  hasHardFailure,
  renderRetryFeedback,
  runAllValidators,
  type AttachedSourceContext,
  type ValidatorResult,
} from './ai-validators.js'
import type { MustPreserveManifest } from './must-preserve.js'

/** The shape the retry wrapper requires from the caller's AI call site.
 *  Accepts an optional `prependPrompt` so attempt 2 can inject the
 *  structured feedback without the caller having to rebuild the whole
 *  prompt. Return shape is just the generated HTML (the caller already
 *  owns the model / token accounting side). */
export type AiSuggestCall = (args: {
  prependPrompt?: string
  attempt:       1 | 2
}) => Promise<{ html: string }>

export interface RetryTraceEntry {
  attempt:     1 | 2
  flags:       ValidatorResult[]
  retriedBecause?: string             // present on the entry WHOSE outcome triggered a retry
}

export interface RetryResult {
  html:    string                     // the HTML to show / save
  flags:   string[]                   // flag codes (ai-confidence FLAG_WEIGHTS keys) from the FINAL attempt
  retried: boolean
  trace:   RetryTraceEntry[]
}

/** Run attempt 1 → validators → (if hard fail) attempt 2 → validators.
 *  Returns the final HTML + accumulated flags + a trace the caller can
 *  thread into the step log. Pure orchestration. */
export async function callWithValidation(args: {
  call:              AiSuggestCall
  manifestBefore:    MustPreserveManifest
  attachedSources:   AttachedSourceContext
}): Promise<RetryResult> {
  const { call, manifestBefore, attachedSources } = args
  const trace: RetryTraceEntry[] = []

  // Attempt 1.
  const first = await call({ attempt: 1 })
  const firstFlags = runAllValidators({
    before: manifestBefore, afterHtml: first.html, attached: attachedSources,
  })

  if (!hasHardFailure(firstFlags)) {
    trace.push({ attempt: 1, flags: firstFlags })
    return { html: first.html, flags: flagCodes(firstFlags), retried: false, trace }
  }

  // Hard failure → one retry with structured feedback.
  const feedback = renderRetryFeedback(firstFlags)
  const retryReason = summariseHardFailure(firstFlags)
  trace.push({ attempt: 1, flags: firstFlags, retriedBecause: retryReason })

  const second = await call({ prependPrompt: feedback, attempt: 2 })
  const secondFlags = runAllValidators({
    before: manifestBefore, afterHtml: second.html, attached: attachedSources,
  })
  trace.push({ attempt: 2, flags: secondFlags })

  return {
    html:    second.html,
    flags:   flagCodes(secondFlags),
    retried: true,
    trace,
  }
}

function flagCodes(results: readonly ValidatorResult[]): string[] {
  const out = new Set<string>()
  for (const r of results) out.add(r.code)
  return [...out]
}

function summariseHardFailure(results: readonly ValidatorResult[]): string {
  const hard = results.filter(r => r.severity === 'hard')
  if (hard.length === 0) return ''
  const parts: string[] = []
  for (const r of hard) {
    if (r.code === 'dropped_cross_ref') {
      const cN = ((r.details.citations as string[] | undefined) ?? []).length
      const xN = ((r.details.crossRefs  as string[] | undefined) ?? []).length
      const sN = ((r.details.studyIds   as string[] | undefined) ?? []).length
      parts.push(`dropped ${cN + xN + sN} reference(s)`)
    } else if (r.code === 'invented_citation') {
      const n = ((r.details.citations as string[] | undefined) ?? []).length
      parts.push(`invented ${n} citation(s)`)
    }
  }
  return parts.join(', ')
}
