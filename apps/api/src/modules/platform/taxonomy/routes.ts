// Taxonomy admin — therapeutic areas (TA tags).
//
// Admin surface (PRD sPM17). Admins curate the TA catalogue; every authed
// user can read + validate. Projects / documents / module items store the
// TA *label* as free text, so "in use" = rows whose TA matches the label
// case-insensitively (see usageByLabel). The project + Module A document
// create routes validate against this list via ./validate.ts.
//
// Routes:
//   GET    /taxonomy/therapeutic-areas            — list active (?tree=true, ?includeArchived=true, ?includeUsage=true)
//   GET    /taxonomy/therapeutic-areas/:code      — detail incl children
//   GET    /taxonomy/therapeutic-areas/validate?code=X  — writer helper
//   POST   /admin/taxonomy/therapeutic-areas      — admin create
//   PATCH  /admin/taxonomy/therapeutic-areas/:code — admin update / archive / restore
//   DELETE /admin/taxonomy/therapeutic-areas/:code — admin hard delete (unused tags only; FR-PM-031)

import type { FastifyPluginAsync } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

// Tenant admins manage the catalogue too (PRD sPM17 access = Admin).
const adminGate = requireAuth({ roles: ['admin'] })

type Usage = { projectCount: number; documentCount: number }

// Counts every row that carries each TA label, keyed by lower-cased label.
// "Documents" spans Module A documents plus the module-specific items that
// carry a TA tag (C content, D submissions, E ideation, library sections).
async function usageByLabel(prisma: PrismaClient): Promise<Map<string, Usage>> {
  const rows = await prisma.$queryRaw<Array<{ label: string | null; kind: 'project' | 'document'; n: number }>>`
    SELECT lower(ta) AS label, kind, count(*)::int AS n FROM (
      SELECT "therapeuticArea" AS ta, 'project' AS kind FROM projects
      UNION ALL SELECT "therapeuticArea", 'document' FROM documents WHERE "deletedAt" IS NULL
      UNION ALL SELECT "taTag", 'document' FROM med_content_items
      UNION ALL SELECT "taTag", 'document' FROM regulatory_submissions
      UNION ALL SELECT "taTag", 'document' FROM ideation_projects
      UNION ALL SELECT "taTag", 'document' FROM library_sections
    ) t GROUP BY 1, 2`
  const usage = new Map<string, Usage>()
  for (const r of rows) {
    if (!r.label) continue
    const u = usage.get(r.label) ?? { projectCount: 0, documentCount: 0 }
    if (r.kind === 'project') u.projectCount += r.n
    else u.documentCount += r.n
    usage.set(r.label, u)
  }
  return usage
}

const usageFor = (usage: Map<string, Usage>, label: string): Usage =>
  usage.get(label.trim().toLowerCase()) ?? { projectCount: 0, documentCount: 0 }

const isInUse = (u: Usage) => u.projectCount + u.documentCount > 0

