// Master Library "Share" (share.ts): POST /library/:id/share, and the public pages behind an invitation link
// (/shared-library/:tokenâ€¦) where the reader proves the invited address with an emailed one-time code.
// Fastify inject() over an in-memory fake Prisma; nothing is stored or sent.

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser, Role } from '../../../auth/rbac.js'
import { libraryShareRoutes, sharedLibraryPublicRoutes, maskEmail, CODE_MAX_ATTEMPTS } from './share.js'

type FakeUser = { id: string; email: string; name: string; role: string; additionalRoles: string[]; tenantId: string | null; status: string }
const USERS: FakeUser[] = [
  { id: 'u1', email: 'pm@x.io',       name: 'Alex PM',      role: 'pm',           additionalRoles: [], tenantId: 't1', status: 'active' },
  { id: 'u2', email: 'raj@x.io',      name: 'Raj',          role: 'contributor',  additionalRoles: [], tenantId: 't1', status: 'active' },
  { id: 'u3', email: 'qc@x.io',       name: 'Quinn QC',     role: 'qc',           additionalRoles: [], tenantId: 't1', status: 'active' },
  { id: 'u4', email: 'admin@x.io',    name: 'IT Admin',     role: 'tenant-admin', additionalRoles: [], tenantId: 't1', status: 'active' },
  { id: 'u5', email: 'gone@x.io',     name: 'Left',         role: 'contributor',  additionalRoles: [], tenantId: 't1', status: 'suspended' },
  { id: 'u6', email: 'other@y.io',    name: 'Other Tenant', role: 'contributor',  additionalRoles: [], tenantId: 't2', status: 'active' },
]

type Share = Record<string, unknown> & { id: string; tokenHash: string; email: string; libraryItemId: string }

interface Setup { role?: Role; item?: Record<string, unknown> | null; notifyFails?: string[]; mailFails?: boolean }

async function setup(s: Setup = {}) {
  const item = s.item === null ? null : {
    id: 'lib-1', tenantId: 't1', title: 'CSR Full', body: 'The study text.', taTag: 'Oncology', framework: 'CSR', category: 'claim', version: 1,
    isCurrent: true, approvedBy: 'u1', approvedAt: new Date('2026-11-13T00:00:00Z'), retiredAt: null,
    tags: ['module:A', 'doctype:CSR', 'project:p1', 'fromdoc:doc-9'], updatedAt: new Date('2026-11-13T00:00:00Z'), supersededBy: null, usageCount: 0,
    ...s.item,
  }
  const shares: Share[] = []
  const mails: Array<{ to: string; subject: string; text: string }> = []
  const send = vi.fn(async (args: { recipientId: string }) => {
    if (s.notifyFails?.includes(args.recipientId)) throw new Error('queue down')
    return {}
  })
  const append = vi.fn(async (_event: Record<string, unknown>) => ({}))
  const apply = (row: Share, data: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'increment' in (v as object)) row[k] = ((row[k] as number) ?? 0) + (v as { increment: number }).increment
      else row[k] = v
    }
    return row
  }
  const libraryShare = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `sh-${shares.length + 1}`, sharedAt: new Date(), revokedAt: null, codeHash: null, codeSentAt: null, codeExpiresAt: null, codeAttempts: 0, codesSent: 0, sessionHash: null, sessionExpiresAt: null, lastOpenedAt: null, ...data } as Share
      shares.push(row); return row
    }),
    findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => shares.find(x => x.tokenHash === where.tokenHash) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => apply(shares.find(x => x.id === where.id)!, data)),
    updateMany: vi.fn(async ({ where, data }: { where: { libraryItemId: string; email: string }; data: Record<string, unknown> }) => {
      const hit = shares.filter(x => x.libraryItemId === where.libraryItemId && x.email === where.email && !x.revokedAt)
      hit.forEach(x => apply(x, data)); return { count: hit.length }
    }),
  }
  const app = Fastify()
  app.decorate('env', { CORS_ORIGIN: 'http://localhost:5173' } as never)
  app.decorate('prisma', {
    librarySection: { findFirst: vi.fn(async () => item), findUnique: vi.fn(async () => item) },
    user: {
      findMany: vi.fn(async ({ where }: { where: { email: { in: string[] } } }) => USERS.filter(u => where.email.in.includes(u.email.toLowerCase()))),
      findUnique: vi.fn(async () => ({ name: 'Alex PM' })),
    },
    libraryShare,
  } as never)
  app.decorate('audit', { append } as never)
  app.decorate('notifications', { send } as never)
  app.decorate('mailer', {
    sendMail: vi.fn(async (m: { to: string; subject: string; text: string }) => { if (s.mailFails) throw new Error('smtp down'); mails.push(m); return { messageId: 'm', transport: 'log' } }),
  } as never)
  app.decorate('blob', { get: vi.fn() } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/shared-library')) return   // public: nobody signed in
    ;(req as unknown as { user: AuthenticatedUser }).user = { id: 'u1', email: 'pm@x.io', role: s.role ?? 'pm', modules: ['A'], tenantId: 't1' }
  })
  await app.register(libraryShareRoutes, { prefix: '/library' })
  await app.register(sharedLibraryPublicRoutes, { prefix: '/shared-library' })
  await app.ready()
  current = app
  return { app, send, append, shares, mails }
}

