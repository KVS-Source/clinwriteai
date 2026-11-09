// SMS adapter — one-interface SMS send with pluggable providers.
//
// Mirrors the shape of EmailAdapter. Three dry-run impls out of the
// box (noop default, log, console) + a Twilio stub that documents what
// the real wiring will look like once procurement completes. Real
// providers (Twilio, Vonage / Nexmo, AWS SNS) slot in behind the same
// `SmsAdapter.send(message)` signature without touching callers.
//
// Selection: `SMS_PROVIDER` env var. Unset or 'noop' ⇒ noop.
// Twilio needs TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM
// to actually deliver; without them we still log the attempt and
// return delivered:false so an ops team can staging-test without
// real credentials.

export interface SmsMessage {
  to:      string               // E.164 phone number; caller validates
  body:    string               // ≤ 1600 chars per Twilio; adapter checks
  /** Optional caller tag for the log — e.g. 'kol_review_invite',
   *  'ma_approval_notification' — makes it easy to grep staging
   *  logs for a specific flow. */
  reason?: string
}

export interface SmsSendResult {
  adapter:           'noop' | 'log' | 'console' | 'twilio' | 'vonage' | 'sns'
  delivered:         boolean
  providerMessageId: string | null
}

export interface SmsAdapter {
  send(message: SmsMessage): Promise<SmsSendResult>
}

const MAX_BODY_CHARS = 1600

function assertSmsShape(m: SmsMessage): void {
  if (!m.to || typeof m.to !== 'string') throw new Error('sms.to required')
  if (!m.body || typeof m.body !== 'string') throw new Error('sms.body required')
  if (m.body.length > MAX_BODY_CHARS) throw new Error(`sms.body exceeds ${MAX_BODY_CHARS} chars`)
}

export class NoopSmsAdapter implements SmsAdapter {
  async send(m: SmsMessage): Promise<SmsSendResult> {
    assertSmsShape(m)
    return { adapter: 'noop', delivered: false, providerMessageId: null }
  }
}

export class LoggingSmsAdapter implements SmsAdapter {
  constructor(private readonly log: { info: (obj: object, msg: string) => void }) {}
  async send(m: SmsMessage): Promise<SmsSendResult> {
    assertSmsShape(m)
    this.log.info({
      to:        m.to,
      reason:    m.reason,
      bodyChars: m.body.length,
    }, 'sms.send (log adapter — no SMS gateway)')
    return { adapter: 'log', delivered: false, providerMessageId: null }
  }
}

export class ConsoleSmsAdapter implements SmsAdapter {
  async send(m: SmsMessage): Promise<SmsSendResult> {
    assertSmsShape(m)
    process.stdout.write(
      `--- sms (console adapter — no gateway) ---\n` +
      `to:     ${m.to}\n` +
      (m.reason ? `reason: ${m.reason}\n` : '') +
      `---\n${m.body}\n---\n`,
    )
    return { adapter: 'console', delivered: false, providerMessageId: null }
  }
}

// Twilio stub — the shape of the real provider adapter without the
// network call. Real wiring POSTs to the Twilio Messages API with
// basic auth (AccountSID + AuthToken) + form body (To + From + Body),
// parses { sid } from the response, returns it as providerMessageId.
// Wire it up when procurement completes; the surface the route calls
// (adapter.send) doesn't change.
export class TwilioSmsAdapterStub implements SmsAdapter {
  constructor(private readonly log?: { warn: (obj: object, msg: string) => void }) {}
  async send(m: SmsMessage): Promise<SmsSendResult> {
    assertSmsShape(m)
    this.log?.warn({
      to:        m.to,
      reason:    m.reason,
      bodyChars: m.body.length,
    }, 'sms.send (twilio-stub — provider configured but adapter not yet implemented)')
    return { adapter: 'twilio', delivered: false, providerMessageId: null }
  }
}

export interface CreateSmsAdapterOpts {
  provider?: string
  log?:      {
    info: (obj: object, msg: string) => void
    warn: (obj: object, msg: string) => void
  }
}

export function createSmsAdapter(opts: CreateSmsAdapterOpts = {}): SmsAdapter {
  const provider = (opts.provider ?? '').toLowerCase().trim()
  switch (provider) {
    case 'log':
      return new LoggingSmsAdapter(opts.log ?? { info: () => undefined })
    case 'console':
      return new ConsoleSmsAdapter()
    case 'twilio':
      // Will become TwilioSmsAdapter(creds) once procurement + a real
      // adapter land. For now returns delivered:false with a warn log
      // so a staging deploy using SMS_PROVIDER=twilio exposes the gap
      // instead of silently dropping messages.
      return new TwilioSmsAdapterStub(opts.log ?? { warn: () => undefined })
    case 'noop':
    case '':
    default:
      return new NoopSmsAdapter()
  }
}
