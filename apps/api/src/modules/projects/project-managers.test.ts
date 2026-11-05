// A project's managers: the creator is one, and any PM on the project can add others, from the list of
// PMs in their tenant or by email. Fastify inject() over an in-memory Prisma double.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../auth/rbac.js'
import { projectMembersRoutes } from '../platform/project-members/routes.js'
import { projectRoutes } from './routes.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose in-memory Prisma double
type Row = Record<string, any>

const P = 'PROJ-1'
const user = (id: string, over: Row = {}): Row => ({ id, name: id, email: `${id}@x.test`, role: 'pm', status: 'active', tenantId: 'T-1', modules: ['A'], ...over })

async function build(actor: Partial<AuthenticatedUser> = {}, opts: { onProject?: boolean } = {}) {
  const me: AuthenticatedUser = { id: 'u-me', email: 'u-me@x.test', role: 'pm', modules: ['A', 'B'], tenantId: 'T-1', ...actor } as AuthenticatedUser
  const users: Row[] = [
    user('u-me', { modules: me.modules, role: me.role }),
    user('u-boss'),
    user('u-invited', { status: 'invited' }),
    user('u-suspended', { status: 'suspended' }),
    user('u-other-tenant', { tenantId: 'T-2' }),
    user('u-writer', { role: 'contributor' }),
  ]
  const members: Row[] = opts.onProject === false ? [] : [{ id: 'm-me', projectId: P, userId: 'u-me', projectRole: 'Project Manager', addedBy: 'u-me', addedAt: new Date('2026-01-01'), removedAt: null }]
  const projects: Row[] = [{ id: P, name: 'Velora', therapeuticArea: 'Oncology' }]
  const invitations: Row[] = []
  const prisma: Row = {
    project: {
      findUnique: async ({ where }: Row) => projects.find(p => p.id === where.id) ?? null,
      create: async ({ data }: Row) => {
        const { members: nested, ...rest } = data
        projects.push(rest)
        members.push({ id: `m-${members.length}`, projectId: rest.id, ...nested.create, addedAt: new Date(), removedAt: null })
        return rest
      },
      update: async ({ where, data }: Row) => Object.assign(projects.find(p => p.id === where.id)!, data),
    },
    projectMember: {
      findMany: async ({ where }: Row) => members
        .filter(m => (!where.projectId || m.projectId === where.projectId) && (!where.userId || m.userId === where.userId) && (where.removedAt !== null || !m.removedAt))
        .map(m => ({ ...m, user: users.find(u => u.id === m.userId) }))
        .filter(m => !where.user || m.user?.role === where.user.role),
      findUnique: async ({ where }: Row) => members.find(m => m.id === where.id || (m.projectId === where.projectId_userId?.projectId && m.userId === where.projectId_userId?.userId)) ?? null,
      create: async ({ data }: Row) => { const m = { id: `m-${members.length}`, addedAt: new Date(), removedAt: null, ...data }; members.push(m); return m },
      update: async ({ where, data }: Row) => Object.assign(members.find(m => m.id === where.id)!, data),
    },
    projectTeamMember: { findMany: async () => [] },
    document: { findMany: async () => [] },
    therapeuticArea: { findMany: async () => [{ label: 'Oncology' }], findFirst: async () => ({ label: 'Oncology' }) },
    user: {
      findUnique: async ({ where }: Row) => users.find(u => u.id === where.id || u.email === where.email) ?? null,
      findMany: async ({ where }: Row) => users.filter(u => u.role === where.role && u.tenantId === where.tenantId && where.status.in.includes(u.status)).map(({ id, name, email, status }) => ({ id, name, email, status })),
      create: async ({ data }: Row) => { const u = { id: `u-new-${users.length}`, ...data }; users.push(u); return u },
    },
    userInvitation: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: Row) => { invitations.push(data); return data },
    },
    $transaction: async (ops: unknown) => Promise.all(ops as Array<Promise<unknown>>),
  }
  const send = vi.fn(async (_n: Row) => undefined)
  const append = vi.fn(async (_e: Row) => ({ id: '1', rowHash: 'h' }))
  const app = Fastify({ logger: false })
  app.decorate('prisma', prisma as never)
  app.decorate('audit', { append } as never)
  app.decorate('notifications', { send } as never)
  app.decorate('env', { CORS_ORIGIN: 'http://web.test' } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => { (req as unknown as { user: AuthenticatedUser }).user = me })
  await app.register(projectRoutes, { prefix: '/projects' })
  await app.register(projectMembersRoutes, { prefix: '/projects' })
  await app.ready()
  return { app, users, members, projects, invitations, send, append }
}

