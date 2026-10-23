// GET /documents/:id/sources — the sources a document is based on, with the
// sections that cite each one. Fastify inject() with a stubbed Prisma.

import Fastify from 'fastify'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsReferencesRoutes } from './references-routes.js'

const up = (id: string, over: Record<string, unknown> = {}) => ({
  id, projectId: 'proj-1', fileName: `${id}.pdf`, contentType: 'application/pdf', title: null, sourceCategory: null,
  origin: null, version: null, createdAt: new Date('2026-10-01T00:00:00Z'), ...over,
})
const UPLOADS = [
  up('prot', { title: 'Protocol v3', sourceCategory: 'protocol', origin: 'Sponsor', version: 'v3' }),
  up('sap-file', { fileName: '02_Statistical_Analysis_Plan.pdf' }),
  up('tlf', { fileName: 'tlf.xlsx', contentType: 'application/vnd.ms-excel' }),
  up('other-project', { projectId: 'proj-2' }),
]

async function build() {
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'DOC-1'
          ? { id: 'DOC-1', projectId: 'proj-1', deletedAt: null, currentVersion: { sections: [
              { sectionId: 's11_4', sectionNumber: '11.4', sectionTitle: 'Efficacy Results' },
              { sectionId: 's9', sectionNumber: '9', sectionTitle: 'Study Design' },
            ] } }
          : null,
    },
    documentSource: {
      findMany: async () => [
        { documentId: 'DOC-1', uploadId: 'prot', linkedBy: 'u1', createdAt: new Date('2026-10-02T00:00:00Z') },
        { documentId: 'DOC-1', uploadId: 'tlf', linkedBy: 'u1', createdAt: new Date('2026-10-02T00:00:00Z') },
      ],
    },
    sourceReference: {
      findMany: async () => [
        { documentId: 'DOC-1', sectionId: 's11_4', uploadId: 'prot', createdAt: new Date() },
        { documentId: 'DOC-1', sectionId: 's9', uploadId: 'prot', createdAt: new Date() },
        { documentId: 'DOC-1', sectionId: 's11_4', uploadId: 'prot', createdAt: new Date() },
        { documentId: 'DOC-1', sectionId: 's9', uploadId: 'sap-file', createdAt: new Date() },   // cited but never picked at creation
      ],
    },
    sourceReferenceRemoval: { findMany: async () => [] },
    documentUpload: {
      findMany: async ({ where }: { where: { id: { in: string[] }; projectId: string } }) =>
        UPLOADS.filter(u => where.id.in.includes(u.id) && u.projectId === where.projectId),
    },
  } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (req) => {
    const user: AuthenticatedUser = { id: 'viewer', email: 'v@x.io', role: 'clinical-writer', modules: ['A'], tenantId: null }
    ;(req as unknown as { user: AuthenticatedUser }).user = user
  })
  await app.register(documentsReferencesRoutes, { prefix: '/documents' })
  await app.ready()
  return app
}

beforeEach(() => { process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E' })

describe('GET /documents/:id/sources', () => {
  it('returns linked and cited sources with the sections that cite them, in section order', async () => {
    const res = await (await build()).inject({ method: 'GET', url: '/documents/DOC-1/sources' })
    expect(res.statusCode).toBe(200)
    const { items } = res.json()
    const by = Object.fromEntries(items.map((i: { uploadId: string }) => [i.uploadId, i]))
    expect(Object.keys(by).sort()).toEqual(['prot', 'sap-file', 'tlf'])

    expect(by.prot).toMatchObject({ title: 'Protocol v3', category: 'protocol', origin: 'Sponsor', version: 'v3', previewable: true })
    expect(by.prot.sections).toEqual([
      { sectionId: 's9', number: '9', title: 'Study Design', references: 1 },
      { sectionId: 's11_4', number: '11.4', title: 'Efficacy Results', references: 2 },
    ])
    // linked at creation but not cited anywhere yet
    expect(by.tlf).toMatchObject({ category: 'tlf', previewable: false, sections: [] })
    // cited but not picked at creation: still listed; category guessed from the name
    expect(by['sap-file']).toMatchObject({ title: '02_Statistical_Analysis_Plan', category: 'sap' })
  })

  it('404s for an unknown document', async () => {
    expect((await (await build()).inject({ method: 'GET', url: '/documents/NOPE/sources' })).statusCode).toBe(404)
  })
})
