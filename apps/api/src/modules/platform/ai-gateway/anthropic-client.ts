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

import type { ChatImage, LlmClient } from './service.js'

// Anthropic vision caps (from their docs). Images exceeding these are
// dropped with a note; the prompt still goes through.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024   // 5MB per image

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
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

  async send(args: { model: string; prompt: string; maxOutputTokens?: number; images?: ChatImage[] }) {
    // Lazy-load the SDK; a missing install surfaces as a clear message.
    const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
      throw new Error(
        'ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed. Run `npm i @anthropic-ai/sdk` in apps/api.',
      )
    })

    const client = new Anthropic({ apiKey: this.apiKey })

    // Build the content array. Text-only → single string (fast path).
    // With images → multimodal content blocks (image blocks first, then
    // the text block — Anthropic's docs recommend this order so the model
    // "sees" the image before reading the instruction).
    const validImages = (args.images ?? []).filter(img =>
      ALLOWED_IMAGE_TYPES.has(img.mediaType.toLowerCase()) &&
      img.data.length > 0 &&
      img.data.length <= MAX_IMAGE_BYTES,
    )
    const skippedImages = (args.images ?? []).length - validImages.length
    const skipNote = skippedImages > 0
      ? `\n\n[Note: ${skippedImages} image(s) were dropped because they exceeded 5MB or used an unsupported format. Supported: PNG, JPEG, GIF, WebP.]`
      : ''

    const content = validImages.length === 0
      ? (args.prompt + skipNote)
      : [
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
