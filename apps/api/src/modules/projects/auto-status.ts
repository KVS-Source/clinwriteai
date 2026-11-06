// A project moves from Initiated to Ongoing by itself when authoring starts: the first saved edit in any
// of its documents, or a document leaving Not Started some other way (submitted without an earlier edit,
// or moved on by hand).
//
// Only that one move. A project on hold, closed or re-opened is someone's decision, so the condition on
// the update leaves it alone; nothing ever goes back to Initiated, so this happens once per project, and
// two saves at the same moment can't both record it.

import type { FastifyInstance } from 'fastify'
import { PROJECT_STATE_CHANGED } from './state-machine.js'

/** How an automatic move came about. Status history words each one in the reader's language. */
export type AutomaticStatusTrigger = 'authoring_started' | 'work_already_started'

export const documentLabel = (doc: { title?: string | null; type?: string | null }) => doc.title?.trim() || doc.type || 'a document'

/** The audit details of an automatic move. The reason is for anyone reading the raw audit trail. */
export function automaticMoveDetails(trigger: AutomaticStatusTrigger, document: string) {
  const why = trigger === 'authoring_started' ? 'authoring started on' : 'work had already started on'
  return {
    from: 'initiated',
    to: 'ongoing',
    reason: `Automatically moved to Ongoing: ${why} ${document}`,
    automatic: trigger,
    document,
  }
}

/**
 * Call after a document's content really changed, or it left Not Started. Never throws: the author's work
 * is already saved, and a status that didn't move is not worth failing that save over.
 */
export async function noteAuthoringStarted(
  app: FastifyInstance,
  args: { documentId: string; actorId: string; ipAddress?: string | null },
): Promise<void> {
  try {
    const doc = await app.prisma.document.findUnique({
      where: { id: args.documentId },
      select: { projectId: true, title: true, type: true },
    })
    if (!doc?.projectId) return

    const moved = await app.prisma.project.updateMany({
      where: { id: doc.projectId, status: 'initiated' },
      data: { status: 'ongoing' },
    })
    if (moved.count === 0) return

    await app.audit.append({
      timestamp: new Date().toISOString(),
      actorId: args.actorId,
      action: PROJECT_STATE_CHANGED,
      entityType: 'project',
      entityId: doc.projectId,
      details: { ...automaticMoveDetails('authoring_started', documentLabel(doc)), documentId: args.documentId },
      ipAddress: args.ipAddress ?? null,
    })
  } catch (err) {
    app.log.error({ err, documentId: args.documentId }, 'Could not move the project to Ongoing automatically')
  }
}
