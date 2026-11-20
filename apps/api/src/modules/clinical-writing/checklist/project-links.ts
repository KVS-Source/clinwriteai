// One checklist template, many projects. A project checklist's rows carry their owning project in
// ChecklistTemplate.projectId (so its versions keep one sequence); checklist_template_project_links says which
// projects use it, the owner included. A project uses at most one checklist per document type, and a project
// with no link uses the platform baseline. See migration 0098.

import type { PrismaClient } from '@prisma/client'
// Same as normalizeDeliverableType in service.ts (which imports template-update.ts, which imports this file).
const normalizeDeliverableType = (s: string) => s.replace(/-/g, '_')

type PrismaTxLike = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0] | PrismaClient

// The real client always has the table; hand-rolled test doubles of the older routes don't, and there "no links"
// is the right answer (every project uses its own override or the baseline, as before migration 0098).
const links = (tx: PrismaTxLike) => (tx as Partial<PrismaClient>).checklistTemplateProjectLink

/** The owner of the project checklist this project uses for the type; the project itself when it has no link. */
export async function checklistOwnerFor(tx: PrismaTxLike, deliverableType: string, projectId: string): Promise<string> {
  const link = await links(tx)?.findUnique({
    where: { deliverableType_projectId: { deliverableType: normalizeDeliverableType(deliverableType), projectId } },
    select: { ownerProjectId: true },
  })
  return link?.ownerProjectId ?? projectId
}

/** Every project that uses the project checklist owned by `ownerProjectId` (the owner first). */
export async function projectsUsingChecklist(tx: PrismaTxLike, deliverableType: string, ownerProjectId: string): Promise<string[]> {
  const rows = await links(tx)?.findMany({
    where: { deliverableType: normalizeDeliverableType(deliverableType), ownerProjectId },
    select: { projectId: true },
    orderBy: { createdAt: 'asc' },
  }) ?? []
  return [ownerProjectId, ...rows.map(l => l.projectId).filter(p => p !== ownerProjectId)]
}

/** For the list screen: `${type}|${owner}` → the projects that use that checklist. */
export async function checklistProjectMap(prisma: PrismaTxLike): Promise<Map<string, string[]>> {
  const rows = await links(prisma)?.findMany({
    select: { deliverableType: true, projectId: true, ownerProjectId: true },
    orderBy: { createdAt: 'asc' },
  }) ?? []
  const map = new Map<string, string[]>()
  for (const l of rows) {
    const key = `${l.deliverableType}|${l.ownerProjectId}`
    map.set(key, [...(map.get(key) ?? []), l.projectId])
  }
  return map
}
