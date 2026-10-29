// GET /documents/:id carries each section's last editor (name + when) for the comments panels.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { documentsRoutes } from './routes.js'

const sec = (sectionId: string, sectionNumber: string, over: Record<string, unknown> = {}) => ({
  id: `row-${sectionId}`, sectionId, sectionNumber, sectionTitle: `Title ${sectionNumber}`, ichStatus: 'complete',
  contentHtml: '<p>x</p>', lastEditedBy: null, lastEditedAt: null, ...over,
})

async function build() {
  const findMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.map(id => ({ id, name: id === 'user-sc' ? 'Dr. Sarah Chen' : 'Someone' })))
  const app = Fastify()
  app.decorate('prisma', {
    document: {
      findUnique: vi.fn(async () => ({
        id: 'doc-1', status: 'in_authoring', stage: 'study_start_up', type: 'csr_full', deletedAt: null,
        currentVersion: {
          versionNumber: 'v0.1',
          sections: [
            sec('s1', '1', { lastEditedBy: 'user-sc', lastEditedAt: new Date('2026-10-20T10:00:00Z'), aiSpanCount: 3, humanSpanCount: 5 }),
            sec('s2', '2'),
          ],
        },
      })),
    },
    user: { findMany },
  } as never)
  app.decorate('audit', { append: vi.fn(async () => ({})) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    const user: AuthenticatedUser = { id: 'user-ev', email: 'e@v', role: 'admin', modules: ['A'], tenantId: null }
    Object.assign(r, { user })
  })
  await app.register(documentsRoutes, { prefix: '/documents' })
  await app.ready()
  return { app, findMany }
}

describe('GET /documents/:id section editors', () => {
  it('names the last editor of each edited section and leaves untouched sections null', async () => {
    const { app, findMany } = await build()
    const res = await app.inject({ method: 'GET', url: '/documents/doc-1' })
    expect(res.statusCode).toBe(200)
    const sections = res.json().sections as Array<Record<string, unknown>>
    expect(sections.find(s => s.id === 's1')).toMatchObject({ lastEditedByName: 'Dr. Sarah Chen', lastEditedAt: '2026-10-20T10:00:00.000Z' })
    expect(sections.find(s => s.id === 's2')).toMatchObject({ lastEditedByName: null, lastEditedAt: null })
    expect(findMany).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it('returns each section\'s AI-drafted and human-authored counts (0 when never edited)', async () => {
    const { app } = await build()
    const sections = (await app.inject({ method: 'GET', url: '/documents/doc-1' })).json().sections as Array<Record<string, unknown>>
    expect(sections.find(s => s.id === 's1')).toMatchObject({ aiSpanCount: 3, humanSpanCount: 5 })
    expect(sections.find(s => s.id === 's2')).toMatchObject({ aiSpanCount: 0, humanSpanCount: 0 })
    await app.close()
  })
})
