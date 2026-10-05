// Taxonomy admin — therapeutic areas (TA tags).
//
// Phase 4 Admin surface. Super-admins curate the TA catalogue; every
// authed user can read + validate. Existing free-text taTag columns
// stay in place for backwards compat; new code is encouraged to validate
// against this list via GET /taxonomy/therapeutic-areas/validate.
//
// Routes:
//   GET    /taxonomy/therapeutic-areas            — list active (optional ?tree=true)
//   GET    /taxonomy/therapeutic-areas/:code      — detail incl children
//   GET    /taxonomy/therapeutic-areas/validate?code=X  — writer helper
//   POST   /admin/taxonomy/therapeutic-areas      — super-admin create
//   PATCH  /admin/taxonomy/therapeutic-areas/:code — super-admin update
//   DELETE /admin/taxonomy/therapeutic-areas/:code — super-admin archive

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

// Codes are ALL_CAPS alphanum + hyphens: 'ONC', 'ONC-HAEM', 'CARD-HTN'.
// Keeps them human-readable + URL-safe + obviously-a-TA-code at a glance.
const codeShape = z.string().regex(/^[A-Z][A-Z0-9-]{1,31}$/, 'TA code must be 2-32 chars: uppercase alnum + hyphen, start with letter')

const createSchema = z.object({
  code: codeShape,
  label: z.string().min(1).max(128),
  parentCode: codeShape.optional(),
  description: z.string().optional(),
})

const updateSchema = z.object({
  label: z.string().min(1).max(128).optional(),
  parentCode: codeShape.nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
})

export const taxonomyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/taxonomy/therapeutic-areas', { preHandler: requireAuth({ modules: ['A', 'B', 'C', 'D', 'E'] }) }, async (request) => {
    const { tree, includeArchived } = request.query as { tree?: string; includeArchived?: string }
    const where = includeArchived === 'true' ? {} : { status: 'active' }
    const rows = await app.prisma.therapeuticArea.findMany({
      where,
      orderBy: [{ parentCode: 'asc' }, { code: 'asc' }],
    })
    if (tree !== 'true') return rows

    // Nest children under their parent. Single pass; O(n). Rows with a
    // parentCode whose parent is in the result stay nested; orphans fall
    // through as roots so the UI never silently drops them.
    const byCode = new Map(rows.map(r => [r.code, { ...r, children: [] as typeof rows }]))
    const roots: Array<ReturnType<typeof byCode.get> & object> = []
    for (const node of byCode.values()) {
      if (node.parentCode && byCode.has(node.parentCode)) {
        byCode.get(node.parentCode)!.children.push(node as (typeof rows)[number])
      } else {
        roots.push(node)
      }
    }
    return roots
  })

  app.get('/taxonomy/therapeutic-areas/validate', { preHandler: requireAuth({ modules: ['A', 'B', 'C', 'D', 'E'] }) }, async (request, reply) => {
    const { code } = request.query as { code?: string }
    if (!code) return reply.code(400).send({ error: 'missing_code' })
    const row = await app.prisma.therapeuticArea.findUnique({ where: { code } })
    return {
      code,
      valid: !!row && row.status === 'active',
      exists: !!row,
      status: row?.status ?? null,
      label: row?.label ?? null,
    }
  })

  app.get('/taxonomy/therapeutic-areas/:code', { preHandler: requireAuth({ modules: ['A', 'B', 'C', 'D', 'E'] }) }, async (request, reply) => {
    const { code } = request.params as { code: string }
    const row = await app.prisma.therapeuticArea.findUnique({
      where: { code },
      include: { children: { where: { status: 'active' }, orderBy: { code: 'asc' } } },
    })
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return row
  })

  app.post('/admin/taxonomy/therapeutic-areas', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    if (parsed.data.parentCode) {
      const parent = await app.prisma.therapeuticArea.findUnique({ where: { code: parsed.data.parentCode } })
      if (!parent) return reply.code(400).send({ error: 'parent_not_found', parentCode: parsed.data.parentCode })
    }

    const existing = await app.prisma.therapeuticArea.findUnique({ where: { code: parsed.data.code } })
    if (existing) return reply.code(409).send({ error: 'code_exists', code: parsed.data.code })

    const row = await app.prisma.therapeuticArea.create({
      data: {
        code: parsed.data.code,
        label: parsed.data.label,
        parentCode: parsed.data.parentCode,
        description: parsed.data.description,
        createdBy: request.user!.id,
      },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'therapeutic_area_created',
      entityType: 'therapeutic_area',
      entityId: row.code,
      details: { label: row.label, parentCode: row.parentCode },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(row)
  })

  app.patch('/admin/taxonomy/therapeutic-areas/:code', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const { code } = request.params as { code: string }
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.therapeuticArea.findUnique({ where: { code } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    // Prevent cycles: a code can't become its own ancestor.
    if (parsed.data.parentCode && parsed.data.parentCode === code) {
      return reply.code(400).send({ error: 'self_parent' })
    }
    if (parsed.data.parentCode) {
      // Walk up the new parent chain; abort if we hit `code`.
      let cursor: string | null = parsed.data.parentCode
      const seen = new Set<string>()
      while (cursor) {
        if (seen.has(cursor)) break           // guard against pre-existing cycles
        if (cursor === code) {
          return reply.code(400).send({ error: 'cycle', message: `parentCode=${parsed.data.parentCode} would create a cycle` })
        }
        seen.add(cursor)
        const next: { parentCode: string | null } | null = await app.prisma.therapeuticArea.findUnique({
          where: { code: cursor }, select: { parentCode: true },
        })
        cursor = next?.parentCode ?? null
      }
    }

    const row = await app.prisma.therapeuticArea.update({
      where: { code },
      data: {
        ...(parsed.data.label !== undefined && { label: parsed.data.label }),
        ...(parsed.data.parentCode !== undefined && { parentCode: parsed.data.parentCode }),
        ...(parsed.data.description !== undefined && { description: parsed.data.description }),
        ...(parsed.data.status !== undefined && {
          status: parsed.data.status,
          archivedAt: parsed.data.status === 'archived' ? new Date() : null,
        }),
      },
    })
    return row
  })

  app.delete('/admin/taxonomy/therapeutic-areas/:code', { preHandler: requireAuth({ roles: ['super-admin'] }) }, async (request, reply) => {
    const { code } = request.params as { code: string }
    const existing = await app.prisma.therapeuticArea.findUnique({
      where: { code },
      include: { children: { where: { status: 'active' } } },
    })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.children.length > 0) {
      return reply.code(409).send({
        error: 'has_children',
        message: `Archive the ${existing.children.length} active child TA(s) first`,
        childCodes: existing.children.map(c => c.code),
      })
    }

    const archived = await app.prisma.therapeuticArea.update({
      where: { code },
      data: { status: 'archived', archivedAt: new Date() },
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'therapeutic_area_archived',
      entityType: 'therapeutic_area',
      entityId: code,
      details: { label: existing.label },
      ipAddress: request.ip ?? null,
    })

    return archived
  })
}
