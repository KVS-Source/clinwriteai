// Sending a document back to In authoring, and the "has everyone finished?" checks that decide when.
//
// Reviewers (C) in review and Approvers (A) while the document awaits signature are each a group. A person's
// return is recorded when they make it; the document goes back only once every person in the group has
// finished: Reviewers by marking their review done or returning the document, Approvers by approving
// (signing) or returning it. One return among otherwise-approving people still sends it back, after everyone
// is done. Nobody else's work is cut short before that.

import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { DocumentService } from '../../clinical-writing/documents/service.js'
import type { DocumentStatus } from '../../clinical-writing/document-status.js'
import { resetRaciRound } from './access.js'

/** Who still has to finish, who returned the document, and whether everybody has finished. */
export interface RoundState {
  waiting:  Array<{ id: string; userId: string; sectionId: string | null }>
  rejected: Array<{ id: string; userId: string; sectionId: string | null; rejectionNote: string | null }>
  allIn:    boolean
}

/** Reviewers (C): finished = marked their review done, or returned the document. */
export async function reviewRoundState(prisma: PrismaClient, documentId: string): Promise<RoundState> {
  const cohort = await prisma.documentRaci.findMany({
    where:  { documentId, letter: 'C', removedAt: null },
    select: { id: true, userId: true, sectionId: true, reviewedAt: true, rejectedAt: true, rejectionNote: true },
  })
  const waiting  = cohort.filter(r => !r.reviewedAt && !r.rejectedAt)
  const rejected = cohort.filter(r => !!r.rejectedAt)
  return { waiting, rejected, allIn: cohort.length > 0 && waiting.length === 0 }
}

/** Approvers (A): finished = approved and signed (documentApprovedAt), or returned the document. */
export async function approvalRoundState(prisma: PrismaClient, documentId: string): Promise<RoundState> {
  const cohort = await prisma.documentRaci.findMany({
    where:  { documentId, letter: 'A', removedAt: null },
    select: { id: true, userId: true, sectionId: true, documentApprovedAt: true, rejectedAt: true, rejectionNote: true },
  })
  const waiting  = cohort.filter(r => !r.documentApprovedAt && !r.rejectedAt)
  const rejected = cohort.filter(r => !!r.rejectedAt)
  return { waiting, rejected, allIn: cohort.length > 0 && waiting.length === 0 }
}

/**
 * Sends the document back to In authoring in one go: cancels any open signature chain, takes a version
 * snapshot, starts a new round (resetRaciRound) and tells the authors. Used when QC returns it, and when the
 * Reviewers or the Approvers have all finished and at least one of them returned it.
 */
export async function bounceToAuthoring(app: FastifyInstance, svc: DocumentService, a: {
  documentId: string
  from: DocumentStatus
  actorId: string
  ip: string | null
  returnedBy: { raciId: string; userId: string; letter: string; sectionId: string | null }
  note: string
  doc: { title: string; projectId: string; assigneeId: string } | null
}) {
  const { documentId, from, note, doc } = a
  const now = new Date()
  await app.prisma.document.update({ where: { id: documentId }, data: { status: 'in_authoring' } })
  const cancelledChains = await app.prisma.signatureChain.updateMany({
    where: { documentId, status: { in: ['initiated', 'in_progress'] } },
    data:  { status: 'cancelled', cancelledAt: now, cancelReason: `Returned to authoring: ${note}` },
  })
  const reason = from === 'in_review' ? 'review_bounce' : from === 'crm_in_progress' ? 'crm_bounce' : 'signature_bounce'
  const snap = await svc.createVersionSnapshot({ documentId, createdBy: a.returnedBy.userId, reason, note })
  await resetRaciRound(app.prisma, documentId)
  const updated = await app.prisma.documentRaci.update({ where: { id: a.returnedBy.raciId }, data: { rejectionNote: note } })

  await app.audit.append({
    timestamp: now.toISOString(),
    actorId: a.actorId,
    action: 'document_raci.rejected',
    entityType: 'document_raci',
    entityId: a.returnedBy.raciId,
    details: { documentId, letter: a.returnedBy.letter, sectionId: a.returnedBy.sectionId, note },
    ipAddress: a.ip,
  })
  await app.audit.append({
    timestamp: now.toISOString(),
    actorId: a.actorId,
    action: 'document_status_changed',
    entityType: 'document',
    entityId: documentId,
    details: {
      from, to: 'in_authoring', trigger: 'raci_reject', raciId: a.returnedBy.raciId, letter: a.returnedBy.letter, note,
      snapshotVersionId: snap.version.id, snapshotVersionNumber: snap.version.versionNumber,
      cancelledSignatureChains: cancelledChains.count,
    },
    ipAddress: a.ip,
  })

  // Tell the authors: every active R, or the assignee on a document with no R rows yet.
  // The return is already saved, so a failed notification must not fail it.
  if (doc && app.hasDecorator('notifications')) {
    try {
      const authorRows = await app.prisma.documentRaci.findMany({
        where:  { documentId, letter: 'R', removedAt: null },
        select: { userId: true },
      })
      const authorIds = authorRows.length > 0 ? authorRows.map(r => r.userId) : [doc.assigneeId]
      const recipients = [...new Set(authorIds)].filter(id => id !== a.returnedBy.userId)
      if (recipients.length > 0) {
        const returnedBy = await app.prisma.user.findUnique({ where: { id: a.returnedBy.userId }, select: { name: true } })
        const reasonText = note.length > 200 ? `${note.slice(0, 200)}…` : note
        for (const recipientId of recipients) {
          try {
            await app.notifications.send({
              recipientId,
              kind:     'document.returned_to_authoring',
              severity: 'warning',
              title:    `${returnedBy?.name ?? 'A colleague'} returned "${doc.title}" to authoring`,
              body:     `Now ${snap.version.versionNumber}. Reason: ${reasonText}`,
              linkPath: `/projects/${doc.projectId}/clinical-writing/documents/${documentId}`,
              payload:  { documentId, projectId: doc.projectId, versionNumber: snap.version.versionNumber, letter: a.returnedBy.letter, returnedBy: a.returnedBy.userId },
            })
          } catch (err) {
            app.log.warn({ err, documentId, recipientId }, 'returned_to_authoring notification failed')
          }
        }
      }
    } catch (err) {
      app.log.warn({ err, documentId }, 'returned_to_authoring notifications failed')
    }
  }

  return { row: updated, snap }
}
