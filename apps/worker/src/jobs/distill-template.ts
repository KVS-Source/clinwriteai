// Template-parser worker.
//
// Scope: admin uploads a PDF of a completed / exemplar document (CSR,
// Protocol, IB, ...); this job extracts its structural outline into the
// DocumentTemplate.sections JSON so the New Document wizard can offer
// that section skeleton + the AI drafter knows what to fill in. One-
// time cost per uploaded exemplar, same way bestPracticeDigest works
// for the DocumentTypePolicy.
//
// Pipeline:
//   1. Load the pending DocumentTemplate row (status='parsing') and
//      prove it still exists.
//   2. Load the DocumentUpload row + fetch the blob (BlobReader).
//   3. Hand the PDF to Claude with a strict-JSON system prompt.
//   4. Parse + validate (shape: [{id, number, title, usOnly?}]). Any
//      failure → stamp status='parse_failed' + reason, leave sections
//      empty, return a Report.
//   5. On success: update the DocumentTemplate row with sections,
//      status='ready', parsedAt.
//
// Observability: API audits `document_template.parse_enqueued` at
// enqueue time. Worker doesn't audit directly — audit chain is raw
// SQL, API-only. Outcome signals: pino log + the Report return + the
// template row's sections populating.
//
// Idempotency: `jobId=template-parse-${templateId}-${uploadId}` so
// BullMQ dedupes retries.

import { createBlobReaderFromEnv } from '../blob-reader.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import type { JobHandler } from './types.js'

interface DistillTemplatePayload {
  templateId: string
  uploadId:   string
  actorId:    string
}

interface ParsedSection {
  id:           string     // stable key — safe id, slugified from number if the model doesn't supply one
  number:       string     // '1', '1.1', '§6.2', …
  title:        string
  usOnly?:      boolean    // some sections are US-only (ICH E3 §16.4)
  // Per-section NL formatting rules — populated by the format-extraction
  // phase that runs after structural extraction. Written back into
  // DocumentTemplate.sections[] so the template is the single source of
  // truth (migration 94 retired the standalone SectionTemplate entity).
  formatRules?: string
  // Per-section content guidance — "what this section must cover" +
  // "how to write it". Populated by the guidance-extraction phase that
  // runs after formatRules. Strict verbatim extraction only; null when
  // the template provides no explicit guidance (no synthesis, no
  // paraphrasing — authors see what the template says, not what the
  // model would write).
  instructions?: string
  guidance?:     string
}

interface Report {
  status:        'ok' | 'failed'
  reason?:       string
  sectionsIn?:   number
  // Format-rule extraction breadcrumbs — absent when the phase is
  // skipped (AI not configured, no sections, etc.).
  formatRules?: {
    extracted:   number           // sections that got a non-empty rule block
    merged:      number           // sections written back into the template
    iterations:  number           // passes run through the 85% loop
    belowTarget: number           // sections still below 85 after the final pass
  }
  // Content-guidance extraction breadcrumbs — absent when skipped
  // (AI not configured, no sections). Single-pass, no refinement loop:
  // guidance is verbatim-or-nothing, so refinement would invite drift.
  guidance?: {
    instructionsExtracted: number // sections with a non-null `instructions` after gate
    guidanceExtracted:     number // sections with a non-null `guidance` after gate
    merged:                number // sections written back into the template
    rejectedForHallucinationRisk: number // sections where the gate nulled extracted strings
  }
}

const MAX_OUTPUT_TOKENS = 6_000      // ~150 sections at ~35 tokens each + JSON overhead
const MAX_SECTIONS      = 200

