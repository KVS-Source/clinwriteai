import { describe, expect, it } from 'vitest'
import { MockSsoProvider, WorkOsSsoProvider, createSsoProvider } from './sso.js'

describe('MockSsoProvider', () => {
  const provider = new MockSsoProvider('alice@clinwrite.ai')

  it('bounces straight back to the redirectUri with a code', async () => {
    const url = await provider.getAuthorizationUrl({
      state: 'xyz',
      redirectUri: 'https://api.local/auth/callback',
    })
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://api.local/auth/callback')
    expect(parsed.searchParams.get('state')).toBe('xyz')
    expect(parsed.searchParams.get('code')).toBe('mock:alice@clinwrite.ai')
  })

  it('exchanges its own code into a stable identity', async () => {
    const identity = await provider.exchangeCode({
      code: 'mock:alice@clinwrite.ai',
      state: 'xyz',
      redirectUri: 'https://api.local/auth/callback',
    })
    expect(identity).toEqual({
      subject: 'mock|alice@clinwrite.ai',
      email: 'alice@clinwrite.ai',
      name: 'Alice',
    })
  })

  it('refuses codes not issued by itself', async () => {
    await expect(
      provider.exchangeCode({ code: 'workos-real-code', state: 'xyz', redirectUri: '' }),
    ).rejects.toThrow(/only accepts codes issued by itself/i)
  })
})

describe('createSsoProvider', () => {
  it('returns the mock provider for provider=mock', () => {
    expect(createSsoProvider({ provider: 'mock' })).toBeInstanceOf(MockSsoProvider)
  })

  it('requires WorkOS credentials when provider=workos', () => {
    expect(() => createSsoProvider({ provider: 'workos' })).toThrow(/WORKOS_API_KEY/)
  })

  it('constructs the WorkOS provider with credentials present', () => {
    const p = createSsoProvider({ provider: 'workos', workosApiKey: 'sk', workosClientId: 'cid' })
    expect(p).toBeInstanceOf(WorkOsSsoProvider)
  })
})
