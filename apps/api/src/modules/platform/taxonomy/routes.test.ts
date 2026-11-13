// TA Tags moved from IT Admin to Project Manager: a PM adds, edits, archives and deletes therapeutic-area tags;
// IT Admin (tenant-admin / admin), Contributor, Auditor and QC can't. Everyone signed in can still read the list.

import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import { taxonomyRoutes } from './routes.js'

async function build(role: string, roles?: string[]) {
  const prisma = {
    therapeuticArea: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => [{ code: 'ONC', label: 'Oncology', parentCode: null, status: 'active' }]),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, status: 'active' })),
    },
  }
  const app = Fastify()
  app.decorate('prisma', prisma as never)
  app.decorate('audit', { append: vi.fn(async () => {}) } as never)
  app.decorateRequest('user', null)
  app.addHook('onRequest', async (r) => {
    Object.assign(r, { user: { id: 'u-1', email: 'u@x.io', role, ...(roles && { roles }), modules: ['A', 'B', 'C', 'D', 'E'], tenantId: 't' } as AuthenticatedUser })
  })
  await app.register(taxonomyRoutes)
  await app.ready()
  return { app, prisma }
}

const create = { method: 'POST' as const, url: '/admin/taxonomy/therapeutic-areas', payload: { code: 'CARD', label: 'Cardiology' } }

describe('TA Tags is a Project Manager page', () => {
  it('a PM adds a tag', async () => {
    const { app, prisma } = await build('pm')
    const res = await app.inject(create)
    expect(res.statusCode).toBe(201)
    expect(prisma.therapeuticArea.create).toHaveBeenCalled()
    await app.close()
  })

  it('a user holding PM alongside Contributor can add one too', async () => {
    const { app } = await build('contributor', ['contributor', 'pm'])
    expect((await app.inject(create)).statusCode).toBe(201)
    await app.close()
  })

  it.each([['tenant-admin'], ['admin'], ['contributor'], ['auditor'], ['qc']])('%s cannot add, edit or delete a tag (403)', async (role) => {
    const { app, prisma } = await build(role)
    expect((await app.inject(create)).statusCode).toBe(403)
    expect((await app.inject({ method: 'PATCH', url: '/admin/taxonomy/therapeutic-areas/ONC', payload: { status: 'archived' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'DELETE', url: '/admin/taxonomy/therapeutic-areas/ONC' })).statusCode).toBe(403)
    expect(prisma.therapeuticArea.create).not.toHaveBeenCalled()
    await app.close()
  })
})
