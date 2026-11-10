// AI claim extractor for the Claims Matrix.
//
// Reads the content item's body material (MedSlides.title + bodyHtml, or
// MedContentItem metadata when no slides exist yet) and asks Claude to
// surface every discrete medical claim, pairing it with the source
// reference the claim rests on (SmPC §/CSR §/publication DOI/label
// claim #) and its location on the deck.
//
// Sync-call pattern: the harvest route invokes this inline rather than
// enqueuing a worker. Extraction is fast (one Claude call, ~5-10 s even
// for a 25-slide deck) and the result is needed immediately to populate
// the Claims Matrix — not worth the complexity of a job + poll loop.
//
// Dedup: the caller filters extracted claims against existing rows by
// case-insensitive claimText match before inserting, so re-running the
// extractor on a deck that already has claims only adds genuinely new
// ones. Existing claims keep their reviewer + approval status.

import type { PrismaClient } from '@prisma/client'

export interface ExtractedClaim {
  claimText:  string
  sourceRef:  string              // 'SmPC §4.2', 'CSR v1.0 Table 14.2.1', 'Doi:10.1056/NEJMoa2201111', 'Label §3.1'
  sourceType: 'smpc' | 'csr' | 'publication' | 'label'
  location:   string              // 'Slide 12', 'Body text', 'Figure 3 caption'
}

interface ExtractArgs {
  prisma:    PrismaClient
  contentId: string
  model:     string
  apiKey:    string               // caller ensures AI is configured + key present
}

const MAX_OUTPUT_TOKENS = 4_000
const MAX_CLAIMS_PER_RUN = 60
const MAX_SLIDE_EXCERPT_CHARS = 800       // trim each slide body to keep the prompt bounded

function stripJsonFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text.trim())
  return (m ? m[1]! : text).trim()
}

const SOURCE_TYPES = new Set<ExtractedClaim['sourceType']>(['smpc', 'csr', 'publication', 'label'])

/** Strict JSON parse + validation against the ExtractedClaim shape. */
export function parseExtractResponse(raw: string): { ok: ExtractedClaim[] } | { fail: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonFence(raw))
  } catch (err) {
    return { fail: `json_parse: ${err instanceof Error ? err.message : String(err)}` }
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { claims?: unknown }).claims)
        ? (parsed as { claims: unknown[] }).claims
        : null)
  if (!arr) return { fail: 'shape: expected an array or { "claims": [...] }' }
  if (arr.length > MAX_CLAIMS_PER_RUN) return { fail: `shape: too many claims (${arr.length} > ${MAX_CLAIMS_PER_RUN})` }

  const out: ExtractedClaim[] = []
  for (const [i, c] of arr.entries()) {
    if (!c || typeof c !== 'object') return { fail: `shape: claim[${i}] is not an object` }
    const cc = c as Record<string, unknown>
    const claimText  = typeof cc.claimText  === 'string' ? cc.claimText.trim()  : ''
    const sourceRef  = typeof cc.sourceRef  === 'string' ? cc.sourceRef.trim()  : ''
    const sourceType = typeof cc.sourceType === 'string' ? cc.sourceType.trim().toLowerCase() : ''
    const location   = typeof cc.location   === 'string' ? cc.location.trim()   : ''
    if (!claimText)           return { fail: `shape: claim[${i}].claimText empty` }
    if (!sourceRef)           return { fail: `shape: claim[${i}].sourceRef empty` }
    if (!location)            return { fail: `shape: claim[${i}].location empty` }
    if (!SOURCE_TYPES.has(sourceType as ExtractedClaim['sourceType'])) {
      return { fail: `shape: claim[${i}].sourceType must be smpc/csr/publication/label (got ${JSON.stringify(cc.sourceType)})` }
    }
    if (claimText.length > 1_000) return { fail: `shape: claim[${i}].claimText exceeds 1000 chars` }
    out.push({ claimText, sourceRef, sourceType: sourceType as ExtractedClaim['sourceType'], location })
  }
  return { ok: out }
}

/** Case-insensitive, whitespace-normalised claim-text match. Used to skip
 *  duplicates when harvest is re-run on a deck that already has rows. */
