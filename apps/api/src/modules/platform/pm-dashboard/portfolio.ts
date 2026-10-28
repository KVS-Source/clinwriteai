// Portfolio dashboard — cross-project PM view.
//
// Design: docs/roles-and-permissions.md §5.4 "cross-project dashboards".
// Distinct from the per-project pm-dashboard: this one rolls up every
// project the actor can see.
//
// Visibility rules:
//   - admin  → every project in the tenant.
//   - pm     → projects they're an active ProjectMember of.
//   - other  → their active ProjectMember projects (same mechanic;
//              a contributor sees their own project list).
//
// Route (prefix /dashboards):
//   GET /portfolio
//
// Response:
//   {
//     projects: [{
//       id, name, status, memberCount,
//       documentCount, overdueCount,
//       byStatus: { in_authoring: 3, in_review: 2, ... }
//     }],
//     totals: { projects, documents, overdueDocuments, members }
//   }

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../../auth/rbac.js'

export const portfolioDashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/portfolio', { preHandler: requireAuth() }, async (request) => {
    const actor = request.user!
    const isAdmin = actor.role === 'tenant-admin' || actor.role === 'admin'

    // Resolve the set of project ids the actor can see.
    let projectIds: string[] = []
    if (isAdmin) {
      const where = actor.tenantId ? { tenantId: actor.tenantId } : {}
      const rows = await app.prisma.project.findMany({ where, select: { id: true } })
      projectIds = rows.map(p => p.id)
    } else {
      const memberships = await app.prisma.projectMember.findMany({
        where: { userId: actor.id, removedAt: null },
        select: { projectId: true },
      })
      projectIds = Array.from(new Set(memberships.map(m => m.projectId)))
    }

    if (projectIds.length === 0) {
      return {
        projects: [],
        totals: { projects: 0, documents: 0, overdueDocuments: 0, members: 0 },
        generatedAt: new Date().toISOString(),
      }
    }

    // One query batch, parallelised:
    //   - project rows (name/status)
    //   - active members, grouped by project
    //   - documents (not deleted), grouped by project + status
    //   - documents (not deleted) with targetCompletionDate < now, grouped by project
    const now = new Date()
    const [projects, memberGroups, docGroups, overdueGroups] = await Promise.all([
      app.prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true, status: true },
        orderBy: { name: 'asc' },
      }),
      app.prisma.projectMember.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, removedAt: null },
        _count: { _all: true },
      }),
      app.prisma.document.groupBy({
        by: ['projectId', 'status'],
        where: { projectId: { in: projectIds }, deletedAt: null },
        _count: { _all: true },
      }),
      app.prisma.document.groupBy({
        by: ['projectId'],
        where: {
          projectId: { in: projectIds },
          deletedAt: null,
          status: { not: 'signed' },
          targetCompletionDate: { lt: now, not: null },
        },
        _count: { _all: true },
      }),
    ])

    // Reduce into per-project rollup.
    const membersByProject = new Map<string, number>()
    for (const g of memberGroups) membersByProject.set(g.projectId, g._count._all)

    const overdueByProject = new Map<string, number>()
    for (const g of overdueGroups) overdueByProject.set(g.projectId, g._count._all)

    const byStatusByProject = new Map<string, Record<string, number>>()
    const docCountByProject = new Map<string, number>()
    for (const g of docGroups) {
      const sheet = byStatusByProject.get(g.projectId) ?? {}
      sheet[g.status] = g._count._all
      byStatusByProject.set(g.projectId, sheet)
      docCountByProject.set(g.projectId, (docCountByProject.get(g.projectId) ?? 0) + g._count._all)
    }

    const projectRows = projects.map(p => ({
      id: p.id,
      name: p.name,
      status: p.status,
      memberCount: membersByProject.get(p.id) ?? 0,
      documentCount: docCountByProject.get(p.id) ?? 0,
      overdueCount: overdueByProject.get(p.id) ?? 0,
      byStatus: byStatusByProject.get(p.id) ?? {},
    }))

    const totals = projectRows.reduce(
      (acc, p) => ({
        projects: acc.projects + 1,
        documents: acc.documents + p.documentCount,
        overdueDocuments: acc.overdueDocuments + p.overdueCount,
        members: acc.members + p.memberCount,
      }),
      { projects: 0, documents: 0, overdueDocuments: 0, members: 0 },
    )

    return {
      projects: projectRows,
      totals,
      generatedAt: new Date().toISOString(),
    }
  })
}
