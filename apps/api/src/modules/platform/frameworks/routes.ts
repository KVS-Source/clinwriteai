// Regulatory framework registry — platform-wide catalogue of frameworks
// that modules reference. Admin-maintained; read-only to everyone else.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const createSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  jurisdiction: z.string().min(1),
  category: z.string().min(1),
  effectiveDate: z.string().datetime(),
  description: z.string().optional(),
  sourceUrl: z.string().url().optional(),
})

const updateSchema = createSchema.partial().omit({ name: true })

const listQuery = z.object({
  jurisdiction: z.string().optional(),
  category: z.string().optional(),
  includeRetired: z.coerce.boolean().default(false),
})

export const frameworksRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: requireAuth() }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    return app.prisma.regulatoryFramework.findMany({
      where: {
        ...(parsed.data.jurisdiction && { jurisdiction: parsed.data.jurisdiction }),
        ...(parsed.data.category && { category: parsed.data.category }),
        ...(!parsed.data.includeRetired && { retiredAt: null }),
      },
      orderBy: [{ jurisdiction: 'asc' }, { name: 'asc' }],
    })
  })

  app.get('/:id', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = await app.prisma.regulatoryFramework.findUnique({ where: { id } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })

  app.post('/', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    // Framework names are globally unique — modules reference them by name
    // in free-text columns (library_sections.framework etc.) rather than FK.
    const existing = await app.prisma.regulatoryFramework.findUnique({ where: { name: parsed.data.name } })
    if (existing) return reply.code(409).send({ error: 'name_taken' })

    const created = await app.prisma.regulatoryFramework.create({
      data: {
        name: parsed.data.name,
        version: parsed.data.version,
        jurisdiction: parsed.data.jurisdiction,
        category: parsed.data.category,
        effectiveDate: new Date(parsed.data.effectiveDate),
        description: parsed.data.description ?? null,
        sourceUrl: parsed.data.sourceUrl ?? null,
        createdBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'framework_registered',
      entityType: 'regulatory_framework',
      entityId: created.id,
      details: { name: created.name, version: created.version, jurisdiction: created.jurisdiction },
      ipAddress: request.ip ?? null,
    })
    return reply.code(201).send(created)
  })

  app.patch('/:id', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.regulatoryFramework.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.regulatoryFramework.update({
      where: { id },
      data: {
        ...parsed.data,
        effectiveDate: parsed.data.effectiveDate ? new Date(parsed.data.effectiveDate) : undefined,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'framework_updated',
      entityType: 'regulatory_framework',
      entityId: id,
      details: { changedFields: Object.keys(parsed.data) },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  app.post('/:id/retire', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await app.prisma.regulatoryFramework.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.retiredAt) return reply.code(409).send({ error: 'already_retired' })

    const updated = await app.prisma.regulatoryFramework.update({
      where: { id },
      data: { retiredAt: new Date() },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'framework_retired',
      entityType: 'regulatory_framework',
      entityId: id,
      details: { name: existing.name },
      ipAddress: request.ip ?? null,
    })

    return updated
  })
}