let current: FastifyInstance | null = null
async function closeApp() { const app = current; current = null; await app?.close() }
afterEach(async () => { await closeApp(); vi.useRealTimers() })

const share = (app: FastifyInstance, emails: unknown) =>
  app.inject({ method: 'POST', url: '/library/lib-1/share', payload: { emails } as never })
const tokenFrom = (mail: { text: string }) => /\/shared\/library\/([A-Za-z0-9_-]+)/.exec(mail.text)![1]!
const codeFrom = (mail: { text: string }) => /is: (\d{6})/.exec(mail.text)![1]!

describe('POST /library/:id/share', () => {
  it('colleagues get a notification; people without an account get an invitation email; one audit entry on the source document', async () => {
    const t = await setup()
    const res = await share(t.app, ['Raj@X.io', 'ceo@acme.com', 'raj@x.io'])
    expect(res.statusCode).toBe(200)
    expect(res.json().shared).toEqual([{ email: 'raj@x.io', kind: 'user', name: 'Raj' }, { email: 'ceo@acme.com', kind: 'invite' }])
    expect(t.send).toHaveBeenCalledTimes(1)
    expect(t.send.mock.calls[0]![0]).toMatchObject({ recipientId: 'u2', kind: 'library_document_shared', channels: ['in_app', 'email'], linkPath: '/master-library/documents?item=lib-1' })
    // The invitation: a stored hash only, the token is in the email.
    expect(t.shares).toHaveLength(1)
    expect(t.mails).toHaveLength(1)
    expect(t.mails[0]!.to).toBe('ceo@acme.com')
    const token = tokenFrom(t.mails[0]!)
    expect(t.shares[0]!.tokenHash).not.toContain(token)
    expect(t.mails[0]!.text).not.toMatch(/\b\d{6}\b/)   // no code in the invitation itself
    expect(t.append).toHaveBeenCalledTimes(1)
    expect(t.append.mock.calls[0]![0]).toMatchObject({
      action: 'library_document_shared', entityType: 'document', entityId: 'doc-9', actorId: 'u1',
      details: { libraryItemId: 'lib-1', recipients: [{ kind: 'user', id: 'u2' }, { kind: 'invite', email: 'ceo@acme.com' }] },
    })
  })

  it('an account the Master Library is closed to (IT admin, another organisation) is invited, not notified', async () => {
    const t = await setup()
    const res = await share(t.app, ['admin@x.io', 'other@y.io', 'qc@x.io'])
    expect(res.json().shared.map((r: { kind: string }) => r.kind)).toEqual(['invite', 'invite', 'user'])
  })

  it('refuses a switched-off account in the organisation, and sends nothing', async () => {
    const t = await setup()
    const res = await share(t.app, ['raj@x.io', 'gone@x.io'])
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'recipients_not_allowed', emails: ['gone@x.io'] })
    expect(t.send).not.toHaveBeenCalled()
    expect(t.mails).toHaveLength(0)
    expect(t.append).not.toHaveBeenCalled()
  })

  it('PM and Contributor may share; Auditor, QC and IT admin may not', async () => {
    for (const [role, code] of [['pm', 200], ['contributor', 200], ['auditor', 403], ['qc', 403], ['tenant-admin', 403]] as Array<[Role, number]>) {
      const t = await setup({ role })
      expect((await share(t.app, ['raj@x.io'])).statusCode, role).toBe(code)
      await closeApp()
    }
  })

  it('an uploaded document (no source document) is audited on the library entry', async () => {
    const t = await setup({ item: { tags: ['module:A', 'origin:upload', 'project:p1'] } })
    expect((await share(t.app, ['raj@x.io'])).statusCode).toBe(200)
    expect(t.append.mock.calls[0]![0]).toMatchObject({ entityType: 'library_section', entityId: 'lib-1' })
  })

  it('sharing again with the same person replaces their earlier link', async () => {
    const t = await setup()
    await share(t.app, ['ceo@acme.com'])
    await share(t.app, ['ceo@acme.com'])
    expect(t.shares).toHaveLength(2)
    expect(t.shares[0]!.revokedAt).toBeInstanceOf(Date)
    expect(t.shares[1]!.revokedAt).toBeNull()
  })

  it('an invitation whose email fails is cancelled and reported', async () => {
    const t = await setup({ mailFails: true })
    const res = await share(t.app, ['ceo@acme.com'])
    expect(res.json()).toMatchObject({ shared: [], failed: ['ceo@acme.com'] })
    expect(t.shares[0]!.revokedAt).toBeInstanceOf(Date)
  })

  it('rejects bad input, sharing only with yourself, a missing item and a withdrawn one', async () => {
    const t = await setup()
    expect((await share(t.app, [])).statusCode).toBe(400)
    expect((await share(t.app, ['not-an-email'])).statusCode).toBe(400)
    expect((await share(t.app, Array.from({ length: 21 }, (_, i) => `p${i}@x.io`))).statusCode).toBe(400)
    expect((await share(t.app, ['pm@x.io'])).json().error).toBe('share_with_self')
    await closeApp()
    expect((await share((await setup({ item: null })).app, ['raj@x.io'])).statusCode).toBe(404)
    await closeApp()
    expect((await share((await setup({ item: { retiredAt: new Date() } })).app, ['raj@x.io'])).statusCode).toBe(409)
  })
})

