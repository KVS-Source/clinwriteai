// GeminiLlmClient — real Google Generative AI SDK wrapper. Picked up by
// the gateway's createLlmClient() factory when the requested model id
// starts with `gemini-` AND `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) is
// set; otherwise the gateway falls back to the stub.
//
// Vision: Gemini 1.5+ models accept inlineData parts in the same
// user message as the prompt text. Images, PDFs and video are all
// first-class content types. We attach PDF documents the same way
// (as inlineData with media_type application/pdf).
//
// Caps (as of Gemini 1.5 Pro / Flash):
//   - Image: 20MB per inline attachment
//   - PDF:   50MB per inline attachment; up to 3600 pages
//   - Many attachments allowed per request; we enforce the same 5-image
//     / 3-document caps the Anthropic route uses to keep cost bounded.

import type { ChatDocument, ChatImage, LlmClient } from './service.js'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
])
const ALLOWED_DOCUMENT_TYPES = new Set([
  'application/pdf',
])

export class GeminiLlmClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly defaultModel = 'gemini-1.5-pro',
  ) {
    if (!apiKey) throw new Error('GeminiLlmClient requires an API key')
  }

  async send(args: {
    model: string
    prompt: string
    maxOutputTokens?: number
    images?: ChatImage[]
    documents?: ChatDocument[]
  }) {
    const { GoogleGenerativeAI } = await import('@google/generative-ai').catch(() => {
      throw new Error('GOOGLE_API_KEY is set but @google/generative-ai is not installed. Run `npm i @google/generative-ai` in apps/api.')
    })
    const genAI = new GoogleGenerativeAI(this.apiKey)
    const model = genAI.getGenerativeModel({
      model: args.model || this.defaultModel,
    })

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
      skipNotes.push(`${skippedImages} image(s) were dropped (over 20MB or unsupported format)`)
    }
    if (skippedDocs > 0) {
      skipNotes.push(`${skippedDocs} PDF document(s) were dropped (over 50MB or unsupported format)`)
    }
    const skipNote = skipNotes.length > 0 ? `\n\n[Note: ${skipNotes.join('. ')}.]` : ''

    // Gemini content model: Array<{ inlineData: { mimeType, data } } | { text }>.
    // Attachments first, then text — same convention as Anthropic.
    const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = []
    for (const doc of validDocs) {
      parts.push({ inlineData: { mimeType: 'application/pdf', data: doc.data.toString('base64') } })
    }
    for (const img of validImages) {
      parts.push({ inlineData: { mimeType: img.mediaType.toLowerCase(), data: img.data.toString('base64') } })
    }
    parts.push({ text: args.prompt + skipNote })

    const response = await model.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        maxOutputTokens: args.maxOutputTokens ?? 4096,
      },
    })

    const responseText = response.response.text()
    const usage = response.response.usageMetadata ?? { promptTokenCount: 0, candidatesTokenCount: 0 }

    return {
      responseText,
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
    }
  }
}

/** Factory — returns a GeminiLlmClient when GOOGLE_API_KEY (or GEMINI_API_KEY) is set, else null. */
export function createGeminiClientFromEnv(): GeminiLlmClient | null {
  const key = (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY)?.trim()
  if (!key) return null
  const model = process.env.GEMINI_DEFAULT_MODEL?.trim() || 'gemini-1.5-pro'
  return new GeminiLlmClient(key, model)
}
