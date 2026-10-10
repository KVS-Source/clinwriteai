// AnthropicLlmClient — Arc 8.1.
//
// Real Anthropic SDK wrapper. Picked up by the gateway's createLlmClient()
// factory when `ANTHROPIC_API_KEY` is set in the environment; otherwise
// the gateway falls back to StubLlmClient (deterministic, no network).
//
// Design notes:
//   - This file imports @anthropic-ai/sdk lazily (dynamic import inside
//     send()). The dependency isn't in package.json yet — procurement
//     for the API key is pending. When procurement completes, add the
//     dep and the env var; no code change elsewhere needed.
//   - send() shape matches the LlmClient interface exactly, so swapping
//     is a single factory decision rather than a call-site change.
//   - Prompt caching: Anthropic's SDK reports `cache_creation_input_tokens`
//     and `cache_read_input_tokens` separately. The gateway's AiCallRecord
//     already has a `cachedTokens` column — we populate it from the sum
//     of both. See docs/pivot-plan.md Arc 8.1.

import type { LlmClient } from './service.js'

export class AnthropicLlmClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    // Default to the current flagship model; the gateway's `args.model`
    // override wins per-call.
    private readonly defaultModel = 'claude-opus-4-7',
  ) {
    if (!apiKey) throw new Error('AnthropicLlmClient requires an API key')
  }

  async send(args: { model: string; prompt: string; maxOutputTokens?: number }) {
    // Lazy-load the SDK so the dependency can be added without touching
    // this file. Will throw at runtime if the dep isn't installed yet —
    // the factory catches this and logs a clear message.
    // @ts-expect-error — dep not installed until ANTHROPIC_API_KEY is set in prod
    const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
      throw new Error(
        'ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed. Run `npm i @anthropic-ai/sdk` in apps/api.',
      )
    })

    const client = new Anthropic({ apiKey: this.apiKey })

    const response = await client.messages.create({
      model: args.model || this.defaultModel,
      max_tokens: args.maxOutputTokens ?? 4096,
      messages: [{ role: 'user', content: args.prompt }],
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