const inUseMessage = (u: Usage) =>
  `This tag is in use by ${u.projectCount} projects and ${u.documentCount} documents and cannot be deleted. You may archive it instead.`

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
    const { tree, includeArchived, includeUsage } = request.query as { tree?: string; includeArchived?: string; includeUsage?: string }
    const where = includeArchived === 'true' ? {} : { status: 'active' }
    let rows = await app.prisma.therapeuticArea.findMany({
      where,
      orderBy: [{ parentCode: 'asc' }, { code: 'asc' }],
    })
    if (includeUsage === 'true') {
      const usage = await usageByLabel(app.prisma)
      rows = rows.map(r => ({ ...r, ...usageFor(usage, r.label) }))
    }
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

  app.post('/admin/taxonomy/therapeutic-areas', { preHandler: adminGate }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    if (parsed.data.parentCode) {
      const parent = await app.prisma.therapeuticArea.findUnique({ where: { code: parsed.data.parentCode } })
      if (!parent) return reply.code(400).send({ error: 'parent_not_found', parentCode: parsed.data.parentCode })
    }

    const existing = await app.prisma.therapeuticArea.findUnique({ where: { code: parsed.data.code } })
    if (existing) return reply.code(409).send({ error: 'code_exists', code: parsed.data.code, message: `Abbreviation ${parsed.data.code} is already in use` })

    // Labels are what projects/documents store, so they must be unique too.
    const sameLabel = await app.prisma.therapeuticArea.findFirst({
      where: { label: { equals: parsed.data.label.trim(), mode: 'insensitive' } },
    })
    if (sameLabel) return reply.code(409).send({ error: 'label_exists', code: sameLabel.code, message: `A tag named "${sameLabel.label}" already exists` })

    const row = await app.prisma.therapeuticArea.create({
      data: {
        code: parsed.data.code,
        label: parsed.data.label.trim(),
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

  app.patch('/admin/taxonomy/therapeutic-areas/:code', { preHandler: adminGate }, async (request, reply) => {
    const { code } = request.params as { code: string }
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const existing = await app.prisma.therapeuticArea.findUnique({
      where: { code },
      include: { children: { where: { status: 'active' } } },
    })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    // Projects/documents store the label, so renaming an in-use tag would
    // orphan their tagging. Only unused tags can be renamed.
    const newLabel = parsed.data.label?.trim()
    if (newLabel !== undefined && newLabel !== existing.label) {
      const usage = usageFor(await usageByLabel(app.prisma), existing.label)
      if (isInUse(usage)) {
        return reply.code(409).send({ error: 'in_use', ...usage, message: 'A tag in use cannot be renamed. Archive it and create a new tag instead.' })
      }
      const clash = await app.prisma.therapeuticArea.findFirst({
        where: { label: { equals: newLabel, mode: 'insensitive' }, NOT: { code } },
      })
      if (clash) return reply.code(409).send({ error: 'label_exists', code: clash.code, message: `A tag named "${clash.label}" already exists` })
    }

    if (parsed.data.status === 'archived' && existing.children.length > 0) {
      return reply.code(409).send({
        error: 'has_children',
        message: `Archive the ${existing.children.length} active child TA(s) first`,
        childCodes: existing.children.map(c => c.code),
      })
    }

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
        ...(newLabel !== undefined && { label: newLabel }),
        ...(parsed.data.parentCode !== undefined && { parentCode: parsed.data.parentCode }),
        ...(parsed.data.description !== undefined && { description: parsed.data.description }),
        ...(parsed.data.status !== undefined && {
          status: parsed.data.status,
          archivedAt: parsed.data.status === 'archived' ? new Date() : null,
        }),
      },
    })

    const statusChanged = parsed.data.status !== undefined && parsed.data.status !== existing.status
    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: statusChanged
        ? (parsed.data.status === 'archived' ? 'therapeutic_area_archived' : 'therapeutic_area_restored')
        : 'therapeutic_area_updated',
      entityType: 'therapeutic_area',
      entityId: code,
      details: { label: row.label, changedFields: Object.keys(parsed.data), previousLabel: existing.label },
      ipAddress: request.ip ?? null,
    })

    return row
  })

  // Hard delete — only for tags nothing references (FR-PM-031 / AC-PM-025).
  // In-use tags must be archived via PATCH { status: 'archived' } instead.
  app.delete('/admin/taxonomy/therapeutic-areas/:code', { preHandler: adminGate }, async (request, reply) => {
    const { code } = request.params as { code: string }
    const existing = await app.prisma.therapeuticArea.findUnique({
      where: { code },
      include: { children: true },
    })
    if (!existing) return reply.code(404).send({ error: 'not_found' })
    if (existing.children.length > 0) {
      return reply.code(409).send({
        error: 'has_children',
        message: `Remove the ${existing.children.length} child TA(s) first`,
        childCodes: existing.children.map(c => c.code),
      })
    }

    const usage = usageFor(await usageByLabel(app.prisma), existing.label)
    if (isInUse(usage)) {
      return reply.code(409).send({ error: 'in_use', ...usage, message: inUseMessage(usage) })
    }

    await app.prisma.therapeuticArea.delete({ where: { code } })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'therapeutic_area_deleted',
      entityType: 'therapeutic_area',
      entityId: code,
      details: { label: existing.label },
      ipAddress: request.ip ?? null,
    })

    return { ok: true }
  })
}
