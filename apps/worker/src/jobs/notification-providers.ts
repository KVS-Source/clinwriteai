// Pluggable email + SMS adapters — Arc 8.2 / 8.3.
//
// Three implementations each, selected by env:
//   - NoopProvider: logs + marks delivered (default; used in dev/CI).
//   - SesProvider / SendGridProvider / TwilioProvider: real adapters
//     that invoke the vendor SDK. Lazy-loaded so the deps don't ship
//     to dev if the keys aren't set.
//
// Selection via EMAIL_PROVIDER / SMS_PROVIDER env vars. Default 'noop'.

export interface EmailSendArgs {
  recipientEmail: string
  recipientName?: string
  subject: string
  body: string
  linkPath?: string | null
}

export interface SmsSendArgs {
  recipientPhone: string
  body: string
}

export interface EmailAdapter {
  readonly provider: string
  send(args: EmailSendArgs): Promise<{ providerRef: string | null }>
}

export interface SmsAdapter {
  readonly provider: string
  send(args: SmsSendArgs): Promise<{ providerRef: string | null }>
}

// --- Noop implementations (dev / CI) --------------------------------------

class NoopEmailAdapter implements EmailAdapter {
  readonly provider = 'noop-email'
  async send(_args: EmailSendArgs) {
    return { providerRef: null }
  }
}

class NoopSmsAdapter implements SmsAdapter {
  readonly provider = 'noop-sms'
  async send(_args: SmsSendArgs) {
    return { providerRef: null }
  }
}

// --- Real adapters (lazy-loaded) ------------------------------------------
// Each real adapter dynamic-imports its SDK so the dependency can be
// absent in dev without breaking the import graph. If the SDK isn't
// installed, the adapter throws a clear "run npm i …" message on first
// send() call.

class SesEmailAdapter implements EmailAdapter {
  readonly provider = 'aws-ses'
  constructor(
    private readonly fromAddress: string,
    private readonly region = process.env.AWS_REGION ?? 'us-east-1',
  ) {}

  async send(args: EmailSendArgs) {
    // @ts-expect-error — dep not installed until procurement completes
    const sdk = await import('@aws-sdk/client-ses').catch(() => {
      throw new Error('EMAIL_PROVIDER=ses but @aws-sdk/client-ses is not installed. Run `npm i @aws-sdk/client-ses` in apps/worker.')
    })
    const client = new sdk.SESClient({ region: this.region })
    const result = await client.send(
      new sdk.SendEmailCommand({
        Source: this.fromAddress,
        Destination: { ToAddresses: [args.recipientEmail] },
        Message: {
          Subject: { Data: args.subject, Charset: 'UTF-8' },
          Body: { Text: { Data: args.body, Charset: 'UTF-8' } },
        },
      }),
    )
    return { providerRef: result.MessageId ?? null }
  }
}

class SendGridEmailAdapter implements EmailAdapter {
  readonly provider = 'sendgrid'
  constructor(private readonly apiKey: string, private readonly fromAddress: string) {}

  async send(args: EmailSendArgs) {
    // @ts-expect-error — dep not installed until procurement completes
    const sgMail = await import('@sendgrid/mail').catch(() => {
      throw new Error('EMAIL_PROVIDER=sendgrid but @sendgrid/mail is not installed. Run `npm i @sendgrid/mail` in apps/worker.')
    })
    // sgMail is a module with a default export in CJS and named exports in ESM.
    const client = (sgMail as { default?: typeof sgMail }).default ?? sgMail
    client.setApiKey(this.apiKey)
    const [response] = await client.send({
      to: args.recipientEmail,
      from: this.fromAddress,
      subject: args.subject,
      text: args.body,
    })
    const providerRef = (response.headers as Record<string, string> | undefined)?.['x-message-id'] ?? null
    return { providerRef }
  }
}

class TwilioSmsAdapter implements SmsAdapter {
  readonly provider = 'twilio'
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly fromNumber: string,
  ) {}

  async send(args: SmsSendArgs) {
    // @ts-expect-error — dep not installed until procurement completes
    const twilioMod = await import('twilio').catch(() => {
      throw new Error('SMS_PROVIDER=twilio but twilio is not installed. Run `npm i twilio` in apps/worker.')
    })
    const twilio = (twilioMod as { default?: typeof twilioMod }).default ?? twilioMod
    const client = (twilio as unknown as (sid: string, token: string) => { messages: { create: (opts: Record<string, string>) => Promise<{ sid: string }> } })(
      this.accountSid,
      this.authToken,
    )
    const msg = await client.messages.create({
      body: args.body,
      from: this.fromNumber,
      to: args.recipientPhone,
    })
    return { providerRef: msg.sid }
  }
}

// --- Factories ------------------------------------------------------------

export function createEmailAdapter(): EmailAdapter {
  const provider = (process.env.EMAIL_PROVIDER ?? 'noop').toLowerCase()
  const from = process.env.EMAIL_FROM_ADDRESS ?? 'noreply@clinwrite.ai'
  if (provider === 'ses') {
    return new SesEmailAdapter(from)
  }
  if (provider === 'sendgrid') {
    const key = process.env.SENDGRID_API_KEY
    if (!key) {
      // Fail closed to noop + log — don't crash the worker.
      // Operator sees the misconfig in the first delivery audit.
      // eslint-disable-next-line no-console
      console.warn('[notification-providers] EMAIL_PROVIDER=sendgrid but SENDGRID_API_KEY not set; falling back to noop.')
      return new NoopEmailAdapter()
    }
    return new SendGridEmailAdapter(key, from)
  }
  return new NoopEmailAdapter()
}

export function createSmsAdapter(): SmsAdapter {
  const provider = (process.env.SMS_PROVIDER ?? 'noop').toLowerCase()
  if (provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    const from = process.env.TWILIO_FROM_NUMBER
    if (!sid || !token || !from) {
      // eslint-disable-next-line no-console
      console.warn('[notification-providers] SMS_PROVIDER=twilio but TWILIO_* vars missing; falling back to noop.')
      return new NoopSmsAdapter()
    }
    return new TwilioSmsAdapter(sid, token, from)
  }
  return new NoopSmsAdapter()
}
