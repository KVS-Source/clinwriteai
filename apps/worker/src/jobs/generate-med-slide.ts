// AI slide generator — Module C Medical Writing "+ New slide with AI".
//
// Mirrors the Module A clinical.ai_initial_draft worker, scoped to MedSlide
// rows instead of SectionContent. One job = one slide inserted at a given
// position. Full-deck generation (one click → 20 slides) is a follow-up —
// the single-slide path is what the ContentEditor's "+ New slide with AI"
// button calls, and it keeps the provider-rate-limit math simple.
//
// Pipeline:
//   1. Load the deck job + its MedContentItem — prove both still exist +
//      the deck isn't frozen ('exported' → refuse: sealed content).
//   2. Resolve the DocumentTypePolicy pinned at deck creation
//      (policyVersionAtCreate) or the current policy for the doc-type
//      derived from MedContentItem.type. Reuses the same resolver as
//      Module A so the SME prompt + BP digest + section rules all flow.
//   3. Pull the existing slides in the deck as compact context (title +
//      first ~80 chars of body) so the new slide fits the deck's voice
//      without the AI rewriting what's there.
//   4. Call Claude with a strict-JSON system prompt: { title, bodyHtml,
//      speakerNotes, figure? } for the slide — same contract the UI
//      will store verbatim.
//   5. On success: insert the slide at the requested position, shifting
//      any existing slide >= position down by 1 in a transaction so the
//      position-unique constraint holds. Dev stub (AI_ALLOW_STUB=1)
//      produces a deterministic placeholder slide.
//
// Idempotency: jobId = `med-slide-${deckJobId}-${requestedPosition}-${seq}`
// (seq is a ms timestamp from the API) so retries don't double-insert.

import { resolveForDocument, renderPolicyPromptBlock, type PolicyRowForAi } from './policy-prompt.js'
import { resolveDraftModel } from '../ai-engine-settings.js'
import type { JobHandler } from './types.js'

interface AiSlidePayload {
  deckJobId:         string
  position:          number           // 1-based slot the new slide should occupy
  prompt:            string           // author's free-text instruction ("Explain the mechanism of action" etc.)
  actorId:           string
}

interface SlideDraft {
  title:        string
  bodyHtml:     string
  speakerNotes: string
  figure?:      { figureRef: string; altText: string; figureDescription: string }
}

interface Report {
  status:    'ok' | 'failed'
  reason?:   string
  slideId?:  string
  position?: number
}

// Max output tokens for a single slide. A thorough slide + 300-word speaker
// notes + figure metadata lands well under this.
const MAX_SLIDE_OUTPUT_TOKENS = 2_000

// How many existing slides (title + excerpt) to send as context. Keeps the
// prompt bounded even for large decks.
const CONTEXT_SLIDES_WINDOW = 10
const CONTEXT_BODY_CHARS    = 140

function stripJsonFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(text.trim())
  return (m ? m[1]! : text).trim()
}

