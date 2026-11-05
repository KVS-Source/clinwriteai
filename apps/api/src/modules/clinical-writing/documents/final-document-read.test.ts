// The Final Document is readable by the same people the UI shows it to
// (useSignatureAccess.canViewFinal): any RACI letter on the document, its
// assignee, a PM who can see the project, or an auditor — never an admin or a
// guest, and not QC (Q) on its own. GET /documents/:id/final and the compliance
// summary enforce it; GET /documents/:id (the editor's read) is unchanged, so a
// QC reviewer can still read the document to do their QC.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'
import { checklistRoutes } from '../checklist/routes.js'

type Opts = { role?: AuthenticatedUser['role']; letters?: string[]; assignee?: boolean; pmMember?: boolean }

async function build(o: Opts = {}) {
  const me = 'u-me'
  const letters = o.letters ?? []
  const doc = {
    id: 'DOC-1', projectId: 'p-1', type: 'protocol', title: 'Protocol', status: 'signed', stage: 'final_output',
    assigneeId: o.assignee ? me : 'someone-else', deletedAt: null, currentVersionId: 'v1',
    currentVersion: { id: 'v1', versionNumber: 'v1.0', sections: [] as unknown[] },
  }
  const audit: Array<{ action: string; details: Record<string, unknown> }> = []
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => doc),
      count:      vi.fn(async () => (letters.length > 0 || o.assignee ? 1 : 0)),
      findMany:   vi.fn(async () => (letters.length > 0 || o.assignee ? [{ projectId: 'p-1' }] : [])),
    },
    documentRaci: {
      findFirst: vi.fn(async () => (letters.length > 0 ? { id: 'raci-1' } : null)),
      findMany:  vi.fn(async () => letters.map(letter => ({ letter }))),
    },
    projectMember:     { findMany: vi.fn(async () => (o.pmMember ? [{ projectId: 'p-1' }] : [])) },
    projectTeamMember: { findMany: vi.fn(async () => []) },
    user:              { findMany: vi.fn(async () => []) },
    checklistInstance: { findUnique: vi.fn(async () => ({ templateVersion: 1, items: [] })) },
    ichSectionWaiver:  { findMany: vi.fn(async () => []) },
  } as never)
  app.decorate('audit', { append: vi.fn(async (e: { action: string; details: Record<string, unknown> }) => { audit.push(e); return {} }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: me, email: 'me@x', role: o.role ?? 'contributor', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.register(checklistRoutes, { prefix: '/documents' })
  await app.ready()
  const get = (path: string) => app.inject({ method: 'GET', url: `/documents/DOC-1${path}` })
  return { app, get, audit }
}

process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E'

describe('GET /documents/:id/final — who may read the Final Document', () => {
  it.each([
    ['the author (R)',            { letters: ['R'] }],
    ['a reviewer (C)',            { letters: ['C'] }],
    ['an approver (A)',           { letters: ['A'] }],
    ['someone informed (I)',      { letters: ['I'] }],
    ['QC (Q) together with C',    { letters: ['Q', 'C'] }],
    ['the assignee, no letter',   { assignee: true }],
    ['an auditor',                { role: 'auditor' as const }],
    ['a PM who can see the project', { role: 'pm' as const, pmMember: true }],
  ])('%s may read it (200), audited as a Final Document read', async (_l, o) => {
    const t = await build(o)
    const res = await t.get('/final')
    expect(res.statusCode).toBe(200)
    expect(res.json().id).toBe('DOC-1')
    expect(t.audit.find(e => e.action === 'phi_document_accessed')?.details).toMatchObject({ view: 'final_document' })
  })

  it.each([
    ['a tenant admin',                { role: 'tenant-admin' as const }],
    ['a guest',                       { role: 'guest' as const, letters: ['I'] }],
    ['QC (Q) on its own',             { letters: ['Q'] }],
    ['a PM who cannot see the project', { role: 'pm' as const }],
    ['someone with no part in it',    {}],
  ])('%s is refused (403) and nothing is read', async (_l, o) => {
    const t = await build(o)
    const res = await t.get('/final')
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('final_document_forbidden')
    expect(t.audit.some(e => e.action === 'phi_document_accessed')).toBe(false)
  })
})

describe('the rest of the document stays readable where it was', () => {
  it('QC (Q) alone can still read the document itself (the editor\'s read) to do their QC', async () => {
    const t = await build({ letters: ['Q'] })
    const res = await t.get('')
    expect(res.statusCode).toBe(200)
    expect(t.audit.find(e => e.action === 'phi_document_accessed')?.details).toMatchObject({ view: 'document' })
  })
})

describe('compliance summary (part of the Final Document) — same rule', () => {
  it('a reviewer (C) may read it', async () => {
    expect((await (await build({ letters: ['C'] })).get('/compliance-summary')).statusCode).toBe(200)
  })

  it.each([
    ['QC (Q) on its own', { letters: ['Q'] }],
    ['a tenant admin',    { role: 'tenant-admin' as const }],
  ])('%s is refused (403)', async (_l, o) => {
    const res = await (await build(o)).get('/compliance-summary')
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('final_document_forbidden')
  })
})
