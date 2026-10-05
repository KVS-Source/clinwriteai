// Project CRUD + lifecycle routes.
//
// Scope boundaries this plugin DOES NOT cover (deferred):
//   - Team member assignment: Phase 1 Week 4 via /projects/:id/team sub-routes.
//   - Document / publication sub-resources: owned by their respective modules
//     (clinical-writing, scientific-writing, …) and mounted under their own
//     prefixes in Phase 3A-3E.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../auth/rbac.js'
import {
  canTransition,
  InvalidTransitionError,
  PROJECT_STATUSES,
  type ProjectStatus,
} from './state-machine.js'

const projectCreateSchema = z.object({
  id: z.string().min(3),            // human-friendly id (e.g. 'PROJ-VELORA')
  name: z.string().min(1),
  shortTitle: z.string().min(1),
  client: z.string().min(1),
  therapeuticArea: z.string().min(1),
  indication: z.string().optional(),
  phase: z.string().min(1),
  startDate: z.string().datetime(),
  dataCutoff: z.string().datetime().optional(),
  activeModules: z.array(z.enum(['A', 'B', 'C', 'D', 'E'])).default([]),
  submissionCountries: z.array(z.string()).default([]),
  referenceTrial: z.string().optional(),
})

const projectUpdateSchema = projectCreateSchema.partial().omit({ id: true })

const transitionSchema = z.object({
  to: z.enum(PROJECT_STATUSES),
  reason: z.string().max(500).optional(),
})

export const projectRoutes: FastifyPluginAsync = async (app) => {
  // List — all authenticated users see the full set. Tenant scoping (per-user
  // visibility) lands when multi-tenant goes live in Phase 2.
  app.get('/', { preHandler: requireAuth() }, async () => {
    return app.prisma.project.findMany({ orderBy: { createdAt: 'desc' } })
  })

  app.get('/:id', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const project = await app.prisma.project.findUnique({ where: { id } })
    if (!project) return reply.code(404).send({ error: 'not_found' })
    return project
  })

  app.post('/', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
    const parsed = projectCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.project.findUnique({ where: { id: parsed.data.id } })
    if (existing) return reply.code(409).send({ error: 'conflict', message: 'Project id already exists' })

    const created = await app.prisma.project.create({
      data: {
        ...parsed.data,
        status: 'initiated',
        startDate: new Date(parsed.data.startDate),
        dataCutoff: parsed.data.dataCutoff ? new Date(parsed.data.dataCutoff) : null,
        tenantId: request.user!.tenantId,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'project.create',
      entityType: 'project',
      entityId: created.id,
      details: { name: created.name, status: created.status },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  app.patch('/:id', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = projectUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.project.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const updated = await app.prisma.project.update({
      where: { id },
      data: {
        ...parsed.data,
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : undefined,
        dataCutoff: parsed.data.dataCutoff ? new Date(parsed.data.dataCutoff) : undefined,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'project.update',
      entityType: 'project',
      entityId: id,
      details: { changedFields: Object.keys(parsed.data) },
      ipAddress: request.ip ?? null,
    })

    return updated
  })

  // Explicit state-machine endpoint — status changes NEVER go through PATCH.
  // Keeping them separate makes the audit trail unambiguous (every row with
  // action='project.state_changed' is a real transition, not an incidental
  // field update).
  app.post('/:id/transition', { preHandler: requireAuth({ roles: ['admin', 'super-admin'] }) }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = transitionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const project = await app.prisma.project.findUnique({ where: { id } })
    if (!project) return reply.code(404).send({ error: 'not_found' })

    const from = project.status as ProjectStatus
    const to = parsed.data.to
    if (!canTransition(from, to)) {
      const err = new InvalidTransitionError(from, to)
      return reply.code(409).send({ error: 'invalid_transition', message: err.message })
    }

    const updated = await app.prisma.project.update({ where: { id }, data: { status: to } })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'project.state_changed',
      entityType: 'project',
      entityId: id,
      details: { from, to, reason: parsed.data.reason ?? null },
      ipAddress: request.ip ?? null,
    })

    return updated
  })
}
