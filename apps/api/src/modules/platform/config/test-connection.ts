// AI engine "Test connection" (Admin Panel, PRD sPM04 §2.2 / AC-PM-001):
// fire a tiny test prompt at the configured engine and report success or
// failure within 5 seconds. The result is audit-logged by the route.
//
// Honest by design: with no API key it says "not configured" (it never falls
// back to the gateway's offline stub, which would "succeed" without touching a
// provider), and any provider/SDK error is reported as a failure.

import type { LlmClient } from '../ai-gateway/service.js'

export const TEST_PROMPT = 'Reply with the single word: ok'
export const TEST_TIMEOUT_MS = 5_000

export type ConnectionStatus = 'connected' | 'failed' | 'not-configured'

export interface ConnectionResult {
  status:   ConnectionStatus
  model:    string
  latency:  number | null        // ms to a response; null when there was none
  message:  string | null        // human-readable reason when not connected
  testedAt: string               // ISO timestamp
}

export interface ConnectionTestOptions {
  client:     Pick<LlmClient, 'send'> | null     // null = no provider key configured
  model:      string
  timeoutMs?: number
  /** Strings that must never appear in the message (API keys). */
  secrets?:   string[]
}

const clean = (raw: string, secrets: string[]) => {
  let msg = raw
  for (const s of secrets) if (s) msg = msg.split(s).join('***')
  return msg.replace(/\s+/g, ' ').trim().slice(0, 240)
}

export async function runConnectionTest(opts: ConnectionTestOptions): Promise<ConnectionResult> {
  const { client, model, timeoutMs = TEST_TIMEOUT_MS, secrets = [] } = opts
  const testedAt = () => new Date().toISOString()

  if (!client) {
    return {
      status: 'not-configured', model, latency: null, testedAt: testedAt(),
      message: 'No AI provider key is configured on the server (ANTHROPIC_API_KEY).',
    }
  }

  const started = Date.now()
  let timer: NodeJS.Timeout | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`No response within ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs)
    })
    const reply = await Promise.race([client.send({ model, prompt: TEST_PROMPT, maxOutputTokens: 8 }), timeout])
    if (typeof reply?.responseText !== 'string') throw new Error('The provider returned an unexpected response.')
    return { status: 'connected', model, latency: Date.now() - started, message: null, testedAt: testedAt() }
  } catch (err) {
    return {
      status: 'failed', model, latency: null, testedAt: testedAt(),
      message: clean(err instanceof Error ? err.message : String(err), secrets) || 'Connection failed.',
    }
  } finally {
    clearTimeout(timer)
  }
}
