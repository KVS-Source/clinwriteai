// Master Library routes — Phase 4 cross-module shared service.
//
// Modules B (publications), C (med content), D (regulatory), E (ideation)
// all pull approved content from here. Writes come from compliance admins
// after new approved wording ships.
//
// Versioning model:
//   - Updating an existing section creates a NEW LibrarySection row with
//     version+1 and flips the old row's `isCurrent=false` + `supersededBy`.
//     Audit trail stays correct and consumers can still link to historical
//     wording for provenance.
//   - "Retiring" (POST /:id/retire) sets `retiredAt` without creating a
//     new version — used for sections pulled permanently.
//
// Adoption tracking:
//   - LibraryAdoptionRecord captures every consumer action. On POST
//     /:id/adopt, usage_count on the section is bumped in the same tx.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const createSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  taTag: z.string().min(1),
  framework: z.string().min(1),
  category: z.enum(['claim', 'safety', 'boilerplate', 'best_practice']),
  tags: z.array(z.string()).default([]),
  tenantId: z.string().optional(),
})

const updateSchema = createSchema.partial().omit({ tenantId: true })

const listQuery = z.object({
  taTag: z.string().optional(),
  framework: z.string().optional(),
  category: z.enum(['claim', 'safety', 'boilerplate', 'best_practice']).optional(),
  tenantId: z.string().optional(),
  includeRetired: z.coerce.boolean().default(false),
  search: z.string().optional(),
})

const adoptSchema = z.object({
  adoptingModule: z.enum(['A', 'B', 'C', 'D', 'E']),
  adoptingEntity: z.string().min(1),
})

export const libraryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/sections', { preHandler: requireAuth() }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })
    return app.prisma.librarySection.findMany({
      where: {
        isCurrent: true,
        ...(parsed.data.taTag && { taTag: parsed.data.taTag }),
        ...(parsed.data.framework && { framework: parsed.data.framework }),
        ...(parsed.data.category && { category: parsed.data.category }),
        ...(parsed.data.tenantId !== undefined && { tenantId: parsed.data.tenantId }),
        ...(!parsed.data.includeRetired && { retiredAt: null }),
        ...(parsed.data.search && {
          OR: [
            { title: { contains: parsed.data.search, mode: 'insensitive' } },
            { body: { contains: parsed.data.search, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { usageCount: 'desc' },
    })
  })

  app.get('/sections/:id', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const row = await app.prisma.librarySection.findUnique({ where: { id } })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })

  // Create a brand-new section (version 1). Admin-only.
  app.post('/sections', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const created = await app.prisma.librarySection.create({
      data: {
        tenantId: parsed.data.tenantId ?? request.user!.tenantId,
        title: parsed.data.title,
        body: parsed.data.body,
        taTag: parsed.data.taTag,
        framework: parsed.data.framework,
        category: parsed.data.category,
        tags: parsed.data.tags,
        approvedBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'library_section_created',
      entityType: 'library_section',
      entityId: created.id,
      details: { title: created.title, taTag: created.taTag, framework: created.framework, category: created.category },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  // Create a new VERSION of an existing section. Admin-only.
  app.post('/sections/:id/versions', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.librarySection.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (!existing.isCurrent) {
      return reply.code(409).send({ error: 'not_current', message: 'Can only version the current section' })
    }

    const created = await app.prisma.$transaction(async (tx) => {
      await tx.librarySection.update({
        where: { id: existing.id },
        data: { isCurrent: false, supersededBy: null },               // supersededBy set after the new row has an id
      })
      const next = await tx.librarySection.create({
        data: {
          tenantId: existing.tenantId,
          title: parsed.data.title ?? existing.title,
          body: parsed.data.body ?? existing.body,
          taTag: parsed.data.taTag ?? existing.taTag,
          framework: parsed.data.framework ?? existing.framework,
          category: (parsed.data.category ?? existing.category) as 'claim' | 'safety' | 'boilerplate' | 'best_practice',
          tags: parsed.data.tags ?? existing.tags,
          version: existing.version + 1,
          isCurrent: true,
          approvedBy: request.user!.id,
        },
      })
      await tx.librarySection.update({
        where: { id: existing.id },
        data: { supersededBy: next.id },
      })
      return next
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'library_section_versioned',
      entityType: 'library_section',
      entityId: created.id,
      details: { fromId: existing.id, fromVersion: existing.version, toVersion: created.version },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  app.post('/sections/:id/retire', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const existing = await app.prisma.librarySection.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.retiredAt) return reply.code(409).send({ error: 'already_retired' })

    const updated = await app.prisma.librarySection.update({
      where: { id },
      data: { retiredAt: new Date(), isCurrent: false },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'library_section_retired',
      entityType: 'library_section',
      entityId: id,
      details: { title: existing.title, version: existing.version },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // Record an adoption by a consuming module. Non-admin; any authenticated
  // user can adopt (modules call this on behalf of their users).
  app.post('/sections/:id/adopt', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = adoptSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const section = await app.prisma.librarySection.findUnique({ where: { id } })
    if (!section) return reply.code(404).send({ error: 'not_found' })
    if (section.retiredAt) {
      return reply.code(422).send({ error: 'retired', message: 'Cannot adopt a retired section' })
    }
    if (!section.isCurrent) {
      return reply.code(422).send({
        error: 'superseded',
        message: `Section is superseded. Latest version is at /library/sections/${section.supersededBy}`,
      })
    }

    const record = await app.prisma.$transaction(async (tx) => {
      const r = await tx.libraryAdoptionRecord.create({
        data: {
          libraryId: section.id,
          adoptingModule: parsed.data.adoptingModule,
          adoptingEntity: parsed.data.adoptingEntity,
          adoptedBy: request.user!.id,
        },
      })
      await tx.librarySection.update({
        where: { id: section.id },
        data: { usageCount: { increment: 1 } },
      })
      return r
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'library_section_adopted',
      entityType: 'library_section',
      entityId: section.id,
      details: {
        adoptingModule: parsed.data.adoptingModule,
        adoptingEntity: parsed.data.adoptingEntity,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(record)
  })

  app.get('/sections/:id/adoptions', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string }
    return app.prisma.libraryAdoptionRecord.findMany({
      where: { libraryId: id },
      orderBy: { adoptedAt: 'desc' },
    })
  })
}