// ────────────────────────────────────────────────────────────────────────
// Format-rule extraction (M-F.2, migration 91).
//
// Second AI phase that runs after structural extraction succeeds. For
// every extracted section, Claude reads the PDF and produces a short
// natural-language block describing how that section is formatted in
// the exemplar (font, paragraph, list/table defaults, references).
// Each refined block lands as a draft SectionTemplate row that the
// admin reviews + approves on the Section Templates admin tab.
//
// Loop mirrors the drafter's 85% confidence rubric:
//   - MIN_ITERATIONS = 3 (always refine at least twice after the
//     initial extraction, even when scores already clear the target)
//   - MAX_ITERATIONS = 5 (hard stop so a perpetually-unsatisfied
//     ruleset doesn't spin forever)
//   - CONFIDENCE_TARGET = 85 (stops iterating once ALL sections clear
//     this score AND MIN_ITERATIONS has been reached)
//
// Scoring rubric (pure, inline — same flavour as ai-validation-pass):
//   flag                               weight   trigger
//   format:too_short                   35       rules < 40 chars
//   format:missing_font                25       no font/size/typeface mention
//   format:missing_paragraph           20       no paragraph/line/align/indent
//   format:missing_structure_hint      20       no list/table/heading mention
// Max penalty = 100 → bottoms at 0. A 4-axis ruleset ≥40 chars scores 100.

const MAX_FORMAT_OUTPUT_TOKENS = 8_000                // ~50 sections × ~150 tokens of rules each
const FORMAT_CONFIDENCE_TARGET = 85
const FORMAT_MIN_ITERATIONS    = 3
const FORMAT_MAX_ITERATIONS    = 5

const FORMAT_FLAG_WEIGHTS: Readonly<Record<string, number>> = {
  'format:too_short':              35,
  'format:missing_font':           25,
  'format:missing_paragraph':      20,
  'format:missing_structure_hint': 20,
}

const FONT_RE       = /\b(font|typeface|times|arial|calibri|helvetica|georgia|verdana|pt\b|point)\b/i
const PARAGRAPH_RE  = /\b(paragraph|line[- ]?height|line[- ]?spacing|alignment|align|justif|indent|margin|space (before|after))\b/i
const STRUCTURE_RE  = /\b(list|bullet|numbered|table|heading|header|footer|reference|cell|row|column)\b/i

/** Score a single section's format rules. Returns 0–100 and the flags
 *  that fired (empty array = perfect score). Pure — unit-testable. */
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

/** Decide whether the loop can exit — all sections at or above target
 *  AND the minimum-iteration floor has been reached. Pure. */
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

const ID_RE     = /^[a-zA-Z0-9_.\-§]+$/
const NUMBER_RE = /^[\p{L}\p{N}.\-§\s]{1,30}$/u                    // digits, dots, letters, § allowed

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'section'
}

/** Strict JSON parse + structural validation. */
function parseSectionsResponse(raw: string): { ok: ParsedSection[] } | { fail: string } {
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
    // id: use the model's if valid + unique; else derive from (number, slugified title).
    let id = typeof sec.id === 'string' && ID_RE.test(sec.id) ? sec.id : `s${slugify(number)}_${slugify(title)}`
    while (seenIds.has(id)) id = `${id}_${seenIds.size + 1}`
    seenIds.add(id)
    const usOnly = sec.usOnly === true ? true : undefined
    out.push({ id, number, title, ...(usOnly ? { usOnly: true } : {}) })
  }
  return { ok: out }
}

function stripJsonFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text.trim())
  return (m ? m[1]! : text).trim()
}

/** Dev/CI only: AI_ALLOW_STUB=1 → synthetic 3-section outline so the
 *  pipeline is exercisable without an Anthropic key. */
function stubAllowed(): boolean {
  return process.env.AI_ALLOW_STUB === '1'
}

function buildStubSections(): ParsedSection[] {
  return [
    { id: 's1',   number: '1',   title: '[stub] Title Page' },
    { id: 's2',   number: '2',   title: '[stub] Synopsis' },
    { id: 's16_1', number: '16.1', title: '[stub] Study Information' },
  ]
}

