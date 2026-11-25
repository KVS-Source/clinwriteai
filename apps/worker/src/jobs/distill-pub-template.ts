// Publication template distiller (Package B-2, migration 105).
//
// Mirror of apps/worker/src/jobs/distill-template.ts but for Module B
// (Scientific Writing). Uploaded exemplar publication PDF → 3-phase
// Claude extraction → PublicationTemplate.sections[] JSON is filled
// with per-section formatRules + instructions + guidance.
//
// Why a separate distiller instead of parametrising the Clinical one:
//   - Framing differs (ICMJE / GPP / CONSORT vs ICH E3 / CTD).
//   - RULES bullets differ (manuscript section conventions vs CSR).
//   - Output schema is the SAME (`ParsedSection`) so downstream parsers
//     + merges + gates are shared via template-distill-common.ts.
//
// Pipeline:
//   1. Load the pending PublicationTemplate row + the DocumentUpload row.
//   2. Fetch the PDF blob.
//   3. Phase 1 — Claude structural outline (sections[]).
//   4. Phase 2 — Claude format-rule extraction (85% confidence loop).
//   5. Phase 3 — Claude content-guidance extraction (single-pass,
//      verbatim-or-null, gate-rejected if hallucinated).
//   6. Persist the layered sections[] on the PublicationTemplate row.
//
// Observability: same pattern as Clinical — API audits
// `publication_template.parse_enqueued` at enqueue; worker logs via
// pino + returns a Report. Idempotent via jobId.

import { createBlobReaderFromEnv } from '../blob-reader.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import {
  type ParsedSection,
  type ExtractedGuidance,
  scoreFormatRules,
  shouldStopFormatLoop,
  parseSectionsResponse,
  parseFormatRulesResponse,
  parseGuidanceResponse,
  applyGuidanceGate,
  mergeFormatRulesIntoSections,
  mergeGuidanceIntoSections,
  FORMAT_CONFIDENCE_TARGET,
} from './template-distill-common.js'
import type { JobHandler } from './types.js'

interface DistillPubTemplatePayload {
  templateId: string
  uploadId:   string
  actorId:    string
}

interface Report {
  status:        'ok' | 'failed'
  reason?:       string
  sectionsIn?:   number
  formatRules?: {
    extracted:   number
    merged:      number
    iterations:  number
    belowTarget: number
  }
  guidance?: {
    instructionsExtracted:        number
    guidanceExtracted:            number
    merged:                       number
    rejectedForHallucinationRisk: number
  }
}

const MAX_OUTPUT_TOKENS        = 6_000
const MAX_FORMAT_OUTPUT_TOKENS = 8_000
const GUIDANCE_MAX_OUTPUT_TOKENS = 6_000

// ────────────────────────────────────────────────────────────────────────
// Phase 1 — structural outline.

