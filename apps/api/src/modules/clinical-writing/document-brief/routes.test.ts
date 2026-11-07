// GET /documents/:documentId/brief — returns the stored brief, or
// lazy-regens when no row exists yet.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentBriefRoutes } from './routes.js'

const DOC = 'DOC-1'

async function build(opts: {
  brief?: { rev: number; contentJson: Record<string, unknown>; generatedAt: Date } | null
  canSee?: boolean
} = {}) {
  const briefState: { row: { rev: number; contentJson: Record<string, unknown>; generatedAt: Date } | null } = {
    row: opts.brief ?? null,
  }
  const audit = vi.fn(async () => undefined)
  const app = Fastify()

  const docRow = {
    id: DOC, projectId: 'proj-1', type: 'protocol', title: 'VELORA',
    status: 'in_authoring', stage: 'study_start_up',
    therapeuticArea: 'Oncology', assigneeId: 'u-assignee',
    sponsor: 'Acme', templateId: null, regulatoryRegion: 'us',
    studyTitle: null, protocolNumber: 'GB-001', protocolVersion: 'v1',
    investigationalProduct: null, studyDesign: null, targetPopulation: null,
    deletedAt: null,
    currentVersion: {
      sections: [
        { sectionId: 's1', sectionNumber: '1', sectionTitle: 'Title',
          ichStatus: 'not_started', wordCount: 0 },
      ],
    },
  }

  app.decorate('prisma', {
    document: {
      // Route's own findUnique uses select: { id, deletedAt }.
      // Service's findUnique uses include: { currentVersion: { select: { sections } } }.
      findUnique: vi.fn(async (q: { select?: Record<string, unknown>; include?: Record<string, unknown> }) => {
        if (q.select) return { id: DOC, deletedAt: null, projectId: 'proj-1' }
        return docRow
      }),
      count: vi.fn(async () => (opts.canSee === false ? 0 : 1)),
    },
    documentBrief: {
      findUnique: vi.fn(async () => briefState.row),
      upsert: vi.fn(async ({ create }: { create: { rev: number; contentJson: Record<string, unknown> } }) => {
        briefState.row = {
          rev:         create.rev,
          contentJson: create.contentJson,
          generatedAt: new Date('2026-11-06T12:00:00Z'),
        }
        return briefState.row
      }),
    },
    documentSource:          { findMany: vi.fn(async () => []) },
    documentUpload:          { findMany: vi.fn(async () => []) },
    tlfPackage:              { findFirst: vi.fn(async () => null) },
    ichSectionWaiver:        { findMany: vi.fn(async () => []) },
    sourceReference:         { count: vi.fn(async () => 3) },
    sourceReferenceRemoval:  { count: vi.fn(async () => 0) },
  } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = {
      id: 'u-assignee', email: 'u@x.io', role: 'contributor',
      modules: ['A'], tenantId: null,
    }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })

  await app.register(documentBriefRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, audit, briefState }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A' })

describe('GET /documents/:documentId/brief', () => {
  it('returns the stored brief when a row exists', async () => {
    const stored = {
      rev:         3,
      contentJson: { document: { id: DOC, title: 'Stored' } },
      generatedAt: new Date('2026-11-05T10:00:00Z'),
    }
    const { app, audit } = await build({ brief: stored })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/brief` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      rev:         3,
      generatedAt: '2026-11-05T10:00:00.000Z',
      brief:       { document: { id: DOC, title: 'Stored' } },
    })
    // Audit entry carries the rev so a reader can trace which snapshot was served.
    const rec = audit.mock.calls.map(c => c[0]).find(e =>
      e.action === 'clinical-writing.document.brief-accessed')
    expect(rec?.details).toMatchObject({ rev: 3 })
  })

  it('lazy-regens a brief when no row exists yet and returns the fresh one', async () => {
    const { app, briefState } = await build({ brief: null })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/brief` })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { rev: number; brief: { document: { id: string; type: string; jurisdictions: string[] } } }
    expect(body.rev).toBe(0)                          // first generation
    expect(body.brief.document.id).toBe(DOC)
    expect(body.brief.document.type).toBe('protocol')
    expect(body.brief.document.jurisdictions).toEqual(['FDA'])
    expect(briefState.row).not.toBeNull()
  })

  it('returns 404 when the document is soft-deleted', async () => {
    const { app } = await build()
    const prisma = (app as unknown as { prisma: { document: { findUnique: ReturnType<typeof vi.fn> } } }).prisma
    prisma.document.findUnique = vi.fn(async () => ({ id: DOC, deletedAt: new Date() }))
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/brief` })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 when the caller cannot see the document', async () => {
    const { app } = await build({ canSee: false })
    const res = await app.inject({ method: 'GET', url: `/documents/${DOC}/brief` })
    expect(res.statusCode).toBe(404)
  })
})
