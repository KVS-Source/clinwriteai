// POST /documents/:id/apply-template: an empty document gets its template's empty headings. Through
// Fastify inject() over an in-memory Prisma double.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'
import { templateSections } from './templates.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose in-memory Prisma double
type Row = Record<string, any>
const DOC = 'DOC-1'
const EMPTY_HASH = 'e3b0c442'

type Opts = { status?: string; type?: string; role?: AuthenticatedUser['role']; letters?: string[]; memberOf?: string[]; projectStatus?: string; existingSections?: number; dbTemplate?: unknown; noVersion?: boolean; countries?: string[] }

async function build(opts: Opts = {}) {
  const created: Row[] = []
  const versionUpdates: Row[] = []
  const append = vi.fn(async (_e: Row) => ({ id: '1', rowHash: 'h' }))
  const letters = opts.letters ?? []
  const tx: Row = {
    sectionContent: {
      count: async () => opts.existingSections ?? 0,
      createMany: async ({ data }: Row) => { created.push(...data); return { count: data.length } },
    },
    documentVersion: { update: async ({ where, data }: Row) => { versionUpdates.push({ where, data }); return {} } },
  }
  const app = Fastify({ logger: false })
  app.decorate('prisma', {
    ...tx,
    document: {
      findUnique: async () => ({
        id: DOC, type: opts.type ?? 'protocol', status: opts.status ?? 'not_started', projectId: 'P-1', deletedAt: null, assigneeId: 'someone-else',
        currentVersionId: opts.noVersion ? null : 'v1', currentVersion: opts.noVersion ? null : { versionNumber: 'v0.1', contentHash: EMPTY_HASH },
      }),
      findMany: async () => [],
    },
    documentRaci: {
      findFirst: async ({ where }: Row) => (letters.includes(where.letter) ? { id: 'r' } : null),
      findMany: async () => letters.map(letter => ({ letter, userId: 'u-1', id: 'r' })),
    },
    project: { findUnique: async () => ({ status: opts.projectStatus ?? 'ongoing', submissionCountries: opts.countries ?? [] }) },
    projectMember: { findMany: async () => (opts.memberOf ?? []).map(projectId => ({ projectId })) },
    projectTeamMember: { findMany: async () => [] },
    documentTemplate: { findFirst: async () => (opts.dbTemplate !== undefined ? { sections: opts.dbTemplate } : null) },
    $transaction: async (fn: (t: Row) => unknown) => fn(tx),
  } as never)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u-1', email: 'u@x', role: opts.role ?? 'contributor', modules: ['A'], tenantId: null } as AuthenticatedUser
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  const post = () => app.inject({ method: 'POST', url: `/documents/${DOC}/apply-template`, payload: {} })
  return { post, created, versionUpdates, append }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

describe('apply template sections', () => {
  it('gives an empty Protocol its template: empty headings, a new hash, and an audit entry', async () => {
    const t = await build({ letters: ['R'] })
    const expected = templateSections('protocol')
    const res = await t.post()
    expect(res.statusCode).toBe(201)
    expect(res.json().sectionCount).toBe(expected.length)
    expect(expected.length).toBeGreaterThan(0)
    expect(t.created.map(s => s.sectionId)).toEqual(expected.map(s => s.sectionId))
    expect(t.created.every(s => s.contentHtml === '' && s.documentVersionId === 'v1')).toBe(true)
    expect(t.versionUpdates[0]!.data.contentHash).not.toBe(EMPTY_HASH)
    expect(t.append.mock.calls[0]![0]).toMatchObject({
      action: 'document_template_applied', entityId: DOC,
      details: { source: 'action', versionNumber: 'v0.1', sectionCount: expected.length, hashBefore: EMPTY_HASH },
    })
  })

  it('uses the managed template when there is one', async () => {
    const t = await build({ letters: ['R'], dbTemplate: [{ id: 's1', number: '1', title: 'From the database' }] })
    await t.post()
    expect(t.created.map(s => s.sectionTitle)).toEqual(['From the database'])
  })

  it('falls back to the built-in template when the managed one is unusable', async () => {
    const t = await build({ letters: ['R'], dbTemplate: 'not a list' })
    expect((await t.post()).statusCode).toBe(201)
    expect(t.created.length).toBe(templateSections('protocol').length)
  })

  it('never touches a document that already has sections', async () => {
    const t = await build({ letters: ['R'], existingSections: 3 })
    const res = await t.post()
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('already_has_sections')
    expect(t.created).toEqual([])
    expect(t.versionUpdates).toEqual([])
    expect(t.append).not.toHaveBeenCalled()
  })

  it.each(['pending_signature', 'signed'])('refuses a %s document, whose hash is bound to signatures', async (status) => {
    const t = await build({ letters: ['R'], status })
    const res = await t.post()
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('signature_bound')
    expect(t.created).toEqual([])
  })

  it.each(['not_started', 'in_authoring', 'in_review', 'crm_in_progress'])('allows a %s document', async (status) => {
    expect((await (await build({ letters: ['R'], status })).post()).statusCode).toBe(201)
  })

  it('refuses a document in a closed project', async () => {
    const t = await build({ letters: ['R'], projectStatus: 'closed' })
    expect((await t.post()).statusCode).toBe(409)
    expect(t.created).toEqual([])
  })

  it('says so when the type has no template', async () => {
    const t = await build({ letters: ['R'], type: 'no-such-type' })
    const res = await t.post()
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('no_template')
  })

  it('says so when the document has no current version', async () => {
    expect((await (await build({ letters: ['R'], noVersion: true })).post()).statusCode).toBe(409)
  })
})

describe('who may apply it', () => {
  it('a PM on the project may', async () => {
    expect((await (await build({ role: 'pm', memberOf: ['P-1'] })).post()).statusCode).toBe(201)
  })

  it.each([
    ['a PM outside the project', { role: 'pm' as const, memberOf: ['P-other'] }],
    ['a Reviewer (C)', { letters: ['C'] }],
    ['an Approver (A)', { letters: ['A'] }],
    ['QC (Q)', { letters: ['Q'] }],
    ['Informed (I)', { letters: ['I'] }],
    ['someone with no letter', {}],
    ['a tenant admin', { role: 'tenant-admin' as const }],
  ])('%s may not', async (_label, opts) => {
    const t = await build(opts)
    const res = await t.post()
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('template_apply_forbidden')
    expect(t.created).toEqual([])
  })
})

describe('an auditor', () => {
  it('is refused like every other change, and nothing is added', async () => {
    const t = await build({ role: 'auditor' })
    expect((await t.post()).statusCode).toBe(403)
    expect(t.created).toEqual([])
  })
})