const post = (app: Awaited<ReturnType<typeof build>>['app'], url: string, payload: Row = {}) => app.inject({ method: 'POST', url, payload })
const active = (t: Awaited<ReturnType<typeof build>>) => t.members.filter(m => m.projectId === P && !m.removedAt).map(m => m.userId)

describe('the list of PMs to pick from', () => {
  it('has the PMs in my tenant who are active or invited, and nobody else', async () => {
    const t = await build()
    const res = await t.app.inject({ method: 'GET', url: '/projects/pm-directory' })
    expect(res.statusCode).toBe(200)
    expect(res.json().map((u: Row) => u.id).sort()).toEqual(['u-boss', 'u-invited', 'u-me'])
  })

  it.each(['contributor', 'tenant-admin', 'auditor', 'guest'] as const)('is refused to a %s', async (role) => {
    const t = await build({ role })
    expect((await t.app.inject({ method: 'GET', url: '/projects/pm-directory' })).statusCode).toBe(403)
  })
})

describe('adding a PM from the list', () => {
  it('puts them on the project, tells them, and records it', async () => {
    const t = await build()
    const res = await post(t.app, `/projects/${P}/managers`, { userId: 'u-boss' })
    expect(res.statusCode).toBe(201)
    expect(active(t)).toContain('u-boss')
    expect(res.json().managers.map((m: Row) => m.id)).toEqual(['u-me', 'u-boss'])
    expect(res.json().managers[0].isCreator).toBe(true)
    expect(res.json().managers[1].isCreator).toBe(false)
    expect(t.send.mock.calls[0]![0]).toMatchObject({ recipientId: 'u-boss', kind: 'project_manager_added' })
    expect(t.append.mock.calls.map(c => c[0].action)).toContain('project.manager_added')
  })

  it('adding someone already on it changes nothing and records nothing', async () => {
    const t = await build()
    await post(t.app, `/projects/${P}/managers`, { userId: 'u-boss' })
    t.append.mockClear()
    const res = await post(t.app, `/projects/${P}/managers`, { userId: 'u-boss' })
    expect(res.statusCode).toBe(200)
    expect(active(t).filter(id => id === 'u-boss')).toHaveLength(1)
    expect(t.append).not.toHaveBeenCalled()
  })

  it.each(['u-writer', 'u-suspended', 'u-other-tenant', 'u-unknown'])('refuses %s', async (userId) => {
    const t = await build()
    const res = await post(t.app, `/projects/${P}/managers`, { userId })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('pm_user_not_eligible')
    expect(active(t)).toEqual(['u-me'])
  })

  it('a PM who is not on the project cannot add anyone, or themselves', async () => {
    const t = await build({}, { onProject: false })
    expect((await post(t.app, `/projects/${P}/managers`, { userId: 'u-me' })).statusCode).toBe(403)
    expect(t.members).toEqual([])
  })

  it.each(['contributor', 'tenant-admin', 'auditor'] as const)('a %s cannot add a PM', async (role) => {
    const t = await build({ role })
    expect((await post(t.app, `/projects/${P}/managers`, { userId: 'u-boss' })).statusCode).toBe(403)
  })
})

