// Regulatory template distiller (Package R-2, migration 105).
//
// Parallels distill-template (A) / distill-pub-template (B) /
// distill-med-template (C). Uploaded exemplar PDF of a regulatory
// deliverable (CTD M2.3/2.4/2.5/2.6/2.7, cover letter, HA response,
// risk-benefit statement) → 3-phase Claude extraction →
// RegulatoryDocumentTemplate.sections[] JSON is filled with per-section
// formatRules + instructions + guidance.
//
// Framing is regulatory-specific: ICH M4 CTD structure, eCTD module
// conventions, HA correspondence shapes.

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

interface DistillRegTemplatePayload {
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

const MAX_OUTPUT_TOKENS          = 6_000
const MAX_FORMAT_OUTPUT_TOKENS   = 8_000
const GUIDANCE_MAX_OUTPUT_TOKENS = 6_000

// ────────────────────────────────────────────────────────────────────────
// Phase 1 — structural outline.

async function parseWithClaude(args: {
  pdfBytes: Buffer
  model:    string
  apiKey:   string
  docType:  string
  regulatoryTrack: string | null
}): Promise<ParsedSection[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })

  const system = [
    `You are a regulatory-submission template extractor. Read the attached exemplar deliverable (CTD Module 2.3 / 2.4 / 2.5 / 2.6 / 2.7, cover letter, Health Authority (HA) response narrative, or risk-benefit statement) and extract its structural outline — the section number + title hierarchy — into a strict JSON array.`,
    ``,
    `CONTEXT`,
    `Deliverable type: ${args.docType}.`,
    args.regulatoryTrack ? `Regulatory track: ${args.regulatoryTrack} (ind / nda / maa / bla / variation).` : `Regulatory track: unspecified; infer from the content.`,
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
    `1. "number" is the heading's label verbatim (e.g. "2.5.1", "2.5.4", "Question 3", "Response"). Keep the document's own numbering convention.`,
    `2. "title" is the heading text (≤ 300 chars). Strip trailing periods but keep acronyms + punctuation inside.`,
    `3. "id" is a stable, lowercase, snake-case slug you produce (e.g. "product_development", "efficacy_overview", "question_3_response"). Must be unique across the array.`,
    `4. Extract ONLY structural headings. Do NOT extract table captions, figure legends, header boilerplate, or signature blocks as top-level sections.`,
    `5. Typical shapes by deliverable type:`,
    `   - CTD M2.3 (QOS): Introduction + Drug Substance + Drug Product + Appendices + Regional.`,
    `   - CTD M2.4 (Nonclinical Overview): Pharmacology + Pharmacokinetics + Toxicology + Integrated Conclusions + References.`,
    `   - CTD M2.5 (Clinical Overview): 2.5.1–2.5.7 following ICH M4E.`,
    `   - CTD M2.6 (Nonclinical Summary): Pharmacology + PK + Tox written summaries.`,
    `   - CTD M2.7 (Clinical Summary): Biopharmaceutic + Clinical Pharmacology + Efficacy + Safety + Literature + Synopses.`,
    `   - Cover letter: single-section narrative (use "body" as id/number/title).`,
    `   - HA response narrative: Summary + per-question responses + Appendices.`,
    `   - Risk-benefit statement: Indication + Benefits + Risks + Conclusion.`,
    `6. Keep the order headings appear in the exemplar.`,
    `7. Do not invent sections not in the document.`,
  ].join('\n')

  const userPrompt = `Extract the section outline from the attached ${args.docType} exemplar. Return the JSON object only.`

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
  if ('fail' in parsed) throw new Error(`reg_template_output_${parsed.fail}`)
  return parsed.ok
}

// ────────────────────────────────────────────────────────────────────────
// Phase 2 — format-rule extraction.

