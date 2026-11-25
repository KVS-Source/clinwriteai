// Shared helpers for per-module template distillers (Package B-2,
// migration 105). Module A (Clinical, distill-template.ts) and Module B
// (Scientific Writing, distill-pub-template.ts) both parse an uploaded
// exemplar PDF into:
//
//   1. a structural outline (sections[] with id/number/title)
//   2. per-section formatting rules (85% confidence loop)
//   3. per-section content guidance (instructions + guidance, single-
//      pass with hallucination gate)
//
// The Claude call shapes are module-specific (ICH E3 vs ICMJE / GPP
// framing, output contracts), but everything downstream of the model
// response — parsing, scoring, gating, merging — is identical. That
// shared surface lives here so neither distiller copies regex or merge
// logic that would drift in one and not the other.
//
// Nothing in this module imports the Anthropic SDK. It stays pure so
// the existing distill-template unit tests (and the new pub-distiller
// tests) can import these helpers directly without mocking network IO.

// ────────────────────────────────────────────────────────────────────────
// Structural outline — shared regex + slugify + parser.

/** Section id shape — stable, URL/DB-safe, lowercase.
 *  Also used by the per-section rule response parsers to reject keys
 *  the model made up outside the agreed id space. */
export const ID_RE     = /^[a-zA-Z0-9_.\-§]+$/
export const NUMBER_RE = /^[\p{L}\p{N}.\-§\s]{1,30}$/u                    // digits, dots, letters, § allowed
export const MAX_SECTIONS = 200

export interface ParsedSection {
  id:            string
  number:        string
  title:         string
  usOnly?:       boolean
  // Populated by the format-rule extraction phase (phase 2). Short NL
  // formatting rules the AI drafter + rewriter reference on every call.
  formatRules?:  string
  // Populated by the content-guidance extraction phase (phase 3).
  // Verbatim-or-null — see gateGuidanceString rubric.
  instructions?: string
  guidance?:     string
}

export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'section'
}

export function stripJsonFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text.trim())
  return (m ? m[1]! : text).trim()
}

/** Strict JSON parse + structural validation of a Claude response
 *  describing the section outline. Returns the parsed sections OR a
 *  failure reason the worker surfaces for diagnostics. Pure. */
export function parseSectionsResponse(raw: string): { ok: ParsedSection[] } | { fail: string } {
  const stripped = stripJsonFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    return { fail: `json_parse: ${err instanceof Error ? err.message : String(err)}` }
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { sections?: unknown }).sections)
        ? (parsed as { sections: unknown[] }).sections
        : null)
  if (!arr) return { fail: 'shape: expected an array (or {"sections": [...]})' }
  if (arr.length === 0) return { fail: 'shape: zero sections extracted' }
  if (arr.length > MAX_SECTIONS) return { fail: `shape: too many sections (${arr.length} > ${MAX_SECTIONS})` }

  const out: ParsedSection[] = []
  const seenIds = new Set<string>()
  for (const [i, s] of arr.entries()) {
    if (!s || typeof s !== 'object') return { fail: `shape: section[${i}] is not an object` }
    const sec = s as Record<string, unknown>
    const number = typeof sec.number === 'string' ? sec.number.trim() : ''
    const title  = typeof sec.title  === 'string' ? sec.title.trim()  : ''
    if (!NUMBER_RE.test(number)) return { fail: `shape: section[${i}].number invalid (${JSON.stringify(sec.number)})` }
    if (title.length === 0)      return { fail: `shape: section[${i}].title missing` }
    if (title.length > 300)      return { fail: `shape: section[${i}].title exceeds 300 chars` }
    let id = typeof sec.id === 'string' && ID_RE.test(sec.id) ? sec.id : `s${slugify(number)}_${slugify(title)}`
    while (seenIds.has(id)) id = `${id}_${seenIds.size + 1}`
    seenIds.add(id)
    const usOnly = sec.usOnly === true ? true : undefined
    out.push({ id, number, title, ...(usOnly ? { usOnly: true } : {}) })
  }
  return { ok: out }
}

