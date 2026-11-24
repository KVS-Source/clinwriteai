// "Sync from ICH" pressed by a Project Manager: when the sync brings new ICH codes (or updates / withdraws
// guidelines), every other active Project Manager is notified, as after the automatic 30-day sync.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import type { IchSyncResult } from './ich-sync.js'

let sync: () => Promise<IchSyncResult> = async () => NOTHING
const stub = (r: IchSyncResult) => { sync = async () => r }
vi.mock('./ich-sync.js', () => ({ syncIchGuidelines: () => sync() }))
const { frameworksRoutes } = await import('./routes.js')

const NOTHING: IchSyncResult = { fetched: 80, created: [], updated: [], unchanged: 80, withdrawn: [], skipped: [] }

async function build(opts: { sendFails?: boolean } = {}) {
  const sent: Array<{ recipientId: string; kind: string; title: string; body: string; linkPath: string }> = []
  const audit: Array<{ action: string; details: Record<string, unknown> }> = []
  const app = Fastify()
  app.decorate('prisma', {
    // activeProjectManagerIds: every active PM (primary or additional role), the caller included.
    user: { findMany: vi.fn(async () => [{ id: 'u-pm-a' }, { id: 'u-pm-b' }, { id: 'u-both' }]) },
  } as never)
  app.decorate('audit', { append: vi.fn(async (e: (typeof audit)[number]) => { audit.push(e) }) } as never)
  app.decorate('notifications', { send: vi.fn(async (n: (typeof sent)[number]) => {
    if (opts.sendFails) throw new Error('down')
    sent.push(n)
  }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    Object.assign(r, { user: { id: 'u-pm-a', email: 'a@x.io', role: 'pm', modules: ['A'], tenantId: null } as AuthenticatedUser })
  })
  await app.register(frameworksRoutes)
  await app.ready()
  return { app, sent, audit }
}

beforeEach(() => stub(NOTHING))

describe('POST /sync-ich: notifying the Project Managers', () => {
  it('new ICH codes: every other active PM is told which ones, with a link to the ICH framework registry', async () => {
    stub({ ...NOTHING, created: ['ICH E22', 'ICH M15'], unchanged: 78 })
    const { app, sent, audit } = await build()
    const res = await app.inject({ method: 'POST', url: '/sync-ich' })
    expect(res.statusCode).toBe(200)
    expect(audit).toHaveLength(1)
    expect(sent.map(n => n.recipientId)).toEqual(['u-pm-b', 'u-both'])      // not the PM who ran it
    expect(sent[0]).toMatchObject({ kind: 'ich_frameworks_synced', title: 'ICH frameworks updated', linkPath: '/master-library/ich-frameworks' })
    expect(sent[0].body).toContain('A Project Manager synced the frameworks from ICH.')
    expect(sent[0].body).toContain('2 new (ICH E22, ICH M15)')
    await app.close()
  })

  it('updated or withdrawn guidelines notify too', async () => {
    stub({ ...NOTHING, updated: ['ICH E6(R3)'], withdrawn: ['ICH E2B(R2)'] })
    const { app, sent } = await build()
    await app.inject({ method: 'POST', url: '/sync-ich' })
    expect(sent).toHaveLength(2)
    expect(sent[0].body).toContain('1 updated (ICH E6(R3)); 1 withdrawn (ICH E2B(R2))')
    await app.close()
  })

  it('a sync that changes nothing notifies no one', async () => {
    stub(NOTHING)
    const { app, sent } = await build()
    expect((await app.inject({ method: 'POST', url: '/sync-ich' })).statusCode).toBe(200)
    expect(sent).toHaveLength(0)
    await app.close()
  })

  it('a notification failure does not fail the sync', async () => {
    stub({ ...NOTHING, created: ['ICH E22'] })
    const { app, audit } = await build({ sendFails: true })
    expect((await app.inject({ method: 'POST', url: '/sync-ich' })).statusCode).toBe(200)
    expect(audit).toHaveLength(1)
    await app.close()
  })

  it('ich.org unreachable: nothing changed, nobody notified', async () => {
    sync = async () => { throw new Error('ENOTFOUND') }
    const { app, sent, audit } = await build()
    const r = await app.inject({ method: 'POST', url: '/sync-ich' })
    expect(r.statusCode).toBe(502)
    expect(sent).toHaveLength(0)
    expect(audit).toHaveLength(0)
    await app.close()
  })
})
