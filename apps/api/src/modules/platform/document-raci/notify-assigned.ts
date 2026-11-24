// Tell someone they were put on a document: assigned as its Author when a PM creates it for them, or given a
// RACI letter (Author, Reviewer, Approver, QC, Informed). One kind, `document.raci_assigned`, with the role in
// the text. Never throws: the assignment is already saved, so a failed notification must not fail it.
//
// Not sent to yourself (assigning your own role is not news to you), nor when the notification service is not
// running (tests, minimal setups).

import type { FastifyInstance } from 'fastify'

export const RACI_ASSIGNED_KIND = 'document.raci_assigned'

const ROLE_LABEL: Record<string, string> = { R: 'Author', C: 'Reviewer', A: 'Approver', Q: 'QC reviewer', I: 'Informed' }

const ROLE_BODY: Record<string, string> = {
  R: 'Open the document to start writing.',
  C: 'You will review it once the author submits it for review.',
  A: 'You can read it now. You approve and sign it once it is awaiting signature.',
  Q: 'You will review it for quality once the author submits it.',
  I: 'You will be kept informed as it progresses.',
}

export async function notifyRaciAssigned(app: FastifyInstance, args: {
  recipientId: string
  actorId: string
  documentId: string
  letter: string
  /** The document was just created for the recipient (a PM chose them as its author). */
  newDocument?: boolean
  sectionId?: string | null
  /** Already known by the caller; looked up when omitted. */
  doc?: { title: string; projectId: string; status?: string | null }
}): Promise<void> {
  if (args.recipientId === args.actorId) return
  if (!app.hasDecorator('notifications')) return
  try {
    const doc = args.doc ?? await app.prisma.document.findUnique({
      where:  { id: args.documentId },
      select: { title: true, projectId: true, status: true },
    })
    if (!doc) return
    const actor = await app.prisma.user.findUnique({ where: { id: args.actorId }, select: { name: true } })
    const role  = ROLE_LABEL[args.letter] ?? args.letter
    const base  = `/projects/${doc.projectId}/clinical-writing/documents/${args.documentId}`
    const linkPath = args.letter === 'C' || args.letter === 'Q' || args.letter === 'A' ? `${base}/review` : base
    await app.notifications.send({
      recipientId: args.recipientId,
      kind:        RACI_ASSIGNED_KIND,
      severity:    'info',
      title:       args.newDocument
        ? `New document assigned to you: "${doc.title}"`
        : `You've been assigned as ${role} on "${doc.title}"`,
      body:        `${args.newDocument ? 'You are the Author. ' : ''}${ROLE_BODY[args.letter] ?? ''}${actor?.name ? ` Assigned by ${actor.name}.` : ''}`.trim(),
      linkPath,
      payload:     { documentId: args.documentId, projectId: doc.projectId, letter: args.letter, sectionId: args.sectionId ?? null, assignedBy: args.actorId, newDocument: !!args.newDocument },
    })
  } catch (err) {
    app.log.warn({ err, documentId: args.documentId, recipientId: args.recipientId }, 'raci_assigned notification failed')
  }
}
