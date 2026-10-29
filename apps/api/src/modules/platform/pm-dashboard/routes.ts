// PM dashboard — per-project rollup aimed at the PM role.
//
// Distinct from /reports/projects/:projectId/dashboard (cross-module
// status counts); this one is RACI-aware and surfaces the fields the PM
// actually acts on — team members, per-document cohort progress,
// overdue docs, bottleneck users.
//
// Route (prefix /projects):
//   GET /:projectId/pm-dashboard

import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../../../auth/rbac.js'
import { visibleProjectIdsForUser } from '../../projects/visibility.js'
import { evaluateStageTransition, type RaciRowForEval } from '../document-raci/transition-engine.js'
import type { DocumentStatus } from '../../clinical-writing/document-status.js'

interface MemberRow {
  id: string
  userId: string
  projectRole: string | null
  addedAt: Date
}

interface DocumentRow {
  id: string
  title: string
  type: string
  status: string
  assigneeId: string
  targetCompletionDate: Date | null
}

export const pmDashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:projectId/pm-dashboard', { preHandler: requireAuth() }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string }

    // Project visibility — PMs/contributors can only see dashboards for
    // projects they belong to. Return 404 (not 403) so the id doesn't leak.
    const visible = await visibleProjectIdsForUser(app.prisma, request.user!)
    if (visible !== 'all' && !visible.has(projectId)) {
      return reply.code(404).send({ error: 'project_not_found' })
    }

    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, status: true },
    })
    if (!project) return reply.code(404).send({ error: 'project_not_found' })

    // Three queries, parallelised. Membership + documents + RACI rows cover
    // everything we aggregate; the per-document cohort evaluation then runs
    // in-process.
    const [members, documents, raciRows] = await Promise.all([
      app.prisma.projectMember.findMany({
        where: { projectId, removedAt: null },
        select: { id: true, userId: true, projectRole: true, addedAt: true },
        orderBy: { addedAt: 'asc' },
      }) as Promise<MemberRow[]>,
      app.prisma.document.findMany({
        where: { projectId, deletedAt: null },
        select: {
          id: true, title: true, type: true, status: true,
          assigneeId: true, targetCompletionDate: true,
        },
        orderBy: { updatedAt: 'desc' },
      }) as Promise<DocumentRow[]>,
      app.prisma.documentRaci.findMany({
        where: { document: { projectId } },
        select: {
          documentId: true, letter: true, userId: true,
          signatureRequired: true,
          submittedAt: true, reviewedAt: true, approvedAt: true,
          signatureId: true, rejectedAt: true, removedAt: true,
        },
      }),
    ])

    // Group RACI rows by document for the transition evaluator.
    const rowsByDoc = new Map<string, RaciRowForEval[]>()
    for (const r of raciRows) {
      const arr = rowsByDoc.get(r.documentId) ?? []
      arr.push(r as RaciRowForEval)
      rowsByDoc.set(r.documentId, arr)
    }

    // Bottleneck tally: count unfinished rows per user across the project.
    // "Unfinished" = active (removedAt null) + no completion timestamp for
    // their letter + not rejected. Reveals the "medical approver sitting
    // on 12 docs" case the PM wants to see.
    const pendingByUser = new Map<string, number>()
    const now = new Date()
    for (const r of raciRows) {
      if (r.removedAt !== null) continue
      if (r.rejectedAt !== null) continue
      const isPending =
        (r.letter === 'R' && r.submittedAt === null) ||
        (r.letter === 'C' && r.reviewedAt === null) ||
        (r.letter === 'A' && r.approvedAt === null)
      if (!isPending) continue
      pendingByUser.set(r.userId, (pendingByUser.get(r.userId) ?? 0) + 1)
    }
    const bottlenecks = Array.from(pendingByUser.entries())
      .map(([userId, pendingCount]) => ({ userId, pendingCount }))
      .sort((a, b) => b.pendingCount - a.pendingCount)
      .slice(0, 10)

    // Per-document view: evaluate the cohort + flag overdue.
    const documentsWithRaci = documents.map(d => {
      const evalResult = evaluateStageTransition(
        d.status as DocumentStatus,
        rowsByDoc.get(d.id) ?? [],
      )
      const isOverdue =
        d.targetCompletionDate !== null &&
        d.targetCompletionDate < now &&
        d.status !== 'signed'
      return {
        id: d.id,
        title: d.title,
        type: d.type,
        status: d.status,
        assigneeId: d.assigneeId,
        targetCompletionDate: d.targetCompletionDate?.toISOString() ?? null,
        isOverdue,
        raciProgress: {
          gatingLetter: evalResult.gatingLetter,
          nextStatus: evalResult.nextStatus,
          cohortDone: evalResult.cohortDone,
          cohortTotal: evalResult.cohortTotal,
          cohortComplete: evalResult.cohortComplete,
          rejectedRows: evalResult.rejectedRows,
        },
      }
    })

    // Summary counts.
    const byStatus: Record<string, number> = {}
    let overdueCount = 0
    for (const d of documentsWithRaci) {
      byStatus[d.status] = (byStatus[d.status] ?? 0) + 1
      if (d.isOverdue) overdueCount++
    }

    return {
      project,
      members: members.map(m => ({
        id: m.id,
        userId: m.userId,
        projectRole: m.projectRole,
        addedAt: m.addedAt.toISOString(),
      })),
      documents: documentsWithRaci,
      summary: {
        totalDocuments: documents.length,
        byStatus,
        overdueCount,
        activeMembers: members.length,
      },
      bottlenecks,
      generatedAt: new Date().toISOString(),
    }
  })
}
