// Unit tests for the SocialPublishAdapter.

import { describe, expect, it, vi } from 'vitest'
import {
  ConsoleSocialPublishAdapter,
  LinkedInStubAdapter,
  LoggingSocialPublishAdapter,
  MetaStubAdapter,
  NoopSocialPublishAdapter,
  TwitterStubAdapter,
  createSocialPublishAdapter,
} from './adapter.js'

const msg = {
  channel: 'linkedin' as const,
  title:   'VELORA-301 primary results',
  body:    'Adding pembrolizumab + veloricept significantly improved PFS. Full data at ASCO.',
  reason:  'launch_campaign',
  utm:     { utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'velora-launch' },
  assetUrls: ['https://cdn.example/velora-pfs.png'],
}

describe('NoopSocialPublishAdapter', () => {
  it('returns delivered=false and validates the payload', async () => {
    const r = await new NoopSocialPublishAdapter().publish(msg)
    expect(r).toEqual({ adapter: 'noop', delivered: false, externalId: null, externalUrl: null })
  })
  it('rejects malformed payloads', async () => {
    const a = new NoopSocialPublishAdapter()
    await expect(a.publish({ channel: '' as never, body: 'x' })).rejects.toThrow(/channel required/)
    await expect(a.publish({ channel: 'linkedin', body: '' })).rejects.toThrow(/body required/)
    await expect(a.publish({ channel: 'linkedin', body: 'x'.repeat(10_001) })).rejects.toThrow(/exceeds 10000/)
  })
})

describe('LoggingSocialPublishAdapter', () => {
  it('logs channel + reason + body char count + asset count + utm keys', async () => {
    const log = { info: vi.fn() }
    await new LoggingSocialPublishAdapter(log).publish(msg)
    const [payload, line] = log.info.mock.calls[0]!
    expect(payload).toMatchObject({
      channel: 'linkedin', reason: 'launch_campaign',
      hasTitle: true, assetCount: 1,
    })
    expect((payload as { utmKeys: string[] }).utmKeys).toEqual(['utm_source', 'utm_medium', 'utm_campaign'])
    expect(line).toMatch(/log adapter/)
  })
})

describe('ConsoleSocialPublishAdapter', () => {
  it('writes payload to stdout', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const r = await new ConsoleSocialPublishAdapter().publish(msg)
    expect(r.adapter).toBe('console')
    const text = write.mock.calls.map(c => String(c[0])).join('')
    expect(text).toContain('channel: linkedin')
    expect(text).toContain('title:   VELORA-301 primary results')
    expect(text).toContain('assets:  1')
    write.mockRestore()
  })
})

describe('Provider stubs', () => {
  it('LinkedIn stub reports adapter=linkedin / delivered=false + warn log', async () => {
    const log = { warn: vi.fn() }
    const r = await new LinkedInStubAdapter(log).publish(msg)
    expect(r).toEqual({ adapter: 'linkedin', delivered: false, externalId: null, externalUrl: null })
    expect(log.warn).toHaveBeenCalled()
  })
  it('Twitter stub warns separately when body > 280 chars', async () => {
    const log = { warn: vi.fn() }
    await new TwitterStubAdapter(log).publish({ channel: 'twitter', body: 'x'.repeat(300) })
    // Two warns: body-too-long + not-implemented
    expect(log.warn).toHaveBeenCalledTimes(2)
    expect((log.warn.mock.calls[0]?.[0] as { bodyChars: number }).bodyChars).toBe(300)
  })
  it('Meta stub reports adapter=meta', async () => {
    const r = await new MetaStubAdapter().publish({ channel: 'facebook', body: 'x' })
    expect(r.adapter).toBe('meta')
  })
})

describe('createSocialPublishAdapter', () => {
  it('defaults to noop', () => expect(createSocialPublishAdapter()).toBeInstanceOf(NoopSocialPublishAdapter))
  it('selects by provider name case-insensitively and routes aliases', () => {
    expect(createSocialPublishAdapter({ provider: '  LOG  ', log: { info: () => undefined, warn: () => undefined } })).toBeInstanceOf(LoggingSocialPublishAdapter)
    expect(createSocialPublishAdapter({ provider: 'linkedin', log: { info: () => undefined, warn: () => undefined } })).toBeInstanceOf(LinkedInStubAdapter)
    expect(createSocialPublishAdapter({ provider: 'x',        log: { info: () => undefined, warn: () => undefined } })).toBeInstanceOf(TwitterStubAdapter)
    expect(createSocialPublishAdapter({ provider: 'twitter',  log: { info: () => undefined, warn: () => undefined } })).toBeInstanceOf(TwitterStubAdapter)
    expect(createSocialPublishAdapter({ provider: 'facebook', log: { info: () => undefined, warn: () => undefined } })).toBeInstanceOf(MetaStubAdapter)
    expect(createSocialPublishAdapter({ provider: 'instagram',log: { info: () => undefined, warn: () => undefined } })).toBeInstanceOf(MetaStubAdapter)
  })
  it('falls back to noop for unknown providers', () => {
    expect(createSocialPublishAdapter({ provider: 'tiktok' })).toBeInstanceOf(NoopSocialPublishAdapter)
  })
})
