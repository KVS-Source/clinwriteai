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

/** Rules extracted from the SME prompt that apply to EVERY section —
 *  active voice, cite ICH E6, use British English, etc. Shipped on
 *  every AI call instead of the raw SME prompt dump (migration 95). */
export type CrossCuttingRules = SectionRule[]

export interface ExtractedPromptStructure {
  crossCuttingRules: CrossCuttingRules
  sectionRules:      SectionRulesMap
}

const MAX_OUTPUT_TOKENS       = 4_000
const MAX_RULES_TOTAL         = 80
const MAX_CROSS_CUTTING_RULES = 30
const MAX_TEXT_CHARS          = 2_000
const KEY_RE  = /^[a-zA-Z0-9_.\-§]+$/
const SEVS    = new Set<Severity>(['must', 'should', 'nice'])

function stripJsonFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text.trim())
  return (m ? m[1]! : text).trim()
}

/** Strict JSON parse + shape validation for the richer response shape
 *  (migration 95) carrying BOTH cross-cutting + per-section rules. Any
 *  failure returns { fail: reason }. Backwards-compatible: a response
 *  shaped as just the sectionRules map (legacy) is accepted and treated
 *  as `{ crossCuttingRules: [], sectionRules: <map> }`. */
export function parseExtractResponse(raw: string): { ok: ExtractedPromptStructure } | { fail: string } {
  let parsed: unknown
  try { parsed = JSON.parse(stripJsonFence(raw)) }
  catch (err) { return { fail: `json_parse: ${err instanceof Error ? err.message : String(err)}` } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { fail: 'shape: expected an object' }
  }
  const body = parsed as Record<string, unknown>

  // Legacy bare `sectionRules` map (no crossCuttingRules key) still works.
  const hasRich = 'crossCuttingRules' in body || 'sectionRules' in body
  const sectionRulesRaw = hasRich ? body.sectionRules : body
  const crossRaw        = hasRich ? body.crossCuttingRules : []

  const sectionRules = parseSectionRulesMap(sectionRulesRaw)
  if ('fail' in sectionRules) return sectionRules
  const crossCuttingRules = parseRuleArray(crossRaw, 'crossCuttingRules', MAX_CROSS_CUTTING_RULES)
  if ('fail' in crossCuttingRules) return crossCuttingRules

  return { ok: { crossCuttingRules: crossCuttingRules.ok, sectionRules: sectionRules.ok } }
}

function parseSectionRulesMap(raw: unknown): { ok: SectionRulesMap } | { fail: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { fail: 'shape: sectionRules must be an object keyed by section key' }
  }
  const map = raw as Record<string, unknown>
  const out: SectionRulesMap = {}
  let totalRules = 0
  for (const [key, value] of Object.entries(map)) {
    if (!KEY_RE.test(key)) return { fail: `shape: section key "${key}" is not a safe slug` }
    if (!Array.isArray(value)) return { fail: `shape: "${key}" must be an array` }
    const bucket: SectionRule[] = []
    for (const [i, v] of value.entries()) {
      const rule = parseOneRule(v, `${key}[${i}]`)
      if ('fail' in rule) return rule
      bucket.push(rule.ok)
      totalRules++
      if (totalRules > MAX_RULES_TOTAL) return { fail: `shape: too many rules (${totalRules} > ${MAX_RULES_TOTAL})` }
    }
    if (bucket.length > 0) out[key] = bucket
  }
  return { ok: out }
}

function parseRuleArray(raw: unknown, label: string, max: number): { ok: SectionRule[] } | { fail: string } {
  if (raw === undefined || raw === null) return { ok: [] }
  if (!Array.isArray(raw)) return { fail: `shape: ${label} must be an array` }
  if (raw.length > max)    return { fail: `shape: ${label} exceeds ${max} entries` }
  const out: SectionRule[] = []
  for (const [i, v] of raw.entries()) {
    const rule = parseOneRule(v, `${label}[${i}]`)
    if ('fail' in rule) return rule
    out.push(rule.ok)
  }
  return { ok: out }
}

