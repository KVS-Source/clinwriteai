// Extract section rules from the SME prompt.
//
// The SME prompt is free-form guidance; most prompts bury per-section
// instructions inside prose ("in Section 6.2 list inclusion criteria as a
// numbered list…"). This helper asks Claude to surface those into the
// strict shape `sectionRules` already uses — keyed by stable section key,
// each value an array of { severity, text }. The caller writes the
// result back onto DocumentTypePolicy.sectionRules (after admin review).
//
// Design mirrors the BP distiller (distill-best-practice.ts) + the claim
// extractor (claims/ai-extract.ts): pure-function parse + strict shape
// validation, AI_ALLOW_STUB=1 fallback for dev/CI. Sync API call —
// response is small enough that a worker job + poll loop would add
// noise without benefit.

import type { PrismaClient } from '@prisma/client'

export type Severity = 'must' | 'should' | 'nice'

export interface SectionRule {
  severity: Severity
  text:     string
}

// Keyed by stable section key (e.g. 's6_2', '3.2.P.3'). Values are the
// rules Claude surfaced for that section.
export type SectionRulesMap = Record<string, SectionRule[]>

const MAX_OUTPUT_TOKENS = 4_000
const MAX_RULES_TOTAL   = 80
const MAX_TEXT_CHARS    = 2_000
const KEY_RE  = /^[a-zA-Z0-9_.\-§]+$/
const SEVS    = new Set<Severity>(['must', 'should', 'nice'])

function stripJsonFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text.trim())
  return (m ? m[1]! : text).trim()
}

/** Strict JSON parse + shape validation. Any failure → { fail: reason }. */
export function parseExtractResponse(raw: string): { ok: SectionRulesMap } | { fail: string } {
  let parsed: unknown
  try { parsed = JSON.parse(stripJsonFence(raw)) }
  catch (err) { return { fail: `json_parse: ${err instanceof Error ? err.message : String(err)}` } }
  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? ('sectionRules' in (parsed as Record<string, unknown>)
        ? (parsed as { sectionRules: unknown }).sectionRules
        : parsed)
    : null
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    return { fail: 'shape: expected an object or { "sectionRules": {...} }' }
  }
  const map = root as Record<string, unknown>
  const out: SectionRulesMap = {}
  let totalRules = 0
  for (const [key, value] of Object.entries(map)) {
    if (!KEY_RE.test(key)) return { fail: `shape: section key "${key}" is not a safe slug` }
    if (!Array.isArray(value)) return { fail: `shape: "${key}" must be an array` }
    const bucket: SectionRule[] = []
    for (const [i, v] of value.entries()) {
      if (!v || typeof v !== 'object') return { fail: `shape: ${key}[${i}] is not an object` }
      const r = v as Record<string, unknown>
      const severity = typeof r.severity === 'string' ? r.severity.toLowerCase() : ''
      const text     = typeof r.text     === 'string' ? r.text.trim()           : ''
      if (!SEVS.has(severity as Severity)) return { fail: `shape: ${key}[${i}].severity must be must/should/nice (got ${JSON.stringify(r.severity)})` }
      if (!text)                           return { fail: `shape: ${key}[${i}].text empty` }
      if (text.length > MAX_TEXT_CHARS)    return { fail: `shape: ${key}[${i}].text exceeds ${MAX_TEXT_CHARS} chars` }
      bucket.push({ severity: severity as Severity, text })
      totalRules++
      if (totalRules > MAX_RULES_TOTAL) return { fail: `shape: too many rules (${totalRules} > ${MAX_RULES_TOTAL})` }
    }
    if (bucket.length > 0) out[key] = bucket
  }
  return { ok: out }
}

export interface ExtractArgs {
  prisma:    PrismaClient
  docType:   string
  smePrompt: string
  model:     string
  apiKey:    string
}

export async function extractSectionRulesWithClaude(args: ExtractArgs): Promise<SectionRulesMap> {
  if (!args.smePrompt.trim()) throw new Error('empty_sme_prompt')

  const system = [
    `You are a regulatory writing style editor. Read the SME prompt below for a ${args.docType} document and surface every per-section instruction into a strict JSON object.`,
    ``,
    `OUTPUT CONTRACT`,
    `Return ONLY a JSON object matching this shape — no prose, no markdown fences:`,
    `{`,
    `  "sectionRules": {`,
    `    "<sectionKey>": [`,
    `      { "severity": "must" | "should" | "nice", "text": "<one-sentence rule>" }`,
    `    ]`,
    `  }`,
    `}`,
    ``,
    `RULES`,
    `1. "sectionKey" is a stable slug for the section the rule applies to — infer from how the SME prompt names it. Prefer the document's own convention (e.g. "s6_2" for ICH E3 §6.2, "3.2.P.3" for CTD Module 3, "synopsis" if the SME prompt calls it that). Underscores + dots + hyphens allowed; no spaces, no §.`,
    `2. "severity":`,
    `   - "must"   = regulatory / compliance requirement`,
    `   - "should" = strong preference`,
    `   - "nice"   = style suggestion`,
    `3. "text" is one actionable sentence in the imperative ("Use…", "List…", "Lead with…"). <= ${MAX_TEXT_CHARS} chars. Do NOT paraphrase to add detail the source did not include.`,
    `4. Extract ONLY per-section guidance. Rules that apply to the whole document stay implicit — do NOT invent section keys for them.`,
    `5. Return "sectionRules": {} if the SME prompt has no per-section guidance. An empty result is a valid, informative answer.`,
    `6. Maximum ${MAX_RULES_TOTAL} rules total across all sections.`,
  ].join('\n')

  const userPrompt = [
    `SME prompt for ${args.docType}:`,
    ``,
    args.smePrompt.trim(),
    ``,
    `Return the JSON object only.`,
  ].join('\n')

  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY set but @anthropic-ai/sdk is not installed in apps/api.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })
  const message = await client.messages.create({
    model:      args.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
  })

  const text = message.content
    .map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : ''))
    .join('\n')
    .trim()
  if (!text) throw new Error('claude_empty_response')
  const parsed = parseExtractResponse(text)
  if ('fail' in parsed) throw new Error(`extract_output_${parsed.fail}`)
  return parsed.ok
}

/** Dev/CI fallback — deterministic sample so admins can exercise the UI
 *  without an Anthropic key. Matches the shape of a real response. */
export function buildStubSectionRules(): SectionRulesMap {
  return {
    s6_2: [
      { severity: 'must',   text: '[stub] List inclusion criteria as a numbered list, one criterion per line.' },
      { severity: 'should', text: '[stub] Cross-reference exclusion criteria by number.' },
    ],
    synopsis: [
      { severity: 'must', text: '[stub] Lead with the primary objective in one sentence.' },
    ],
  }
}
