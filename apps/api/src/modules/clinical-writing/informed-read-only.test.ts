// Someone whose only part on a document is Informed (I) reads it and signs it if named, and
// changes nothing else. Through Fastify inject() over a Prisma double that records any write.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../auth/rbac.js'
import { checklistRActionRoutes } from './checklist/r-actions.js'
import { commentsRoutes } from './comments/routes.js'
import { crmRoutes } from './crm/routes.js'
import { documentsRoutes } from './documents/routes.js'
import { tlfRoutes } from './tlf/routes.js'

const DOC = 'DOC-1'
const ME = 'u-me'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose in-memory Prisma double
type Row = Record<string, any>

type Opts = { letters?: string[]; role?: AuthenticatedUser['role']; assignee?: string; chair?: string; auditRows?: Row[] }

function fakePrisma(opts: Opts, writes: string[]) {
  const letters = opts.letters ?? []
  const tables: Row = {
    document: {
      findUnique: async () => ({ id: DOC, projectId: 'P-1', type: 'csr_full', status: 'in_review', stage: 'cross_functional_review', deletedAt: null, assigneeId: opts.assignee ?? 'someone-else', title: 'Doc' }),
      findFirst: async () => (opts.assignee === ME ? { id: DOC } : null),
    },
    documentRaci: {
      findMany: async () => letters.map(letter => ({ id: `r-${letter}`, documentId: DOC, userId: ME, letter })),
      findFirst: async () => (letters.length ? { id: 'r-1', letter: letters[0] } : null),
    },
    crmMeeting: {
      findUnique: async () => ({ id: 'm1', documentId: DOC, chairId: opts.chair ?? 'u-chair', status: 'in_progress', meetingRef: 'CRM-1', attendees: [], resolutions: [], transcript: null }),
    },
    tlfPackage: { findUnique: async ({ where }: Row) => (where.id ? { id: where.id, projectId: 'P-1' } : null) },
    tlfItem:    { findUnique: async ({ where }: Row) => (where.id ? { id: where.id, packageId: 'pkg-1' } : null) },
  }
  const prisma: Row = new Proxy({}, {
    get(_t, table: string) {
      if (table === '$transaction') return async (fn: (tx: Row) => unknown) => fn(prisma)
      if (table.startsWith('$')) return async () => []
      return new Proxy({}, {
        get(_m, method: string) {
          const own = tables[table]?.[method]
          if (own) return own
          if (/^(create|update|upsert|delete)/.test(method)) {
            return async () => { writes.push(`${table}.${method}`); return { id: 'x', count: 1 } }
          }
          if (method === 'findMany') return async () => []
          if (method === 'count') return async () => 0
          return async () => null
        },
      })
    },
  })
  return prisma
}

async function build(opts: Opts) {
  const writes: string[] = []
  const append = vi.fn(async () => ({ id: '1', rowHash: 'h' }))
  const app = Fastify({ logger: false })
  app.decorate('prisma', fakePrisma(opts, writes) as never)
  app.decorate('audit', { append, pageForEntity: async () => ({ rows: opts.auditRows ?? [], total: opts.auditRows?.length ?? 0 }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: ME, email: 'me@x.test', role: opts.role ?? 'contributor', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.register(commentsRoutes, { prefix: '/documents' })
  await app.register(checklistRActionRoutes, { prefix: '/documents' })
  await app.register(crmRoutes)
  await app.register(tlfRoutes)
  await app.ready()
  return { app, writes, append }
}

const DOCUMENT_ROUTES = [
  { name: 'change the document status', url: `/documents/${DOC}/transition`, payload: { to: 'in_authoring', reason: 'x' } },
  { name: 'advance the stage',          url: `/documents/${DOC}/advance-stage`, payload: {} },
  { name: 'log a QA review',            url: `/documents/${DOC}/qa-review`, payload: { reviewedBy: 'x' } },
  { name: 'run the checklist autocheck', url: `/documents/${DOC}/checklist/autocheck/run`, payload: {} },
]
const TLF_ROUTES = [
  { name: 'add a TLF package',      url: '/projects/P-1/tlf-packages', payload: { version: 'v1', validatedBy: 'x', validatedAt: '2026-11-01T00:00:00.000Z', items: [] } },
  { name: 'add a TLF item',         url: '/tlf-packages/pkg-1/items', payload: { itemType: 'T', referenceId: 'T-1', title: 'x' } },
  { name: 'link a TLF item',        url: '/tlf-items/i1/section-links', payload: { documentId: DOC, sectionRef: '1' } },
]
const CRM_ROUTES = [
  { name: 'add a CRM attendee',    url: '/crm/m1/attendees', payload: { userId: 'u-x', roleInCrm: 'Reviewer' } },
  { name: 'cancel a CRM meeting',  url: '/crm/m1/cancel', payload: {} },
  { name: 'upload a transcript',   url: '/crm/m1/transcript', payload: { rawText: 'one two three four five six', source: 'manual_paste' } },
  { name: 'generate minutes',      url: '/crm/m1/minutes', payload: {} },
]

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

describe('someone who is only Informed (I)', () => {
  it.each([...DOCUMENT_ROUTES, ...TLF_ROUTES, ...CRM_ROUTES])('cannot $name', async ({ url, payload }) => {
    const { app, writes, append } = await build({ letters: ['I'] })
    const res = await app.inject({ method: 'POST', url, payload })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('informed_read_only')
    expect(writes).toEqual([])
    expect(append).not.toHaveBeenCalled()
  })

  it.each(CRM_ROUTES)('can still $name in a meeting they chair', async ({ url, payload }) => {
    const { app } = await build({ letters: ['I'], chair: ME })
    const res = await app.inject({ method: 'POST', url, payload })
    expect(res.json().error).not.toBe('informed_read_only')
  })
})

describe('the refusal only applies to someone whose sole part is Informed', () => {
  describe.each([
    ['an Author (R)',            { letters: ['R'] }],
    ['a Reviewer (C)',           { letters: ['C'] }],
    ['an Approver (A)',          { letters: ['A'] }],
    ['QC (Q)',                   { letters: ['Q'] }],
    ['someone who is I and C',   { letters: ['I', 'C'] }],
    ['the assignee who is also I', { letters: ['I'], assignee: ME }],
    ['a PM holding I',           { letters: ['I'], role: 'pm' as const }],
    ['a user with no letter',    { letters: [] }],
  ])('%s', (_label, opts) => {
    it.each([...DOCUMENT_ROUTES, ...TLF_ROUTES, ...CRM_ROUTES])('is not refused to $name as Informed', async ({ url, payload }) => {
      const { app } = await build(opts)
      const res = await app.inject({ method: 'POST', url, payload })
      expect(res.json().error).not.toBe('informed_read_only')
    })
  })
})

describe('an Informed signature in the document audit trail', () => {
  const row = (action: string, details: Row) => ({ id: '9', timestamp: '2026-11-05T10:00:00.000Z', actorId: ME, action, entityType: 'document', entityId: DOC, details, prevHash: null, rowHash: 'h' })

  it.each(['signature_recorded', 'document_signed'])('%s is a signature event and says what it was signed as', async (action) => {
    const { app } = await build({ letters: ['I'], auditRows: [row(action, { meaning: 'acknowledged', step: 5 })] })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/audit` })
    expect(res.statusCode).toBe(200)
    const [entry] = res.json().entries
    expect(entry.eventType).toBe('document-signed')
    expect(entry.detail).toBe('Meaning: acknowledged · Step 5')
  })
})
