// Fires the autoCompleteOn trigger on ChecklistInstanceItem rows that match
// a real system event. Called from:
//   - /submit-for-review (and /transition when to=in_review)   → 'submit_for_review'
//   - /crm/:meetingId/complete                                  → 'crm_complete'
//   - /signature-records/:id/sign  (when the chain terminates)  → 'document_signed'
//
// Marks every pending item on `documentId` with matching autoCompleteOn as
// Complete, stamps actorId + now, and emits one audit event per item so
// Part 11 reviewers can reconstruct who-ticked-what-when. Non-pending items
// (already complete or waived) are left untouched — triggers are idempotent
// against prior ticks.

import type { PrismaClient } from '@prisma/client'

// Shape-compatible with AuditRepository.append — accepts the parameters we
// need and ignores the real return value (it hands back { id, rowHash } for
// hash-chain callers; auto-complete just fires-and-moves-on).
type AuditAppender = {
  append(entry: {
    timestamp: string
    actorId: string
    action: string
    entityType: string
    entityId: string
    details: Record<string, unknown>
    ipAddress: string | null
  }): Promise<unknown>
}

export type AutoCompleteTrigger =
  | 'submit_for_review'
  | 'crm_complete'
  | 'document_signed'

export interface AutoCompleteReport {
  trigger: AutoCompleteTrigger
  documentId: string
  completedCount: number
  itemIds: string[]
}

/**
 * Find pending mandatory items on `documentId` whose autoCompleteOn matches
 * `trigger`, mark them complete, and audit each. Idempotent — running the
 * trigger again on an already-complete item is a no-op.
 *
 * Pass `app.audit` as `audit` so this helper never has to know how the
 * audit plugin is decorated.
 */
export async function fireAutoComplete(
  prisma: PrismaClient,
  audit: AuditAppender,
  args: {
    trigger: AutoCompleteTrigger
    documentId: string
    actorId: string
    ipAddress: string | null
  },
): Promise<AutoCompleteReport> {
  const rows = await prisma.checklistInstanceItem.findMany({
    where: {
      instance: { documentId: args.documentId },
      autoCompleteOn: args.trigger,
      status: 'pending',
    },
    select: { id: true, text: true, framework: true, stage: true, ownerRaci: true },
  })

  if (rows.length === 0) {
    return { trigger: args.trigger, documentId: args.documentId, completedCount: 0, itemIds: [] }
  }

  const now = new Date()
  // Bulk-update inside a transaction so partial failure doesn't leave the
  // ticks half-applied. updateMany mirrors the per-row completedBy stamp.
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      await tx.checklistInstanceItem.update({
        where: { id: r.id },
        data: { status: 'complete', completedBy: args.actorId, completedAt: now },
      })
    }
  })

  // One audit event per item — matches the manual tick's granularity.
  for (const r of rows) {
    await audit.append({
      timestamp: now.toISOString(),
      actorId: args.actorId,
      action: 'checklist_item_auto_completed',
      entityType: 'document',
      entityId: args.documentId,
      details: {
        itemId: r.id,
        trigger: args.trigger,
        framework: r.framework,
        stage: r.stage,
        ownerRaci: r.ownerRaci,
        text: r.text,
      },
      ipAddress: args.ipAddress,
    })
  }

  return {
    trigger: args.trigger,
    documentId: args.documentId,
    completedCount: rows.length,
    itemIds: rows.map(r => r.id),
  }
}
