// POST /:submissionId/canonical-json/index
//
// Previously returned a hardcoded `{ dataPoints: 0, sources: [], stub: true }`.
// Now reads the actual CanonicalJsonEntry rows and reports counts.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'

const { canonicalRoutes } = await import('./routes.js')

const SUB = 'sub-1'

type Entry = { sourceDocId: string; sourceType: string; version: string; content: unknown; indexedAt: Date }

async function build(opts: { submissionExists?: boolean; entries?: Entry[] } = {}) {
  const audits: Array<Record<string, unknown>> = []
  const app = Fastify()
  app.decorate('prisma', {
    regulatorySubmission: {
      findUnique: vi.fn(async () => opts.submissionExists === false ? null : ({ id: SUB })),
    },
    canonicalJsonEntry: {
      findMany: vi.fn(async () => opts.entries ?? []),
    },
  } as never)
  app.decorate('audit', { append: vi.fn(async (ev: Record<string, unknown>) => { audits.push(ev); return { id: 'a1' } }) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u1', email: 'u@x.io', role: 'regulatory-writer', modules: ['D'], tenantId: 't1' }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(canonicalRoutes)
  await app.ready()
  return { app, audits }
}

const index = (app: Awaited<ReturnType<typeof build>>['app']) =>
  app.inject({ method: 'POST', url: `/${SUB}/canonical-json/index` })

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'D' })

describe('POST /:submissionId/canonical-json/index', () => {
  it('returns zero counts for a submission with no indexed entries', async () => {
    const { app } = await build({ entries: [] })
    const res = await index(app)
    expect(res.statusCode).toBe(200)
    const body = res.json() as { dataPoints: number; sources: unknown[]; stub?: boolean }
    expect(body.dataPoints).toBe(0)
    expect(body.sources).toEqual([])
    expect(body.stub).toBeUndefined()
  })

  it('counts top-level keys across every entry.content (object case)', async () => {
    const { app, audits } = await build({
      entries: [
        { sourceDocId: 'd1', sourceType: 'csr', version: 'v1', content: { a: 1, b: 2, c: 3 }, indexedAt: new Date('2026-11-09T08:00:00Z') },
        { sourceDocId: 'd2', sourceType: 'ib',  version: 'v2', content: { x: 'y' },           indexedAt: new Date('2026-11-09T09:00:00Z') },
      ],
    })
    const res = await index(app)
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      dataPoints: number
      sources: Array<{ sourceDocId: string; sourceType: string; version: string; indexedAt: string }>
    }
    expect(body.dataPoints).toBe(4)                                     // 3 + 1
    expect(body.sources).toHaveLength(2)
    expect(body.sources[0]).toMatchObject({ sourceDocId: 'd1', sourceType: 'csr', version: 'v1' })

    const rec = audits.find(e => e.action === 'canonical_json_indexed')
    expect(rec?.details).toMatchObject({ sourceCount: 2, dataPoints: 4 })
  })

  it('handles array content by counting length, scalar content as 0', async () => {
    const { app } = await build({
      entries: [
        { sourceDocId: 'd1', sourceType: 'tlf',    version: 'v1', content: ['row1', 'row2', 'row3'], indexedAt: new Date() },
        { sourceDocId: 'd2', sourceType: 'cmc',    version: 'v1', content: 'just a string',         indexedAt: new Date() },
        { sourceDocId: 'd3', sourceType: 'nonclin',version: 'v1', content: null,                     indexedAt: new Date() },
      ],
    })
    const body = (await index(app)).json() as { dataPoints: number; sources: unknown[] }
    expect(body.dataPoints).toBe(3)                                      // 3 + 0 + 0
    expect(body.sources).toHaveLength(3)
  })

  it('returns 404 when the submission does not exist', async () => {
    const { app } = await build({ submissionExists: false })
    expect((await index(app)).statusCode).toBe(404)
  })
})
