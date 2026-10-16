import { describe, expect, it, vi } from 'vitest'
import { runConnectionTest, TEST_PROMPT } from './test-connection.js'

const ok = (text = 'ok') => ({ send: vi.fn(async () => ({ responseText: text, inputTokens: 5, outputTokens: 1 })) })

describe('runConnectionTest', () => {
  it('reports "not-configured" without calling anything when there is no client (no key)', async () => {
    const res = await runConnectionTest({ client: null, model: 'claude-sonnet-4-6' })
    expect(res).toMatchObject({ status: 'not-configured', model: 'claude-sonnet-4-6', latency: null })
    expect(res.message).toMatch(/ANTHROPIC_API_KEY/)
  })

  it('sends a tiny test prompt to the configured model and reports connected + latency', async () => {
    const client = ok()
    const res = await runConnectionTest({ client, model: 'claude-sonnet-4-6' })
    expect(client.send).toHaveBeenCalledWith({ model: 'claude-sonnet-4-6', prompt: TEST_PROMPT, maxOutputTokens: 8 })
    expect(res.status).toBe('connected')
    expect(res.latency).toBeGreaterThanOrEqual(0)
    expect(res.message).toBeNull()
    expect(new Date(res.testedAt).toString()).not.toBe('Invalid Date')
  })

  it('reports a provider error as a failure', async () => {
    const client = { send: vi.fn(async () => { throw new Error('401 invalid x-api-key') }) }
    const res = await runConnectionTest({ client, model: 'm' })
    expect(res).toMatchObject({ status: 'failed', latency: null, message: '401 invalid x-api-key' })
  })

  it('never leaks the API key in a failure message', async () => {
    const key = 'sk-ant-SECRET123'
    const client = { send: vi.fn(async () => { throw new Error(`auth failed for key ${key} (retry later)`) }) }
    const res = await runConnectionTest({ client, model: 'm', secrets: [key] })
    expect(res.message).not.toContain('SECRET123')
    expect(res.message).toContain('***')
  })

  it('gives up after the time limit instead of hanging (AC-PM-001: within 5 seconds)', async () => {
    const client = { send: vi.fn(() => new Promise<never>(() => undefined)) }     // never answers
    const started = Date.now()
    const res = await runConnectionTest({ client, model: 'm', timeoutMs: 50 })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(res).toMatchObject({ status: 'failed' })
    expect(res.message).toMatch(/No response within/)
  })

  it('treats a malformed provider reply as a failure', async () => {
    const client = { send: vi.fn(async () => ({}) as never) }
    expect((await runConnectionTest({ client, model: 'm' })).status).toBe('failed')
  })
})