function parseOneRule(v: unknown, label: string): { ok: SectionRule } | { fail: string } {
  if (!v || typeof v !== 'object') return { fail: `shape: ${label} is not an object` }
  const r = v as Record<string, unknown>
  const severity = typeof r.severity === 'string' ? r.severity.toLowerCase() : ''
  const text     = typeof r.text     === 'string' ? r.text.trim()           : ''
  if (!SEVS.has(severity as Severity)) return { fail: `shape: ${label}.severity must be must/should/nice (got ${JSON.stringify(r.severity)})` }
  if (!text)                           return { fail: `shape: ${label}.text empty` }
  if (text.length > MAX_TEXT_CHARS)    return { fail: `shape: ${label}.text exceeds ${MAX_TEXT_CHARS} chars` }
  return { ok: { severity: severity as Severity, text } }
}

export interface ExtractArgs {
  prisma:    PrismaClient
  docType:   string
  smePrompt: string
  model:     string
  apiKey:    string
}

export async function extractSectionRulesWithClaude(args: ExtractArgs): Promise<ExtractedPromptStructure> {
  if (!args.smePrompt.trim()) throw new Error('empty_sme_prompt')

  const system = [
    `You are a regulatory writing style editor. Read the SME prompt below for a ${args.docType} document and surface its guidance into a strict JSON object with TWO buckets: cross-cutting rules that apply to every section, and per-section rules that apply only to specific sections.`,
    ``,
    `OUTPUT CONTRACT`,
    `Return ONLY a JSON object matching this shape — no prose, no markdown fences:`,
    `{`,
    `  "crossCuttingRules": [`,
    `    { "severity": "must" | "should" | "nice", "text": "<one-sentence rule>" }`,
    `  ],`,
    `  "sectionRules": {`,
    `    "<sectionKey>": [`,
    `      { "severity": "must" | "should" | "nice", "text": "<one-sentence rule>" }`,
    `    ]`,
    `  }`,
    `}`,
    ``,
    `RULES`,
    `1. "crossCuttingRules" carry guidance the writer must apply to EVERY section — voice ("Use active voice"), register ("Write in British English"), citation style ("Cite ICH E6 for GCP claims"), terminology ("Spell out abbreviations on first use"), grounding ("Never invent numeric values"). These used to be inferred by injecting the raw SME prompt into every section call; extracting them once here cuts per-call tokens ~5×.`,
    `2. "sectionRules" carry guidance that applies only to a specific section ("In §6.2 list inclusion criteria as a numbered list"). Keyed by stable slug — prefer the document's own convention (e.g. "s6_2" for ICH E3 §6.2, "3.2.P.3" for CTD Module 3, "synopsis" if the SME prompt calls it that). Underscores + dots + hyphens allowed; no spaces, no §.`,
    `3. "severity": "must" = regulatory / compliance requirement · "should" = strong preference · "nice" = style suggestion.`,
    `4. "text" is one actionable sentence in the imperative ("Use…", "List…", "Lead with…"). <= ${MAX_TEXT_CHARS} chars. Do NOT paraphrase to add detail the source did not include.`,
    `5. A rule that could plausibly fit either bucket belongs in the more SPECIFIC one — prefer sectionRules when the prompt names a section, crossCuttingRules only when the guidance is genuinely universal to the document type.`,
    `6. Empty arrays / empty objects are valid, informative answers. Return "crossCuttingRules": [] + "sectionRules": {} if the SME prompt has no actionable rules at all.`,
    `7. Max ${MAX_CROSS_CUTTING_RULES} cross-cutting rules; max ${MAX_RULES_TOTAL} per-section rules total.`,
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
 *  without an Anthropic key. Matches the richer response shape. */
export function buildStubSectionRules(): ExtractedPromptStructure {
  return {
    crossCuttingRules: [
      { severity: 'must',   text: '[stub] Write in the active voice throughout the document.' },
      { severity: 'must',   text: '[stub] Never invent numeric values, patient counts, dates, or citations.' },
      { severity: 'should', text: '[stub] Prefer British English spelling.' },
    ],
    sectionRules: {
      s6_2: [
        { severity: 'must',   text: '[stub] List inclusion criteria as a numbered list, one criterion per line.' },
        { severity: 'should', text: '[stub] Cross-reference exclusion criteria by number.' },
      ],
      synopsis: [
        { severity: 'must', text: '[stub] Lead with the primary objective in one sentence.' },
      ],
    },
  }
}