async function parseWithClaude(args: {
  pdfBytes: Buffer
  model:    string
  apiKey:   string
  docType:  string
  guideline: string | null
}): Promise<ParsedSection[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })

  const system = [
    `You are a scientific publication template extractor. Read the attached exemplar manuscript / abstract / poster and extract its structural outline — the section number + title hierarchy — into a strict JSON array.`,
    ``,
    `CONTEXT`,
    `Publication type: ${args.docType}.`,
    args.guideline ? `Reporting guideline: ${args.guideline} (follow its structural recommendations when deciding section boundaries).` : `Reporting guideline: not specified; infer from the headings.`,
    ``,
    `OUTPUT CONTRACT`,
    `Return ONLY a JSON object matching this shape — no prose, no markdown fences:`,
    `{`,
    `  "sections": [`,
    `    { "id": "<stable-slug>", "number": "<section number>", "title": "<section title>" }`,
    `  ]`,
    `}`,
    ``,
    `RULES`,
    `1. "number" is the heading's label verbatim ("1", "2.1", "Introduction", "Methods"). If the exemplar uses unnumbered section titles (common in journal articles), use the title itself as the number so it stays unique within the array.`,
    `2. "title" is the heading's text (≤ 300 chars). Strip trailing periods but keep acronyms + punctuation inside the title.`,
    `3. "id" is a stable, lowercase, snake-case slug you produce — safe for a URL/DB key. Use the title as the basis (e.g. "methods", "results"). Must be unique across the array.`,
    `4. Extract ONLY headings that structure the manuscript. Do NOT extract figure captions, table titles, author lists, or acknowledgements subheadings as top-level sections.`,
    `5. Keep the order in which sections appear in the publication.`,
    `6. Typical journal manuscript sections: Title, Abstract, Introduction, Methods, Results, Discussion, Conclusion, References. Case reports omit Methods / Results and add Case Presentation. Reviews have Search Strategy + Evidence Synthesis. Posters are a single flat section list with limited depth.`,
    `7. Do not invent sections not in the publication.`,
  ].join('\n')

  const userPrompt = `Extract the section outline from the attached ${args.docType} publication. Return the JSON object only.`

  const message = await client.messages.create({
    model:      args.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: args.pdfBytes.toString('base64') } },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  })
  const text = message.content.map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : '')).join('\n').trim()
  if (!text) throw new Error('Claude returned no text content')
  const parsed = parseSectionsResponse(text)
  if ('fail' in parsed) throw new Error(`pub_template_output_${parsed.fail}`)
  return parsed.ok
}

// ────────────────────────────────────────────────────────────────────────
// Phase 2 — format-rule extraction (same shape as Clinical: initial +
// refine passes, scored via the shared rubric).

async function extractFormatRulesWithClaude(args: {
  pdfBytes:  Buffer
  sections:  ParsedSection[]
  model:     string
  apiKey:    string
  docType:   string
  guideline: string | null
}): Promise<Record<string, string>> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => { throw new Error('@anthropic-ai/sdk is not installed in apps/worker.') })
  const client = new Anthropic({ apiKey: args.apiKey })
  const sectionList = args.sections.map(s => `  - id=${s.id}  number=${s.number}  title=${JSON.stringify(s.title)}`).join('\n')
  const system = [
    `You are a scientific publication template extractor. Read the attached exemplar manuscript / abstract / poster and describe how each section is FORMATTED — not what it says, but how it is styled (font, paragraph, list, table, references, figure callouts).`,
    ``,
    `CONTEXT`,
    `Publication type: ${args.docType}.`,
    args.guideline ? `Reporting guideline: ${args.guideline}.` : `Reporting guideline: unspecified.`,
    ``,
    `SECTIONS (use these ids as JSON keys; keep them verbatim):`,
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
    `1. Write short, concrete rules the AI should follow when drafting / rewriting this section. One rule per line is easiest to read.`,
    `2. Cover (when visible in the exemplar) font (family, size), paragraph (alignment, line-height, indent, space), list / numbering style, table defaults (borders, header row, cell padding), figure / table callout style ("(Figure 1)" vs "Fig. 1"), and reference citation style (Vancouver numbered [N], author-year, superscript).`,
    `3. Do NOT describe the content of the section — only its formatting.`,
    `4. Use the SAME id for the key as the id supplied above. Do not invent new ids. Omit a section if the exemplar provides no formatting signal for it (don't guess).`,
    `5. Keep each section's rules short — prefer 3–8 lines of concrete rules over long prose. Every character is tokens injected into every AI rewrite call later.`,
  ].join('\n')
  const userPrompt = `Extract the per-section formatting rules from the attached ${args.docType} exemplar. Return the JSON object only.`
  const message = await client.messages.create({
    model:      args.model,
    max_tokens: MAX_FORMAT_OUTPUT_TOKENS,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: args.pdfBytes.toString('base64') } },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  })
  const text = message.content.map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : '')).join('\n').trim()
  if (!text) throw new Error('Claude returned no text content (format extract)')
  const parsed = parseFormatRulesResponse(text)
  if ('fail' in parsed) throw new Error(`pub_format_output_${parsed.fail}`)
  return parsed.ok
}