// ────────────────────────────────────────────────────────────────────────
// Format-rule extraction — rubric + loop-exit + response parser +
// merge helper. Loop driver (which CALLS Claude) stays in each distiller
// because the system prompts differ by module.

export const FORMAT_CONFIDENCE_TARGET = 85
export const FORMAT_MIN_ITERATIONS    = 3
export const FORMAT_MAX_ITERATIONS    = 5

export const FORMAT_FLAG_WEIGHTS: Readonly<Record<string, number>> = {
  'format:too_short':              35,
  'format:missing_font':           25,
  'format:missing_paragraph':      20,
  'format:missing_structure_hint': 20,
}

const FONT_RE       = /\b(font|typeface|times|arial|calibri|helvetica|georgia|verdana|pt\b|point)\b/i
const PARAGRAPH_RE  = /\b(paragraph|line[- ]?height|line[- ]?spacing|alignment|align|justif|indent|margin|space (before|after))\b/i
const STRUCTURE_RE  = /\b(list|bullet|numbered|table|heading|header|footer|reference|cell|row|column)\b/i

/** Score a single section's format rules. Pure — unit-testable. */
export function scoreFormatRules(rules: string): { score: number; flags: string[] } {
  const flags: string[] = []
  const trimmed = rules.trim()
  if (trimmed.length < 40)              flags.push('format:too_short')
  if (!FONT_RE.test(trimmed))           flags.push('format:missing_font')
  if (!PARAGRAPH_RE.test(trimmed))      flags.push('format:missing_paragraph')
  if (!STRUCTURE_RE.test(trimmed))      flags.push('format:missing_structure_hint')
  let penalty = 0
  for (const f of flags) penalty += FORMAT_FLAG_WEIGHTS[f] ?? 15
  return { score: Math.max(0, Math.min(100, 100 - penalty)), flags }
}

/** Decide whether the refine loop should exit. Pure. */
export function shouldStopFormatLoop(
  iteration: number,
  scoresBySection: ReadonlyMap<string, number>,
): boolean {
  if (iteration >= FORMAT_MAX_ITERATIONS) return true
  if (iteration < FORMAT_MIN_ITERATIONS)  return false
  for (const s of scoresBySection.values()) {
    if (s < FORMAT_CONFIDENCE_TARGET) return false
  }
  return true
}

/** Parse the `{<sectionKey>: "<rules>"}` JSON response (also accepts a
 *  `{rules: {...}}` wrapper). Pure. */
export function parseFormatRulesResponse(raw: string): { ok: Record<string, string> } | { fail: string } {
  const stripped = stripJsonFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    return { fail: `json_parse: ${err instanceof Error ? err.message : String(err)}` }
  }
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? ((parsed as { rules?: unknown }).rules ?? parsed)
    : null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { fail: 'shape: expected an object keyed by section id' }
  }
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!ID_RE.test(key)) continue
    if (typeof value !== 'string') continue
    out[key] = value.trim()
  }
  return { ok: out }
}

/** Merge per-section formatRules into the sections array. Pure. */
export function mergeFormatRulesIntoSections(
  sections: ParsedSection[],
  rules:    Record<string, string>,
): { sections: ParsedSection[]; merged: number } {
  let merged = 0
  const out = sections.map(sec => {
    const raw = rules[sec.id]
    const trimmed = raw?.trim() ?? ''
    if (trimmed.length === 0) return sec
    merged += 1
    return { ...sec, formatRules: trimmed }
  })
  return { sections: out, merged }
}

// ────────────────────────────────────────────────────────────────────────
// Content-guidance extraction — hallucination gate + response parser +
// bulk apply + merge helper. See the module-level comment in
// apps/worker/src/jobs/distill-template.ts for why this is a single-pass
// extraction (no refinement loop) + why the gate is strict.