function parseSlideResponse(raw: string): { ok: SlideDraft } | { fail: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonFence(raw))
  } catch (err) {
    return { fail: `json_parse: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (!parsed || typeof parsed !== 'object') return { fail: 'shape: not an object' }
  const s = parsed as Record<string, unknown>
  const title        = typeof s.title        === 'string' ? s.title.trim()        : ''
  const bodyHtml     = typeof s.bodyHtml     === 'string' ? s.bodyHtml.trim()     : ''
  const speakerNotes = typeof s.speakerNotes === 'string' ? s.speakerNotes.trim() : ''
  if (!title)        return { fail: 'shape: title missing or empty' }
  if (!bodyHtml)     return { fail: 'shape: bodyHtml missing or empty' }
  if (!speakerNotes) return { fail: 'shape: speakerNotes missing or empty' }
  if (title.length > 200) return { fail: 'shape: title exceeds 200 chars' }
  if (bodyHtml.length > 8_000) return { fail: 'shape: bodyHtml exceeds 8000 chars' }
  if (speakerNotes.length > 4_000) return { fail: 'shape: speakerNotes exceeds 4000 chars' }

  let figure: SlideDraft['figure']
  if (s.figure && typeof s.figure === 'object') {
    const f = s.figure as Record<string, unknown>
    const figureRef         = typeof f.figureRef         === 'string' ? f.figureRef.trim()         : ''
    const altText           = typeof f.altText           === 'string' ? f.altText.trim()           : ''
    const figureDescription = typeof f.figureDescription === 'string' ? f.figureDescription.trim() : ''
    if (figureRef && altText && figureDescription) {
      figure = { figureRef, altText, figureDescription }
    }
  }
  return { ok: { title, bodyHtml, speakerNotes, ...(figure ? { figure } : {}) } }
}

function stubAllowed(): boolean {
  return process.env.AI_ALLOW_STUB === '1'
}

function buildStubSlide(args: { prompt: string; position: number }): SlideDraft {
  return {
    title:        `[stub] ${args.prompt.slice(0, 60) || `Slide ${args.position}`}`,
    bodyHtml:     `<p>[stub slide — AI not configured, deterministic placeholder]</p><ul><li>Prompt: ${args.prompt || '(none)'}</li><li>Position: ${args.position}</li></ul>`,
    speakerNotes: `[stub] Speaker notes placeholder for slide at position ${args.position}. Set ANTHROPIC_API_KEY to generate real content.`,
  }
}

async function generateWithClaude(args: {
  prompt:       string
  position:     number
  contentTitle: string
  contentType:  string
  deckTitle:    string | null
  contextSlides: Array<{ position: number; title: string; excerpt: string }>
  policyBlock:  string                                    // from renderPolicyPromptBlock
  model:        string
  apiKey:       string
}): Promise<SlideDraft> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('ANTHROPIC_API_KEY set but @anthropic-ai/sdk is not installed in apps/worker.')
  })
  const client = new Anthropic({ apiKey: args.apiKey })

  const contextBlock = args.contextSlides.length === 0
    ? '(no existing slides yet)'
    : args.contextSlides
        .map(s => `${s.position}. ${s.title}\n   ${s.excerpt}`)
        .join('\n')

  const system = [
    `You are a medical affairs slide author drafting ONE slide for a ${args.contentType} deck titled "${args.contentTitle}".`,
    ``,
    `OUTPUT CONTRACT`,
    `Return ONLY a JSON object matching this shape — no prose, no markdown fences:`,
    `{`,
    `  "title":        "<slide title, <= 200 chars>",`,
    `  "bodyHtml":     "<HTML body: <p>, <ul>/<li>, <strong>, <em>; no scripts, no inline styles; <= 8000 chars>",`,
    `  "speakerNotes": "<plain-text speaker notes, 2-4 paragraphs; <= 4000 chars>",`,
    `  "figure":       { "figureRef": "<e.g. Fig-3>", "altText": "<WCAG alt>", "figureDescription": "<one sentence>" }  // optional`,
    `}`,
    ``,
    `RULES`,
    `1. Fit the slide to the deck's existing voice (titles + excerpts below). Do not restate what earlier slides already said.`,
    `2. Body is scannable: short paragraphs + bulleted lists. No tables unless the data demands one.`,
    `3. Speaker notes expand on the body with the clinical context an HCP would need; no disclaimers of your own.`,
    `4. Do NOT fabricate patient numbers, p-values, dates, or citation counts. Quote figures only when they appear in the attached briefing or policy context.`,
    `5. Include a figure object ONLY when the slide materially benefits from one — otherwise omit the key entirely.`,
    args.policyBlock ? `` : null,
    args.policyBlock ? args.policyBlock : null,
  ].filter((x): x is string => x !== null).join('\n')

  const userPrompt = [
    `Deck context (title → first ~${CONTEXT_BODY_CHARS} chars):`,
    contextBlock,
    ``,
    `Insert a new slide at position ${args.position}.`,
    `Author's instruction: ${args.prompt || '(none — infer the next logical slide from the deck context)'}`,
    ``,
    `Return the JSON object only.`,
  ].join('\n')

  const message = await client.messages.create({
    model:      args.model,
    max_tokens: MAX_SLIDE_OUTPUT_TOKENS,
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
  })

  const text = message.content
    .map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : ''))
    .join('\n')
    .trim()
  if (!text) throw new Error('Claude returned no text content')

  const parsed = parseSlideResponse(text)
  if ('fail' in parsed) throw new Error(`slide_output_${parsed.fail}`)
  return parsed.ok
}

