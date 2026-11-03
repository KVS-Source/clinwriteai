// POST /publications/:publicationId/slides — slide-job creation.
//
// Mocks Prisma + the audit decorator so we can exercise the handler end-to-
// end. Only the create path is covered here; GET / PATCH / export are
// covered implicitly by downstream UI integration.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { slidesRoutes } from './routes.js'

type PubRow = {
  id: string
  deletedAt: Date | null
  title: string
}

async function build(initial: { pub: PubRow | null; prior?: null | { id: string; congressTarget: string | null; slideCountLimit: number; slides: Array<{ title: string; bodyText: string }> } }) {
  const audit = vi.fn(async () => undefined)
  const createdJobs: Array<Record<string, unknown>> = []
  const createdSlides: Array<Record<string, unknown>> = []

  // Fake txn client: duplicates the top-level mocks for the fields we touch.
  const txnClient = {
    slideDeckJob: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'job-new-1', status: 'generating', ...data }
        createdJobs.push(row)
        return row
      }),
    },
    slide: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `slide-${createdSlides.length + 1}`, ...data }
        createdSlides.push(row)
        return row
      }),
    },
  }

  const app = Fastify()
  app.decorate('prisma', {
    publication: {
      findUnique: vi.fn(async () => initial.pub),
    },
    slideDeckJob: {
      findFirst: vi.fn(async () => initial.prior ?? null),
    },
    slide: {
      findMany: vi.fn(async () => createdSlides.map((s, i) => ({ ...s, position: i + 1, figures: [] }))),
    },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(txnClient),
  } as never)
  app.decorate('audit', { append: audit } as never)
  app.decorate('editHistory', {
    recordEdit: vi.fn(async () => undefined),
    listHistory: vi.fn(async () => []),
    revert: vi.fn(async () => ({ contentAfter: null })),
  } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'writer-b', email: 'w@x.io', role: 'medical-writer', modules: ['B'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(slidesRoutes)
  await app.ready()
  return { app, audit, createdJobs, createdSlides }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'B' })

describe('POST /publications/:publicationId/slides', () => {
  it('seeds a slide-per-section skeleton and returns the jobId', async () => {
    const { app, audit, createdJobs, createdSlides } = await build({
      pub: { id: 'pub-001', deletedAt: null, title: 'VELORA-301 manuscript' },
      prior: null,
    })
    const res = await app.inject({ method: 'POST', url: '/publications/pub-001/slides', payload: {} })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { jobId: string; status: string; slides: Array<{ title: string }> }
    expect(body.jobId).toBe('job-new-1')
    expect(body.status).toBe('generating')
    expect(body.slides.length).toBe(6)
    expect(body.slides.map(s => s.title)).toContain('Primary endpoint')
    // One SlideDeckJob row + 6 Slide rows written through the txn client.
    expect(createdJobs).toHaveLength(1)
    expect(createdSlides).toHaveLength(6)
    // Audit chain extended.
    expect(audit).toHaveBeenCalledOnce()
    const entry = audit.mock.calls[0]![0] as { action: string; details: Record<string, unknown> }
    expect(entry.action).toBe('scientific-writing.slide.job-created')
    expect(entry.details.publicationId).toBe('pub-001')
    expect(entry.details.slideCount).toBe(6)
  })

  it('404s when the publication is missing', async () => {
    const { app } = await build({ pub: null })
    const res = await app.inject({ method: 'POST', url: '/publications/pub-missing/slides', payload: {} })
    expect(res.statusCode).toBe(404)
  })

  it('reuses prior deck titles when a previous job exists', async () => {
    const { app, createdSlides } = await build({
      pub: { id: 'pub-001', deletedAt: null, title: 'VELORA-301 manuscript' },
      prior: {
        id: 'prior-job', congressTarget: 'ESMO 2026', slideCountLimit: 15,
        slides: [
          { title: 'Opening slide',    bodyText: 'Title · authors' },
          { title: 'Trial design',     bodyText: 'Phase III · double-blind' },
          { title: 'Efficacy headline', bodyText: 'HR 0.61' },
        ],
      },
    })
    const res = await app.inject({ method: 'POST', url: '/publications/pub-001/slides', payload: {} })
    expect(res.statusCode).toBe(201)
    expect(createdSlides).toHaveLength(3)
    const titles = createdSlides.map(s => (s as { title: string }).title)
    expect(titles).toEqual(['Opening slide', 'Trial design', 'Efficacy headline'])
  })

  it('rejects a bad styleProfileId with 400', async () => {
    const { app } = await build({
      pub: { id: 'pub-001', deletedAt: null, title: 'x' },
    })
    const res = await app.inject({ method: 'POST', url: '/publications/pub-001/slides', payload: { styleProfileId: '' } })
    expect(res.statusCode).toBe(400)
  })
})
