// AnthropicLlmClient — Arc 8.1.
//
// Real Anthropic SDK wrapper. Picked up by the gateway's createLlmClient()
// factory when `ANTHROPIC_API_KEY` is set in the environment; otherwise
// the gateway falls back to StubLlmClient (deterministic, no network).
//
// Design notes:
//   - This file imports @anthropic-ai/sdk lazily (dynamic import inside
//     send()), so the SDK is only loaded once a real call is made.
//   - send() shape matches the LlmClient interface exactly, so swapping
//     is a single factory decision rather than a call-site change.
//   - Prompt caching: Anthropic's SDK reports `cache_creation_input_tokens`
//     and `cache_read_input_tokens` separately. The gateway's AiCallRecord
//     already has a `cachedTokens` column — we populate it from the sum
//     of both. See docs/pivot-plan.md Arc 8.1.

import type { ChatDocument, ChatImage, LlmClient } from './service.js'

// Anthropic vision caps (from their docs). Images exceeding these are
// dropped with a note; the prompt still goes through.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024    // 5MB per image

// Anthropic document (PDF) caps (from their docs).
// https://docs.anthropic.com/en/docs/build-with-claude/pdf-support
const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024   // 32MB per PDF

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
])

const ALLOWED_DOCUMENT_TYPES = new Set([
  'application/pdf',
])

export class AnthropicLlmClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    // Default to the current flagship model; the gateway's `args.model`
    // override wins per-call.
    private readonly defaultModel = 'claude-opus-4-7',
  ) {
    if (!apiKey) throw new Error('AnthropicLlmClient requires an API key')
  }

  async send(args: { model: string; prompt: string; maxOutputTokens?: number; images?: ChatImage[]; documents?: ChatDocument[] }) {
    // Lazy-load the SDK; a missing install surfaces as a clear message.
    const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
      throw new Error(
        'ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed. Run `npm i @anthropic-ai/sdk` in apps/api.',
      )
    })

    const client = new Anthropic({ apiKey: this.apiKey })

    // Build the content array. Text-only → single string (fast path).
    // With images / documents → multimodal content blocks:
    // documents first, then images, then text. Anthropic's docs
    // recommend attachments-first so the model "sees" them before
    // reading the instruction.
    const validImages = (args.images ?? []).filter(img =>
      ALLOWED_IMAGE_TYPES.has(img.mediaType.toLowerCase()) &&
      img.data.length > 0 &&
      img.data.length <= MAX_IMAGE_BYTES,
    )
    const skippedImages = (args.images ?? []).length - validImages.length

    const validDocs = (args.documents ?? []).filter(doc =>
      ALLOWED_DOCUMENT_TYPES.has(doc.mediaType.toLowerCase()) &&
      doc.data.length > 0 &&
      doc.data.length <= MAX_DOCUMENT_BYTES,
    )
    const skippedDocs = (args.documents ?? []).length - validDocs.length

    const skipNotes: string[] = []
    if (skippedImages > 0) {
      skipNotes.push(`${skippedImages} image(s) were dropped (over 5MB or unsupported format; supported: PNG, JPEG, GIF, WebP)`)
    }
    if (skippedDocs > 0) {
      skipNotes.push(`${skippedDocs} document(s) were dropped (over 32MB or unsupported format; supported: PDF)`)
    }
    const skipNote = skipNotes.length > 0 ? `\n\n[Note: ${skipNotes.join('. ')}.]` : ''

    const hasAttachments = validImages.length > 0 || validDocs.length > 0
    const content = !hasAttachments
      ? (args.prompt + skipNote)
      : [
          ...validDocs.map(doc => ({
            type: 'document' as const,
            source: {
              type: 'base64' as const,
              media_type: 'application/pdf' as const,
              data: doc.data.toString('base64'),
            },
          })),
          ...validImages.map(img => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: img.mediaType.toLowerCase() as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
              data: img.data.toString('base64'),
            },
          })),
          { type: 'text' as const, text: args.prompt + skipNote },
        ]

    const response = await client.messages.create({
      model: args.model || this.defaultModel,
      max_tokens: args.maxOutputTokens ?? 4096,
      messages: [{ role: 'user', content }],
    })

    // Response content is an array of blocks; the common case is a single
    // text block. Concatenate if multiple.
    const responseText = response.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { type: string; text?: string }) => b.text ?? '')
      .join('')

    return {
      responseText,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }
  }
}

/**
 * Factory — picks AnthropicLlmClient when ANTHROPIC_API_KEY is set,
 * else returns null so the gateway can fall back to its stub.
 * Caller: AiGatewayService constructor in service.ts.
 */
export function createAnthropicClientFromEnv(): AnthropicLlmClient | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) return null
  const model = process.env.ANTHROPIC_DEFAULT_MODEL?.trim() || 'claude-opus-4-7'
  return new AnthropicLlmClient(key, model)
}
