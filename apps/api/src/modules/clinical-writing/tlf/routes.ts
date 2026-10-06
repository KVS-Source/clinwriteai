// TLF (Tables / Listings / Figures) routes — Module A reference tooling.
//
// Source: docs/demo/02-datamodel.md §12 + docs/demo/03-api-contract.md §11.
// A TLF package is a validated set of CSR deliverables (T/L/F) a project
// cites across its documents. One package per project is "current" at a
// time; prior versions remain queryable for audit. Section links record
// which doc section cites which item (used to compute referenceCount for
// the §11 /documents/:documentId/tlf endpoint).
//
// Mixed path shapes (project-scoped, package-scoped, item-scoped, and
// document-scoped) are all defined here and registered at root — the
// handlers use full paths. Same pattern as peer-review + crm.

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../../../auth/rbac.js'

const createPackageSchema = z.object({
  version: z.string().min(1).max(32),
  validatedBy: z.string().min(1),
  validatedAt: z.string().datetime(),
  items: z.array(z.object({
    itemType: z.enum(['T', 'L', 'F']),
    referenceId: z.string().min(1),
    title: z.string().min(1),
    sortOrder: z.number().int().optional(),
  })).default([]),
})

const addItemSchema = z.object({
  itemType: z.enum(['T', 'L', 'F']),
  referenceId: z.string().min(1),
  title: z.string().min(1),
  sortOrder: z.number().int().optional(),
})

const linkSectionSchema = z.object({
  documentId: z.string().min(1),
  sectionRef: z.string().min(1),
  referenceCount: z.number().int().positive().default(1),
})