async function parseWithClaude(args: {
  pdfBytes: Buffer
  model:    string
  apiKey:   string
  docType:  string
  framework: string | null
}): Promise<ParsedSection[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })

  const system = [
    `You are a regulatory writing template extractor. Read the attached document and extract its structural outline — the section number + title hierarchy — into a strict JSON array.`,
    ``,
    `CONTEXT`,
    `Document type: ${args.docType}.`,
    args.framework ? `Framework: ${args.framework}.` : `Framework: unspecified; infer from the headings.`,
    ``,
    `OUTPUT CONTRACT`,
    `Return ONLY a JSON object matching this shape — no prose, no markdown fences:`,
    `{`,
    `  "sections": [`,
    `    { "id": "<stable-slug>", "number": "<section number>", "title": "<section title>", "usOnly": <true|false (optional)> }`,
    `  ]`,
    `}`,
    ``,
    `RULES`,
    `1. "number" is the heading's label verbatim ("1", "2.1", "§6.2", "16.4", …). Keep the document's own numbering convention.`,
    `2. "title" is the heading's text (≤ 300 chars). Strip trailing periods but keep acronyms + punctuation inside the title.`,
    `3. "id" is a stable, lowercase, snake-case slug you produce — safe for a URL/DB key. Use the number when possible (e.g. "s6_2" for §6.2). Must be unique across the array.`,
    `4. "usOnly" true ONLY for sections that are explicitly US-only (e.g. ICH E3 §16.4 case report forms). Omit otherwise.`,
    `5. Extract ONLY headings that structure the document. Do NOT extract table titles, figure captions, or appendix contents as top-level sections.`,
    `6. Keep the order in which sections appear in the document.`,
    `7. Maximum ${MAX_SECTIONS} sections. Do not invent sections not in the document.`,
  ].join('\n')

  const userPrompt =
    `Extract the section outline from the attached ${args.docType} document. Return the JSON object only.`

  const message = await client.messages.create({
    model:      args.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document' as const,
            source: {
              type:       'base64' as const,
              media_type: 'application/pdf' as const,
              data:       args.pdfBytes.toString('base64'),
            },
          },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  })

  const text = message.content
    .map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : ''))
    .join('\n')
    .trim()
  if (!text) throw new Error('Claude returned no text content')

  const parsed = parseSectionsResponse(text)
  if ('fail' in parsed) {
    throw new Error(`template_output_${parsed.fail}`)
  }
  return parsed.ok
}

// ────────────────────────────────────────────────────────────────────────
// Format-rule extraction — Claude calls (initial + refine) + loop glue.

/** Parse a `{<sectionKey>: "<rules>"}` JSON response. Robust against
 *  stray markdown fences + accepts either the bare object or a
 *  `{ rules: {...} }` wrapper. */
function parseFormatRulesResponse(raw: string): { ok: Record<string, string> } | { fail: string } {
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
    if (!ID_RE.test(key)) continue                                   // ignore unexpected keys
    if (typeof value !== 'string') continue
    out[key] = value.trim()
  }
  return { ok: out }
}

/** Initial Claude pass — the whole PDF + the section outline in, one
 *  `{<sectionKey>: "<rules>"}` object out. */
async function extractFormatRulesWithClaude(args: {
  pdfBytes:  Buffer
  sections:  ParsedSection[]
  model:     string
  apiKey:    string
  docType:   string
  framework: string | null
}): Promise<Record<string, string>> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })
  const sectionList = args.sections.map(s => `  - id=${s.id}  number=${s.number}  title=${JSON.stringify(s.title)}`).join('\n')
  const system = [
    `You are a regulatory writing template extractor. Read the attached exemplar document and describe how each section is FORMATTED — not what it says, but how it is styled (font, paragraph, list, table, references).`,
    ``,
    `CONTEXT`,
    `Document type: ${args.docType}.`,
    args.framework ? `Framework: ${args.framework}.` : `Framework: unspecified.`,
    ``,
    `SECTIONS (use these ids as JSON keys; keep the ids verbatim):`,
    sectionList,
    ``,
    `OUTPUT CONTRACT`,
    `Return ONLY a JSON object matching this shape — no prose, no markdown fences:`,
    `{`,
    `  "rules": {`,
    `    "<section id>": "<short natural-language formatting rules, one rule per line>"`,
    `  }`,
    `}`,
    ``,
    `RULES`,
    `1. Write short, concrete rules the AI should follow when drafting/rewriting this section. One rule per line is easiest to read.`,
    `2. Cover (when visible in the exemplar) font (family, size, color), paragraph (alignment, line-height, indent, space), list / numbering style, table defaults (borders, header row, cell padding), and reference / citation style.`,
    `3. Do NOT describe the content of the section — only its formatting.`,
    `4. Use the SAME id for the key as the id supplied above. Do not invent new ids. Omit a section if the exemplar provides no formatting signal for it (don't guess).`,
    `5. Keep each section's rules short — prefer 3–8 lines of concrete rules over long prose. Every character is tokens injected into every AI rewrite call later.`,
  ].join('\n')
  const userPrompt = `Extract the per-section formatting rules from the attached ${args.docType} document. Return the JSON object only.`
  const message = await client.messages.create({
    model:      args.model,
    max_tokens: MAX_FORMAT_OUTPUT_TOKENS,
    system,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document' as const,
            source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: args.pdfBytes.toString('base64') },
          },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  })
  const text = message.content
    .map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : ''))
    .join('\n')
    .trim()
  if (!text) throw new Error('Claude returned no text content (format extract)')
  const parsed = parseFormatRulesResponse(text)
  if ('fail' in parsed) throw new Error(`format_output_${parsed.fail}`)
  return parsed.ok
}

