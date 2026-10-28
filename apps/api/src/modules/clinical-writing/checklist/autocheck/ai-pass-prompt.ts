// Prompt profiles for the ai-pass autocheck strategy.
//
// Each profile owns:
//   - a short instruction prepended to the sections being reviewed
//   - a parser that converts the model's free-text reply into
//     { criticalIssues: number; summary: string }
//
// The model is instructed to end its reply with a JSON line like:
//   {"criticalIssues":2,"summary":"terminology mismatch in §11.4.1"}
// so parsing is a one-line JSON extraction. If the model doesn't comply,
// parseAiPassResponse returns a safe-fail (criticalIssues=1, summary="…")
// so the checklist item stays pending and the R can retry.

import type { AiPassResult } from './ai-pass-strategy.js'

export interface AiPassProfile {
  name: string
  instruction: string
}

export const AI_PASS_PROFILES: Record<string, AiPassProfile> = {
  consistency: {
    name: 'consistency',
    instruction:
      'You are a clinical writing quality reviewer. Check the following document ' +
      'sections for TERMINOLOGY, NUMERIC, and FACTUAL consistency across sections. ' +
      'Flag only CRITICAL issues (same drug name spelled differently; different ' +
      'subject counts; contradictory conclusions). Ignore stylistic nits.',
  },
  terminology: {
    name: 'terminology',
    instruction:
      'You are a terminology reviewer. Check the following clinical writing for ' +
      'standardized term usage (MedDRA/CDISC vocabulary where applicable). Flag only ' +
      'CRITICAL issues — a non-standard term where the standard one is required.',
  },
  tone: {
    name: 'tone',
    instruction:
      'You are reviewing a clinical document for scientific tone consistency. Flag ' +
      'only sections with CRITICAL tone issues (promotional claims, unqualified ' +
      'statements, informal language). Ignore minor stylistic preferences.',
  },
}

const RESPONSE_FORMAT_INSTRUCTION =
  '\n\nEnd your reply with EXACTLY one JSON line in this format and nothing after it:\n' +
  '{"criticalIssues": <integer>, "summary": "<one-sentence summary>"}\n' +
  'Use 0 for criticalIssues if the section is clean.'

export function buildAiPassPrompt(
  profile: AiPassProfile,
  sections: Array<{ sectionNumber: string; contentHtml: string }>,
): string {
  const header = profile.instruction + RESPONSE_FORMAT_INSTRUCTION
  const body = sections
    .map(s => `### Section ${s.sectionNumber}\n${s.contentHtml}`)
    .join('\n\n')
  return `${header}\n\n---\n\n${body}`
}

/**
 * Parse the model's reply. We look for the final JSON object in the
 * response (greedy — the model sometimes wraps commentary around the
 * required JSON line). On parse failure or missing fields we return a
 * safe-fail with criticalIssues=1 so the checklist stays pending; the
 * R can retry without the engine lying about a clean pass.
 */
export function parseAiPassResponse(responseText: string): AiPassResult {
  const match = responseText.match(/\{[^{}]*"criticalIssues"[^{}]*\}/g)
  const last = match?.[match.length - 1]
  if (!last) {
    return {
      criticalIssues: 1,
      summary: 'parse-fail: no JSON summary in model response',
    }
  }
  try {
    const parsed = JSON.parse(last) as { criticalIssues?: unknown; summary?: unknown }
    const n = Number(parsed.criticalIssues)
    const summary = typeof parsed.summary === 'string' ? parsed.summary : '(no summary)'
    if (!Number.isFinite(n) || n < 0) {
      return { criticalIssues: 1, summary: `parse-fail: criticalIssues not a non-negative integer (${String(parsed.criticalIssues)})` }
    }
    return { criticalIssues: Math.floor(n), summary }
  } catch (err) {
    return {
      criticalIssues: 1,
      summary: `parse-fail: invalid JSON (${err instanceof Error ? err.message : String(err)})`,
    }
  }
}