export const tlfRoutes: FastifyPluginAsync = async (app) => {
  // --- Package CRUD (project-scoped) --------------------------------------

  app.get('/projects/:projectId/tlf-packages', { preHandler: requireAuth({ modules: ['A'] }) }, async (request) => {
    const { projectId } = request.params as { projectId: string }
    return app.prisma.tlfPackage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    })
  })

  app.post('/projects/:projectId/tlf-packages', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const parsed = createPackageSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    // Unique(projectId, version) — explicit check for a friendlier 409.
    const dup = await app.prisma.tlfPackage.findUnique({
      where: { projectId_version: { projectId, version: parsed.data.version } },
    })
    if (dup) {
      return reply.code(409).send({ error: 'version_exists', message: `Package version ${parsed.data.version} already exists for project` })
    }

    const created = await app.prisma.$transaction(async (tx) => {
      // Demote any current package — only one isCurrent per project.
      await tx.tlfPackage.updateMany({
        where: { projectId, isCurrent: true },
        data: { isCurrent: false },
      })
      const pkg = await tx.tlfPackage.create({
        data: {
          projectId,
          version: parsed.data.version,
          validatedBy: parsed.data.validatedBy,
          validatedAt: new Date(parsed.data.validatedAt),
          isCurrent: true,
        },
      })
      if (parsed.data.items.length > 0) {
        await tx.tlfItem.createMany({
          data: parsed.data.items.map((it, idx) => ({
            packageId: pkg.id,
            itemType: it.itemType,
            referenceId: it.referenceId,
            title: it.title,
            sortOrder: it.sortOrder ?? idx,
          })),
        })
      }
      return pkg
    })

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: request.user!.id,
      action: 'tlf_package_validated',
      entityType: 'project',
      entityId: projectId,
      details: {
        packageId: created.id,
        version: created.version,
        itemCount: parsed.data.items.length,
      },
      ipAddress: request.ip ?? null,
    })

    return reply.code(201).send(created)
  })

  app.get('/tlf-packages/:packageId', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { packageId } = request.params as { packageId: string }
    const pkg = await app.prisma.tlfPackage.findUnique({
      where: { id: packageId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })
    if (!pkg) return reply.code(404).send({ error: 'not_found' })
    return pkg
  })

  // --- Item CRUD ----------------------------------------------------------

  app.post('/tlf-packages/:packageId/items', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { packageId } = request.params as { packageId: string }
    const parsed = addItemSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const pkg = await app.prisma.tlfPackage.findUnique({ where: { id: packageId } })
    if (!pkg) return reply.code(404).send({ error: 'not_found' })

    // Unique(packageId, referenceId) — explicit check for a friendlier 409.
    const dup = await app.prisma.tlfItem.findUnique({
      where: { packageId_referenceId: { packageId, referenceId: parsed.data.referenceId } },
    })
    if (dup) {
      return reply.code(409).send({ error: 'reference_exists', message: `${parsed.data.referenceId} already in package` })
    }

    const created = await app.prisma.tlfItem.create({
      data: {
        packageId,
        itemType: parsed.data.itemType,
        referenceId: parsed.data.referenceId,
        title: parsed.data.title,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
    })
    return reply.code(201).send(created)
  })

  // --- Section links ------------------------------------------------------

  app.post('/tlf-items/:itemId/section-links', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { itemId } = request.params as { itemId: string }
    const parsed = linkSectionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'validation', issues: parsed.error.issues })

    const item = await app.prisma.tlfItem.findUnique({ where: { id: itemId } })
    if (!item) return reply.code(404).send({ error: 'not_found' })

    // Upsert — repeated POST increments referenceCount if desired.
    const link = await app.prisma.tlfSectionLink.upsert({
      where: {
        tlfItemId_documentId_sectionRef: {
          tlfItemId: itemId,
          documentId: parsed.data.documentId,
          sectionRef: parsed.data.sectionRef,
        },
      },
      create: {
        tlfItemId: itemId,
        documentId: parsed.data.documentId,
        sectionRef: parsed.data.sectionRef,
        referenceCount: parsed.data.referenceCount,
      },
      update: { referenceCount: parsed.data.referenceCount },
    })
    return reply.code(201).send(link)
  })

  // --- Document-scoped TLF read (03-api-contract.md §11) -----------------

  app.get('/documents/:documentId/tlf', { preHandler: requireAuth({ modules: ['A'] }) }, async (request, reply) => {
    const { documentId } = request.params as { documentId: string }
    const doc = await app.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return reply.code(404).send({ error: 'not_found' })

    const pkg = await app.prisma.tlfPackage.findFirst({
      where: { projectId: doc.projectId, isCurrent: true },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })
    if (!pkg) {
      return reply.code(404).send({ error: 'no_current_package', message: 'Project has no current TLF package' })
    }

    // Reference counts come from section_links on this specific document.
    // One query, grouped — avoids N+1.
    const links = await app.prisma.tlfSectionLink.findMany({
      where: {
        documentId,
        tlfItemId: { in: pkg.items.map(i => i.id) },
      },
    })
    const refCountByItem = new Map<string, number>()
    for (const l of links) {
      refCountByItem.set(l.tlfItemId, (refCountByItem.get(l.tlfItemId) ?? 0) + l.referenceCount)
    }

    // UI's packages/types TLFItem interface:
    //   type (not itemType), id, title, linkedSections[], referenceCount?
    // linkedSections is the list of sectionRefs that cite this item on
    // THIS document — grouped per-item below.
    const sectionsByItem = new Map<string, string[]>()
    for (const l of links) {
      const arr = sectionsByItem.get(l.tlfItemId) ?? []
      if (!arr.includes(l.sectionRef)) arr.push(l.sectionRef)
      sectionsByItem.set(l.tlfItemId, arr)
    }

    return {
      package: {
        version: pkg.version,
        validatedBy: pkg.validatedBy,
        validatedDate: pkg.validatedAt.toISOString(),
      },
      items: pkg.items.map(it => ({
        type: it.itemType,
        id: it.referenceId,          // UI uses the human-readable ref as its id
        title: it.title,
        linkedSections: sectionsByItem.get(it.id) ?? [],
        referenceCount: refCountByItem.get(it.id) ?? 0,
      })),
    }
  })
}
