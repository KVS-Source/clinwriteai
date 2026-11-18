// GET /publications/:id/sections: sections in natural number order (1, 2 … 10, 12), each with the drafting guidance
// from the publication type's current template.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { publicationSectionRoutes } from './section-routes.js'

const row = (sectionId: string, sectionNumber: string, sectionTitle: string) => ({
  id: `c-${sectionId}`, sectionId, sectionNumber, sectionTitle, contentHtml: '<p>[x]</p>', wordCount: 1,
  aiConfidence: null, aiFlags: [], lastEditedBy: null, lastEditedAt: null,
})

async function build(opts: { policy: boolean }) {
  const app = Fastify()
  const prisma = {
    publication: { findUnique: vi.fn(async () => ({ id: 'pub-1', deletedAt: null, type: 'manuscript', subtype: 'original_research', currentVersionId: 'v-1' })) },
    publicationSectionContent: { findMany: vi.fn(async () => [
      row('traceability', '12', 'Drafting traceability log'), row('title', '1', 'Title page'),
      row('tables_figures', '10', 'Tables and figures'), row('abstract', '2', 'Abstract'), row('results', '5', 'Results'),
    ]) },
    publicationTypePolicy: { findFirst: vi.fn(async ({ where }: { where: { docType: string } }) =>
      (opts.policy && where.docType === 'manuscript_original_research' ? { templateId: 'tpl-1' } : null)) },
    publicationTemplate: { findUnique: vi.fn(async () => ({ sections: [
      { id: 'results', guidance: 'Do not fabricate values.' }, { id: 'title', guidance: 'Confirm authorship against ICMJE criteria.' }, { id: 'abstract' },
    ] })) },
  }
  app.decorate('prisma', prisma as never)
  app.decorate('audit', { append: vi.fn() } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => { Object.assign(r, { user: { id: 'u-1', email: 'u@x', role: 'contributor', modules: ['B'], tenantId: 't1' } }) })
  await app.register(publicationSectionRoutes)
  return app
}

describe('GET /publications/:id/sections', () => {
  it('lists sections in natural number order (10 and 12 after 5, not after 1)', async () => {
    const app = await build({ policy: true })
    const res = await app.inject({ method: 'GET', url: '/pub-1/sections' })
    expect(res.statusCode).toBe(200)
    expect(res.json().sections.map((s: { sectionNumber: string }) => s.sectionNumber)).toEqual(['1', '2', '5', '10', '12'])
    await app.close()
  })

  it("adds each section's drafting guidance from the type's current template", async () => {
    const app = await build({ policy: true })
    const byId = Object.fromEntries((await app.inject({ method: 'GET', url: '/pub-1/sections' })).json().sections
      .map((s: { sectionId: string; guidance: string | null }) => [s.sectionId, s.guidance]))
    expect(byId).toMatchObject({ results: 'Do not fabricate values.', title: 'Confirm authorship against ICMJE criteria.', abstract: null, traceability: null })
    await app.close()
  })

  it('has no guidance when the type has no template', async () => {
    const app = await build({ policy: false })
    const sections = (await app.inject({ method: 'GET', url: '/pub-1/sections' })).json().sections as Array<{ guidance: unknown }>
    expect(sections.every(s => s.guidance === null)).toBe(true)
    await app.close()
  })
})
