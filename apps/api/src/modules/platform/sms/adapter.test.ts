// Unit tests for the SMS adapter.

import { describe, expect, it, vi } from 'vitest'
import {
  ConsoleSmsAdapter,
  LoggingSmsAdapter,
  NoopSmsAdapter,
  TwilioSmsAdapterStub,
  createSmsAdapter,
} from './adapter.js'

const msg = {
  to:     '+15551234567',
  body:   'Your KOL review for VELORA is ready — please tap the link in your email to start.',
  reason: 'kol_review_invite',
}

describe('NoopSmsAdapter', () => {
  it('returns delivered=false and stays silent', async () => {
    const r = await new NoopSmsAdapter().send(msg)
    expect(r).toEqual({ adapter: 'noop', delivered: false, providerMessageId: null })
  })
  it('rejects malformed payloads before pretending to send', async () => {
    await expect(new NoopSmsAdapter().send({ to: '', body: 'x' })).rejects.toThrow(/to required/)
    await expect(new NoopSmsAdapter().send({ to: '+1', body: '' })).rejects.toThrow(/body required/)
    await expect(new NoopSmsAdapter().send({ to: '+1', body: 'x'.repeat(1601) })).rejects.toThrow(/exceeds 1600/)
  })
})

describe('LoggingSmsAdapter', () => {
  it('writes to the injected logger with bodyChars + reason', async () => {
    const log = { info: vi.fn() }
    const r = await new LoggingSmsAdapter(log).send(msg)
    expect(r).toEqual({ adapter: 'log', delivered: false, providerMessageId: null })
    const [payload, line] = log.info.mock.calls[0]!
    expect(payload).toMatchObject({ to: msg.to, reason: 'kol_review_invite' })
    expect((payload as { bodyChars: number }).bodyChars).toBe(msg.body.length)
    expect(line).toMatch(/log adapter/)
  })
})

describe('ConsoleSmsAdapter', () => {
  it('writes to stdout', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const r = await new ConsoleSmsAdapter().send(msg)
    expect(r.adapter).toBe('console')
    expect(write.mock.calls.map(c => String(c[0])).join('')).toContain('to:     +15551234567')
    write.mockRestore()
  })
})

describe('TwilioSmsAdapterStub', () => {
  it('reports adapter=twilio but delivered=false and warns that it is not implemented', async () => {
    const log = { warn: vi.fn() }
    const r = await new TwilioSmsAdapterStub(log).send(msg)
    expect(r).toEqual({ adapter: 'twilio', delivered: false, providerMessageId: null })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0]?.[1]).toMatch(/twilio-stub/)
  })
})

describe('createSmsAdapter', () => {
  it('defaults to noop', () => expect(createSmsAdapter()).toBeInstanceOf(NoopSmsAdapter))
  it('selects by provider name case-insensitively', () => {
    expect(createSmsAdapter({ provider: '  LOG  ', log: { info: () => undefined, warn: () => undefined } })).toBeInstanceOf(LoggingSmsAdapter)
    expect(createSmsAdapter({ provider: 'console' })).toBeInstanceOf(ConsoleSmsAdapter)
    expect(createSmsAdapter({ provider: 'twilio', log: { info: () => undefined, warn: () => undefined } })).toBeInstanceOf(TwilioSmsAdapterStub)
  })
  it('falls back to noop for unknown providers', () => {
    expect(createSmsAdapter({ provider: 'vonage' })).toBeInstanceOf(NoopSmsAdapter)
  })
})
