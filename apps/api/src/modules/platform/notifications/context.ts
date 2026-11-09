// What a notification belongs to and who it came from, worked out when the feed is read — so notifications
// created before this existed show it too. Reads the ids already stored in each notification's payload.

import type { PrismaClient } from '@prisma/client'

export interface NotificationContext {
  projectId: string | null
  projectName: string | null
  documentId: string
  documentTitle: string
}
export interface NotificationActor { name: string; role: string }

const LETTER_ROLE: Record<string, string> = { R: 'Author', A: 'Approver', C: 'Reviewer', Q: 'QC', I: 'Informed' }
const PLATFORM_ROLE: Record<string, string> = {
  'tenant-admin': 'Tenant Admin', admin: 'Tenant Admin', pm: 'Project Manager', contributor: 'Contributor',
  auditor: 'Auditor', guest: 'Guest', 'super-admin': 'Super Admin',
}

type Row = { id: string; kind: string; payload: unknown }

const payloadOf = (r: Row): Record<string, unknown> =>
  r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : {}
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

export async function enrichNotifications<T extends Row>(
  prisma: PrismaClient,
  rows: ReadonlyArray<T>,
): Promise<Array<T & { context: NotificationContext | null; actor: NotificationActor | null }>> {
  // Which comment a mention is about -> who wrote it.
  const commentIds = [...new Set(rows.map(r => str(payloadOf(r).commentId)).filter((v): v is string => !!v))]
  const comments = commentIds.length === 0 ? [] : await prisma.comment.findMany({
    where: { id: { in: commentIds } }, select: { id: true, reviewerId: true },
  })
  const authorOfComment = new Map(comments.map(c => [c.id, c.reviewerId]))

  const actorIdOf = (r: Row): string | null => {
    const p = payloadOf(r)
    const commentId = str(p.commentId)
    return str(p.actorId) ?? str(p.nudgedBy) ?? str(p.startedBy) ?? str(p.returnedBy)
      ?? (commentId ? authorOfComment.get(commentId) ?? null : null)
  }

  const documentIds = [...new Set(rows.map(r => str(payloadOf(r).documentId)).filter((v): v is string => !!v))]
  const actorIds = [...new Set(rows.map(actorIdOf).filter((v): v is string => !!v && v !== 'system:guest'))]

  const [documents, users] = await Promise.all([
    documentIds.length === 0 ? [] : prisma.document.findMany({ where: { id: { in: documentIds } }, select: { id: true, title: true, projectId: true } }),
    actorIds.length === 0 ? [] : prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, role: true } }),
  ])
  const projectIds = [...new Set(documents.map(d => d.projectId))]
  const [projects, raci] = await Promise.all([
    projectIds.length === 0 ? [] : prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }),
    actorIds.length === 0 || documentIds.length === 0 ? [] : prisma.documentRaci.findMany({
      where: { documentId: { in: documentIds }, userId: { in: actorIds }, removedAt: null }, select: { documentId: true, userId: true, letter: true },
    }),
  ])
  const docById = new Map(documents.map(d => [d.id, d]))
  const projectName = new Map(projects.map(p => [p.id, p.name]))
  const userById = new Map(users.map(u => [u.id, u]))

  // The role shown after a name: what they are on this document (Author, Reviewer…), else their role in the app.
  const roleOf = (userId: string, documentId: string | null, platformRole: string): string => {
    const letters = documentId
      ? [...new Set(raci.filter(r => r.documentId === documentId && r.userId === userId).map(r => LETTER_ROLE[r.letter]).filter(Boolean))]
      : []
    if (letters.length > 0) return letters.join(' / ')
    return PLATFORM_ROLE[platformRole] ?? platformRole
  }

  return rows.map(r => {
    const documentId = str(payloadOf(r).documentId)
    const doc = documentId ? docById.get(documentId) : undefined
    const actorId = actorIdOf(r)
    const user = actorId ? userById.get(actorId) : undefined
    return {
      ...r,
      context: doc ? { projectId: doc.projectId, projectName: projectName.get(doc.projectId) ?? null, documentId: doc.id, documentTitle: doc.title } : null,
      actor: user ? { name: user.name, role: roleOf(user.id, documentId, user.role) } : null,
    }
  })
}