async function refineFormatRulesWithClaude(args: {
  pdfBytes:  Buffer
  sections:  ParsedSection[]
  model:     string
  apiKey:    string
  docType:   string
  weakEntries: Array<{ sectionId: string; flags: string[]; currentRules: string }>
}): Promise<Record<string, string>> {
  if (args.weakEntries.length === 0) return {}
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => { throw new Error('@anthropic-ai/sdk is not installed in apps/worker.') })
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
    `You already produced per-section formatting rules for this publication exemplar. Several sections scored below our quality bar. Rewrite ONLY those sections, re-reading the attached document for the formatting details the first pass missed.`,
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
  const userPrompt = `Rewrite the weak sections listed above by re-reading the attached ${args.docType} publication. Return the JSON object only.`
  const message = await client.messages.create({
    model:      args.model,
    max_tokens: MAX_FORMAT_OUTPUT_TOKENS,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: args.pdfBytes.toString('base64') } },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  })
  const text = message.content.map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : '')).join('\n').trim()
  if (!text) throw new Error('Claude returned no text content (format refine)')
  const parsed = parseFormatRulesResponse(text)
  if ('fail' in parsed) throw new Error(`pub_format_refine_${parsed.fail}`)
  const allowed = new Set(args.weakEntries.map(w => w.sectionId))
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed.ok)) if (allowed.has(k)) out[k] = v
  return out
}

interface FormatLoopResult {
  rules:       Record<string, string>
  scores:      Record<string, number>
  iterations:  number
  belowTarget: number
}

async function runFormatValidationLoop(args: {
  pdfBytes:  Buffer
  sections:  ParsedSection[]
  model:     string
  apiKey:    string
  docType:   string
  guideline: string | null
  log:       { info(obj: object, msg: string): void }
}): Promise<FormatLoopResult> {
  let rules = await extractFormatRulesWithClaude({
    pdfBytes: args.pdfBytes, sections: args.sections,
    model: args.model, apiKey: args.apiKey, docType: args.docType, guideline: args.guideline,
  })
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
  args.log.info({ iteration, sections: scoresBySection.size }, 'pub template format: initial pass scored')
  while (!shouldStopFormatLoop(iteration, scoresBySection)) {
    iteration += 1
    const weak: Array<{ sectionId: string; flags: string[]; currentRules: string }> = []
    for (const sec of args.sections) {
      const score = scoresBySection.get(sec.id) ?? 0
      if (score < FORMAT_CONFIDENCE_TARGET) {
        weak.push({ sectionId: sec.id, flags: flagsBySection.get(sec.id) ?? [], currentRules: rules[sec.id] ?? '' })
      }
    }
    if (weak.length === 0) {
      for (const sec of args.sections) weak.push({ sectionId: sec.id, flags: [], currentRules: rules[sec.id] ?? '' })
    }
    const refined = await refineFormatRulesWithClaude({
      pdfBytes: args.pdfBytes, sections: args.sections, model: args.model, apiKey: args.apiKey, docType: args.docType, weakEntries: weak,
    })
    rules = { ...rules, ...refined }
    applyScores()
    args.log.info({ iteration, refined: Object.keys(refined).length }, 'pub template format: refine pass scored')
  }
  const scores: Record<string, number> = {}
  let belowTarget = 0
  for (const [k, v] of scoresBySection) { scores[k] = v; if (v < FORMAT_CONFIDENCE_TARGET) belowTarget += 1 }
  return { rules, scores, iterations: iteration, belowTarget }
}

// ────────────────────────────────────────────────────────────────────────
// Phase 3 — content-guidance extraction (single-pass, gated).

