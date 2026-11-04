// PATCH /documents/:documentId/protocol-metadata — migration 60.
//
// Exercises the five contract points of the endpoint:
//   1. Full-shape update returns the updated document shape
//   2. Partial update leaves unsent fields alone
//   3. Signed document → 409 document_locked
//   4. Non-assignee, non-admin, non-R/A/Q → 403 forbidden
//   5. Invalid regulatoryRegion → 400 validation
//
// Mirrors the Fastify.inject() style used by transition-signed-guard.test.ts
// and update-section-lock-guard.test.ts — stubbed Prisma, no DB.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'

const DOC = 'DOC-1'

interface DocRow {
  id: string
  projectId: string
  type: string
  title: string
  status: string
  stage: string
  therapeuticArea: string
  assigneeId: string
  createdBy: string
  deletedAt: null
  studyTitle: string | null
  protocolNumber: string | null
  protocolVersion: string | null
  sponsor: string | null
  investigationalProduct: string | null
  studyDesign: string | null
  targetPopulation: string | null
  regulatoryRegion: string | null
}

function makeRow(over: Partial<DocRow> = {}): DocRow {
  return {
    id: DOC,
    projectId: 'proj-1',
    type: 'protocol',
    title: 'VELORA Phase III protocol',
    status: 'in_authoring',
    stage: 'study_start_up',
    therapeuticArea: 'Oncology',
    assigneeId: 'u-assignee',
    createdBy: 'u-assignee',
    deletedAt: null,
    studyTitle: null,
    protocolNumber: null,
    protocolVersion: null,
    sponsor: null,
    investigationalProduct: null,
    studyDesign: null,
    targetPopulation: null,
    regulatoryRegion: null,
    ...over,
  }
}

async function build(opts: {
  row?: Partial<DocRow>
  callerId?: string
  callerRole?: AuthenticatedUser['role']
  raciRows?: Array<{ userId: string; letter: string }>
  projectStatus?: string
} = {}) {
  const state = { row: makeRow(opts.row) }
  const audit = vi.fn(async () => undefined)
  const app = Fastify()

  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => state.row),
      count: vi.fn(async () => 1), // canSeeDocument — admin-bypass or match
      findFirst: vi.fn(async () => state.row),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.row = { ...state.row, ...data } as DocRow
        return state.row
      }),
    },
    project: {
      findUnique: vi.fn(async () => ({ status: opts.projectStatus ?? 'ongoing' })),
    },
    documentRaci: {
      findFirst: vi.fn(async (q: { where: { userId: string; letter: { in: string[] } } }) => {
        const hit = (opts.raciRows ?? []).find(r =>
          r.userId === q.where.userId && q.where.letter.in.includes(r.letter))
        return hit ? { id: 'raci-1' } : null
      }),
    },
    user: { findMany: vi.fn(async () => []) },
  } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorate('aiGateway', { chat: vi.fn() } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = {
      id: opts.callerId ?? 'u-assignee',
      email: 'u@x.io',
      role: opts.callerRole ?? 'contributor',
      modules: ['A'],
      tenantId: null,
    }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })

  // DocumentService.getWithSections(documentId) is called in the handler
  // to build the full response shape. Stub it on the service via Prisma
  // — the service calls prisma.document.findUnique(where, include). We
  // intercept both the simple + the include call shape here.
  ;(app.prisma as unknown as { document: { findUnique: ReturnType<typeof vi.fn> } }).document.findUnique = vi.fn(async () =>
    ({ ...state.row, currentVersion: { versionNumber: 'v0.1', sections: [] } }))

  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, audit, state }
}

const patch = (app: Awaited<ReturnType<typeof build>>['app'], body: Record<string, unknown>) =>
  app.inject({
    method: 'PATCH',
    url: `/documents/${DOC}/protocol-metadata`,
    payload: body,
  })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('PATCH /documents/:documentId/protocol-metadata', () => {
  it('updates every field and returns the full document shape', async () => {
    const { app, state, audit } = await build()
    const body = {
      studyTitle: 'A randomised phase III trial of ...',
      protocolNumber: 'GB-NSCLC-002',
      protocolVersion: 'v3.1',
      sponsor: 'GenBioCa, Inc.',
      investigationalProduct: 'GBC-101',
      studyDesign: 'Multicentre, double-blind, placebo-controlled',
      targetPopulation: 'Adults with advanced NSCLC after first-line therapy',
      regulatoryRegion: 'us',
    }
    const res = await patch(app, body)
    expect(res.statusCode).toBe(200)
    expect(state.row).toMatchObject(body)
    const json = res.json() as Record<string, unknown>
    expect(json).toMatchObject(body)
    // Audit entry carries a diff of exactly the changed keys.
    const rec = audit.mock.calls.map(c => c[0]).find(e =>
      e.action === 'clinical-writing.document.protocol-metadata-updated')
    expect(rec?.details).toMatchObject({
      diff: expect.objectContaining({
        protocolNumber: { before: null, after: 'GB-NSCLC-002' },
        regulatoryRegion: { before: null, after: 'us' },
      }),
    })
  })

  it('leaves omitted fields unchanged on a partial update', async () => {
    const { app, state } = await build({
      row: {
        studyTitle: 'Keep me',
        protocolNumber: 'OLD-001',
        sponsor: 'Legacy Sponsor',
      },
    })
    const res = await patch(app, { protocolNumber: 'NEW-002' })
    expect(res.statusCode).toBe(200)
    expect(state.row.protocolNumber).toBe('NEW-002')
    // Untouched columns preserved — they were NOT in the patch payload.
    expect(state.row.studyTitle).toBe('Keep me')
    expect(state.row.sponsor).toBe('Legacy Sponsor')
  })

  it('returns 409 document_locked when the document is signed', async () => {
    const { app, audit } = await build({ row: { status: 'signed' } })
    const res = await patch(app, { protocolNumber: 'X' })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ error: 'document_locked', status: 'signed' })
    expect(audit).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is neither assignee, admin, nor R/A/Q', async () => {
    const { app, audit } = await build({
      callerId: 'u-random',
      callerRole: 'contributor',
      raciRows: [], // no RACI row for u-random
    })
    const res = await patch(app, { protocolNumber: 'X' })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: 'forbidden' })
    expect(audit).not.toHaveBeenCalled()
  })

  it('returns 400 when regulatoryRegion is not one of the known values', async () => {
    const { app } = await build()
    const res = await patch(app, { regulatoryRegion: 'mars' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'validation' })
  })
})
