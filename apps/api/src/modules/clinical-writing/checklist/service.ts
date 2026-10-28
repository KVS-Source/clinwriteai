// Checklist helpers shared between the per-document routes and the eager
// instance creation at document creation time.
//
// Historically a document's ChecklistInstance was lazy-bootstrapped on the
// first GET /checklist. Side effect: templates were created on read, and
// the duplicate "hyphen vs underscore" deliverable-type keys produced
// duplicate ChecklistTemplate rows. Both bugs are addressed here:
//   - normalizeDeliverableType collapses the two spellings to one canonical
//     form before any template lookup or template.create.
//   - ensureChecklistInstance is called synchronously from DocumentService
//     .create so new documents arrive with their instance already in place.

import type { PrismaClient } from '@prisma/client'

/**
 * Checklist templates were originally keyed off whatever string the client
 * sent in `document.type` — the frontend sent hyphenated ('csr-full'),
 * the seed converted to underscored ('csr_full'), and templates.ts mapped
 * both. The checklist lookup therefore produced orphan rows under both
 * spellings.
 *
 * Canonical form is underscored (matches the DB storage convention per
 * ADR 0001). Normalize on every write + lookup.
 */
export function normalizeDeliverableType(s: string): string {
  return s.replace(/-/g, '_')
}

type PrismaTxLike = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0] | PrismaClient

/**
 * Materialise a ChecklistInstance for `documentId` from the current master
 * template of its deliverable type. If no master template exists yet,
 * create an empty fallback template (versioned 1) so the instance always
 * has a template row to point at. Idempotent: a second call with the same
 * documentId returns the existing instance unchanged.
 *
 * Used by:
 *   - DocumentService.create (eager — new documents start with an instance)
 *   - checklistRoutes GET fallback (defensive — old documents without one)
 */
export async function ensureChecklistInstance(
  tx: PrismaTxLike,
  args: { documentId: string; deliverableType: string; actorId: string; projectId?: string },
) {
  const existing = await tx.checklistInstance.findUnique({
    where: { documentId: args.documentId },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  })
  if (existing) return existing

  const normalizedType = normalizeDeliverableType(args.deliverableType)

  // Resolve the project id from the Document row when the caller didn't
  // pass it (keeps the GET /checklist route working without threading
  // projectId through everywhere).
  let projectId = args.projectId
  if (!projectId) {
    const doc = await tx.document.findUnique({
      where: { id: args.documentId },
      select: { projectId: true },
    })
    projectId = doc?.projectId ?? undefined
  }

  // Preference order:
  //   1. the project's own approved override, if one exists
  //   2. the platform baseline (projectId=null, locked)
  //   3. any current template for the type (defensive, pre-migration DBs)
  const include = { items: { orderBy: { sortOrder: 'asc' as const } } }

  let template = projectId
    ? await tx.checklistTemplate.findFirst({
        where: { deliverableType: normalizedType, projectId, isCurrent: true, templateStatus: 'locked' },
        include,
      })
    : null

  if (!template) {
    template = await tx.checklistTemplate.findFirst({
      where: { deliverableType: normalizedType, projectId: null, isCurrent: true },
      include,
    })
  }

  if (!template) {
    template = await tx.checklistTemplate.findFirst({
      where: { deliverableType: normalizedType, isCurrent: true },
      include,
    })
  }

  if (!template) {
    const created = await tx.checklistTemplate.create({
      data: {
        deliverableType: normalizedType,
        version: 1,
        effectiveDate: new Date(),
        changeReason: 'Auto-created fallback for first document of this type',
        templateStatus: 'locked',                             // fallback behaves as a locked baseline
        createdBy: args.actorId,
      },
    })
    template = { ...created, items: [] }
  }

  return tx.checklistInstance.create({
    data: {
      documentId: args.documentId,
      templateId: template.id,
      templateVersion: template.version,
      items: template.items.length > 0
        ? {
            // Snapshot every ownership + staging field onto the instance so
            // a later template bump never retro-mutates this document.
            create: template.items.map(ti => ({
              templateItemId: ti.id,
              text: ti.text,
              framework: ti.framework,
              frameworkMandatory: ti.frameworkMandatory,
              ownerRaci: ti.ownerRaci,
              stage: ti.stage,
              autoCompleteOn: ti.autoCompleteOn,
              sortOrder: ti.sortOrder,
            })),
          }
        : undefined,
    },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  })
}

export interface ProjectChecklistSummary {
  totalDocuments: number
  documentsWithChecklist: number
  totalItems: number
  complete: number
  pending: number
  waived: number
  mandatoryPending: number
}

/**
 * Aggregate the checklist state across every document in a project. Pure
 * read — never materialises missing instances (unlike the per-document GET,
 * which lazy-bootstraps). Documents with no instance yet simply contribute
 * zeros, so visiting the home page is safe to run against every project.
 */
export async function computeProjectChecklistSummary(
  prisma: PrismaClient,
  projectId: string,
): Promise<ProjectChecklistSummary> {
  const docs = await prisma.document.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true },
  })
  const docIds = docs.map(d => d.id)

  if (docIds.length === 0) {
    return {
      totalDocuments: 0,
      documentsWithChecklist: 0,
      totalItems: 0,
      complete: 0,
      pending: 0,
      waived: 0,
      mandatoryPending: 0,
    }
  }

  const instances = await prisma.checklistInstance.findMany({
    where: { documentId: { in: docIds } },
    select: { id: true },
  })
  const instanceIds = instances.map(i => i.id)

  if (instanceIds.length === 0) {
    return {
      totalDocuments: docIds.length,
      documentsWithChecklist: 0,
      totalItems: 0,
      complete: 0,
      pending: 0,
      waived: 0,
      mandatoryPending: 0,
    }
  }

  const items = await prisma.checklistInstanceItem.findMany({
    where: { instanceId: { in: instanceIds } },
    select: { status: true, frameworkMandatory: true },
  })

  let complete = 0
  let pending = 0
  let waived = 0
  let mandatoryPending = 0

  for (const it of items) {
    if (it.status === 'complete') complete++
    else if (it.status === 'waived') waived++
    else {
      pending++
      if (it.frameworkMandatory) mandatoryPending++
    }
  }

  return {
    totalDocuments: docIds.length,
    documentsWithChecklist: instances.length,
    totalItems: items.length,
    complete,
    pending,
    waived,
    mandatoryPending,
  }
}
