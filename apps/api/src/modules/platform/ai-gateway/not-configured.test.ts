// With no real AI provider the gateway must refuse — never answer with placeholder text, never write a
// record. The stub is available only behind the explicit AI_ALLOW_STUB=1 dev/CI flag.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiGatewayService, AiNotConfiguredError, stubAllowed } from './service.js'

const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'AI_ALLOW_STUB']
const clearEnv = () => KEYS.forEach(k => vi.stubEnv(k, ''))

// prisma is never touched when the call is refused up front; this proves it.
const untouchedPrisma = new Proxy({}, { get: () => { throw new Error('prisma must not be used when AI is not configured') } }) as never

const call = (model: string) => ({
  tenantId: null, actorId: 'u1', module: 'A' as const, intent: 'edit', model, prompt: 'Rewrite this section.',
})

afterEach(() => vi.unstubAllEnvs())

describe('AI not configured', () => {
  it('refuses with "AI is not configured" and touches nothing (no quota lookup, no record)', async () => {
    clearEnv()
    const svc = new AiGatewayService(untouchedPrisma)
    await expect(svc.chat(call('claude-opus-4-7'))).rejects.toBeInstanceOf(AiNotConfiguredError)
    await expect(svc.chat(call('claude-opus-4-7'))).rejects.toMatchObject({ message: 'AI is not configured', statusCode: 503, code: 'ai_not_configured' })
  })

  it('reports not configured for every provider when no key is set', () => {
    clearEnv()
    const svc = new AiGatewayService(untouchedPrisma)
    for (const m of ['claude-opus-4-7', 'gpt-4o', 'gemini-1.5-pro', 'some-unknown-model']) expect(svc.isConfigured(m)).toBe(false)
  })

  it('a key configures only its own provider; an unrecognised model name is never configured', () => {
    clearEnv()
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test')
    const svc = new AiGatewayService(untouchedPrisma)
    expect(svc.isConfigured('claude-opus-4-7')).toBe(true)
    expect(svc.isConfigured('gpt-4o')).toBe(false)
    expect(svc.isConfigured('some-unknown-model')).toBe(false)
  })

  it('AI_ALLOW_STUB=1 (dev/CI only) is the only way the placeholder client is used', () => {
    clearEnv()
    expect(stubAllowed()).toBe(false)
    vi.stubEnv('AI_ALLOW_STUB', '1')
    expect(stubAllowed()).toBe(true)
    expect(new AiGatewayService(untouchedPrisma).isConfigured('claude-opus-4-7')).toBe(true)
  })

  it('"true" or "yes" is not the flag — only the exact value 1', () => {
    clearEnv()
    vi.stubEnv('AI_ALLOW_STUB', 'true')
    expect(stubAllowed()).toBe(false)
  })
})
