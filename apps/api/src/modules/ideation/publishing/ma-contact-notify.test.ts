// POST /ma-contacts/:contactId/notify
//
// Verifies the SMS + email adapter wiring + mobile decryption.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { encryptColumn } from '../../platform/compliance/column-crypto.js'

const { publishingRoutes } = await import('./routes.js')

const CID = 'ma-1'

async function build(opts: {
  pref?:        'email' | 'sms' | 'email_sms'
  mobile?:      string | null
  emailFails?:  boolean
  smsFails?:    boolean
  contactExists?: boolean
} = {}) {
  const emailSend = vi.fn(async () => {
    if (opts.emailFails) throw new Error('smtp timeout')
    return { adapter: 'log' as const, delivered: false, providerMessageId: null }
  })
  const smsSend = vi.fn(async () => {
    if (opts.smsFails) throw new Error('twilio timeout')
    return { adapter: 'console' as const, delivered: false, providerMessageId: null }
  })
  const audits: Array<Record<string, unknown>> = []
  const app = Fastify()
  app.decorate('prisma', {
    maContact: {
      findUnique: vi.fn(async () => opts.contactExists === false ? null : ({
        id: CID, ideationProjectId: 'ip-1', role: 'lead',
        name: 'Dr Anna Chen', email: 'anna@example.com',
        notificationPreference: opts.pref ?? 'email_sms',
        mobileEncrypted: opts.mobile === undefined ? encryptColumn('+15551234567') : (opts.mobile === null ? null : encryptColumn(opts.mobile)),
      })),
    },
  } as never)
  app.decorate('email', { send: emailSend } as never)
  app.decorate('sms',   { send: smsSend } as never)
  app.decorate('audit', { append: vi.fn(async (ev: Record<string, unknown>) => { audits.push(ev); return { id: 'a1' } }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'ideation-lead', modules: ['E'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(publishingRoutes)
  await app.ready()
  return { app, emailSend, smsSend, audits }
}

const notify = (app: Awaited<ReturnType<typeof build>>['app'], payload: unknown) =>
  app.inject({ method: 'POST', url: `/ma-contacts/${CID}/notify`, payload: payload as never })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'E' })

describe('POST /ma-contacts/:contactId/notify', () => {
  it('dispatches to BOTH channels for notificationPreference=email_sms', async () => {
    const { app, emailSend, smsSend } = await build({ pref: 'email_sms' })
    const res = await notify(app, { subject: 'Review ready', body: 'Please approve the HCP deck.', reason: 'approval_ping' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { results: Array<{ channel: string; adapter: string }> }
    expect(body.results.map(r => r.channel)).toEqual(['email', 'sms'])
    expect(emailSend).toHaveBeenCalledTimes(1)
    expect(smsSend).toHaveBeenCalledTimes(1)
    // SMS gets plaintext mobile (not the ciphertext) + composed body.
    const smsCall = smsSend.mock.calls[0]![0] as { to: string; body: string; reason?: string }
    expect(smsCall.to).toBe('+15551234567')
    expect(smsCall.body).toBe('Review ready: Please approve the HCP deck.')
    expect(smsCall.reason).toBe('approval_ping')
  })

  it('skips the SMS branch when preference=email', async () => {
    const { app, emailSend, smsSend } = await build({ pref: 'email' })
    const res = await notify(app, { subject: 's', body: 'b' })
    expect(res.statusCode).toBe(200)
    expect(emailSend).toHaveBeenCalled()
    expect(smsSend).not.toHaveBeenCalled()
    expect((res.json() as { results: unknown[] }).results).toHaveLength(1)
  })

  it('skips the email branch when preference=sms', async () => {
    const { app, emailSend, smsSend } = await build({ pref: 'sms' })
    const res = await notify(app, { subject: 's', body: 'b' })
    expect(res.statusCode).toBe(200)
    expect(emailSend).not.toHaveBeenCalled()
    expect(smsSend).toHaveBeenCalled()
  })

  it('records sms skippedReason when the contact has no mobile on file', async () => {
    const { app, smsSend, audits } = await build({ pref: 'sms', mobile: null })
    const res = await notify(app, { subject: 's', body: 'b' })
    expect(res.statusCode).toBe(200)
    expect(smsSend).not.toHaveBeenCalled()
    const body = res.json() as { results: Array<{ channel: string; skippedReason?: string }> }
    expect(body.results[0]).toMatchObject({ channel: 'sms', adapter: 'noop', skippedReason: 'no mobile number on file' })
    const rec = audits.find(e => e.action === 'ma_contact_notify_sent')
    expect((rec?.details as { results: Array<{ skippedReason: string }> }).results[0]?.skippedReason).toBe('no mobile number on file')
  })

  it('truncates sms body over 320 chars with a trailing ellipsis', async () => {
    const { app, smsSend } = await build({ pref: 'sms' })
    const longBody = 'x'.repeat(500)
    await notify(app, { subject: 'subj', body: longBody })
    const smsCall = smsSend.mock.calls[0]![0] as { body: string }
    expect(smsCall.body.length).toBe(320)
    expect(smsCall.body.endsWith('…')).toBe(true)
  })

  it('returns 200 with partial failure captured in results when sms adapter throws', async () => {
    const { app, audits } = await build({ pref: 'email_sms', smsFails: true })
    const res = await notify(app, { subject: 's', body: 'b' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { results: Array<{ channel: string; delivered: boolean; skippedReason?: string }> }
    expect(body.results.find(r => r.channel === 'email')).toMatchObject({ delivered: false })
    expect(body.results.find(r => r.channel === 'sms')).toMatchObject({ adapter: 'error', delivered: false, skippedReason: expect.stringMatching(/twilio timeout/) })
    expect(audits).toHaveLength(1)
  })

  it('returns 404 when the contact does not exist', async () => {
    const { app } = await build({ contactExists: false })
    const res = await notify(app, { subject: 's', body: 'b' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 400 for missing / oversize fields', async () => {
    const { app } = await build()
    expect((await notify(app, { body: 'b' })).statusCode).toBe(400)
    expect((await notify(app, { subject: 's' })).statusCode).toBe(400)
    expect((await notify(app, { subject: 'x'.repeat(201), body: 'b' })).statusCode).toBe(400)
  })
})
