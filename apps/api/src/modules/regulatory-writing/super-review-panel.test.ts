// GET /:submissionId/super-reviewers
//
// Previously returned hardcoded 4-seat panel with fixed names. Now
// derives seats from the submission's project members using role +
// projectRole heuristics.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../auth/rbac.js'

const { regAliasesAndStubs } = await import('./aliases-and-stubs.js')

const SUB = 'sub-1'

type Member = {
  userId:       string
  projectRole:  string | null
  user: { id: string; name: string; initials: string; role: string }
}

async function build(opts: { submissionExists?: boolean; members?: Member[] } = {}) {
  const app = Fastify()
  app.decorate('prisma', {
    regulatorySubmission: {
      findUnique: vi.fn(async () => opts.submissionExists === false ? null : ({ projectId: 'proj-1' })),
    },
    projectMember: {
      findMany: vi.fn(async () => opts.members ?? []),
    },
  } as never)
  app.decorate('audit', { append: vi.fn() } as never)
  app.decorate('aiGateway', { chat: vi.fn() } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'regulatory-writer', modules: ['D'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(regAliasesAndStubs)
  await app.ready()
  return app
}

const member = (userId: string, name: string, role: string, projectRole: string | null): Member => ({
  userId,
  projectRole,
  user: { id: userId, name, initials: name.split(' ').map(s => s[0]).join(''), role },
})

const get = (app: Awaited<ReturnType<typeof build>>) =>
  app.inject({ method: 'GET', url: `/${SUB}/super-reviewers` })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'D' })

describe('GET /:submissionId/super-reviewers', () => {
  it('returns 4 seats with no hardcoded names when no members exist', async () => {
    const res = await get(await build({ members: [] }))
    expect(res.statusCode).toBe(200)
    const seats = res.json() as Array<{ seatRole: string; assigned: boolean; name: string | null }>
    expect(seats).toHaveLength(4)
    expect(seats.map(s => s.seatRole)).toEqual(['Clinical', 'Regulatory', 'PV Lead', 'Biostats'])
    expect(seats.every(s => s.assigned === false && s.name === null)).toBe(true)
  })

  it('assigns seats from matching project members by role + projectRole', async () => {
    const app = await build({
      members: [
        member('u-clin', 'Dr Rebecca Morton', 'clinical-writer',   null),
        member('u-reg',  'Dr Priya Nair',     'regulatory-writer', null),
        member('u-pv',   'Dr Elena Vasquez',  'medical-writer',    'PV Lead'),
        member('u-stat', 'Mr David Chen',     'contributor',       'Biostats Lead'),
      ],
    })
    const seats = (await get(app)).json() as Array<{ seatRole: string; userId: string | null; name: string | null; assigned: boolean }>
    expect(seats.find(s => s.seatRole === 'Clinical')).toMatchObject({ userId: 'u-clin', name: 'Dr Rebecca Morton', assigned: true })
    expect(seats.find(s => s.seatRole === 'Regulatory')).toMatchObject({ userId: 'u-reg', name: 'Dr Priya Nair', assigned: true })
    expect(seats.find(s => s.seatRole === 'PV Lead')).toMatchObject({ userId: 'u-pv', name: 'Dr Elena Vasquez', assigned: true })
    expect(seats.find(s => s.seatRole === 'Biostats')).toMatchObject({ userId: 'u-stat', name: 'Mr David Chen', assigned: true })
  })

  it('matches on projectRole regex when user.role is generic (contributor)', async () => {
    const app = await build({
      members: [
        member('u1', 'Anna', 'contributor', 'Clinical Reviewer'),
        member('u2', 'Bill', 'contributor', 'Regulatory Affairs'),
      ],
    })
    const seats = (await get(app)).json() as Array<{ seatRole: string; userId: string | null }>
    expect(seats.find(s => s.seatRole === 'Clinical')?.userId).toBe('u1')
    expect(seats.find(s => s.seatRole === 'Regulatory')?.userId).toBe('u2')
  })

  it('does not fill two seats with the same member (first match wins)', async () => {
    // "Pharmacovigilance Regulatory Lead" could match both Regulatory + PV.
    // Regulatory seat is checked first; the single user lands there only.
    const app = await build({
      members: [
        member('u1', 'Alice', 'contributor', 'Pharmacovigilance Regulatory Lead'),
      ],
    })
    const seats = (await get(app)).json() as Array<{ seatRole: string; userId: string | null; assigned: boolean }>
    expect(seats.find(s => s.seatRole === 'Regulatory')?.userId).toBe('u1')
    expect(seats.find(s => s.seatRole === 'PV Lead')?.assigned).toBe(false)
  })

  it('leaves unmatched seats unassigned rather than returning hardcoded placeholders', async () => {
    const app = await build({
      members: [member('u-clin', 'Only Clinical', 'clinical-writer', null)],
    })
    const seats = (await get(app)).json() as Array<{ seatRole: string; assigned: boolean }>
    expect(seats.find(s => s.seatRole === 'Clinical')?.assigned).toBe(true)
    expect(seats.find(s => s.seatRole === 'Regulatory')?.assigned).toBe(false)
    expect(seats.find(s => s.seatRole === 'PV Lead')?.assigned).toBe(false)
    expect(seats.find(s => s.seatRole === 'Biostats')?.assigned).toBe(false)
  })

  it('returns 404 when the submission does not exist', async () => {
    expect((await get(await build({ submissionExists: false }))).statusCode).toBe(404)
  })
})
