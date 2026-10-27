// Checklist gates — Phase 2 of the Module A rollout.
//
// Three gating checks, each filtering mandatory ChecklistInstanceItem rows
// by stage and returning the pending-or-missing set so the UI can show
// "N mandatory items blocking submission".
//
//   • Gate C — submit-for-review: items for exactly the current stage must
//              be Complete or Waived.
//   • Gate B — stage-advance:    items for every stage ≤ current must be
//              Complete or Waived (the stage you're LEAVING must be clean).
//   • Gate A — signature:        items for every stage must be Complete
//              or Waived. Strongest. Applied at chain initiation.
//
// Each helper returns the structured list — the HTTP 409 shape is composed
// by the calling route so the error schema stays with its endpoint.

import type { PrismaClient } from '@prisma/client'
import { DB_STAGES, stageIndex, type DbStage } from '../document-stage.js'

export interface BlockingItem {
  id: string
  text: string
  framework: string
  stage: string
  ownerRaci: string
}

export interface GateResult {
  ok: boolean
  blocking: BlockingItem[]
}

/**
 * Load mandatory ChecklistInstanceItem rows that are still pending (NOT
 * Complete, NOT Waived) and whose stage satisfies `where`. One query, no
 * joins beyond the instance → document relation Prisma already handles via
 * documentId.
 *
 * User-added items are implicitly non-mandatory (frameworkMandatory=false),
 * so they're never blocking. Instance items for custom items whose owning
 * Admin set frameworkMandatory=true still gate — which is the intended
 * extension point.
 */
async function loadBlocking(
  prisma: PrismaClient,
  documentId: string,
  where: { exactStage?: DbStage; stagesIncluded?: DbStage[] },
): Promise<BlockingItem[]> {
  const stageFilter =
    where.exactStage !== undefined
      ? { stage: where.exactStage }
      : where.stagesIncluded !== undefined
        ? { stage: { in: where.stagesIncluded } }
        : {}

  const rows = await prisma.checklistInstanceItem.findMany({
    where: {
      instance: { documentId },
      frameworkMandatory: true,
      status: 'pending',
      ...stageFilter,
    },
    orderBy: [{ stage: 'asc' }, { sortOrder: 'asc' }],
    select: {
      id: true,
      text: true,
      framework: true,
      stage: true,
      ownerRaci: true,
    },
  })

  return rows
}

/**
 * Gate C — submit-for-review.
 * All mandatory items for the current stage must be Complete or Waived
 * before a document can leave authoring for review.
 */
export async function checkSubmitForReviewGate(
  prisma: PrismaClient,
  documentId: string,
  currentStage: DbStage,
): Promise<GateResult> {
  const blocking = await loadBlocking(prisma, documentId, { exactStage: currentStage })
  return { ok: blocking.length === 0, blocking }
}

/**
 * Gate B — stage-advance.
 * All mandatory items for every stage up to and including the current one
 * must be Complete or Waived before the stepper can move forward.
 */
export async function checkStageAdvanceGate(
  prisma: PrismaClient,
  documentId: string,
  currentStage: DbStage,
): Promise<GateResult> {
  const upto = DB_STAGES.slice(0, stageIndex(currentStage) + 1) as DbStage[]
  const blocking = await loadBlocking(prisma, documentId, { stagesIncluded: upto })
  return { ok: blocking.length === 0, blocking }
}

/**
 * Gate A — signature initiation.
 * All mandatory items from every stage must be Complete or Waived before
 * a Part 11 signature chain can be opened against the document.
 */
export async function checkSignatureGate(
  prisma: PrismaClient,
  documentId: string,
): Promise<GateResult> {
  const blocking = await loadBlocking(prisma, documentId, {})
  return { ok: blocking.length === 0, blocking }
}

/**
 * Build the standard 409 body for a blocked gate so every endpoint
 * returns the same shape to the UI.
 */
export function blockedBody(gate: 'submit_for_review' | 'stage_advance' | 'signature', result: GateResult) {
  return {
    error: 'checklist_blocked',
    gate,
    message:
      `${result.blocking.length} mandatory checklist item${result.blocking.length === 1 ? '' : 's'} must be `
      + 'completed or waived first.',
    blockingCount: result.blocking.length,
    blocking: result.blocking,
  }
}
