// POST /:publicationId/authors/:authorId/remind — exercises the
// email-adapter wiring. Default build has a noop adapter; this test
// stubs the adapter directly so we can assert the route calls
// app.email.send with the right payload and records the adapter
// outcome on the audit entry.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import type { EmailAdapter } from '../../platform/email/adapter.js'

const { authorsRoutes } = await import('./routes.js')

const PUB = 'pub-1'
const AUTH = 'auth-1'

async function build(opts: {
  authorExists?: boolean
  authorEmail?:  string | null
  emailResult?:  Awaited<ReturnType<EmailAdapter['send']>>
  emailThrows?:  Error | null
} = {}) {
  const emailSend = vi.fn(async () => {
    if (opts.emailThrows) throw opts.emailThrows
    return opts.emailResult ?? {
      adapter: 'noop' as const, delivered: false, providerMessageId: null,
    }
  })
  const audit = vi.fn(async () => undefined)
  const app = Fastify()
  app.decorate('prisma', {
    publicationAuthor: {
      findFirst: vi.fn(async () => opts.authorExists === false ? null : ({
        id: AUTH, publicationId: PUB, name: 'Dr. Alice Chen',
        inviteEmail: opts.authorEmail === undefined ? 'alice@example.com' : opts.authorEmail,
      })),
    },
    publication: {
      findUnique: vi.fn(async () => ({ title: 'Veloricept in NSCLC' })),
    },
  } as never)
  app.decorate('email',  { send: emailSend } as never)
  app.decorate('audit',  { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'clinical-writer', modules: ['B'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(authorsRoutes)
  await app.ready()
  return { app, emailSend, audit }
}

const remind = (app: Awaited<ReturnType<typeof build>>['app']) =>
  app.inject({ method: 'POST', url: `/${PUB}/authors/${AUTH}/remind` })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'B' })

describe('POST /:publicationId/authors/:authorId/remind', () => {
  it('calls app.email.send with the publication title in the subject + author name + reason tag', async () => {
    const { app, emailSend, audit } = await build()
    const res = await remind(app)
    expect(res.statusCode).toBe(204)
    expect(emailSend).toHaveBeenCalledTimes(1)
    const payload = emailSend.mock.calls[0]![0] as { to: string; subject: string; textBody: string; reason?: string }
    expect(payload.to).toBe('alice@example.com')
    expect(payload.subject).toContain('Veloricept in NSCLC')
    expect(payload.textBody).toContain('Dr. Alice Chen')
    expect(payload.reason).toBe('author_reminder')
    // Audit entry records which adapter handled the send + delivery flag.
    const rec = audit.mock.calls.map(c => c[0]).find(e => e.action === 'author_reminder_sent')
    expect(rec?.details).toMatchObject({
      authorId:         AUTH,
      inviteEmail:      'alice@example.com',
      emailAdapter:     'noop',
      emailDelivered:   false,
    })
  })

  it('records emailDelivered=true + providerMessageId when the adapter delivers', async () => {
    const { app, audit } = await build({
      emailResult: { adapter: 'postmark', delivered: true, providerMessageId: 'pm-abc123' },
    })
    await remind(app)
    const rec = audit.mock.calls.map(c => c[0]).find(e => e.action === 'author_reminder_sent')
    expect(rec?.details).toMatchObject({
      emailAdapter:     'postmark',
      emailDelivered:   true,
      providerMessageId: 'pm-abc123',
    })
  })

  it('skips the email send when the author has no inviteEmail, but still audits', async () => {
    const { app, emailSend, audit } = await build({ authorEmail: null })
    const res = await remind(app)
    expect(res.statusCode).toBe(204)
    expect(emailSend).not.toHaveBeenCalled()
    const rec = audit.mock.calls.map(c => c[0]).find(e => e.action === 'author_reminder_sent')
    expect(rec?.details).toMatchObject({ emailAdapter: 'noop', emailDelivered: false, inviteEmail: null })
  })

  it('does not fail the request when the adapter throws — audits + 204 so the UI stays coherent', async () => {
    const { app, audit } = await build({ emailThrows: new Error('SMTP timeout') })
    const res = await remind(app)
    expect(res.statusCode).toBe(204)
    const rec = audit.mock.calls.map(c => c[0]).find(e => e.action === 'author_reminder_sent')
    expect(rec?.details).toMatchObject({ emailAdapter: 'noop', emailDelivered: false })
  })

  it('returns 404 when the author does not exist', async () => {
    const { app, emailSend } = await build({ authorExists: false })
    const res = await remind(app)
    expect(res.statusCode).toBe(404)
    expect(emailSend).not.toHaveBeenCalled()
  })
})
