// Unit tests for the CrossRef client — stubbed fetch, no network.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { crossRefLookup, crossRefMint } from './crossref-client.js'

function mkFetch(respond: (url: string) => Partial<Response> | Promise<Partial<Response>>): typeof fetch {
  return (async (input: unknown) => {
    const url = typeof input === 'string' ? input : (input as URL).toString()
    return respond(url) as unknown as Response
  }) as unknown as typeof fetch
}

describe('crossRefLookup', () => {
  it('returns found=false + reason for empty doi (no network call)', async () => {
    const r = await crossRefLookup('   ', { fetchImpl: mkFetch(() => { throw new Error('should not be called') }) })
    expect(r).toEqual({ found: false, reason: 'empty_doi' })
  })

  it('returns parsed title + journal + year on a successful public lookup', async () => {
    const r = await crossRefLookup('10.1056/NEJMoa260XXXX', {
      fetchImpl: mkFetch(() => ({
        ok: true, status: 200,
        json: async () => ({
          message: {
            title: ['VELORA Phase III primary analysis'],
            'container-title': ['New England Journal of Medicine'],
            issued: { 'date-parts': [[2026, 3, 12]] },
          },
        }),
      })),
    })
    expect(r).toMatchObject({
      found:   true,
      title:   'VELORA Phase III primary analysis',
      journal: 'New England Journal of Medicine',
      year:    2026,
    })
  })

  it('returns found=false with not_in_crossref on 404', async () => {
    const r = await crossRefLookup('10.5555/does-not-exist', {
      fetchImpl: mkFetch(() => ({ ok: false, status: 404, json: async () => ({}) })),
    })
    expect(r).toEqual({ found: false, reason: 'not_in_crossref' })
  })

  it('returns found=false with http status on other non-2xx', async () => {
    const r = await crossRefLookup('10.5555/x', {
      fetchImpl: mkFetch(() => ({ ok: false, status: 429, json: async () => ({}) })),
    })
    expect(r.found).toBe(false)
    expect(r.reason).toContain('429')
  })

  it('returns found=false with the error reason on fetch throw', async () => {
    const r = await crossRefLookup('10.5555/x', {
      fetchImpl: mkFetch(() => { throw new Error('ECONNRESET') }),
    })
    expect(r.found).toBe(false)
    expect(r.reason).toContain('ECONNRESET')
  })

  it('sends a User-Agent header identifying the deploy (CrossRef etiquette)', async () => {
    let seenHeaders: Record<string, string> | undefined
    const fetchImpl = ((input: unknown, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as unknown as Response)
    }) as unknown as typeof fetch
    await crossRefLookup('10.1/x', { fetchImpl })
    expect(seenHeaders?.['User-Agent']).toMatch(/aurora-clinwrite/)
  })
})

describe('crossRefMint', () => {
  const origUser = process.env.CROSSREF_API_USER
  const origPwd  = process.env.CROSSREF_API_PASSWORD
  afterEach(() => {
    process.env.CROSSREF_API_USER     = origUser
    process.env.CROSSREF_API_PASSWORD = origPwd
  })

  it('returns source=stub with the suggested DOI when creds are missing', async () => {
    delete process.env.CROSSREF_API_USER
    delete process.env.CROSSREF_API_PASSWORD
    const r = await crossRefMint({ doi: '10.5555/aurora.card-1', title: 't', url: '/u' })
    expect(r).toMatchObject({ source: 'stub', doi: '10.5555/aurora.card-1' })
    expect(r.reason).toBe('crossref_credentials_not_configured')
  })

  it('also returns source=stub when creds are set but the deposit implementation is still pending', async () => {
    const r = await crossRefMint(
      { doi: '10.5555/aurora.card-1', title: 't', url: '/u' },
      { apiUser: 'u', apiPassword: 'p' },
    )
    // Deposit XML + signed POST still to implement; shape is stable.
    expect(r.source).toBe('stub')
    expect(r.reason).toBe('deposit_implementation_pending')
  })
})