describe('the invitation link (/shared-library/:token)', () => {
  async function invited(over: Setup = {}) {
    const t = await setup(over)
    await share(t.app, ['ceo@acme.com'])
    return { ...t, token: tokenFrom(t.mails[0]!) }
  }

  it('the link alone shows only what was shared, to a masked address â€” never the document', async () => {
    const t = await invited()
    const info = await t.app.inject({ method: 'GET', url: `/shared-library/${t.token}` })
    expect(info.statusCode).toBe(200)
    expect(info.json()).toMatchObject({ title: 'CSR Full', version: 'v1.0', emailHint: maskEmail('ceo@acme.com') })
    expect(JSON.stringify(info.json())).not.toContain('ceo@acme.com')
    expect((await t.app.inject({ method: 'GET', url: `/shared-library/${t.token}/pdf` })).statusCode).toBe(401)
    expect((await t.app.inject({ method: 'GET', url: `/shared-library/${t.token}/pdf`, headers: { 'x-share-session': 'x'.repeat(43) } })).statusCode).toBe(401)
  })

  it('the code goes to the invited address only; the right code opens the document, audited', async () => {
    const t = await invited()
    const sent = await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/code`, payload: { email: 'attacker@evil.com' } as never })
    expect(sent.statusCode).toBe(200)
    expect(t.mails).toHaveLength(2)
    expect(t.mails[1]!.to).toBe('ceo@acme.com')
    const code = codeFrom(t.mails[1]!)
    expect(t.shares[0]!.codeHash).not.toContain(code)

    const ok = await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/verify`, payload: { code } as never })
    expect(ok.statusCode).toBe(200)
    const { session } = ok.json()
    expect(t.append.mock.calls.at(-1)![0]).toMatchObject({ action: 'library_share_opened', entityType: 'document', entityId: 'doc-9', details: { email: 'ceo@acme.com' } })

    const pdf = await t.app.inject({ method: 'GET', url: `/shared-library/${t.token}/pdf`, headers: { 'x-share-session': session } })
    expect(pdf.statusCode).toBe(200)
    expect(pdf.headers['content-type']).toBe('application/pdf')
    expect(String(pdf.headers['content-disposition'])).toMatch(/^inline/)
    // A code works once.
    expect((await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/verify`, payload: { code } as never })).statusCode).toBe(410)
  })

  it('a session only works with its own link, and a new code ends the old session', async () => {
    const t = await invited()
    await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/code` })
    const { session } = (await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/verify`, payload: { code: codeFrom(t.mails[1]!) } as never })).json()
    // A second invitation (another document's link, say) does not accept this session.
    await share(t.app, ['cfo@acme.com'])
    const other = tokenFrom(t.mails.at(-1)!)
    expect((await t.app.inject({ method: 'GET', url: `/shared-library/${other}/pdf`, headers: { 'x-share-session': session } })).statusCode).toBe(401)
    // Opening again (after the resend wait) replaces the session.
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] })
    await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/code` })
    await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/verify`, payload: { code: codeFrom(t.mails.at(-1)!) } as never })
    expect((await t.app.inject({ method: 'GET', url: `/shared-library/${t.token}/pdf`, headers: { 'x-share-session': session } })).statusCode).toBe(401)
  })

  it(`wrong codes are counted; after ${CODE_MAX_ATTEMPTS} the code stops working, audited`, async () => {
    const t = await invited()
    await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/code` })
    const right = codeFrom(t.mails[1]!)
    const wrong = right === '000000' ? '111111' : '000000'
    for (let i = 1; i < CODE_MAX_ATTEMPTS; i++) {
      const r = await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/verify`, payload: { code: wrong } as never })
      expect(r.statusCode).toBe(400)
      expect(r.json().attemptsLeft).toBe(CODE_MAX_ATTEMPTS - i)
    }
    expect((await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/verify`, payload: { code: wrong } as never })).statusCode).toBe(429)
    expect(t.append.mock.calls.at(-1)![0]).toMatchObject({ action: 'library_share_code_locked' })
    // Even the right code no longer works â€” a new one is needed.
    expect((await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/verify`, payload: { code: right } as never })).statusCode).toBe(410)
  })

  it('a second code has to wait a minute', async () => {
    const t = await invited()
    expect((await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/code` })).statusCode).toBe(200)
    const again = await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/code` })
    expect(again.statusCode).toBe(429)
    expect(again.json().error).toBe('code_recently_sent')
  })

  it('an unknown, replaced, expired or withdrawn link opens nothing', async () => {
    const t = await invited()
    expect((await t.app.inject({ method: 'GET', url: `/shared-library/${'a'.repeat(43)}` })).statusCode).toBe(404)
    t.shares[0]!.expiresAt = new Date(Date.now() - 1000)
    expect((await t.app.inject({ method: 'GET', url: `/shared-library/${t.token}` })).json().error).toBe('expired')
    t.shares[0]!.revokedAt = new Date()
    expect((await t.app.inject({ method: 'POST', url: `/shared-library/${t.token}/code` })).json().error).toBe('revoked')
    await closeApp()

    const w = await invited({ item: { retiredAt: null } })
    ;(w.app as unknown as { prisma: { librarySection: { findUnique: () => Promise<unknown> } } }).prisma.librarySection.findUnique = async () => ({ id: 'lib-1', retiredAt: new Date() })
    expect((await w.app.inject({ method: 'GET', url: `/shared-library/${w.token}` })).json().error).toBe('withdrawn')
  })
})
