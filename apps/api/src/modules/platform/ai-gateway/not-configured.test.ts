// With no real AI provider the gateway must refuse — never answer with placeholder text, never write a
// record. The stub is available only behind the explicit AI_ALLOW_STUB=1 dev/CI flag.
//
// Post-env-disconnect note: Anthropic's key is now DB-backed only
// (ExternalApiCredential apiId='anthropic'). The sync isConfigured()
// optimistically returns true for claude-* models; the authoritative check
// lives at send() time, which calls the DB resolver and raises
// AiNotConfiguredError when no row exists.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiGatewayService, AiNotConfiguredError, stubAllowed } from './service.js'

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'AI_ALLOW_STUB']
const clearEnv = () => KEYS.forEach(k => vi.stubEnv(k, ''))

// Returns a Prisma stub that answers the DB key lookup with `apiKey`
// (null = "no row" — not configured). The findFirst call shape matches
// what resolveAnthropicKey issues; anything else throws so the test fails
// loudly if the gateway tries to touch an unmocked collection.
const prismaWithKey = (apiKey: string | null) => ({
  externalApiCredential: {
    findFirst: async () => apiKey === null ? null : { apiKey },
  },
}) as never

const call = (model: string) => ({
  tenantId: null, actorId: 'u1', module: 'A' as const, intent: 'edit', model, prompt: 'Rewrite this section.',
})

afterEach(() => vi.unstubAllEnvs())

describe('AI not configured', () => {
  it('refuses with "AI is not configured" when the DB has no Anthropic row (no quota lookup, no record)', async () => {
    clearEnv()
    const svc = new AiGatewayService(prismaWithKey(null))
    await expect(svc.chat(call('claude-opus-4-7'))).rejects.toBeInstanceOf(AiNotConfiguredError)
    await expect(svc.chat(call('claude-opus-4-7'))).rejects.toMatchObject({ message: 'AI is not configured', statusCode: 503, code: 'ai_not_configured' })
  })

  it('sync isConfigured is permissive for Anthropic (authoritative check is at send time)', () => {
    clearEnv()
    const svc = new AiGatewayService(prismaWithKey(null))
    // Claude passes the sync gate; the real "not configured" raises when
    // send() can't find a DB key. Keeps existing enqueue-decision
    // callers non-async while still routing to the "AI not configured"
    // UX once the drafter runs.
    expect(svc.isConfigured('claude-opus-4-7')).toBe(true)
    // Other providers still env-only here.
    expect(svc.isConfigured('gpt-4o')).toBe(false)
    expect(svc.isConfigured('some-unknown-model')).toBe(false)
  })

  it('OpenAI / Gemini still read env (DB-only migration covers Anthropic for now)', () => {
    clearEnv()
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai')
    const svc = new AiGatewayService(prismaWithKey(null))
    expect(svc.isConfigured('gpt-4o')).toBe(true)
    expect(svc.isConfigured('gemini-1.5-pro')).toBe(false)
  })

  it('AI_ALLOW_STUB=1 (dev/CI only) is the only way the placeholder client is used', () => {
    clearEnv()
    expect(stubAllowed()).toBe(false)
    vi.stubEnv('AI_ALLOW_STUB', '1')
    expect(stubAllowed()).toBe(true)
    expect(new AiGatewayService(prismaWithKey(null)).isConfigured('claude-opus-4-7')).toBe(true)
  })

  it('"true" or "yes" is not the flag — only the exact value 1', () => {
    clearEnv()
    vi.stubEnv('AI_ALLOW_STUB', 'true')
    expect(stubAllowed()).toBe(false)
  })
})
