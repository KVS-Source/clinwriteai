// A closed project is read-only whatever the document's status (PRD: "Closed is a
// hard, unoverridable read-only state"). Only a PM's Re-open gets it out of there.
// Same 423 body the references and source routes answer with.

import type { PrismaClient } from '@prisma/client'

export const PROJECT_CLOSED = {
  error: 'document_locked',
  status: 'project_closed',
  message: 'The project is closed and read-only.',
} as const

export async function projectIsClosed(prisma: PrismaClient, projectId: string): Promise<boolean> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { status: true } })
  return project?.status === 'closed'
}

/** Whether the document's project is closed. An unknown document isn't; the route's own lookup 404s. */
export async function documentProjectIsClosed(prisma: PrismaClient, documentId: string): Promise<boolean> {
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { projectId: true } })
  return doc?.projectId ? projectIsClosed(prisma, doc.projectId) : false
}