export const handleGenerateMedSlide: JobHandler<AiSlidePayload, Report> = async (job, { prisma, log }) => {
  const { deckJobId, position, prompt, actorId } = job.data

  // 1. Deck must still exist + not be sealed.
  const deck = await prisma.medSlideDeckJob.findUnique({ where: { id: deckJobId } })
  if (!deck) {
    log.warn({ deckJobId }, 'med slide gen: deck not found — abort')
    return { status: 'failed', reason: 'deck_not_found' }
  }
  if (deck.status === 'exported') {
    log.warn({ deckJobId }, 'med slide gen: deck is exported (sealed) — abort')
    return { status: 'failed', reason: 'deck_exported' }
  }

  const content = await prisma.medContentItem.findUnique({ where: { id: deck.contentItemId } })
  if (!content) {
    log.warn({ deckJobId, contentItemId: deck.contentItemId }, 'med slide gen: content item not found — abort')
    return { status: 'failed', reason: 'content_not_found' }
  }

  // 2. Resolve the policy. DocumentTypePolicy's docType is a free string;
  // Module C uses the same taxonomy (e.g. 'hcp-slide-deck').
  const policy: PolicyRowForAi | null = await resolveForDocument(prisma, {
    docType:               content.type,
    policyVersionAtCreate: deck.policyVersionAtCreate ?? null,
  })
  if (policy) {
    log.info({ deckJobId, policyId: policy.id, policyVersion: policy.version }, 'med slide gen: policy resolved')
  }

  // 3. Existing slides as context.
  const existing = await prisma.medSlide.findMany({
    where:   { deckJobId },
    orderBy: { position: 'asc' },
  })
  const contextSlides = existing.slice(0, CONTEXT_SLIDES_WINDOW).map(s => ({
    position: s.position,
    title:    s.title,
    excerpt:  s.bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CONTEXT_BODY_CHARS),
  }))

  // 4. Call Claude (or the dev stub).
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  const model  = await resolveDraftModel(prisma, null)
  let draft: SlideDraft
  let engine = model
  try {
    if (apiKey) {
      draft = await generateWithClaude({
        prompt,
        position,
        contentTitle: content.title,
        contentType:  content.type,
        deckTitle:    deck.congressTarget,
        contextSlides,
        policyBlock:  renderPolicyPromptBlock(policy),
        model,
        apiKey,
      })
    } else if (stubAllowed()) {
      draft = buildStubSlide({ prompt, position })
      engine = 'stub'
    } else {
      log.warn({ deckJobId }, 'med slide gen: AI not configured (no ANTHROPIC_API_KEY, AI_ALLOW_STUB off)')
      return { status: 'failed', reason: 'ai_not_configured' }
    }
  } catch (err) {
    log.warn({ err, deckJobId }, 'med slide gen: Claude call failed')
    return { status: 'failed', reason: 'ai_call_failed' }
  }

  // 5. Persist. Shift existing slides at or after `position` down by one
  // inside a single transaction so the unique (deckJobId, position)
  // constraint holds without a race.
  const insertedPosition = Math.max(1, Math.min(position, existing.length + 1))
  const slide = await prisma.$transaction(async (tx) => {
    // Shift positions down from the tail so we never hit the unique
    // constraint mid-update (no temporary duplicates).
    const toShift = existing.filter(s => s.position >= insertedPosition).reverse()
    for (const s of toShift) {
      await tx.medSlide.update({ where: { id: s.id }, data: { position: s.position + 1 } })
    }
    const created = await tx.medSlide.create({
      data: {
        deckJobId,
        position:       insertedPosition,
        title:          draft.title,
        bodyHtml:       draft.bodyHtml,
        speakerNotes:   draft.speakerNotes,
        aiGenerated:    true,
        aiModel:        engine,
        aiGeneratedAt:  new Date(),
        aiPrompt:       prompt || null,
        lastEditedBy:   actorId,
        lastEditedAt:   new Date(),
        ...(draft.figure
          ? { figures: { create: [draft.figure] } }
          : {}),
      },
    })
    // Deck status mirrors first-slide-landed: if this was the first slide
    // of a brand-new deck job, flip to 'ready'. Later refinements (full-
    // deck jobs, status 'generating') ride on top of this.
    await tx.medSlideDeckJob.update({
      where: { id: deckJobId },
      data: {
        aiModel:     engine,
        generatedAt: new Date(),
        status:      deck.status === 'draft' || deck.status === 'generating' ? 'ready' : deck.status,
      },
    })
    return created
  })

  log.info({ deckJobId, slideId: slide.id, position: slide.position, engine, actorId }, 'med slide gen: slide written')
  return { status: 'ok', slideId: slide.id, position: slide.position }
}

export const __test__ = { parseSlideResponse, stripJsonFence }