/** Refine pass — given the current rules + the sections that scored
 *  below target (with their failing flags), ask Claude to rewrite only
 *  those sections. Returns a partial map; caller merges it over the
 *  current rules. Uses the SAME PDF attachment so the model can re-ground. */
async function refineFormatRulesWithClaude(args: {
  pdfBytes:  Buffer
  sections:  ParsedSection[]
  model:     string
  apiKey:    string
  docType:   string
  current:   Record<string, string>
  weakEntries: Array<{ sectionId: string; flags: string[]; currentRules: string }>
}): Promise<Record<string, string>> {
  if (args.weakEntries.length === 0) return {}
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })
  const sectionLookup = new Map(args.sections.map(s => [s.id, s]))
  const issuesBlock = args.weakEntries.map(w => {
    const sec = sectionLookup.get(w.sectionId)
    const title = sec ? `${sec.number} — ${sec.title}` : w.sectionId
    const flagList = w.flags.length > 0 ? w.flags.join(', ') : '(no flags — just weak)'
    const current = w.currentRules.trim() || '(empty)'
    return `  * id=${w.sectionId}  title="${title}"  issues=${flagList}\n    current:\n      ${current.replace(/\n/g, '\n      ')}`
  }).join('\n\n')
  const system = [
    `You already produced per-section formatting rules for this exemplar. Several sections scored below our quality bar. Rewrite ONLY those sections, re-reading the attached document for the formatting details the first pass missed.`,
    ``,
    `QUALITY BAR`,
    `A good section-rule block covers (where visible in the exemplar): font, paragraph, list / table structure, and references. 3–8 concrete lines. No prose about what the section says — only how it is formatted.`,
    ``,
    `SECTIONS NEEDING REWRITE`,
    issuesBlock,
    ``,
    `OUTPUT CONTRACT`,
    `Return ONLY a JSON object matching this shape — no prose, no markdown fences:`,
    `{`,
    `  "rules": {`,
    `    "<section id>": "<rewritten rules — short, concrete, one rule per line>"`,
    `  }`,
    `}`,
    `Include ONLY the ids listed above. Keep the ids verbatim.`,
  ].join('\n')
  const userPrompt = `Rewrite the weak sections listed above by re-reading the attached ${args.docType} document. Return the JSON object only.`
  const message = await client.messages.create({
    model:      args.model,
    max_tokens: MAX_FORMAT_OUTPUT_TOKENS,
    system,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document' as const,
            source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: args.pdfBytes.toString('base64') },
          },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  })
  const text = message.content
    .map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : ''))
    .join('\n')
    .trim()
  if (!text) throw new Error('Claude returned no text content (format refine)')
  const parsed = parseFormatRulesResponse(text)
  if ('fail' in parsed) throw new Error(`format_refine_${parsed.fail}`)
  // Ignore any keys the model added that weren't in the weak list.
  const allowed = new Set(args.weakEntries.map(w => w.sectionId))
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed.ok)) {
    if (allowed.has(k)) out[k] = v
  }
  return out
}