describe('inviting a PM by email', () => {
  it('creates an invited PM in my tenant with my modules, on the project, and emails them the link', async () => {
    const t = await build()
    const res = await post(t.app, `/projects/${P}/managers/invite`, { email: '  The.Boss@X.test ' })
    expect(res.statusCode).toBe(201)
    const boss = t.users.find(u => u.email === 'the.boss@x.test')!
    expect(boss).toMatchObject({ role: 'pm', status: 'invited', tenantId: 'T-1', modules: ['A', 'B'], name: 'The Boss' })
    expect(active(t)).toContain(boss.id)
    expect(t.invitations).toHaveLength(1)
    const mail = t.send.mock.calls[0]![0]
    expect(mail).toMatchObject({ recipientId: boss.id, channels: ['email'] })
    expect(mail.body).toContain('http://web.test/accept-invitation?token=')
    expect(mail.body).toContain('project manager on "Velora"')
  })

  it('never gives the link to the PM who invited them', async () => {
    const t = await build()
    const res = await post(t.app, `/projects/${P}/managers/invite`, { email: 'boss2@x.test' })
    expect(res.body).not.toContain('accept-invitation')
    expect(res.json().inviteUrl).toBeUndefined()
    expect(res.json().emailQueued).toBe(true)
  })

  it('says when the email could not be queued, and still adds them', async () => {
    const t = await build()
    t.send.mockRejectedValueOnce(new Error('no queue'))
    const res = await post(t.app, `/projects/${P}/managers/invite`, { email: 'boss3@x.test' })
    expect(res.statusCode).toBe(201)
    expect(res.json().emailQueued).toBe(false)
    expect(res.json().managers.map((m: Row) => m.email)).toContain('boss3@x.test')
  })

  it('an email that is already a PM here adds that person, with no new account', async () => {
    const t = await build()
    const before = t.users.length
    expect((await post(t.app, `/projects/${P}/managers/invite`, { email: 'u-boss@x.test' })).statusCode).toBe(201)
    expect(t.users).toHaveLength(before)
    expect(active(t)).toContain('u-boss')
  })

  it.each(['u-writer@x.test', 'u-other-tenant@x.test', 'u-suspended@x.test'])('refuses %s with one message, and promotes nobody', async (email) => {
    const t = await build()
    const res = await post(t.app, `/projects/${P}/managers/invite`, { email })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('pm_email_not_pm')
    expect(t.users.find(u => u.email === 'u-writer@x.test')!.role).toBe('contributor')
    expect(active(t)).toEqual(['u-me'])
  })

  it('a PM who is not on the project cannot invite', async () => {
    const t = await build({}, { onProject: false })
    const before = t.users.length
    expect((await post(t.app, `/projects/${P}/managers/invite`, { email: 'x@x.test' })).statusCode).toBe(403)
    expect(t.users).toHaveLength(before)
  })
})

describe('resending an invitation', () => {
  it('sends an invited PM on the project a fresh link', async () => {
    const t = await build()
    await post(t.app, `/projects/${P}/managers`, { userId: 'u-invited' })
    t.send.mockClear()
    const res = await post(t.app, `/projects/${P}/managers/u-invited/resend`)
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('accept-invitation')
    expect(t.send).toHaveBeenCalledOnce()
    expect(t.invitations).toHaveLength(2)
  })

  it('has nothing to send to someone already active, or someone not on the project', async () => {
    const t = await build()
    await post(t.app, `/projects/${P}/managers`, { userId: 'u-boss' })
    expect((await post(t.app, `/projects/${P}/managers/u-boss/resend`)).statusCode).toBe(409)
    expect((await post(t.app, `/projects/${P}/managers/u-invited/resend`)).statusCode).toBe(404)
  })
})

