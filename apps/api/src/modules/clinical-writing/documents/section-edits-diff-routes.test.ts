// GET /section-edits/:id/diff — returns the full beforeHtml + afterHtml for
// a single EditHistory row. Used by the Section History panel's "Show change"
// expand so the full snapshots aren't shipped on the list GET.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'

type Row = {
  id: string
  entityType: string
  documentId: string | null
  sectionId: string | null
  origin: string
  createdAt: Date
  beforeHtml: string | null
  afterHtml: string
}

async function build(opts: { row?: Row } = {}) {
  const app = Fastify()
  app.decorate('prisma', {
    editHistory: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (!opts.row) return null
        return opts.row.id === where.id ? opts.row : null
      }),
    },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'clinical-writer', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

const sampleRow: Row = {
  id:          'eh-1',
  entityType:  'clinical_section',
  documentId:  'DOC-1',
  sectionId:   's11_4',
  origin:      'manual',
  createdAt:   new Date('2026-10-27T10:00:00Z'),
  beforeHtml:  '<p>Before text.</p>',
  afterHtml:   '<p>After text.</p>',
}

describe('GET /section-edits/:id/diff', () => {
  it('returns the beforeHtml + afterHtml for a matching row', async () => {
    const { app } = await build({ row: sampleRow })
    const res = await app.inject({ method: 'GET', url: '/documents/section-edits/eh-1/diff' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      editHistoryId: 'eh-1',
      documentId:    'DOC-1',
      sectionId:     's11_4',
      origin:        'manual',
      createdAt:     '2026-10-27T10:00:00.000Z',
      beforeHtml:    '<p>Before text.</p>',
      afterHtml:     '<p>After text.</p>',
    })
  })

  it('404s when the row does not exist', async () => {
    const { app } = await build()
    const res = await app.inject({ method: 'GET', url: '/documents/section-edits/eh-missing/diff' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('not_found')
  })

  it('404s when the row is a different entityType (defensive — this route is clinical-only)', async () => {
    const { app } = await build({ row: { ...sampleRow, entityType: 'atomised_content' } })
    const res = await app.inject({ method: 'GET', url: '/documents/section-edits/eh-1/diff' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('wrong_entity_type')
  })

  it('returns null beforeHtml for the first-ever save on a section', async () => {
    const { app } = await build({ row: { ...sampleRow, beforeHtml: null } })
    const res = await app.inject({ method: 'GET', url: '/documents/section-edits/eh-1/diff' })
    expect(res.statusCode).toBe(200)
    expect(res.json().beforeHtml).toBeNull()
    expect(res.json().afterHtml).toBe('<p>After text.</p>')
  })
})
