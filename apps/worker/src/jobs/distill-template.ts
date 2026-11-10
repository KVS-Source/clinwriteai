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
  id:      string     // stable key — safe id, slugified from number if the model doesn't supply one
  number:  string     // '1', '1.1', '§6.2', …
  title:   string
  usOnly?: boolean    // some sections are US-only (ICH E3 §16.4)
}

interface Report {
  status:        'ok' | 'failed'
  reason?:       string
  sectionsIn?:   number
}

const MAX_OUTPUT_TOKENS = 6_000      // ~150 sections at ~35 tokens each + JSON overhead
const MAX_SECTIONS      = 200

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
  return { status: 'ok', sectionsIn: sections.length }
}

// Exposed for unit testing the pure parse + validate.
export const __test__ = { parseSectionsResponse, stripJsonFence, slugify }
