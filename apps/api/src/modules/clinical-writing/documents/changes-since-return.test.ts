// GET /documents/:id/changes-since-return: the version the document was last sent back from, so the next
// round's Reviewers and Approvers see the changes highlighted.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

const canView = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../../platform/document-raci/access.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/document-raci/access.js')>()),
  actorCanViewChecklist: canView,
}))
const { documentsRoutes } = await import('./routes.js')

type Version = { createdAt: Date; restoreSource: unknown }

async function get(versions: Version[]) {
  const findFirst = vi.fn(async ({ where }: { where: { id: string } }) => ({
    versionNumber: where.id, sections: [{ sectionId: 's1', sectionNumber: '1', sectionTitle: 'Summary', contentHtml: '<p>old</p>' }],
  }))
  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async () => ({ id: 'DOC-1', projectId: 'p-1' })), count: vi.fn(async () => 1) },
    documentVersion: { findMany: vi.fn(async () => versions), findFirst },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => ({})) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u-c', email: 'c@x', role: 'contributor', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  const res = await app.inject({ method: 'GET', url: '/documents/DOC-1/changes-since-return' })
  await app.close()
  return res
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A'; canView.mockResolvedValue(true) })

describe('changes since the document was sent back', () => {
  it('compares with the version returned most recently, ignoring versions made for other reasons', async () => {
    const res = await get([
      { createdAt: new Date('2026-11-23T00:00:00Z'), restoreSource: { reason: 'explicit', fromVersionId: 'v0.3' } },
      { createdAt: new Date('2026-11-22T00:00:00Z'), restoreSource: { reason: 'signature_bounce', fromVersionId: 'v0.2' } },
      { createdAt: new Date('2026-11-20T00:00:00Z'), restoreSource: { reason: 'review_bounce', fromVersionId: 'v0.1' } },
      { createdAt: new Date('2026-11-19T00:00:00Z'), restoreSource: null },
    ])
    expect(res.statusCode).toBe(200)
    expect(res.json().baseline).toMatchObject({ versionNumber: 'v0.2', returnedAt: '2026-11-22T00:00:00.000Z', sections: [{ sectionId: 's1', contentHtml: '<p>old</p>' }] })
  })

  it('has nothing to compare with on a first round', async () => {
    expect((await get([{ createdAt: new Date(), restoreSource: null }])).json()).toEqual({ baseline: null })
  })

  it('is refused to someone with no part in the review or approval', async () => {
    canView.mockResolvedValue(false)
    expect((await get([])).statusCode).toBe(403)
  })
})
