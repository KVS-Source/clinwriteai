// AI provider failures in words a writer can act on (ai-error.ts).

import { describe, expect, it } from 'vitest'
import { classifyAiError } from './ai-error.js'

const sdk = (status: number, type: string, message: string) =>
  Object.assign(new Error(`${status} {"type":"error","error":{"type":"${type}","message":"${message}"},"request_id":"req_1"}`), { status })

describe('classifyAiError', () => {
  it('out of credit: an admin fixes it; the raw provider text is not passed on', () => {
    const r = classifyAiError(sdk(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'))
    expect(r).toMatchObject({ status: 503, body: { error: 'ai_out_of_credit', fix: 'admin' } })
    expect(r.body.message).not.toMatch(/request_id|\{/)
  })
  it('bad key, rate limit, overloaded, anything else', () => {
    expect(classifyAiError(sdk(401, 'authentication_error', 'invalid x-api-key')).body).toMatchObject({ error: 'ai_key_invalid', fix: 'admin' })
    expect(classifyAiError(sdk(429, 'rate_limit_error', 'slow down')).body).toMatchObject({ error: 'ai_rate_limited', fix: 'retry' })
    expect(classifyAiError(sdk(529, 'overloaded_error', 'Overloaded')).body).toMatchObject({ error: 'ai_busy', fix: 'retry' })
    expect(classifyAiError(new Error('socket hang up'))).toMatchObject({ status: 502, body: { error: 'ai_failed', fix: 'retry' } })
  })
  it('reads the status from the message when the error has none', () => {
    expect(classifyAiError(new Error('429 {"type":"error"}')).body.error).toBe('ai_rate_limited')
  })
})