interface FormatLoopResult {
  rules:        Record<string, string>
  scores:       Record<string, number>
  iterations:   number
  belowTarget:  number
}

/** 85% confidence loop for per-section NL format rules. Runs the
 *  initial extractor, scores each section, and refines sections below
 *  target in successive passes. Returns the final rules + scores +
 *  iteration count so the caller can audit the run. */
async function runFormatValidationLoop(args: {
  pdfBytes:  Buffer
  sections:  ParsedSection[]
  model:     string
  apiKey:    string
  docType:   string
  framework: string | null
  log:       { info(obj: object, msg: string): void }
}): Promise<FormatLoopResult> {
  // Pass 1 — initial extraction over every section.
  let rules = await extractFormatRulesWithClaude({
    pdfBytes: args.pdfBytes, sections: args.sections,
    model: args.model, apiKey: args.apiKey, docType: args.docType, framework: args.framework,
  })

  // Score + record.
  const scoresBySection = new Map<string, number>()
  const flagsBySection  = new Map<string, string[]>()
  const applyScores = () => {
    scoresBySection.clear()
    flagsBySection.clear()
    for (const sec of args.sections) {
      const body = rules[sec.id] ?? ''
      const { score, flags } = scoreFormatRules(body)
      scoresBySection.set(sec.id, score)
      flagsBySection.set(sec.id, flags)
    }
  }
  applyScores()
  let iteration = 1
  args.log.info({ iteration, sections: scoresBySection.size }, 'template format: initial pass scored')

  // Refine passes until target OR MAX.
  while (!shouldStopFormatLoop(iteration, scoresBySection)) {
    iteration += 1
    const weak: Array<{ sectionId: string; flags: string[]; currentRules: string }> = []
    for (const sec of args.sections) {
      const score = scoresBySection.get(sec.id) ?? 0
      if (score < FORMAT_CONFIDENCE_TARGET) {
        weak.push({
          sectionId:    sec.id,
          flags:        flagsBySection.get(sec.id) ?? [],
          currentRules: rules[sec.id] ?? '',
        })
      }
    }
    // Floor passes (MIN_ITERATIONS when everything already passes) —
    // re-run the whole set so the AI can polish-pass rules that are
    // already above target, not skip the iteration entirely.
    if (weak.length === 0) {
      for (const sec of args.sections) {
        weak.push({ sectionId: sec.id, flags: [], currentRules: rules[sec.id] ?? '' })
      }
    }
    const refined = await refineFormatRulesWithClaude({
      pdfBytes: args.pdfBytes, sections: args.sections, model: args.model, apiKey: args.apiKey,
      docType: args.docType, current: rules, weakEntries: weak,
    })
    rules = { ...rules, ...refined }
    applyScores()
    args.log.info({ iteration, refined: Object.keys(refined).length }, 'template format: refine pass scored')
  }

  const scores: Record<string, number> = {}
  let belowTarget = 0
  for (const [k, v] of scoresBySection) {
    scores[k] = v
    if (v < FORMAT_CONFIDENCE_TARGET) belowTarget += 1
  }
  return { rules, scores, iterations: iteration, belowTarget }
}

/** Merge per-section formatRules into the DocumentTemplate.sections[]
 *  JSON — the single source of truth after migration 94. Returns the
 *  merged sections[] (caller persists it with the structural update).
 *  Sections without extracted rules are left as-is (no `formatRules` key
 *  rather than an empty string, so the shape stays clean). */
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
// Content-guidance extraction (migration 104, Package 2).
//
// Third AI phase. Where formatRules describe HOW a section looks,
// instructions describe WHAT a section must cover, and guidance
// describes HOW to write it (tone, style, framing). These are the
// template's content-steering NL the drafter + rewrite paths previously
// ignored (the schema declared the fields but the parser never touched
// them).
//
// Design choice — SINGLE pass, verbatim-or-null, NO refinement loop.
// Refinement invites hallucination here: if the template doesn't
// contain explicit per-section guidance ("Purpose:", "Scope:",
// "Instructions:"), a refinement prompt pressures the model to
// invent plausible-sounding guidance that was never in the template.
// Users would then see fabricated regulatory instructions attributed
// to their template. Instead: strict system prompt + post-filter gate
// that nulls out anything that looks synthesised or too short.
//
// Gate rubric (nulls out the extracted string on any flag):
//   flag                                  trigger
//   guidance:too_short                    < 30 chars after trim
//   guidance:generic_hedge                starts with "This section should" or
//                                         similar hedging without concrete content
//   guidance:no_imperative                no verb from the whitelist
//                                         (covers synthesis cases)

