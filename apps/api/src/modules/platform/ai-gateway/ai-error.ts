// AI provider failures in words a writer can act on. The provider SDK throws errors like
// `400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low …"}}`;
// classifyAiError turns that into a code, an HTTP status for our own response, and a plain message.
// The raw text stays in the server log, never in the UI.

export type AiErrorCode = 'ai_out_of_credit' | 'ai_key_invalid' | 'ai_rate_limited' | 'ai_busy' | 'ai_failed'

export interface AiErrorBody {
  error:   AiErrorCode
  message: string
  /** Who can fix it: an admin (credit, key) or nobody — just try again later. */
  fix:     'admin' | 'retry'
}

const MESSAGES: Record<AiErrorCode, { message: string; fix: AiErrorBody['fix']; status: number }> = {
  ai_out_of_credit: { status: 503, fix: 'admin', message: 'The AI account has run out of credit, so nothing can be drafted right now. An admin can top it up with the AI provider (Plans & Billing), or paste a key with credit under Admin → AI engine.' },
  ai_key_invalid:   { status: 503, fix: 'admin', message: 'The AI key was not accepted by the AI provider. An admin can paste a valid key under Admin → AI engine.' },
  ai_rate_limited:  { status: 503, fix: 'retry', message: 'The AI provider is limiting how many requests this account can make. Wait a minute and try again.' },
  ai_busy:          { status: 503, fix: 'retry', message: 'The AI provider is busy right now. Try again in a few minutes.' },
  ai_failed:        { status: 502, fix: 'retry', message: 'The AI request did not go through. Try again; if it keeps failing, ask an admin to check AI Debug.' },
}

export function classifyAiError(err: unknown): { status: number; body: AiErrorBody } {
  const e = err as { status?: unknown; message?: unknown } | null
  const text = String(e?.message ?? err ?? '')
  const status = typeof e?.status === 'number' ? e.status : Number(/^\s*(\d{3})\b/.exec(text)?.[1] ?? 0)
  const code: AiErrorCode =
    /credit balance|billing|insufficient[_ ]?(funds|quota)|quota exceeded/i.test(text) ? 'ai_out_of_credit'
    : status === 401 || status === 403 || /authentication_error|invalid x-api-key|invalid api key|permission_error/i.test(text) ? 'ai_key_invalid'
    : status === 429 || /rate_limit/i.test(text) ? 'ai_rate_limited'
    : status === 529 || status === 503 || /overloaded/i.test(text) ? 'ai_busy'
    : 'ai_failed'
  const m = MESSAGES[code]
  return { status: m.status, body: { error: code, message: m.message, fix: m.fix } }
}
