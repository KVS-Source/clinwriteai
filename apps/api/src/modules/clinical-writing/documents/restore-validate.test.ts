// POST /documents/:id/restore checks every requested section exists in the version it is restored
// from before queuing the job (CW-094). The worker used to find out later and fail where no one saw.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'

const DOC = 'DOC-1'

async function build(opts: { currentHtml?: Record<string, string> } = {}) {
  const jobs: unknown[] = []
  const enqueue = vi.fn(async () => undefined)
  const app = Fastify()
  app.decorate('prisma', {
    document: { findUnique: vi.fn(async () => ({ id: DOC, projectId: 'p-1', status: 'in_authoring', assigneeId: 'u-1', currentVersionId: 'v3' })) },
    documentRaci: { findFirst: vi.fn(async () => ({ id: 'raci-r' })) },
    project: { findUnique: vi.fn(async () => ({ id: 'p-1', status: 'initiated' })) },
    // v1 holds s1 and s2; v2 holds only s1. Versions of other documents are filtered out by the where.
    documentVersion: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; documentId: string } }) =>
        [
          { id: 'v1', versionNumber: 'v0.1', sections: [{ sectionId: 's1', contentHtml: '<p>one A</p>' }, { sectionId: 's2', contentHtml: '<p>two A</p>' }] },
          { id: 'v2', versionNumber: 'v0.2', sections: [{ sectionId: 's1', contentHtml: '<p>one B</p>' }] },
        ].filter(v => where.documentId === DOC && where.id.in.includes(v.id))),
      // The current version (v3): what each section holds now.
      findUnique: vi.fn(async () => ({
        versionNumber: 'v0.3',
        sections: Object.entries(opts.currentHtml ?? { s1: '<p>one NOW</p>', s2: '<p>two NOW</p>' }).map(([sectionId, contentHtml]) => ({ sectionId, contentHtml })),
      })),
    },
    versionRestoreJob: { create: vi.fn(async ({ data }: { data: unknown }) => { jobs.push(data); return { id: 'job-1' } }) },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => undefined) } as never)
  app.decorate('queue', { enqueue } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'u-1', email: 'u@x', role: 'contributor', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  const restore = (sections: Array<{ sectionId: string; fromVersionId: string }>) =>
    app.inject({ method: 'POST', url: `/documents/${DOC}/restore`, payload: { sections, reason: 'roll back' } })
  return { app, restore, jobs, enqueue }
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

describe('POST /documents/:id/restore — section check', () => {
  it('400 naming the sections the chosen version does not have, and queues nothing', async () => {
    const { app, restore, jobs, enqueue } = await build()
    const res = await restore([{ sectionId: 's1', fromVersionId: 'v2' }, { sectionId: 's2', fromVersionId: 'v2' }])
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('restore_sections_missing')
    expect(res.json().missing).toEqual([{ sectionId: 's2', fromVersionId: 'v2' }])
    expect(res.json().message).toContain('s2 (v0.2)')
    expect(jobs).toHaveLength(0)
    expect(enqueue).not.toHaveBeenCalled()
    await app.close()
  })

  it('400 for a version that is not on this document', async () => {
    const { app, restore, jobs } = await build()
    const res = await restore([{ sectionId: 's1', fromVersionId: 'v-elsewhere' }])
    expect(res.statusCode).toBe(400)
    expect(jobs).toHaveLength(0)
    await app.close()
  })

  it('202 and queues the job when every section is present', async () => {
    const { app, restore, jobs, enqueue } = await build()
    const res = await restore([{ sectionId: 's1', fromVersionId: 'v2' }, { sectionId: 's2', fromVersionId: 'v1' }])
    expect(res.statusCode).toBe(202)
    expect(jobs).toHaveLength(1)
    expect(enqueue).toHaveBeenCalledOnce()
    await app.close()
  })
})

describe('POST /documents/:id/restore — nothing to restore', () => {
  it('400 when a chosen section already matches the current version, and queues nothing', async () => {
    const { app, restore, jobs, enqueue } = await build({ currentHtml: { s1: '<p>one A</p>', s2: '<p>two NOW</p>' } })
    const res = await restore([{ sectionId: 's1', fromVersionId: 'v1' }, { sectionId: 's2', fromVersionId: 'v1' }])
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('restore_sections_unchanged')
    expect(res.json().unchanged).toEqual([{ sectionId: 's1', fromVersionId: 'v1' }])
    expect(res.json().message).toContain('already match the current version (v0.3)')
    expect(res.json().message).toContain('s1 (from v0.1)')
    expect(jobs).toHaveLength(0)
    expect(enqueue).not.toHaveBeenCalled()
    await app.close()
  })

  it('400 when the only chosen section matches (the case that made an empty new version)', async () => {
    const { app, restore, jobs } = await build({ currentHtml: { s1: '<p>one B</p>' } })
    const res = await restore([{ sectionId: 's1', fromVersionId: 'v2' }])
    expect(res.statusCode).toBe(400)
    expect(jobs).toHaveLength(0)
    await app.close()
  })

  it('202 when the chosen sections differ from the current version, even one the document no longer has', async () => {
    const { app, restore, jobs } = await build({ currentHtml: { s1: '<p>one NOW</p>' } })      // s2 no longer in the document
    const res = await restore([{ sectionId: 's1', fromVersionId: 'v1' }, { sectionId: 's2', fromVersionId: 'v1' }])
    expect(res.statusCode).toBe(202)
    expect(jobs).toHaveLength(1)
    await app.close()
  })
})