async function extractFormatRulesWithClaude(args: {
  pdfBytes:  Buffer
  sections:  ParsedSection[]
  model:     string
  apiKey:    string
  docType:   string
  regulatoryTrack: string | null
}): Promise<Record<string, string>> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => { throw new Error('@anthropic-ai/sdk is not installed in apps/worker.') })
  const client = new Anthropic({ apiKey: args.apiKey })
  const sectionList = args.sections.map(s => `  - id=${s.id}  number=${s.number}  title=${JSON.stringify(s.title)}`).join('\n')
  const system = [
    `You are a regulatory-submission template extractor. Read the attached exemplar and describe how each section is FORMATTED — not what it says, but how it is styled (font, paragraph, list, table, CSR citation style, figure callouts, reference blocks).`,
    ``,
    `CONTEXT`,
    `Deliverable type: ${args.docType}.`,
    args.regulatoryTrack ? `Regulatory track: ${args.regulatoryTrack}.` : `Regulatory track: unspecified.`,
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
    `1. Short, concrete rules the AI should follow when drafting / rewriting this section. One per line.`,
    `2. Cover (when visible): font (family, size), paragraph (alignment, line-height, indent), list / numbering style, table defaults (common for CTD safety summaries), figure / table callout style ("Table 14.2.1", "see §5.3.5.1"), reference citation style (ICMJE / Vancouver numeric / inline-CSR-reference).`,
    `3. Do NOT describe the content of the section — only its formatting.`,
    `4. Use the SAME id for the key as the id supplied above. Do not invent new ids. Omit a section if the exemplar provides no formatting signal.`,
    `5. Keep each section's rules short — prefer 3–8 lines over long prose.`,
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
  if ('fail' in parsed) throw new Error(`reg_format_output_${parsed.fail}`)
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
    `You already produced per-section formatting rules for this regulatory exemplar. Several sections scored below our quality bar. Rewrite ONLY those sections by re-reading the document.`,
    ``,
    `QUALITY BAR`,
    `A good section-rule block covers (where visible): font, paragraph, list / table structure, CSR citation style, and references. 3–8 concrete lines. No prose about what the section says.`,
    ``,
    `SECTIONS NEEDING REWRITE`,
    issuesBlock,
    ``,
    `OUTPUT CONTRACT`,
    `Return ONLY a JSON object matching this shape:`,
    `{`,
    `  "rules": {`,
    `    "<section id>": "<rewritten rules — short, concrete, one rule per line>"`,
    `  }`,
    `}`,
    `Include ONLY the ids listed above. Keep the ids verbatim.`,
  ].join('\n')
  const userPrompt = `Rewrite the weak sections listed above. Return the JSON object only.`
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
  if ('fail' in parsed) throw new Error(`reg_format_refine_${parsed.fail}`)
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
  regulatoryTrack: string | null
  log:       { info(obj: object, msg: string): void }
}): Promise<FormatLoopResult> {
  let rules = await extractFormatRulesWithClaude({
    pdfBytes: args.pdfBytes, sections: args.sections,
    model: args.model, apiKey: args.apiKey, docType: args.docType, regulatoryTrack: args.regulatoryTrack,
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
  args.log.info({ iteration, sections: scoresBySection.size }, 'reg template format: initial pass scored')
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
    args.log.info({ iteration, refined: Object.keys(refined).length }, 'reg template format: refine pass scored')
  }
  const scores: Record<string, number> = {}
  let belowTarget = 0
  for (const [k, v] of scoresBySection) { scores[k] = v; if (v < FORMAT_CONFIDENCE_TARGET) belowTarget += 1 }
  return { rules, scores, iterations: iteration, belowTarget }
}

// ────────────────────────────────────────────────────────────────────────
// Phase 3 — content-guidance extraction.

async function extractGuidanceWithClaude(args: {
  pdfBytes:  Buffer
  sections:  ParsedSection[]
  model:     string
  apiKey:    string
  docType:   string
  regulatoryTrack: string | null
}): Promise<Record<string, ExtractedGuidance>> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => { throw new Error('@anthropic-ai/sdk is not installed in apps/worker.') })
  const client = new Anthropic({ apiKey: args.apiKey })
  const sectionList = args.sections.map(s => `  - id=${s.id}  number=${s.number}  title=${JSON.stringify(s.title)}`).join('\n')
  const system = [
    `You are a regulatory-submission template extractor. Your job is to extract per-section writing INSTRUCTIONS and GUIDANCE from a template or exemplar deliverable — VERBATIM.`,
    ``,
    `CONTEXT`,
    `Deliverable type: ${args.docType}.`,
    args.regulatoryTrack ? `Regulatory track: ${args.regulatoryTrack}.` : `Regulatory track: unspecified.`,
    ``,
    `SECTIONS (use these ids as JSON keys; keep them verbatim):`,
    sectionList,
    ``,
    `WHAT YOU ARE EXTRACTING`,
    `- "instructions" = what this section must COVER. Content requirements.`,
    `  Typical template labels: "Purpose:", "Scope:", "Intent:", "Content:",`,
    `  "Instructions:", "This section shall include:", "Per ICH M4E:", bulleted "must include" lists.`,
    `- "guidance" = HO0W to write it. Style, tone, framing, cautions, agency-specific style notes.`,
    `  Typical template labels: "Guidance:", "Note:", "Tip:", "Style notes:", "Reviewer tip:",`,
    `  italicised commentary separate from body text.`,
    ``,
    `CRITICAL RULES — ZERO HALLUCINATION`,
    `1. Extract ONLY text that appears LITERALLY in the template. Do NOT synthesise. Do NOT paraphrase. Do NOT infer what a section "should" cover from your knowledge of ICH or FDA/EMA conventions.`,
    `2. If a section has NO explicit instructions, return "instructions": null. Same for guidance. Returning null is the CORRECT answer for the majority of sections — exemplar deliverables rarely annotate per-section guidance; authored templates do.`,
    `3. If you are tempted to write "This section should describe X" when the template doesn't literally say that — STOP. Return null.`,
    `4. Verbatim extraction may be lightly cleaned: strip bullet markers, join wrapped lines, remove template placeholders like "[insert X]". Do not reword.`,
    `5. If instructions + guidance are mixed in a single block, split them by role. If they can't be split cleanly, put the whole block in "instructions" and set "guidance" to null.`,
    ``,
    `OUTPUT CONTRACT`,
    `Return ONLY a JSON object matching this shape:`,
    `{`,
    `  "sections": {`,
    `    "<section id>": {`,
    `      "instructions": "<verbatim text from template, or null>",`,
    `      "guidance":     "<verbatim text from template, or null>"`,
    `    }`,
    `  }`,
    `}`,
    `Include ONLY ids listed above. Omit sections you have no guidance for (or set both fields to null).`,
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
  if ('fail' in parsed) throw new Error(`reg_guidance_output_${parsed.fail}`)
  return parsed.ok
}

