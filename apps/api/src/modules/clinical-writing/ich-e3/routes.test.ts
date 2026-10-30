// ICH E3 routes with a stubbed Prisma — report shaping, CSR-only waivers and
// the mark-complete / reopen section status route.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { ichE3Routes } from './routes.js'

const DOC = 'DOC-1'

interface Opts {
  type?:          string
  docStatus?:     string
  projectStatus?: string
  role?:          string
  capabilities?:  string[]
  section?:       { contentHtml: string; ichStatus: string } | null
}

async function build(opts: Opts = {}) {
  const section = opts.section === undefined ? { contentHtml: '<p>text</p>', ichStatus: 'in_progress' } : opts.section
  const sectionUpdates: Array<{ where: { id: string }; data: { ichStatus: string } }> = []
  const waiverUpserts: unknown[] = []
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({
        id: DOC, title: 'CSR Velora-301', type: opts.type ?? 'csr_full', status: opts.docStatus ?? 'in_authoring',
        projectId: 'proj-1', deletedAt: null,
        currentVersion: {
          versionNumber: 'v0.3',
          sections: section ? [{ id: 'row-1', sectionId: 's5', ...section }] : [],
        },
      })),
    },
    project:          { findUnique: vi.fn(async () => ({ status: opts.projectStatus ?? 'ongoing' })) },
    user:             { findMany: vi.fn(async () => [{ id: 'u-9', name: 'Dr A Rao' }]) },
    sectionContent:   { update: vi.fn(async (args: { where: { id: string }; data: { ichStatus: string } }) => { sectionUpdates.push(args); return {} }) },
    ichSectionWaiver: {
      findMany:   vi.fn(async () => [{ sectionCode: '§15', waivedBy: 'u-9', waivedAt: new Date('2026-10-30T10:00:00Z'), reason: 'No references cited', versionAtWaiver: 'v0.2' }]),
      findUnique: vi.fn(async () => null),
      upsert:     vi.fn(async (args: unknown) => { waiverUpserts.push(args); return {} }),
      delete:     vi.fn(async () => ({})),
    },
  } as never)
  const append = vi.fn(async (_event: { action: string; details: Record<string, unknown> }) => undefined)
  app.decorate('audit', { append } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user = {
      id: 'u1', email: 'u@x.io', role: opts.role ?? 'admin', capabilities: opts.capabilities ?? [], modules: ['A'], tenantId: null,
    } as unknown as AuthenticatedUser
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(ichE3Routes, { prefix: '/documents' })
  await app.ready()
  return { app, append, sectionUpdates, waiverUpserts }
}

const setStatus = (app: Awaited<ReturnType<typeof build>>['app'], status: string) =>
  app.inject({ method: 'PATCH', url: `/documents/${DOC}/sections/s5/ich-status`, payload: { status } })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('GET /documents/:id/ich-e3', () => {
  it('returns the title, applicability and the waiver actor name', async () => {
    const { app } = await build()
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/ich-e3` })).json()
    expect(body).toMatchObject({ applicable: true, documentTitle: 'CSR Velora-301', waivedCount: 1 })
    expect(body.sections.find((s: { code: string }) => s.code === '§15').waiver).toMatchObject({ waivedBy: 'u-9', waivedByName: 'Dr A Rao' })
  })

  it('marks a non-CSR document as not applicable, with no rows', async () => {
    const { app } = await build({ type: 'icf' })
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/ich-e3` })).json()
    expect(body).toMatchObject({ applicable: false, sections: [], canWaive: false })
  })

  it.each([
    ['tenant-admin', [], true],
    ['admin',        [], true],
    ['contributor',  ['can-review'], true],
    ['contributor',  ['can-author'], false],
    ['pm',           [], false],
  ])('canWaive for %s %j is %s — same check as the waive route', async (role, capabilities, expected) => {
    const { app } = await build({ role, capabilities })
    const body = (await app.inject({ method: 'GET', url: `/documents/${DOC}/ich-e3` })).json()
    expect(body.canWaive).toBe(expected)
  })
})

