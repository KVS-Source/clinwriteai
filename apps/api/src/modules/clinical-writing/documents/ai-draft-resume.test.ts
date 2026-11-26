// Resuming an AI draft that failed or was stopped: the status says why it ended (for the "Resume drafting" card),
// and POST /ai-draft/start queues the drafter again for a failed document. The drafter keeps every section that
// already has text (draft-with-plan.test.ts), so nothing drafted is lost.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

vi.mock('../../projects/visibility.js', async (original) => ({ ...(await original<object>()), canSeeDocument: async () => true }))
vi.mock('./ai-draft-preflight.js', () => ({ computeDraftPreflight: async () => ({ ok: true, issues: [] }) }))
vi.mock('../../platform/ai-gateway/resolve-anthropic-key.js', () => ({ resolveAnthropicKey: async () => 'k' }))

async function build(aiDraftState: string) {
  const enqueue = vi.fn(async () => undefined)
  const updates: Array<Record<string, unknown>> = []
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({
        id: 'd', type: 'protocol', projectId: 'p', assigneeId: 'u', currentVersionId: 'v', deletedAt: null, aiDraftState,
        aiConfidenceOverall: null, aiLastPassAt: null, aiLastPassNumber: null, policyVersionAtCreate: null,
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return {} }),
    },
    documentSource: { findMany: async () => [{ uploadId: 'u1' }] },
    sectionContent: { findMany: async () => [
      { sectionId: 's3_1', sectionNumber: '3.1', sectionTitle: 'Primary', aiConfidence: null, aiFlags: [], aiSpanCount: 1 },
      { sectionId: 's3_2', sectionNumber: '3.2', sectionTitle: 'Secondary', aiConfidence: null, aiFlags: [], aiSpanCount: 0 },
    ] },
    aiDraftingPass: { findMany: async () => [] },
    aiDraftStep: { findFirst: vi.fn(async () => ({ message: '§3.2 failed: 529 overloaded' })) },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorate('queue', { enqueue } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'pm-1', email: 'pm@x.io', role: 'pm', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  const { documentsRoutes } = await import('./routes.js')
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, enqueue, updates }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

describe('a failed AI draft', () => {
  it('the status says why it stopped and how far it got', async () => {
    const { app } = await build('failed')
    const res = (await app.inject({ url: '/documents/d/ai-draft-status' })).json()
    expect(res).toMatchObject({ state: 'failed', stopReason: '§3.2 failed: 529 overloaded', draftedSections: 1, totalSections: 2 })
  })
  it('Resume drafting queues the drafter again', async () => {
    const { app, enqueue, updates } = await build('failed')
    const res = await app.inject({ method: 'POST', url: '/documents/d/ai-draft/start', payload: {} })
    expect(res.statusCode).toBe(200)
    expect(updates).toContainEqual({ aiDraftState: 'pending' })
    expect(enqueue).toHaveBeenCalledWith('clinical.ai_initial_draft', expect.objectContaining({ documentId: 'd', versionId: 'v', sourceUploadIds: ['u1'] }), expect.anything())
  })
  it('a running draft has no stop reason and is not started twice', async () => {
    const { app, enqueue } = await build('drafting')
    expect((await app.inject({ url: '/documents/d/ai-draft-status' })).json().stopReason).toBeNull()
    expect((await app.inject({ method: 'POST', url: '/documents/d/ai-draft/start', payload: {} })).statusCode).toBe(409)
    expect(enqueue).not.toHaveBeenCalled()
  })
})