export function normaliseClaimText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

export async function extractClaimsWithClaude(args: ExtractArgs): Promise<ExtractedClaim[]> {
  const { prisma, contentId, model, apiKey } = args

  const content = await prisma.medContentItem.findUnique({ where: { id: contentId } })
  if (!content) throw new Error('content_not_found')

  // Pull all slides for this content's deck(s). A fresh content item won't
  // have a deck yet; in that case we synthesise a synthetic "deck" from
  // the metadata so the extractor still has something to work with.
  const decks = await prisma.medSlideDeckJob.findMany({ where: { contentItemId: contentId } })
  const slides = decks.length === 0
    ? []
    : await prisma.medSlide.findMany({
        where:   { deckJobId: { in: decks.map(d => d.id) } },
        orderBy: { position: 'asc' },
      })

  const slideBlock = slides.length === 0
    ? `(No slides yet. Content metadata: ${content.type}, title="${content.title}", TA="${content.taTag}".)`
    : slides.map(s => {
        const body = s.bodyHtml
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, MAX_SLIDE_EXCERPT_CHARS)
        return `Slide ${s.position} — ${s.title}\n${body}`
      }).join('\n\n')

  const system = [
    `You are a medical-affairs claims extractor working on a ${content.type} titled "${content.title}" (TA: ${content.taTag}).`,
    ``,
    `TASK`,
    `Surface every discrete medical claim the slide deck makes — efficacy, safety, dosing, mechanism, population, etc. One row per claim. Attribute each to the source the author would cite (SmPC section, CSR table, publication DOI, or label section). Do not invent claims the deck doesn't actually make.`,
    ``,
    `OUTPUT CONTRACT`,
    `Return ONLY a JSON object matching this shape — no prose, no markdown fences:`,
    `{`,
    `  "claims": [`,
    `    {`,
    `      "claimText":  "<the claim in one sentence, <= 1000 chars>",`,
    `      "sourceRef":  "<citation handle, e.g. 'SmPC §4.2' | 'CSR v1.0 Table 14.2.1' | 'DOI:10.1056/NEJMoa2201111' | 'Label §3.1'>",`,
    `      "sourceType": "smpc" | "csr" | "publication" | "label",`,
    `      "location":   "<where on the deck, e.g. 'Slide 12', 'Figure 3 caption', 'Body text'>"`,
    `    }`,
    `  ]`,
    `}`,
    ``,
    `RULES`,
    `1. Prefer the most specific source reference the slide gives (e.g. "SmPC §4.2 bullet 3" beats "SmPC"). If the slide doesn't name a source, use "source_unspecified" as sourceRef and sourceType="publication".`,
    `2. If two slides make the same claim verbatim, emit it once — pick the slide with the earlier position as "location".`,
    `3. Maximum ${MAX_CLAIMS_PER_RUN} claims per run. If the deck has more, prioritise efficacy + safety + dosing over mechanism/population.`,
    `4. Do NOT fabricate citation details (DOIs, table numbers). When unsure, use source_unspecified rather than guessing.`,
  ].join('\n')

  const userPrompt = [
    `Extract claims from the following slide deck. Return the JSON object only.`,
    ``,
    `<deck>`,
    slideBlock,
    `</deck>`,
  ].join('\n')

  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY set but @anthropic-ai/sdk is not installed in apps/api.')
  })
  const client = new Anthropic({ apiKey })
  const message = await client.messages.create({
    model,
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

/** Dev/CI only: AI_ALLOW_STUB=1 produces a deterministic 2-claim sample so
 *  the UI flow is exercisable without an Anthropic key. */
export function buildStubClaims(): ExtractedClaim[] {
  return [
    {
      claimText:  '[stub] The study drug reduced the risk of disease progression by 45% versus placebo at the primary analysis.',
      sourceRef:  'CSR v1.0 Table 14.2.1',
      sourceType: 'csr',
      location:   'Slide 5',
    },
    {
      claimText:  '[stub] Grade 3 or higher adverse events were observed in 22% of patients in the study-drug arm.',
      sourceRef:  'SmPC §4.8',
      sourceType: 'smpc',
      location:   'Slide 7',
    },
  ]
}