async function extractGuidanceWithClaude(args: {
  pdfBytes:  Buffer
  sections:  ParsedSection[]
  model:     string
  apiKey:    string
  docType:   string
  guideline: string | null
}): Promise<Record<string, ExtractedGuidance>> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => { throw new Error('@anthropic-ai/sdk is not installed in apps/worker.') })
  const client = new Anthropic({ apiKey: args.apiKey })
  const sectionList = args.sections.map(s => `  - id=${s.id}  number=${s.number}  title=${JSON.stringify(s.title)}`).join('\n')
  const system = [
    `You are a scientific publication template extractor. Your job is to extract per-section writing INSTRUCTIONS and GUIDANCE from a template or exemplar publication — VERBATIM.`,
    ``,
    `CONTEXT`,
    `Publication type: ${args.docType}.`,
    args.guideline ? `Reporting guideline: ${args.guideline}.` : `Reporting guideline: unspecified.`,
    ``,
    `SECTIONS (use these ids as JSON keys; keep them verbatim):`,
    sectionList,
    ``,
    `WHAT YOU ARE EXTRACTING`,
    `- "instructions" = what this section must COVER. Content requirements.`,
    `  Typical template labels: "Purpose:", "Scope:", "Intent:", "Content:",`,
    `  "Instructions:", "This section shall include:", bulleted "must include" lists,`,
    `  CONSORT / STROBE / PRISMA checklist items referenced inline.`,
    `- "guidance" = HOW to write it. Style, tone, framing, cautions, journal-specific style notes.`,
    `  Typical template labels: "Guidance:", "Note:", "Tip:", "Style notes:",`,
    `  italicised commentary separate from the body text.`,
    ``,
    `CRITICAL RULES — ZERO HALLUCINATION`,
    `1. Extract ONLY text that appears LITERALLY in the template. Do NOT synthesise. Do NOT paraphrase. Do NOT infer what a section "should" cover from your knowledge of journal conventions.`,
    `2. If a section has NO explicit instructions, return "instructions": null. Same for guidance. Returning null is the CORRECT answer for the majority of sections — exemplar papers rarely annotate per-section guidance; authored templates do.`,
    `3. If you are tempted to write "This section should describe X" when the template doesn't literally say that — STOP. Return null.`,
    `4. Verbatim extraction may be lightly cleaned: strip bullet markers, join wrapped lines, remove template placeholders like "[insert X]". Do not reword.`,
    `5. If instructions + guidance are mixed in a single block, split them by role (content requirements → instructions; style/tone → guidance). If they can't be split cleanly, put the whole block in "instructions" and set "guidance" to null.`,
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
          { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: args.pdfBytes.toString('base64') } },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  })
  const text = message.content.map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : '')).join('\n').trim()
  if (!text) throw new Error('Claude returned no text content (guidance extract)')
  const parsed = parseGuidanceResponse(text)
  if ('fail' in parsed) throw new Error(`pub_guidance_output_${parsed.fail}`)
  return parsed.ok
}

// ────────────────────────────────────────────────────────────────────────
// Handler.