describe('removing a PM', () => {
  const remove = (t: Awaited<ReturnType<typeof build>>, id: string) => t.app.inject({ method: 'DELETE', url: `/projects/${P}/managers/${id}` })

  it('takes them off, and adding them again brings them back', async () => {
    const t = await build()
    await post(t.app, `/projects/${P}/managers`, { userId: 'u-boss' })
    expect((await remove(t, 'u-boss')).statusCode).toBe(200)
    expect(active(t)).toEqual(['u-me'])
    expect(t.append.mock.calls.map(c => c[0].action)).toContain('project.manager_removed')
    expect((await post(t.app, `/projects/${P}/managers`, { userId: 'u-boss' })).statusCode).toBe(201)
    expect(active(t)).toContain('u-boss')
  })

  it('refuses to remove the last PM', async () => {
    const t = await build()
    const res = await remove(t, 'u-me')
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('last_project_manager')
  })

  it('someone only invited does not count as the PM left behind', async () => {
    const t = await build()
    await post(t.app, `/projects/${P}/managers`, { userId: 'u-invited' })
    expect((await remove(t, 'u-me')).statusCode).toBe(409)
    expect((await remove(t, 'u-invited')).statusCode).toBe(200)
  })
})

describe('creating a project', () => {
  const body = (projectManagers?: Row) => ({
    id: 'PROJ-NEW', name: 'New', shortTitle: 'New', therapeuticArea: 'Oncology', phase: 'Phase 1',
    startDate: '2026-11-01T00:00:00.000Z', ...(projectManagers && { projectManagers }),
  })
  const onNew = (t: Awaited<ReturnType<typeof build>>) => t.members.filter(m => m.projectId === 'PROJ-NEW').map(m => m.userId)

  it('makes the creator the PM when no others are given', async () => {
    const t = await build()
    const res = await post(t.app, '/projects', body())
    expect(res.statusCode).toBe(201)
    expect(onNew(t)).toEqual(['u-me'])
  })

  it('adds the PMs picked and invited, and the creator stays first', async () => {
    const t = await build()
    const res = await post(t.app, '/projects', body({ userIds: ['u-boss', 'u-me'], inviteEmails: ['New.Boss@x.test', 'u-boss@x.test'] }))
    expect(res.statusCode).toBe(201)
    const invited = t.users.find(u => u.email === 'new.boss@x.test')!
    expect(onNew(t)).toEqual(['u-me', 'u-boss', invited.id])
    expect(res.json().pmInvites).toEqual([{ email: 'new.boss@x.test', emailQueued: true }])
    expect(res.body).not.toContain('accept-invitation')
  })

  it.each([
    [{ userIds: ['u-writer'] }, 'pm_user_not_eligible'],
    [{ inviteEmails: ['u-writer@x.test'] }, 'pm_email_not_pm'],
  ])('creates nothing when one entry is refused: %j', async (managers, error) => {
    const t = await build()
    const before = t.users.length
    const res = await post(t.app, '/projects', body({ inviteEmails: ['ok@x.test'], ...managers }))
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe(error)
    expect(t.projects.find(p => p.id === 'PROJ-NEW')).toBeUndefined()
    expect(t.users).toHaveLength(before)
  })
})

describe('a PM only changes their own projects', () => {
  it('cannot edit a project they are not on', async () => {
    const t = await build({}, { onProject: false })
    const res = await t.app.inject({ method: 'PATCH', url: `/projects/${P}`, payload: { name: 'Renamed' } })
    expect(res.statusCode).toBe(403)
    expect(t.projects[0]!.name).toBe('Velora')
  })

  it('can edit one they are on', async () => {
    const t = await build()
    expect((await t.app.inject({ method: 'PATCH', url: `/projects/${P}`, payload: { name: 'Renamed' } })).statusCode).toBe(200)
  })

  it('cannot change the members of a project they are not on; an admin still can', async () => {
    const outsider = await build({}, { onProject: false })
    expect((await post(outsider.app, `/projects/${P}/members`, { userId: 'u-boss' })).statusCode).toBe(403)
    const admin = await build({ role: 'tenant-admin' }, { onProject: false })
    expect((await post(admin.app, `/projects/${P}/members`, { userId: 'u-boss' })).statusCode).toBe(201)
  })
})
