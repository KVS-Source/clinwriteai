// OpenAILlmClient — real OpenAI SDK wrapper. Picked up by the gateway's
// createLlmClient() factory when the requested model id starts with
// `gpt-` AND `OPENAI_API_KEY` is set; otherwise the gateway falls back
// to the stub.
//
// Vision: GPT-4o-class models accept image_url blocks inside the user
// message's content array. We base64 the image bytes into a data URL
// so no public hosting is needed.
//
// Document (PDF) support: OpenAI's Chat Completions API does NOT accept
// PDF documents inline the way Anthropic does. GPT-4o can read PDFs via
// the Assistants / Files API (upload → attach by file-id) but that's a
// different endpoint shape. For now we drop PDFs with a note so the
// prompt still goes through — matches the "silent degrade" pattern we
// use elsewhere. Document-upload wiring is a follow-up.

import type { ChatDocument, ChatImage, LlmClient } from './service.js'

// OpenAI vision caps — base64-encoded PNG/JPEG/GIF/WebP, each ≤ 20MB
// per OpenAI's docs (as of GPT-4o).
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
])

export class OpenAILlmClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly defaultModel = 'gpt-4o',
  ) {
    if (!apiKey) throw new Error('OpenAILlmClient requires an API key')
  }

  async send(args: {
    model: string
    prompt: string
    maxOutputTokens?: number
    images?: ChatImage[]
    documents?: ChatDocument[]
  }) {
    const { default: OpenAI } = await import('openai').catch(() => {
      throw new Error('OPENAI_API_KEY is set but the openai package is not installed. Run `npm i openai` in apps/api.')
    })
    const client = new OpenAI({ apiKey: this.apiKey })

    const validImages = (args.images ?? []).filter(img =>
      ALLOWED_IMAGE_TYPES.has(img.mediaType.toLowerCase()) &&
      img.data.length > 0 &&
      img.data.length <= MAX_IMAGE_BYTES,
    )
    const skippedImages = (args.images ?? []).length - validImages.length
    const skippedDocs = args.documents?.length ?? 0  // all PDFs skipped on OpenAI today

    const skipNotes: string[] = []
    if (skippedImages > 0) {
      skipNotes.push(`${skippedImages} image(s) were dropped (over 20MB or unsupported format)`)
    }
    if (skippedDocs > 0) {
      skipNotes.push(`${skippedDocs} PDF document(s) were dropped (OpenAI chat endpoint does not accept inline PDFs today)`)
    }
    const skipNote = skipNotes.length > 0 ? `\n\n[Note: ${skipNotes.join('. ')}.]` : ''

    // Build content: text-only → single string; with images → multi-part
    // array (same shape OpenAI uses for vision).
    const content = validImages.length === 0
      ? (args.prompt + skipNote)
      : [
          { type: 'text' as const, text: args.prompt + skipNote },
          ...validImages.map(img => ({
            type: 'image_url' as const,
            image_url: {
              url: `data:${img.mediaType.toLowerCase()};base64,${img.data.toString('base64')}`,
            },
          })),
        ]

    const response = await client.chat.completions.create({
      model: args.model || this.defaultModel,
      max_tokens: args.maxOutputTokens ?? 4096,
      messages: [{ role: 'user', content: content as never }],
    })

    const responseText = response.choices[0]?.message?.content ?? ''
    const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0 }

    return {
      responseText,
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
    }
  }
}

/** Factory — returns an OpenAILlmClient when OPENAI_API_KEY is set, else null. */
export function createOpenAIClientFromEnv(): OpenAILlmClient | null {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (!key) return null
  const model = process.env.OPENAI_DEFAULT_MODEL?.trim() || 'gpt-4o'
  return new OpenAILlmClient(key, model)
}