const GUIDANCE_IMPERATIVE_RE    = /\b(cover|include|describe|list|state|provide|summari[sz]e|present|report|detail|discuss|outline|specify|define|address|explain|document)\b/i
const GUIDANCE_GENERIC_HEDGE_RE = /^(this section (should|will|must|is intended|is used|describes|contains)|the purpose of this section|this is the section)/i

export interface ExtractedGuidance {
  instructions: string | null
  guidance:     string | null
}

export interface GuidanceExtractResult {
  byId: Map<string, ExtractedGuidance>
  instructionsExtracted:        number
  guidanceExtracted:            number
  rejectedForHallucinationRisk: number
}

/** Score + gate a single extracted guidance string. Pure. */
export function gateGuidanceString(raw: string | null | undefined): { kept: string | null; rejectedReason: string | null } {
  if (raw === null || raw === undefined) return { kept: null, rejectedReason: null }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { kept: null, rejectedReason: null }
  if (trimmed.length < 30) return { kept: null, rejectedReason: 'guidance:too_short' }
  if (GUIDANCE_GENERIC_HEDGE_RE.test(trimmed)) return { kept: null, rejectedReason: 'guidance:generic_hedge' }
  if (!GUIDANCE_IMPERATIVE_RE.test(trimmed)) return { kept: null, rejectedReason: 'guidance:no_imperative' }
  return { kept: trimmed, rejectedReason: null }
}

/** Parse a `{<sectionId>: {instructions?, guidance?}}` JSON response.
 *  Robust to markdown fences + optional `{sections: {...}}` wrapper. */
export function parseGuidanceResponse(raw: string): { ok: Record<string, ExtractedGuidance> } | { fail: string } {
  const stripped = stripJsonFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch (err) {
    return { fail: `json_parse: ${err instanceof Error ? err.message : String(err)}` }
  }
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? ((parsed as { sections?: unknown }).sections ?? parsed)
    : null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { fail: 'shape: expected an object keyed by section id' }
  }
  const out: Record<string, ExtractedGuidance> = {}
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!ID_RE.test(key)) continue
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const obj = value as Record<string, unknown>
    const instructions = typeof obj.instructions === 'string' ? obj.instructions : null
    const guidance     = typeof obj.guidance     === 'string' ? obj.guidance     : null
    out[key] = { instructions, guidance }
  }
  return { ok: out }
}

/** Bulk apply gate to a Claude-returned guidance map. Pure. */
export function applyGuidanceGate(
  raw: Record<string, ExtractedGuidance>,
): GuidanceExtractResult {
  const byId = new Map<string, ExtractedGuidance>()
  let instructionsExtracted = 0
  let guidanceExtracted = 0
  let rejectedForHallucinationRisk = 0
  for (const [key, value] of Object.entries(raw)) {
    const { kept: ins, rejectedReason: insReason } = gateGuidanceString(value.instructions)
    const { kept: gui, rejectedReason: guiReason } = gateGuidanceString(value.guidance)
    if (insReason) rejectedForHallucinationRisk += 1
    if (guiReason) rejectedForHallucinationRisk += 1
    if (ins) instructionsExtracted += 1
    if (gui) guidanceExtracted += 1
    if (ins || gui) byId.set(key, { instructions: ins, guidance: gui })
  }
  return { byId, instructionsExtracted, guidanceExtracted, rejectedForHallucinationRisk }
}

/** Merge gated guidance into the sections array. Pure. */
export function mergeGuidanceIntoSections(
  sections: ParsedSection[],
  byId: ReadonlyMap<string, ExtractedGuidance>,
): { sections: ParsedSection[]; merged: number } {
  let merged = 0
  const out = sections.map(sec => {
    const found = byId.get(sec.id)
    if (!found || (!found.instructions && !found.guidance)) return sec
    merged += 1
    return {
      ...sec,
      ...(found.instructions ? { instructions: found.instructions } : {}),
      ...(found.guidance     ? { guidance:     found.guidance }     : {}),
    }
  })
  return { sections: out, merged }
}