const GUIDANCE_MAX_OUTPUT_TOKENS = 6_000   // ~80 sections × ~75 tokens avg

const GUIDANCE_IMPERATIVE_RE = /\b(cover|include|describe|list|state|provide|summari[sz]e|present|report|detail|discuss|outline|specify|define|address|explain|document)\b/i
const GUIDANCE_GENERIC_HEDGE_RE = /^(this section (should|will|must|is intended|is used|describes|contains)|the purpose of this section|this is the section)/i

interface ExtractedGuidance {
  instructions: string | null
  guidance:     string | null
}

/** Score + gate an extracted guidance string. Returns the cleaned
 *  string, or null if the gate rejects it. Pure — unit-testable. */
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
 *  Robust against stray markdown fences + the `{ sections: {...} }` wrapper. */
function parseGuidanceResponse(raw: string): { ok: Record<string, ExtractedGuidance> } | { fail: string } {
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

/** Claude call — single pass, strict verbatim prompting. The gate (above)
 *  nulls out anything that looks synthesised; we rely on that + the
 *  prompt to keep hallucinations out. No refinement loop. */
async function extractGuidanceWithClaude(args: {
  pdfBytes:  Buffer
  sections:  ParsedSection[]
  model:     string
  apiKey:    string
  docType:   string
  framework: string | null
}): Promise<Record<string, ExtractedGuidance>> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })
  const sectionList = args.sections.map(s => `  - id=${s.id}  number=${s.number}  title=${JSON.stringify(s.title)}`).join('\n')
  const system = [
    `You are a regulatory writing template extractor. Your job is to extract per-section writing INSTRUCTIONS and GUIDANCE from a template document — VERBATIM.`,
    ``,
    `CONTEXT`,
    `Document type: ${args.docType}.`,
    args.framework ? `Framework: ${args.framework}.` : `Framework: unspecified.`,
    ``,
    `SECTIONS (use these ids as JSON keys; keep the ids verbatim):`,
    sectionList,
    ``,
    `WHAT YOU ARE EXTRACTING`,
    `- "instructions" = what this section must COVER. Content requirements.`,
    `  Typical template labels: "Purpose:", "Scope:", "Intent:", "Content:",`,
    `  "Instructions:", "This section shall include:", bulleted "must include" lists.`,
    `- "guidance" = HOW to write it. Style, tone, framing, cautions.`,
    `  Typical template labels: "Guidance:", "Note:", "Tip:", "Style notes:",`,
    `  italicised commentary separate from the body text.`,
    ``,
    `CRITICAL RULES — ZERO HALLUCINATION`,
    `1. Extract ONLY text that appears LITERALLY in the template document. Do NOT synthesise. Do NOT paraphrase. Do NOT infer what a section "should" cover based on your training data.`,
    `2. If a section has NO explicit instructions, return "instructions": null. Same for guidance. Returning null is the CORRECT answer for the majority of sections — templates rarely annotate every section.`,
    `3. If you are tempted to write "This section should describe X" when the template doesn't literally say that — STOP. Return null.`,
    `4. Verbatim extraction may be lightly cleaned: strip bullet markers, join wrapped lines, remove template placeholders like "[insert X]". Do not reword.`,
    `5. If instructions + guidance are mixed in a single block in the template, split them by their semantic role (content requirements → instructions; style/tone → guidance). If they can't be split cleanly, put the whole block in "instructions" and set "guidance" to null.`,
    ``,
    `OUTPUT CONTRACT`,
    `Return ONLY a JSON object matching this shape — no prose, no markdown fences:`,
    `{`,
    `  "sections": {`,
    `    "<section id>": {`,
    `      "instructions": "<verbatim text from template, or null>",`,
    `      "guidance":     "<verbatim text from template, or null>"`,
    `    }`,
    `  }`,
    `}`,
    `Include ONLY ids listed above. Keep ids verbatim. Omit sections you have no guidance for (or set both fields to null).`,
  ].join('\n')
  const userPrompt = `Extract per-section instructions and guidance from the attached ${args.docType} template. Remember: null is the correct answer when the template does not explicitly annotate a section. Return the JSON object only.`
  const message = await client.messages.create({
    model:      args.model,
    max_tokens: GUIDANCE_MAX_OUTPUT_TOKENS,
    system,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document' as const,
            source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: args.pdfBytes.toString('base64') },
          },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  })
  const text = message.content
    .map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : ''))
    .join('\n')
    .trim()
  if (!text) throw new Error('Claude returned no text content (guidance extract)')
  const parsed = parseGuidanceResponse(text)
  if ('fail' in parsed) throw new Error(`guidance_output_${parsed.fail}`)
  return parsed.ok
}

