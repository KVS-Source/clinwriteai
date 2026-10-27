// POST /documents/:id/advance-stage + GET /documents/:id/stage.
// Fastify inject() with a stubbed Prisma; service.ts is exercised for real.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'

type DocRow = {
  id: string
  stage: string | null
  deletedAt: Date | null
  currentVersion?: { versionNumber: string } | null
  type?: string
  status?: string
}

async function build(initial: DocRow) {
  const doc: DocRow = { ...initial, currentVersion: initial.currentVersion ?? { versionNumber: 'v0.1' } }
  const updates: Array<Record<string, unknown>> = []
  const audit = vi.fn(async () => undefined)

  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async ({ select }: { select?: Record<string, boolean> } = {}) => {
        if (select?.stage || select?.deletedAt) {
          return { id: doc.id, stage: doc.stage, deletedAt: doc.deletedAt }
        }
        return { ...doc, type: doc.type ?? 'csr_full', status: doc.status ?? 'in_authoring' }
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data)
        if (typeof data.stage === 'string') doc.stage = data.stage
        return { ...doc }
      }),
    },
    $transaction: async (fn: (t: unknown) => unknown) => fn({
      document: {
        findUnique: vi.fn(async () => ({ id: doc.id, stage: doc.stage, deletedAt: doc.deletedAt })),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data)
          if (typeof data.stage === 'string') doc.stage = data.stage
          return { ...doc }
        }),
      },
    }),
  } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'writer-1', email: 'w@x.io', role: 'clinical-writer', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, audit, updates, doc }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('GET /documents/:id/stage', () => {
  it('returns current + next with UI labels', async () => {
    const { app } = await build({ id: 'DOC-1', stage: 'during_study', deletedAt: null })
    const res = await app.inject({ method: 'GET', url: '/documents/DOC-1/stage' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      documentId:   'DOC-1',
      current:      'during-study',
      currentLabel: 'During Study',
      next:         'post-study',
      nextLabel:    'Post-Study / Data Analysis',
      terminal:     false,
    })
  })

  it('flags terminal when the document is already at final_output', async () => {
    const { app } = await build({ id: 'DOC-1', stage: 'final_output', deletedAt: null })
    const body = (await app.inject({ method: 'GET', url: '/documents/DOC-1/stage' })).json()
    expect(body.next).toBeNull()
    expect(body.terminal).toBe(true)
  })

  it('404s a soft-deleted document', async () => {
    const { app } = await build({ id: 'DOC-1', stage: 'during_study', deletedAt: new Date() })
    expect((await app.inject({ method: 'GET', url: '/documents/DOC-1/stage' })).statusCode).toBe(404)
  })

  it('gracefully reports null stage when the DB value is unknown', async () => {
    const { app } = await build({ id: 'DOC-1', stage: 'ancient_legacy', deletedAt: null })
    const body = (await app.inject({ method: 'GET', url: '/documents/DOC-1/stage' })).json()
    expect(body.current).toBeNull()
    expect(body.next).toBeNull()
    expect(body.terminal).toBe(true)
  })
})

describe('POST /documents/:id/advance-stage', () => {
  it('advances one step and audits the move with labels', async () => {
    const { app, audit, updates } = await build({ id: 'DOC-1', stage: 'study_start_up', deletedAt: null })
    const res = await app.inject({ method: 'POST', url: '/documents/DOC-1/advance-stage' })
    expect(res.statusCode).toBe(200)
    expect(updates).toContainEqual({ stage: 'during_study' })
    expect(audit).toHaveBeenCalledOnce()
    const entry = audit.mock.calls[0]![0] as { action: string; details: Record<string, unknown> }
    expect(entry.action).toBe('document_stage_advanced')
    expect(entry.details).toMatchObject({
      from: 'study_start_up',
      to:   'during_study',
      fromLabel: 'Study Start-Up',
      toLabel:   'During Study',
    })
  })

  it('422s terminal when the document is at final_output', async () => {
    const { app, audit, updates } = await build({ id: 'DOC-1', stage: 'final_output', deletedAt: null })
    const res = await app.inject({ method: 'POST', url: '/documents/DOC-1/advance-stage' })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('terminal')
    expect(updates).toEqual([])
    expect(audit).not.toHaveBeenCalled()
  })

  it('404s when the document is missing / soft-deleted', async () => {
    const { app } = await build({ id: 'DOC-1', stage: 'during_study', deletedAt: new Date() })
    expect((await app.inject({ method: 'POST', url: '/documents/DOC-1/advance-stage' })).statusCode).toBe(404)
  })

  it('422s invalid_stage when the DB value is not a known stage', async () => {
    const { app } = await build({ id: 'DOC-1', stage: 'ancient_legacy', deletedAt: null })
    const res = await app.inject({ method: 'POST', url: '/documents/DOC-1/advance-stage' })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('invalid_stage')
  })
})
