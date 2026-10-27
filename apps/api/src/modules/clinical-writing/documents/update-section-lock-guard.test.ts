// PATCH /documents/:docId/sections/:secId must reject (423) when another
// user holds a live SectionLock. Fastify inject() with a stubbed Prisma
// — focuses on the lock precondition, not the full update pipeline.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'

const DOC = 'DOC-1'
const SEC = 'sec-a'

async function build(opts: { lock?: { userId: string; lastHeartbeatAt: Date }; callerId?: string } = {}) {
  const updates: Array<Record<string, unknown>> = []
  const chat = vi.fn()
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({
        id: DOC, projectId: 'proj-1', type: 'dsur', status: 'in_authoring',
        currentVersion: { id: 'ver-1', versionNumber: 'v0.1', contentHash: 'h', sections: [
          { id: 'row-1', sectionId: SEC, sectionNumber: '§1', sectionTitle: 'S', contentHtml: '<p>old</p>', ichStatus: 'in_progress', wordCount: 1, lastEditedBy: null, lastEditedAt: null, aiSpanCount: 0, humanSpanCount: 0 },
        ] },
      })),
      update: vi.fn(async () => ({})),
    },
    sectionLock: {
      findUnique: vi.fn(async () => {
        if (!opts.lock) return null
        return { id: 'L1', documentId: DOC, sectionId: SEC, userId: opts.lock.userId, acquiredAt: opts.lock.lastHeartbeatAt, lastHeartbeatAt: opts.lock.lastHeartbeatAt }
      }),
    },
    aiCallRecord: { updateMany: vi.fn(async () => ({ count: 0 })) },
    $executeRaw: vi.fn(async () => 1),
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn({
      document: {
        findUnique: vi.fn(async () => ({
          id: DOC, projectId: 'proj-1', type: 'dsur', status: 'in_authoring',
          currentVersion: { id: 'ver-1', versionNumber: 'v0.1', contentHash: 'h', sections: [
            { id: 'row-1', sectionId: SEC, sectionNumber: '§1', sectionTitle: 'S', contentHtml: '<p>old</p>', ichStatus: 'in_progress', wordCount: 1, lastEditedBy: null, lastEditedAt: null, aiSpanCount: 0, humanSpanCount: 0 },
          ] },
        })),
        update: vi.fn(async () => ({})),
      },
      $executeRaw: vi.fn(async () => 1),
      documentVersion: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        update:     vi.fn(async (args: { data: Record<string, unknown> }) => { updates.push(args.data); return { id: 'ver-1', ...args.data } }),
        findMany:   vi.fn(async () => [{ versionNumber: 'v0.1' }]),
        create:     vi.fn(async () => ({ id: 'ver-1', versionNumber: 'v0.1' })),
      },
      sectionContent: {
        update: vi.fn(async () => ({})),
        create: vi.fn(async () => ({})),
      },
      signatureRecord: { findFirst: vi.fn(async () => null) },
      provenanceRecord: { create: vi.fn(async () => ({})) },
      editHistory:      { create: vi.fn(async () => ({})) },
    }),
  } as never)
  const append = vi.fn(async (_event: { action: string; details: Record<string, unknown> }) => undefined)
  app.decorate('audit', { append } as never)
  app.decorate('aiGateway', { chat } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: opts.callerId ?? 'u1', email: 'u@x.io', role: 'clinical-writer', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, updates, append }
}

const patch = (app: Awaited<ReturnType<typeof build>>['app']) =>
  app.inject({
    method: 'PATCH',
    url: `/documents/${DOC}/sections/${SEC}`,
    payload: { contentHtml: '<p>new</p>' },
  })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('PATCH /documents/:docId/sections/:secId — lock precondition', () => {
  it('422/200 passes when no lock exists (legacy / first-save-after-reconnect)', async () => {
    const { app } = await build()
    const res = await patch(app)
    expect(res.statusCode).toBeLessThan(400)
  })

  it('passes when the caller holds the live lock', async () => {
    const { app } = await build({ lock: { userId: 'u1', lastHeartbeatAt: new Date() } })
    const res = await patch(app)
    expect(res.statusCode).toBeLessThan(400)
  })

  it('423 Locked when a different user holds a live lock', async () => {
    const { app } = await build({
      callerId: 'u2',
      lock: { userId: 'u1', lastHeartbeatAt: new Date() },
    })
    const res = await patch(app)
    expect(res.statusCode).toBe(423)
    expect(res.json()).toMatchObject({ error: 'locked', holder: { userId: 'u1' }, staleSeconds: 90 })
  })

  it('passes when the foreign lock is stale (treated as unlocked)', async () => {
    const { app } = await build({
      callerId: 'u2',
      lock: { userId: 'u1', lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) },
    })
    const res = await patch(app)
    expect(res.statusCode).toBeLessThan(400)
  })
})

describe('PATCH /documents/:docId/sections/:secId — audit entry', () => {
  it('records the section text before and after the edit', async () => {
    const { app, append } = await build()
    const res = await patch(app)
    expect(res.statusCode).toBeLessThan(400)
    const edit = append.mock.calls.map(c => c[0]).find(e => e.action === 'section_edited')
    expect(edit?.details).toMatchObject({ sectionId: SEC, before: 'old', after: 'new' })
  })
})
