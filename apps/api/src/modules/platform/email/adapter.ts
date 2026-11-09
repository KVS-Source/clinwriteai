// Email adapter — the one place in the API that decides what to do
// with an outgoing email request.
//
// Ships with three implementations:
//   - 'noop'  : silently drops the message. Default. Matches prior
//               behaviour (route writes an audit event, nothing sent).
//   - 'log'   : writes the full outgoing payload to the Fastify logger
//               at info level. Useful on staging / smoke-test deploys
//               where you want evidence that the right people would be
//               notified without actually sending.
//   - 'console' : writes to stdout. For local dev when the Fastify
//                 logger is noisy or pino-pretty is configured off.
//
// Real providers (Postmark / SES / SendGrid) slot in by adding a new
// case to createEmailAdapter + an impl file. The current `send()`
// signature is deliberately the minimum needed: to, subject, textBody.
// HTML / template / attachment support comes with the real provider.
//
// Selection: `EMAIL_PROVIDER` env var. Unset or 'noop' = noop. Routes
// receive the adapter via `app.email` (decorated by the plugin).

export interface EmailMessage {
  to:       string
  subject:  string
  textBody: string
  /** Optional caller tag for the log — e.g. 'author_reminder',
   *  'review_due_soon' — makes it easy to grep the staging log for a
   *  specific flow without parsing the subject. */
  reason?:  string
}

export interface EmailSendResult {
  /** Which adapter actually handled this send. */
  adapter: 'noop' | 'log' | 'console' | 'postmark' | 'ses' | 'sendgrid'
  /** True when the adapter would send on a real provider. For noop /
   *  log this is false: the message was tracked but no SMTP hop
   *  happened. Routes can surface this to the UI so writers know a
   *  dry-run deploy didn't reach anyone. */
  delivered: boolean
  /** Provider-side identifier when available. Null for dry-run
   *  adapters; the real providers return their message id so audit
   *  entries can link to the delivery record later. */
  providerMessageId: string | null
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<EmailSendResult>
}

// --- implementations ------------------------------------------------------

export class NoopEmailAdapter implements EmailAdapter {
  async send(_message: EmailMessage): Promise<EmailSendResult> {
    return { adapter: 'noop', delivered: false, providerMessageId: null }
  }
}

export class LoggingEmailAdapter implements EmailAdapter {
  constructor(private readonly log: { info: (obj: object, msg: string) => void }) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.log.info({
      to:       message.to,
      subject:  message.subject,
      reason:   message.reason,
      bodyChars: message.textBody.length,
    }, 'email.send (log adapter — no SMTP)')
    return { adapter: 'log', delivered: false, providerMessageId: null }
  }
}

export class ConsoleEmailAdapter implements EmailAdapter {
  async send(message: EmailMessage): Promise<EmailSendResult> {
    // process.stdout.write keeps formatting exact; console.log() mangles
    // multiline bodies on some Windows shells.
    process.stdout.write(
      `--- email (console adapter — no SMTP) ---\n` +
      `to:      ${message.to}\n` +
      `subject: ${message.subject}\n` +
      (message.reason ? `reason:  ${message.reason}\n` : '') +
      `---\n${message.textBody}\n---\n`,
    )
    return { adapter: 'console', delivered: false, providerMessageId: null }
  }
}

// --- factory --------------------------------------------------------------

export interface CreateEmailAdapterOpts {
  /** `EMAIL_PROVIDER` env — overrides selection. Missing / unknown = noop. */
  provider?: string
  /** Logger passed to the log adapter. Required if provider === 'log'. */
  log?: { info: (obj: object, msg: string) => void }
}

export function createEmailAdapter(opts: CreateEmailAdapterOpts = {}): EmailAdapter {
  const provider = (opts.provider ?? '').toLowerCase().trim()
  switch (provider) {
    case 'log':
      return new LoggingEmailAdapter(opts.log ?? { info: () => undefined })
    case 'console':
      return new ConsoleEmailAdapter()
    // Real providers land here (`postmark`, `ses`, `sendgrid`); each
    // slots in behind this same EmailAdapter interface.
    case 'noop':
    case '':
    default:
      return new NoopEmailAdapter()
  }
}