interface GuidanceExtractResult {
  byId: Map<string, ExtractedGuidance>
  instructionsExtracted: number
  guidanceExtracted:     number
  rejectedForHallucinationRisk: number
}

/** Run the guidance extraction + apply the gate. Pure given the Claude
 *  output (callers test with the parsed response). */
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

/** Merge gated guidance into the DocumentTemplate.sections[] JSON.
 *  Returns the merged sections[] + a count of sections written to.
 *  Pure — unit-testable. */
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

export const handleDistillTemplate: JobHandler<DistillTemplatePayload, Report> = async (job, { prisma, log }) => {
  const { templateId, uploadId, actorId } = job.data

  // 1. Template must still exist + be in 'parsing' status.
  const template = await prisma.documentTemplate.findUnique({ where: { id: templateId } })
  if (!template) {
    log.warn({ templateId }, 'template parse: template not found — abort')
    return { status: 'failed', reason: 'template_not_found' }
  }

  // 2. Upload must exist + be PDF.
  const upload = await prisma.documentUpload.findUnique({ where: { id: uploadId } })
  if (!upload) {
    log.warn({ uploadId }, 'template parse: upload not found — abort')
    return { status: 'failed', reason: 'upload_not_found' }
  }
  if ((upload.contentType ?? '').toLowerCase() !== 'application/pdf') {
    log.warn({ uploadId, contentType: upload.contentType }, 'template parse: upload is not a PDF')
    return { status: 'failed', reason: 'not_pdf' }
  }

  // 3. Fetch PDF bytes.
  const reader = createBlobReaderFromEnv()
  let pdfBytes: Buffer
  try {
    const got = await reader.read('documents', upload.blobKey)
    pdfBytes = got.bytes
  } catch (err) {
    log.warn({ err, uploadId }, 'template parse: blob read failed')
    return { status: 'failed', reason: 'blob_read_failed' }
  }

  // 4. Call Claude (or dev stub).
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  const model  = await resolveDraftModel(prisma, null)
  let sections: ParsedSection[]
  try {
    if (apiKey) {
      sections = await parseWithClaude({
        pdfBytes, model, apiKey,
        docType:   template.type,
        framework: template.framework ?? null,
      })
    } else if (stubAllowed()) {
      sections = buildStubSections()
    } else {
      log.warn({ templateId }, 'template parse: AI not configured (no ANTHROPIC_API_KEY, AI_ALLOW_STUB off)')
      return { status: 'failed', reason: 'ai_not_configured' }
    }
  } catch (err) {
    log.warn({ err, templateId }, 'template parse: Claude call failed')
    return { status: 'failed', reason: 'ai_call_failed' }
  }

  // 5. Persist the parsed sections.
  await prisma.documentTemplate.update({
    where: { id: templateId },
    data:  {
      sections: sections as unknown as object,
    },
  })
  log.info({ templateId, sectionCount: sections.length, model, actorId }, 'template parse: sections written')

  // 6. Format-rule extraction. Runs the 85% confidence loop over the
  // same PDF, section-by-section, then merges each refined rule block
  // back into the template.sections[] JSON (migration 94 made the
  // template the single source of truth). Isolated in its own try so a
  // failure here doesn't erase the structural result the admin can
  // still use. Skipped when AI is not configured — the stub section
  // outline carries no usable formatting signal and admins author per-
  // section rules by hand in that mode (via the template JSON editor).
  let formatSummary: Report['formatRules']
  // `sectionsSoFar` tracks the latest merged state across phases so each
  // subsequent persist lays its diff on top of the previous phase's
  // writes rather than clobbering them. formatRules writes fire first,
  // then guidance writes layer on top.
  let sectionsSoFar: ParsedSection[] = sections
  if (apiKey && sections.length > 0) {
    try {
      const loop = await runFormatValidationLoop({
        pdfBytes, sections, model, apiKey,
        docType:   template.type,
        framework: template.framework ?? null,
        log,
      })
      const { sections: mergedSections, merged } = mergeFormatRulesIntoSections(sections, loop.rules)
      sectionsSoFar = mergedSections
      await prisma.documentTemplate.update({
        where: { id: templateId },
        data:  { sections: mergedSections as unknown as object },
      })
      const extracted = Object.values(loop.rules).filter(r => r.trim().length > 0).length
      formatSummary = {
        extracted,
        merged,
        iterations:  loop.iterations,
        belowTarget: loop.belowTarget,
      }
      log.info(
        { templateId, model, actorId, ...formatSummary },
        'template parse: format rules extracted + merged into template.sections',
      )
    } catch (err) {
      // Non-fatal: structural result is already persisted; admins can
      // still use the outline. Format extraction can be re-triggered
      // by re-uploading the template.
      log.warn({ err, templateId }, 'template parse: format-rule extraction failed (non-fatal)')
    }
  }

  // 7. Content-guidance extraction (migration 104). Single-pass,
  // verbatim-or-null — see the design note on gateGuidanceString /
  // extractGuidanceWithClaude for why there is no refinement loop.
  // Non-fatal like format extraction.
  let guidanceSummary: Report['guidance']
  if (apiKey && sections.length > 0) {
    try {
      const raw = await extractGuidanceWithClaude({
        pdfBytes, sections, model, apiKey,
        docType:   template.type,
        framework: template.framework ?? null,
      })
      const gated = applyGuidanceGate(raw)
      const { sections: mergedSections, merged } = mergeGuidanceIntoSections(sectionsSoFar, gated.byId)
      sectionsSoFar = mergedSections
      await prisma.documentTemplate.update({
        where: { id: templateId },
        data:  { sections: mergedSections as unknown as object },
      })
      guidanceSummary = {
        instructionsExtracted:        gated.instructionsExtracted,
        guidanceExtracted:            gated.guidanceExtracted,
        merged,
        rejectedForHallucinationRisk: gated.rejectedForHallucinationRisk,
      }
      log.info(
        { templateId, model, actorId, ...guidanceSummary },
        'template parse: content guidance extracted + gated + merged into template.sections',
      )
    } catch (err) {
      log.warn({ err, templateId }, 'template parse: guidance extraction failed (non-fatal)')
    }
  }

  return { status: 'ok', sectionsIn: sections.length, formatRules: formatSummary, guidance: guidanceSummary }
}

// Exposed for unit testing the pure parse + validate.
export const __test__ = {
  parseSectionsResponse,
  stripJsonFence,
  slugify,
  parseFormatRulesResponse,
  mergeFormatRulesIntoSections,
  parseGuidanceResponse,
  gateGuidanceString,
  applyGuidanceGate,
  mergeGuidanceIntoSections,
  FORMAT_CONFIDENCE_TARGET,
  FORMAT_MIN_ITERATIONS,
  FORMAT_MAX_ITERATIONS,
}
