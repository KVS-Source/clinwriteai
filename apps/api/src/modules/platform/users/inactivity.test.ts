// Inactivity sweep: by default warn at 25 days unused, suspend at 30 — never
// sooner than 5 days after the warning. Signing in or being unsuspended resets
// the clock; admins are left out; repeated runs don't double-warn or re-suspend.
// The times come from settings (e.g. 10 / 15 minutes for testing).

import { describe, expect, it, vi } from 'vitest'
import { INACTIVITY_SUSPENDED_KIND, INACTIVITY_WARNING_KIND, inactivityConfigFromEnv, runInactivitySweep } from './inactivity.js'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- loose in-memory Prisma stub
const NOW = new Date('2026-11-05T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

function setup(opts: { users: Row[]; notes?: Row[]; reactivations?: Row[] }) {
  const users = opts.users.map(u => ({ role: 'contributor', status: 'active', name: 'Una User', termsAcceptedAt: null, createdAt: daysAgo(400), lastActiveAt: null, ...u }))
  const notes: Row[] = [...(opts.notes ?? [])]
  const sessions: Row[] = users.map(u => ({ userId: u.id, revokedAt: null }))
  const audit: Row[] = []
  const prisma = {
    user: {
      findMany: vi.fn(async ({ where }: Row) => users.filter(u => u.status === where.status && !where.role.notIn.includes(u.role))),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const hit = users.filter(u => u.id === where.id && u.status === where.status); hit.forEach(u => Object.assign(u, data)); return { count: hit.length }
      }),
    },
    session: { updateMany: vi.fn(async ({ where, data }: Row) => {
      const hit = sessions.filter(s => s.userId === where.userId && s.revokedAt === null); hit.forEach(s => Object.assign(s, data)); return { count: hit.length }
    }) },
    notification: { findFirst: vi.fn(async ({ where }: Row) => notes
      .filter(n => n.recipientId === where.recipientId && n.kind === where.kind && n.createdAt >= where.createdAt.gte)
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null) },
    $queryRawUnsafe: vi.fn(async () => opts.reactivations ?? []),
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  const notifications = { send: vi.fn(async (args: Row) => { notes.push({ ...args, createdAt: NOW }); return {} }) }
  const deps = { prisma: prisma as never, audit: { append: vi.fn(async (e: Row) => { audit.push(e) }) }, notifications }
  return { deps, users, notes, sessions, audit, notifications, run: () => runInactivitySweep(deps, NOW) }
}

describe('inactivity sweep', () => {
  it('leaves someone who signed in recently alone', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: daysAgo(10) }] })
    expect(await t.run()).toEqual({ warned: [], suspended: [] })
    expect(t.notifications.send).not.toHaveBeenCalled()
  })

  it('warns at 25 days without a sign-in, by email, naming the suspension date (day 30)', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: daysAgo(25) }] })
    expect(await t.run()).toEqual({ warned: ['u1'], suspended: [] })
    const sent = t.notifications.send.mock.calls[0][0]
    expect(sent).toMatchObject({ recipientId: 'u1', kind: INACTIVITY_WARNING_KIND, channels: ['in_app', 'email'] })
    expect(sent.payload.suspendOn).toBe(new Date(daysAgo(25).getTime() + 30 * 86_400_000).toISOString())
    expect(sent.body).toMatch(/sign in before .* or your account will be suspended/i)
    expect(t.audit[0]).toMatchObject({ action: 'user.inactivity_warning', entityId: 'u1' })
    expect(t.users[0].status).toBe('active')
  })

  it('a warning sent late (day 26) still gives the full 5 days: suspension moves to 5 days after it', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: daysAgo(26) }] })
    await t.run()
    expect(t.notifications.send.mock.calls[0][0].payload.suspendOn).toBe(new Date(NOW.getTime() + 5 * 86_400_000).toISOString())
  })

  it('does not warn twice for the same inactive spell', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: daysAgo(27) }], notes: [{ recipientId: 'u1', kind: INACTIVITY_WARNING_KIND, createdAt: daysAgo(2) }] })
    expect(await t.run()).toEqual({ warned: [], suspended: [] })
  })

  it('suspends at 30 days once warned ≥ 5 days ago: status, sessions, audit, and an email', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: daysAgo(31) }], notes: [{ recipientId: 'u1', kind: INACTIVITY_WARNING_KIND, createdAt: daysAgo(6) }] })
    expect(await t.run()).toEqual({ warned: [], suspended: ['u1'] })
    expect(t.users[0].status).toBe('suspended')
    expect(t.sessions[0].revokedAt).toEqual(NOW)
    expect(t.audit[0]).toMatchObject({ action: 'user.suspend', entityId: 'u1', details: { reason: 'inactivity' } })
    expect(t.notifications.send).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'u1', kind: INACTIVITY_SUSPENDED_KIND, channels: ['in_app', 'email'] }))

    expect(await t.run()).toEqual({ warned: [], suspended: [] })    // a second run changes nothing
  })

  it('never suspends sooner than 5 days after the warning', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: daysAgo(31) }], notes: [{ recipientId: 'u1', kind: INACTIVITY_WARNING_KIND, createdAt: daysAgo(2) }] })
    expect(await t.run()).toEqual({ warned: [], suspended: [] })
    expect(t.users[0].status).toBe('active')
  })

  it('an account already long inactive is warned first (5 days\' notice), not suspended on the spot', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: daysAgo(90) }] })
    expect(await t.run()).toEqual({ warned: ['u1'], suspended: [] })
    expect(t.notifications.send.mock.calls[0][0].payload.suspendOn).toBe(new Date(NOW.getTime() + 5 * 86_400_000).toISOString())
  })

  it('signing in after a warning voids it: the clock restarts', async () => {
    // Warned 40 days ago, signed in 26 days ago → a new warning is due now; the old one doesn't count.
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: daysAgo(26) }], notes: [{ recipientId: 'u1', kind: INACTIVITY_WARNING_KIND, createdAt: daysAgo(40) }] })
    expect(await t.run()).toEqual({ warned: ['u1'], suspended: [] })
  })

  it('an account unsuspended by an admin starts a fresh clock', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: daysAgo(60) }], reactivations: [{ entity_id: 'u1', at: daysAgo(3) }] })
    expect(await t.run()).toEqual({ warned: [], suspended: [] })
  })

  it('a user who registered but never signed in counts from registration', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: null, termsAcceptedAt: daysAgo(26) }] })
    expect(await t.run()).toEqual({ warned: ['u1'], suspended: [] })
  })

  it.each(['tenant-admin', 'admin', 'super-admin'])('leaves a %s alone, however long inactive', async (role) => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', role, lastActiveAt: daysAgo(120) }] })
    expect(await t.run()).toEqual({ warned: [], suspended: [] })
  })

  it('only looks at active accounts (invited / suspended / deprovisioned are skipped)', async () => {
    const t = setup({ users: ['invited', 'suspended', 'deprovisioned'].map((status, i) => ({ id: `u${i}`, email: `${i}@x.io`, status, lastActiveAt: daysAgo(120) })) })
    expect(await t.run()).toEqual({ warned: [], suspended: [] })
  })

  it('messages name the time as well as the date', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: daysAgo(25) }] })
    await t.run()
    expect(t.notifications.send.mock.calls[0][0].body).toContain('2026-11-10 12:00 UTC')
  })
})

