// Unit tests for the email adapter — no Fastify / no plugin, just the
// adapter picker + the three dry-run impls.

import { describe, expect, it, vi } from 'vitest'
import {
  ConsoleEmailAdapter,
  LoggingEmailAdapter,
  NoopEmailAdapter,
  createEmailAdapter,
} from './adapter.js'

const msg = {
  to:       'alice@example.com',
  subject:  'Please complete your author details',
  textBody: 'Hi Alice, please confirm your affiliation + conflict-of-interest statement.\n',
  reason:   'author_reminder',
}

describe('NoopEmailAdapter', () => {
  it('returns {adapter:noop, delivered:false} and stays silent', async () => {
    const r = await new NoopEmailAdapter().send(msg)
    expect(r).toEqual({ adapter: 'noop', delivered: false, providerMessageId: null })
  })
})

describe('LoggingEmailAdapter', () => {
  it('writes the outgoing payload to the injected logger and reports not-delivered', async () => {
    const log = { info: vi.fn() }
    const r = await new LoggingEmailAdapter(log).send(msg)
    expect(r).toEqual({ adapter: 'log', delivered: false, providerMessageId: null })
    expect(log.info).toHaveBeenCalledTimes(1)
    const [payload, line] = log.info.mock.calls[0]!
    expect(payload).toMatchObject({ to: msg.to, subject: msg.subject, reason: 'author_reminder' })
    expect((payload as { bodyChars: number }).bodyChars).toBeGreaterThan(0)
    expect(line).toMatch(/log adapter/)
  })
})

describe('ConsoleEmailAdapter', () => {
  it('writes the payload to stdout and reports not-delivered', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const r = await new ConsoleEmailAdapter().send(msg)
    expect(r.adapter).toBe('console')
    expect(r.delivered).toBe(false)
    const written = write.mock.calls.map(c => String(c[0])).join('')
    expect(written).toContain('to:      alice@example.com')
    expect(written).toContain('subject: Please complete')
    write.mockRestore()
  })
})

describe('createEmailAdapter', () => {
  it('returns NoopEmailAdapter by default (missing env)', () => {
    const a = createEmailAdapter()
    expect(a).toBeInstanceOf(NoopEmailAdapter)
  })

  it('matches "noop" explicitly', () => {
    expect(createEmailAdapter({ provider: 'noop' })).toBeInstanceOf(NoopEmailAdapter)
  })

  it('returns LoggingEmailAdapter for provider=log', () => {
    expect(createEmailAdapter({ provider: 'log', log: { info: () => undefined } })).toBeInstanceOf(LoggingEmailAdapter)
  })

  it('returns ConsoleEmailAdapter for provider=console', () => {
    expect(createEmailAdapter({ provider: 'console' })).toBeInstanceOf(ConsoleEmailAdapter)
  })

  it('is case-insensitive and whitespace-tolerant on the provider name', () => {
    expect(createEmailAdapter({ provider: '  LOG  ', log: { info: () => undefined } })).toBeInstanceOf(LoggingEmailAdapter)
  })

  it('falls back to noop for unknown provider strings (future-safe)', () => {
    expect(createEmailAdapter({ provider: 'postmark' })).toBeInstanceOf(NoopEmailAdapter)
  })
})
