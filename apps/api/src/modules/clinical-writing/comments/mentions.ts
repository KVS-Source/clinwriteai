import type { PrismaClient } from '@prisma/client'

// @mentions in comments: who can be mentioned, and what the mentioned person is told.

export interface MentionableUser { id: string; name: string; initials: string | null; projectRole: string | null }

// People involved in the document's project — its active members, plus anyone holding a
// RACI role on the document — who are active users, without the person writing the comment.
export async function mentionableUsers(
  prisma: PrismaClient,
  doc: { id: string; projectId: string },
  actorId: string,
): Promise<MentionableUser[]> {
  const [members, raci] = await Promise.all([
    prisma.projectMember.findMany({ where: { projectId: doc.projectId, removedAt: null }, select: { userId: true, projectRole: true } }),
    prisma.documentRaci.findMany({ where: { documentId: doc.id, removedAt: null }, select: { userId: true } }),
  ])
  const roles = new Map(members.map(m => [m.userId, m.projectRole]))
  const ids = [...new Set([...members.map(m => m.userId), ...raci.map(r => r.userId)])].filter(id => id !== actorId)
  if (ids.length === 0) return []
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, status: 'active' },
    select: { id: true, name: true, initials: true },
    orderBy: { name: 'asc' },
  })
  return users.map(u => ({ id: u.id, name: u.name, initials: u.initials, projectRole: roles.get(u.id) ?? null }))
}

const EXCERPT_MAX = 140
const excerpt = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_MAX ? `${flat.slice(0, EXCERPT_MAX - 1)}…` : flat
}

export function mentionNotification(args: {
  authorName: string
  documentTitle: string
  documentId: string
  projectId: string
  commentId: string
  sectionRef: string
  text: string
}) {
  return {
    kind: 'comment.mention',
    title: `${args.authorName} mentioned you in a comment`,
    body: `${args.documentTitle} · ${args.sectionRef}: ${excerpt(args.text)}`,
    linkPath: `/projects/${args.projectId}/clinical-writing/documents/${args.documentId}`,
    payload: { documentId: args.documentId, projectId: args.projectId, commentId: args.commentId, sectionRef: args.sectionRef },
  }
}
