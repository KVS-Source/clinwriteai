// Unit tests for the NCBI E-utilities client.
//
// Uses an injected fetchImpl so the suite runs offline. Covers the
// happy path (esearch → esummary → shaped records), the three failure
// modes the route depends on (HTTP error, network throw, empty idlist),
// and the Vancouver-ish reference formatting helpers via output assertions.

import { describe, expect, it, vi } from 'vitest'
import { fetchPubmedSearch, type PubmedSearchResult } from './pubmed-client.js'

function mkFetch(responders: Array<(url: string) => Partial<Response> | Promise<Partial<Response>>>): typeof fetch {
  let i = 0
  return (async (input: unknown) => {
    const url = typeof input === 'string' ? input : (input as URL).toString()
    const r = responders[i++] ?? (() => ({ ok: false, status: 500, json: async () => ({}) }))
    return r(url) as unknown as Response
  }) as unknown as typeof fetch
}

describe('fetchPubmedSearch', () => {
  it('returns an empty-but-live result for an empty query (no network call)', async () => {
    const f = vi.fn()
    const r = await fetchPubmedSearch('   ', { fetchImpl: f as unknown as typeof fetch })
    expect(r).toEqual({ source: 'ncbi', results: [] })
    expect(f).not.toHaveBeenCalled()
  })

  it('maps esearch ids + esummary metadata into PubmedRecord[]', async () => {
    const fetchImpl = mkFetch([
      () => ({ ok: true, json: async () => ({ esearchresult: { idlist: ['38765432', '38112233'] } }) }),
      () => ({ ok: true, json: async () => ({
        result: {
          uids: ['38765432', '38112233'],
          '38765432': {
            uid: '38765432',
            title: 'Veloricept plus pembrolizumab in advanced NSCLC',
            authors: [{ name: 'Chen SY' }, { name: 'Hartley J' }, { name: 'Morton R' }],
            fulljournalname: 'New England Journal of Medicine',
            source: 'N Engl J Med',
            pubdate: '2026 Mar 12', volume: '395', issue: '', pages: '812-824',
            articleids: [{ idtype: 'doi', value: '10.1056/NEJMoa2601234' }],
          },
          '38112233': {
            uid: '38112233',
            title: 'ICH E6(R3) operational implications',
            authors: [{ name: 'Smith T' }, { name: 'Patel A' }],
            fulljournalname: 'The Lancet',
            source: 'Lancet',
            pubdate: '2025', volume: '406', pages: '1234-1240',
            elocationid: 'doi: 10.1016/S0140-6736(25)00001-X',
          },
        },
      }) }),
    ])
    const r = await fetchPubmedSearch('veloricept nsclc', { fetchImpl })
    expect(r.source).toBe('ncbi')
    expect(r.results).toHaveLength(2)
    expect(r.results[0]).toMatchObject({
      id:    'pm-38765432',
      pmid:  '38765432',
      title: 'Veloricept plus pembrolizumab in advanced NSCLC',
      source: 'New England Journal of Medicine · 2026',
    })
    // Short ref: author "et al" + journal abbr + year;VIP.
    expect(r.results[0]!.shortRef).toMatch(/Chen SY, et al/)
    expect(r.results[0]!.shortRef).toMatch(/N Engl J Med/)
    expect(r.results[0]!.shortRef).toMatch(/2026;395:812-824/)
    // Full ref: all authors (<=6) + title + DOI from articleids.
    expect(r.results[0]!.fullRef).toMatch(/Chen SY, Hartley J, Morton R\./)
    expect(r.results[0]!.fullRef).toMatch(/doi:10\.1056\/NEJMoa2601234/)
    // DOI from elocationid when articleids is absent.
    expect(r.results[1]!.fullRef).toMatch(/doi:10\.1016\/S0140-6736/)
  })

  it('returns an empty-but-live result when esearch finds no PMIDs', async () => {
    const fetchImpl = mkFetch([
      () => ({ ok: true, json: async () => ({ esearchresult: { idlist: [] } }) }),
    ])
    const r = await fetchPubmedSearch('zzqq', { fetchImpl })
    expect(r).toEqual({ source: 'ncbi', results: [] })
  })

  it('falls back to stub when esearch returns a non-2xx status', async () => {
    const fetchImpl = mkFetch([
      () => ({ ok: false, status: 429, json: async () => ({}) }),
    ])
    const r = await fetchPubmedSearch('x', { fetchImpl })
    expect(r.source).toBe('stub')
    expect(r.reason).toContain('429')
  })

  it('falls back to stub when esummary throws (e.g. network)', async () => {
    const fetchImpl = mkFetch([
      () => ({ ok: true, json: async () => ({ esearchresult: { idlist: ['1'] } }) }),
      () => { throw new Error('ECONNRESET') },
    ])
    const r = await fetchPubmedSearch('x', { fetchImpl })
    expect(r.source).toBe('stub')
    expect(r.reason).toMatch(/esummary failed/)
  })

  it('passes NCBI_API_KEY through as api_key when supplied', async () => {
    const urls: string[] = []
    const fetchImpl = ((input: unknown) => {
      urls.push(typeof input === 'string' ? input : (input as URL).toString())
      return Promise.resolve({ ok: true, json: async () => ({ esearchresult: { idlist: [] } }) } as unknown as Response)
    }) as unknown as typeof fetch
    await fetchPubmedSearch('x', { fetchImpl, apiKey: 'test-key-123' })
    expect(urls[0]).toContain('api_key=test-key-123')
  })

  it('caps retmax at 20 even when the caller asks for more', async () => {
    const urls: string[] = []
    const fetchImpl = ((input: unknown) => {
      urls.push(typeof input === 'string' ? input : (input as URL).toString())
      return Promise.resolve({ ok: true, json: async () => ({ esearchresult: { idlist: [] } }) } as unknown as Response)
    }) as unknown as typeof fetch
    await fetchPubmedSearch('x', { fetchImpl, retmax: 500 })
    expect(urls[0]).toContain('retmax=20')
  })
})

// Satisfy TS that the type export compiles.
const _check: PubmedSearchResult = { source: 'ncbi', query: 'x', results: [] }
void _check