export const handleDistillPubTemplate: JobHandler<DistillPubTemplatePayload, Report> = async (job, { prisma, log }) => {
  const { templateId, uploadId, actorId } = job.data

  const template = await prisma.publicationTemplate.findUnique({ where: { id: templateId } })
  if (!template) {
    log.warn({ templateId }, 'pub template parse: template not found — abort')
    return { status: 'failed', reason: 'template_not_found' }
  }

  const upload = await prisma.documentUpload.findUnique({ where: { id: uploadId } })
  if (!upload) {
    log.warn({ uploadId }, 'pub template parse: upload not found — abort')
    return { status: 'failed', reason: 'upload_not_found' }
  }
  if ((upload.contentType ?? '').toLowerCase() !== 'application/pdf') {
    return { status: 'failed', reason: 'not_pdf' }
  }

  const reader = createBlobReaderFromEnv()
  let pdfBytes: Buffer
  try {
    const got = await reader.read('documents', upload.blobKey)
    pdfBytes = got.bytes
  } catch (err) {
    log.warn({ err, uploadId }, 'pub template parse: blob read failed')
    return { status: 'failed', reason: 'blob_read_failed' }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    log.warn({ templateId }, 'pub template parse: AI not configured')
    return { status: 'failed', reason: 'ai_not_configured' }
  }

  // Resolve the policy for this docType to fetch the reporting guideline
  // (CONSORT / STROBE / PRISMA / none) so the Claude prompts can frame
  // their extraction against it.
  let guideline: string | null = null
  try {
    const pol = await prisma.publicationTypePolicy.findFirst({
      where:   { docType: template.docType, isCurrent: true },
      select:  { guidelineKey: true },
    })
    guideline = pol?.guidelineKey ?? null
  } catch { /* policy missing → guideline just stays null */ }

  const model = await resolveDraftModel(prisma, null)

  // Phase 1 — structural outline.
  let sections: ParsedSection[]
  try {
    sections = await parseWithClaude({ pdfBytes, model, apiKey, docType: template.docType, guideline })
  } catch (err) {
    log.warn({ err, templateId }, 'pub template parse: Claude structural call failed')
    return { status: 'failed', reason: 'ai_call_failed' }
  }

  // Persist the structural layer first — admins get a usable outline even
  // if downstream phases fail.
  let sectionsSoFar: ParsedSection[] = sections
  await prisma.publicationTemplate.update({
    where: { id: templateId },
    data:  { sections: sectionsSoFar as unknown as object, updatedBy: actorId },
  })
  log.info({ templateId, sectionCount: sections.length, model, actorId }, 'pub template parse: sections written')

  // Phase 2 — format rules (non-fatal on failure).
  let formatSummary: Report['formatRules']
  if (sections.length > 0) {
    try {
      const loop = await runFormatValidationLoop({
        pdfBytes, sections, model, apiKey, docType: template.docType, guideline, log,
      })
      const { sections: mergedSections, merged } = mergeFormatRulesIntoSections(sections, loop.rules)
      sectionsSoFar = mergedSections
      await prisma.publicationTemplate.update({
        where: { id: templateId },
        data:  { sections: mergedSections as unknown as object, updatedBy: actorId },
      })
      const extracted = Object.values(loop.rules).filter(r => r.trim().length > 0).length
      formatSummary = { extracted, merged, iterations: loop.iterations, belowTarget: loop.belowTarget }
      log.info({ templateId, ...formatSummary }, 'pub template parse: format rules merged')
    } catch (err) {
      log.warn({ err, templateId }, 'pub template parse: format-rule extraction failed (non-fatal)')
    }
  }

  // Phase 3 — content guidance (non-fatal).
  let guidanceSummary: Report['guidance']
  if (sections.length > 0) {
    try {
      const raw = await extractGuidanceWithClaude({ pdfBytes, sections, model, apiKey, docType: template.docType, guideline })
      const gated = applyGuidanceGate(raw)
      const { sections: mergedSections, merged } = mergeGuidanceIntoSections(sectionsSoFar, gated.byId)
      sectionsSoFar = mergedSections
      await prisma.publicationTemplate.update({
        where: { id: templateId },
        data:  { sections: mergedSections as unknown as object, updatedBy: actorId },
      })
      guidanceSummary = {
        instructionsExtracted:        gated.instructionsExtracted,
        guidanceExtracted:            gated.guidanceExtracted,
        merged,
        rejectedForHallucinationRisk: gated.rejectedForHallucinationRisk,
      }
      log.info({ templateId, ...guidanceSummary }, 'pub template parse: guidance merged')
    } catch (err) {
      log.warn({ err, templateId }, 'pub template parse: guidance extraction failed (non-fatal)')
    }
  }

  return { status: 'ok', sectionsIn: sections.length, formatRules: formatSummary, guidance: guidanceSummary }
}