describe('waive / un-waive — CSR only', () => {
  it('400 not_applicable when waiving on a non-CSR document', async () => {
    const { app, waiverUpserts, append } = await build({ type: 'protocol' })
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC}/ich-e3/${encodeURIComponent('§15')}/waive`, payload: { reason: 'Not required here at all' } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'not_applicable' })
    expect(waiverUpserts).toHaveLength(0)
    expect(append).not.toHaveBeenCalled()
  })

  it('accepts §16.4 as a waivable section on a CSR', async () => {
    const { app, append } = await build()
    const res = await app.inject({ method: 'POST', url: `/documents/${DOC}/ich-e3/${encodeURIComponent('§16.4')}/waive`, payload: { reason: 'Not a US submission' } })
    expect(res.statusCode).toBe(201)
    expect(append.mock.calls[0]![0]).toMatchObject({ action: 'ich_section_waived', details: { sectionCode: '§16.4' } })
  })

  it('400 not_applicable when un-waiving on a non-CSR document', async () => {
    const { app } = await build({ type: 'ib' })
    const res = await app.inject({ method: 'DELETE', url: `/documents/${DOC}/ich-e3/${encodeURIComponent('§15')}/waive` })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /documents/:id/sections/:sectionId/ich-status', () => {
  it('marks a section complete and records it in the audit trail', async () => {
    const { app, sectionUpdates, append } = await build()
    const res = await setStatus(app, 'complete')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ sectionId: 's5', ichStatus: 'complete' })
    expect(sectionUpdates).toEqual([{ where: { id: 'row-1' }, data: { ichStatus: 'complete' } }])
    expect(append.mock.calls[0]![0]).toMatchObject({
      action: 'section_marked_complete',
      details: { sectionId: 's5', versionNumber: 'v0.3', before: 'in_progress', after: 'complete' },
    })
  })

  it('reopens a complete section', async () => {
    const { app, append } = await build({ section: { contentHtml: '<p>x</p>', ichStatus: 'complete' } })
    expect((await setStatus(app, 'in_progress')).statusCode).toBe(200)
    expect(append.mock.calls[0]![0].action).toBe('section_reopened')
  })

  it('works for any authoring role, not just admins', async () => {
    const { app } = await build({ role: 'clinical-writer' })
    expect((await setStatus(app, 'complete')).statusCode).toBe(200)
  })

  it('400 section_empty when marking an empty section complete', async () => {
    const { app, sectionUpdates, append } = await build({ section: { contentHtml: '<p></p>', ichStatus: 'in_progress' } })
    const res = await setStatus(app, 'complete')
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'section_empty' })
    expect(sectionUpdates).toHaveLength(0)
    expect(append).not.toHaveBeenCalled()
  })

  it('is a no-op (no write, no audit) when the status is unchanged', async () => {
    const { app, sectionUpdates, append } = await build({ section: { contentHtml: '<p>x</p>', ichStatus: 'complete' } })
    expect((await setStatus(app, 'complete')).statusCode).toBe(200)
    expect(sectionUpdates).toHaveLength(0)
    expect(append).not.toHaveBeenCalled()
  })

  it.each(['in_review', 'pending_signature', 'signed'])('409 document_locked when the document is %s', async (docStatus) => {
    const { app, sectionUpdates } = await build({ docStatus })
    const res = await setStatus(app, 'complete')
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'document_locked', status: docStatus })
    expect(sectionUpdates).toHaveLength(0)
  })

  it('409 when the project is closed', async () => {
    const { app } = await build({ projectStatus: 'closed' })
    expect((await setStatus(app, 'complete')).statusCode).toBe(409)
  })

  it('404 when the section is not in the current version', async () => {
    const { app } = await build({ section: null })
    expect((await setStatus(app, 'complete')).statusCode).toBe(404)
  })

  it('400 on an unknown status value', async () => {
    const { app } = await build()
    expect((await setStatus(app, 'waived')).statusCode).toBe(400)
  })
})
