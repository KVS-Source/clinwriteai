// Automatic ICH sync: syncs once the last sync (from the audit trail) is 30 days old, records it as 'system' /
// 'automatic', changes nothing when ich.org is down, and can be switched off.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { IchAutoSync, activeProjectManagerIds, ichAutoSyncEnabled, ichSyncNotice, lastIchSync } from './ich-auto-sync.js'
import type { IchSyncResult } from './ich-sync.js'
import { frameworksRoutes } from './routes.js'

const RESULT: IchSyncResult = { fetched: 153, created: ['ICH E22'], updated: ['ICH E6(R3)'], unchanged: 118, withdrawn: [], skipped: [{ code: 'S13 EWG', reason: 'x' }] }
const NOW = new Date('2026-11-16T12:00:00.000Z')

function setup(lastSync: { timestamp: string; actor_id: string; details: unknown } | null, sync = vi.fn(async () => RESULT)) {
  const appended: Array<Record<string, unknown>> = []
  const notify = vi.fn(async () => undefined)
  const prisma = { $queryRawUnsafe: vi.fn(async (sql: string, action: string) => (sql.includes('audit_events') && action === 'frameworks_synced_from_ich' && lastSync ? [lastSync] : [])) }
  const job = new IchAutoSync({
    prisma: prisma as never,
    audit: { append: vi.fn(async (e: Record<string, unknown>) => { appended.push(e) }) },
    logger: { info: vi.fn(), warn: vi.fn() },
    sync: sync as never,
    now: () => NOW,
    notify,
  })
  return { job, sync, appended, notify }
}

