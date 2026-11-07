// GET /documents/:id/brief/open-flags + POST .../:flagId/resolve

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

vi.mock('../../platform/document-raci/access.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/document-raci/access.js')>()),
  actorCanEditDocumentContent: vi.fn(async () => true),
}))

const { documentBriefRoutes } = await import('./routes.js')

const DOC = 'DOC-1'

async function build(opts: {
  flag?: {
    id: string; documentId: string; sectionId: string; type: string; text: string
    aiCallRecordId: string | null; status: string
    resolvedBy: string | null; resolvedAt: Date | null; resolutionNote: string | null
    createdAt: Date; updatedAt: Date
  } | null
  canEdit?: boolean
  canSee?: boolean
} = {}) {
  const audit = vi.fn(async () => undefined)
  const app = Fastify()

  const flagState = { row: opts.flag ?? null }
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({ id: DOC, deletedAt: null, projectId: 'proj-1' })),
      count:      vi.fn(async () => (opts.canSee === false ? 0 : 1)),
    },
    documentBriefOpenFlag: {
      findMany: vi.fn(async () => (flagState.row ? [flagState.row] : [])),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        flagState.row && flagState.row.id === where.id ? flagState.row : null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (!flagState.row) throw new Error('no row')
        flagState.row = { ...flagState.row, ...data } as typeof flagState.row
        return flagState.row
      }),
    },
  } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = {
      id: 'u-1', email: 'u@x.io', role: 'contributor',
      modules: ['A'], tenantId: null,
    }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })

  if (opts.canEdit === false) {
    const access = await import('../../platform/document-raci/access.js')
    ;(access.actorCanEditDocumentContent as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
  }

  await app.register(documentBriefRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, audit, flagState }
}

const flagFixture = (over: Partial<Awaited<ReturnType<typeof build>>['flagState']['row'] & object> = {}) => ({
  id: 'f-1', documentId: DOC, sectionId: 's6_2',
  type: 'information_required', text: 'dose',
  aiCallRecordId: 'rec-1', status: 'open',
  resolvedBy: null, resolvedAt: null, resolutionNote: null,
  createdAt: new Date('2026-11-07T00:00:00Z'),
  updatedAt: new Date('2026-11-07T00:00:00Z'),
  ...over,
})

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('GET /documents/:id/brief/open-flags', () => {
  it('returns the open flags for a document', async () => {
    const { app } = await build({ flag: flagFixture() })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/brief/open-flags` })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { flags: Array<{ id: string; text: string }> }
    expect(body.flags).toHaveLength(1)
    expect(body.flags[0]).toMatchObject({ id: 'f-1', text: 'dose' })
  })

  it('returns empty when no flags exist', async () => {
    const { app } = await build({ flag: null })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/brief/open-flags` })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { flags: unknown[] }).flags).toEqual([])
  })

  it('returns 404 when caller cannot see the document', async () => {
    const { app } = await build({ canSee: false })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/brief/open-flags` })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /documents/:id/brief/open-flags/:flagId/resolve', () => {
  it('resolves an open flag with actor + note', async () => {
    const { app, audit, flagState } = await build({ flag: flagFixture() })
    const res = await app.inject({
      method: 'POST', url: `/documents/${DOC}/brief/open-flags/f-1/resolve`,
      payload: { status: 'resolved', resolutionNote: 'confirmed via IB v2.3' },
    })
    expect(res.statusCode).toBe(200)
    expect(flagState.row?.status).toBe('resolved')
    expect(flagState.row?.resolvedBy).toBe('u-1')
    const rec = audit.mock.calls.map(c => c[0]).find(e =>
      e.action === 'clinical-writing.document.brief-open-flag-resolved')
    expect(rec?.details).toMatchObject({ flagId: 'f-1', newStatus: 'resolved' })
  })

  it('accepts dismissed as a terminal status', async () => {
    const { app, flagState } = await build({ flag: flagFixture() })
    const res = await app.inject({
      method: 'POST', url: `/documents/${DOC}/brief/open-flags/f-1/resolve`,
      payload: { status: 'dismissed' },
    })
    expect(res.statusCode).toBe(200)
    expect(flagState.row?.status).toBe('dismissed')
  })

  it('returns 400 for an invalid status value', async () => {
    const { app } = await build({ flag: flagFixture() })
    const res = await app.inject({
      method: 'POST', url: `/documents/${DOC}/brief/open-flags/f-1/resolve`,
      payload: { status: 'pending' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when the flag does not exist', async () => {
    const { app } = await build({ flag: null })
    const res = await app.inject({
      method: 'POST', url: `/documents/${DOC}/brief/open-flags/gone/resolve`,
      payload: { status: 'resolved' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when the flag is already resolved (idempotent-safe)', async () => {
    const { app } = await build({ flag: flagFixture({ status: 'resolved' }) })
    const res = await app.inject({
      method: 'POST', url: `/documents/${DOC}/brief/open-flags/f-1/resolve`,
      payload: { status: 'dismissed' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 403 when the caller cannot edit the document', async () => {
    const { app, audit } = await build({ flag: flagFixture(), canEdit: false })
    const res = await app.inject({
      method: 'POST', url: `/documents/${DOC}/brief/open-flags/f-1/resolve`,
      payload: { status: 'resolved' },
    })
    expect(res.statusCode).toBe(403)
    expect(audit).not.toHaveBeenCalled()
  })
})