describe('inactivity sweep with short (testing) times: warn at 10 min, suspend at 15', () => {
  const MIN = 60_000
  const config = { warningAfterMs: 10 * MIN, suspendAfterMs: 15 * MIN }
  const minsAgo = (n: number) => new Date(NOW.getTime() - n * MIN)
  const runShort = (t: ReturnType<typeof setup>) => runInactivitySweep(t.deps, NOW, config)

  it('9 minutes unused → nothing', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: minsAgo(9) }] })
    expect(await runShort(t)).toEqual({ warned: [], suspended: [] })
  })

  it('10 minutes unused → warning by email, naming suspension at minute 15', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: minsAgo(10) }] })
    expect(await runShort(t)).toEqual({ warned: ['u1'], suspended: [] })
    const sent = t.notifications.send.mock.calls[0][0]
    expect(sent).toMatchObject({ kind: INACTIVITY_WARNING_KIND, channels: ['in_app', 'email'] })
    expect(sent.payload.suspendOn).toBe(new Date(NOW.getTime() + 5 * MIN).toISOString())
    expect(sent.body).toContain('2026-11-05 12:05 UTC')
  })

  it('15 minutes unused, warned 5 minutes ago → suspended', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: minsAgo(15) }], notes: [{ recipientId: 'u1', kind: INACTIVITY_WARNING_KIND, createdAt: minsAgo(5) }] })
    expect(await runShort(t)).toEqual({ warned: [], suspended: ['u1'] })
    expect(t.users[0].status).toBe('suspended')
  })

  it('still gives the full 5 minutes after a late warning', async () => {
    const t = setup({ users: [{ id: 'u1', email: 'a@x.io', lastActiveAt: minsAgo(16) }], notes: [{ recipientId: 'u1', kind: INACTIVITY_WARNING_KIND, createdAt: minsAgo(3) }] })
    expect(await runShort(t)).toEqual({ warned: [], suspended: [] })
  })
})

describe('inactivityConfigFromEnv', () => {
  const D = 86_400_000
  it('defaults to 25 / 30 days', () => {
    expect(inactivityConfigFromEnv({})).toEqual({ warningAfterMs: 25 * D, suspendAfterMs: 30 * D })
  })
  it('reads minutes from the settings', () => {
    expect(inactivityConfigFromEnv({ INACTIVITY_WARNING_MINUTES: '10', INACTIVITY_SUSPEND_MINUTES: '15' })).toEqual({ warningAfterMs: 600_000, suspendAfterMs: 900_000 })
  })
  it.each([
    ['a warning not before the suspension', { INACTIVITY_WARNING_MINUTES: '15', INACTIVITY_SUSPEND_MINUTES: '15' }],
    ['non-numbers', { INACTIVITY_WARNING_MINUTES: 'ten', INACTIVITY_SUSPEND_MINUTES: 'x' }],
  ])('falls back to the defaults for %s', (_l, env) => {
    expect(inactivityConfigFromEnv(env)).toEqual({ warningAfterMs: 25 * D, suspendAfterMs: 30 * D })
  })
})