describe('automatic ICH sync', () => {
  it('syncs when there has never been a sync, and records it as an automatic system sync', async () => {
    const { job, sync, appended } = setup(null)
    expect(await job.tick()).toBe('synced')
    expect(sync).toHaveBeenCalledWith(expect.anything(), 'system')
    expect(appended).toEqual([expect.objectContaining({
      actorId: 'system', action: 'frameworks_synced_from_ich', entityType: 'regulatory_framework', entityId: 'ich',
      details: { trigger: 'automatic', fetched: 153, created: 1, updated: 1, unchanged: 118, withdrawn: [], skipped: 1 },
    })])
  })

  it('syncs when the last sync is 30 days old or more', async () => {
    const { job, sync } = setup({ timestamp: '2026-10-17T11:00:00.000Z', actor_id: 'u-pm', details: { trigger: 'manual' } })
    expect(await job.tick()).toBe('synced')
    expect(sync).toHaveBeenCalledOnce()
  })

  it('does nothing when someone synced in the last 30 days (button or automatic)', async () => {
    const { job, sync, appended } = setup({ timestamp: '2026-10-18T12:00:00.000Z', actor_id: 'u-pm', details: { trigger: 'manual' } })
    expect(await job.tick()).toBe('not_due')
    expect(sync).not.toHaveBeenCalled()
    expect(appended).toEqual([])
  })

  it('changes nothing and records nothing when ich.org cannot be reached', async () => {
    const { job, appended, notify } = setup(null, vi.fn(async () => { throw new Error('offline') }))
    expect(await job.tick()).toBe('failed')
    expect(appended).toEqual([])
    expect(notify).not.toHaveBeenCalled()
  })

  it('tells the Project Managers what the automatic sync changed and when the next one is due', async () => {
    const { job, notify } = setup(null)
    expect(await job.tick()).toBe('synced')
    expect(notify).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith({
      title: 'ICH frameworks updated',
      body: 'The automatic 30-day sync from ICH ran. Guidelines: 1 new (ICH E22); 1 updated (ICH E6(R3)). Review their scope in the framework registry. Next automatic sync around Dec 16, 2026.',
    })
  })

  it('says so when nothing changed, and lists at most five names per group', () => {
    const none = { ...RESULT, created: [], updated: [], withdrawn: [] }
    expect(ichSyncNotice(none, NOW).title).toBe('ICH frameworks checked: no changes')
    expect(ichSyncNotice(none, NOW).body).toContain('No guidelines were added, changed or withdrawn.')
    const many = { ...RESULT, created: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'], updated: [] }
    expect(ichSyncNotice(many, NOW).body).toContain('7 new (A1, A2, A3, A4, A5 and 2 more)')
  })

  it('does not notify when no sync was due', async () => {
    const { job, notify } = setup({ timestamp: '2026-11-10T00:00:00.000Z', actor_id: 'system', details: { trigger: 'automatic' } })
    expect(await job.tick()).toBe('not_due')
    expect(notify).not.toHaveBeenCalled()
  })

  it('a notification failure keeps the sync and its audit record', async () => {
    const { job, appended, notify } = setup(null)
    notify.mockRejectedValueOnce(new Error('mail down'))
    expect(await job.tick()).toBe('synced')
    expect(appended).toHaveLength(1)
  })

  it('notifies every active user holding the Project Manager role, primary or additional', async () => {
    const findMany = vi.fn(async () => [{ id: 'u-pm' }, { id: 'u-pm2' }])
    expect(await activeProjectManagerIds({ user: { findMany } })).toEqual(['u-pm', 'u-pm2'])
    expect(findMany).toHaveBeenCalledWith({ where: { status: 'active', OR: [{ role: 'pm' }, { additionalRoles: { has: 'pm' } }] }, select: { id: true } })
  })

  it('never runs two syncs at once', async () => {
    let release!: () => void
    const slow = vi.fn(() => new Promise<IchSyncResult>(r => { release = () => r(RESULT) }))
    const { job } = setup(null, slow)
    const first = job.tick()
    await vi.waitFor(() => expect(slow).toHaveBeenCalled())
    expect(await job.tick()).toBe('busy')
    release()
    expect(await first).toBe('synced')
  })

  it('is on in production, opt-in on dev machines, off with ICH_AUTO_SYNC=off, and never in tests', () => {
    expect(ichAutoSyncEnabled({ NODE_ENV: 'production' })).toBe(true)
    expect(ichAutoSyncEnabled({ NODE_ENV: 'production', ICH_AUTO_SYNC: 'OFF' })).toBe(false)
    expect(ichAutoSyncEnabled({ NODE_ENV: 'development' })).toBe(false)
    expect(ichAutoSyncEnabled({ NODE_ENV: 'development', ICH_AUTO_SYNC: 'on' })).toBe(true)
    expect(ichAutoSyncEnabled({ NODE_ENV: 'test', ICH_AUTO_SYNC: 'on' })).toBe(false)
  })

  it('reads the last sync and who started it from the audit trail', async () => {
    const q = (row: unknown) => ({ $queryRawUnsafe: vi.fn(async () => (row ? [row] : [])) })
    expect(await lastIchSync(q(null))).toBeNull()
    expect(await lastIchSync(q({ timestamp: '2026-11-13T11:48:05.000Z', actor_id: 'u-pm', details: '{"fetched":153}' })))
      .toEqual({ at: new Date('2026-11-13T11:48:05.000Z'), trigger: 'manual', actorId: 'u-pm' })
    expect((await lastIchSync(q({ timestamp: '2026-11-16T00:00:00.000Z', actor_id: 'system', details: { trigger: 'automatic' } })))!.trigger).toBe('automatic')
  })
})

describe('GET /sync-ich/status', () => {
  it('tells any signed-in user when the registry last synced and that it syncs every 30 days', async () => {
    const app = Fastify()
    app.decorate('prisma', { $queryRawUnsafe: vi.fn(async () => [{ timestamp: '2026-11-16T00:00:00.000Z', actor_id: 'system', details: { trigger: 'automatic' } }]) } as never)
    app.decorate('audit', { append: vi.fn() } as never)
    app.decorate('env', { NODE_ENV: 'production' } as never)
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (r) => { Object.assign(r, { user: { id: 'u-1', email: 'u@x.io', role: 'contributor', modules: ['A'], tenantId: null } as AuthenticatedUser }) })
    await app.register(frameworksRoutes)
    const res = await app.inject({ method: 'GET', url: '/sync-ich/status' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ lastSyncedAt: '2026-11-16T00:00:00.000Z', lastTrigger: 'automatic', autoSync: { enabled: true, everyDays: 30 } })
    await app.close()
  })
})