// ────────────────────────────────────────────────────────────────────────
// Handler.

export const handleDistillRegTemplate: JobHandler<DistillRegTemplatePayload, Report> = async (job, { prisma, log }) => {
  const { templateId, uploadId, actorId } = job.data

  const template = await prisma.regulatoryDocumentTemplate.findUnique({ where: { id: templateId } })
  if (!template) {
    log.warn({ templateId }, 'reg template parse: template not found — abort')
    return { status: 'failed', reason: 'template_not_found' }
  }

  const upload = await prisma.documentUpload.findUnique({ where: { id: uploadId } })
  if (!upload) {
    log.warn({ uploadId }, 'reg template parse: upload not found — abort')
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
    log.warn({ err, uploadId }, 'reg template parse: blob read failed')
    return { status: 'failed', reason: 'blob_read_failed' }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    log.warn({ templateId }, 'reg template parse: AI not configured')
    return { status: 'failed', reason: 'ai_not_configured' }
  }

  // Resolve the policy for this docType to fetch the regulatory track
  // so the Claude prompts can frame extraction against it.
  let regulatoryTrack: string | null = null
  try {
    const pol = await prisma.regulatoryTypePolicy.findFirst({
      where:   { docType: template.docType, isCurrent: true },
      select:  { regulatoryTrack: true },
    })
    regulatoryTrack = pol?.regulatoryTrack ?? null
  } catch { /* policy missing → regulatoryTrack stays null */ }

  const model = await resolveDraftModel(prisma, null)

  // Phase 1 — structural outline.
  let sections: ParsedSection[]
  try {
    sections = await parseWithClaude({ pdfBytes, model, apiKey, docType: template.docType, regulatoryTrack })
  } catch (err) {
    log.warn({ err, templateId }, 'reg template parse: Claude structural call failed')
    return { status: 'failed', reason: 'ai_call_failed' }
  }

  let sectionsSoFar: ParsedSection[] = sections
  await prisma.regulatoryDocumentTemplate.update({
    where: { id: templateId },
    data:  { sections: sectionsSoFar as unknown as object, updatedBy: actorId },
  })
  log.info({ templateId, sectionCount: sections.length, model, actorId }, 'reg template parse: sections written')

  // Phase 2 — format rules.
  let formatSummary: Report['formatRules']
  if (sections.length > 0) {
    try {
      const loop = await runFormatValidationLoop({
        pdfBytes, sections, model, apiKey, docType: template.docType, regulatoryTrack, log,
      })
      const { sections: mergedSections, merged } = mergeFormatRulesIntoSections(sections, loop.rules)
      sectionsSoFar = mergedSections
      await prisma.regulatoryDocumentTemplate.update({
        where: { id: templateId },
        data:  { sections: mergedSections as unknown as object, updatedBy: actorId },
      })
      const extracted = Object.values(loop.rules).filter(r => r.trim().length > 0).length
      formatSummary = { extracted, merged, iterations: loop.iterations, belowTarget: loop.belowTarget }
      log.info({ templateId, ...formatSummary }, 'reg template parse: format rules merged')
    } catch (err) {
      log.warn({ err, templateId }, 'reg template parse: format-rule extraction failed (non-fatal)')
    }
  }

  // Phase 3 — content guidance.
  let guidanceSummary: Report['guidance']
  if (sections.length > 0) {
    try {
      const raw = await extractGuidanceWithClaude({ pdfBytes, sections, model, apiKey, docType: template.docType, regulatoryTrack })
      const gated = applyGuidanceGate(raw)
      const { sections: mergedSections, merged } = mergeGuidanceIntoSections(sectionsSoFar, gated.byId)
      sectionsSoFar = mergedSections
      await prisma.regulatoryDocumentTemplate.update({
        where: { id: templateId },
        data:  { sections: mergedSections as unknown as object, updatedBy: actorId },
      })
      guidanceSummary = {
        instructionsExtracted:        gated.instructionsExtracted,
        guidanceExtracted:            gated.guidanceExtracted,
        merged,
        rejectedForHallucinationRisk: gated.rejectedForHallucinationRisk,
      }
      log.info({ templateId, ...guidanceSummary }, 'reg template parse: guidance merged')
    } catch (err) {
      log.warn({ err, templateId }, 'reg template parse: guidance extraction failed (non-fatal)')
    }
  }

  return { status: 'ok', sectionsIn: sections.length, formatRules: formatSummary, guidance: guidanceSummary }
}
