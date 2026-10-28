// Nudge the pending cohort on a document — a PM / peer "poke" to users
// who still owe a submission / review / approval.
//
// Design: docs/roles-and-permissions.md §10 Q3 (24h throttle) + the
// permission matrix row "Nudge pending cohort". Allowed actors:
//   - PM / admin (always)
//   - Any R in the gating cohort while status is Draft
//   - Any C or Q in the gating cohort while status is In Review
//   - Any A in the gating cohort while status is Pending Signature
//
// The nudge creates one Notification per target (channels: in_app by
// default; email can be opted in via `channels` param). An actor-level
// throttle (24h per (documentId, actorId, targetUserId) tuple) keeps a
// frustrated R from spamming the same approver 20 times in a morning.
//
// Throttle lives in-process. In clustered deployments the throttle
// would move to Redis; interface stays the same (get/put by key).

import type { PrismaClient } from '@prisma/client'
import type { AuthenticatedUser } from '../../../auth/rbac.js'
import type { DocumentStatus } from '../../clinical-writing/document-status.js'
import {
  evaluateStageTransition,
  type RaciLetter,
  type RaciRowForEval,
} from './transition-engine.js'

const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000

interface ThrottleKey {
  documentId: string
  actorId:    string
  targetId:   string
}

const throttle = new Map<string, number>()
function keyFor(k: ThrottleKey): string {
  return `${k.documentId}:${k.actorId}:${k.targetId}`
}

/** Test helper. */
export function _resetNudgeThrottle(): void {
  throttle.clear()
}

export type NudgeTargetStatus =
  | 'nudged'          // created a Notification row
  | 'throttled'       // skipped (last nudge < 24h ago)
  | 'not_in_cohort'   // target isn't in the active gating cohort
  | 'already_done'    // target has already finished their part

export interface NudgeDecision {
  targetUserId: string
  status:       NudgeTargetStatus
  reason?:      string
}

export interface NudgeArgs {
  documentId:      string
  actor:           AuthenticatedUser
  /** Explicit target list; omitted → every pending user in the cohort. */
  targetUserIds?:  string[]
  /** Delivery channels. Defaults to in_app. */
  channels?:       Array<'in_app' | 'email'>
  /** Caller-provided reason / message — included in the notification body. */
  message?:        string
  /** Clock injection for tests. */
  now?:            Date
}

export async function nudgePendingCohort(
  prisma: PrismaClient,
  args: NudgeArgs,
): Promise<{ decisions: NudgeDecision[]; gatingLetters: RaciLetter[] }> {
  const now = args.now ?? new Date()

  const doc = await prisma.document.findUnique({
    where: { id: args.documentId },
    select: { id: true, status: true, title: true, projectId: true },
  })
  if (!doc) {
    return { decisions: [], gatingLetters: [] }
  }

  // Compute the active gating cohort via the shared evaluator.
  const rows = await prisma.documentRaci.findMany({
    where: { documentId: args.documentId },
    select: {
      userId: true, letter: true, signatureRequired: true,
      submittedAt: true, reviewedAt: true, approvedAt: true,
      signatureId: true, rejectedAt: true, removedAt: true,
    },
  })
  const evalResult = evaluateStageTransition(
    doc.status as DocumentStatus,
    rows as RaciRowForEval[],
  )
  if (evalResult.gatingLetters.length === 0) {
    return { decisions: [], gatingLetters: [] }
  }

  const gating = new Set<RaciLetter>(evalResult.gatingLetters)

  // Pending in the current cohort = rows with the gating letter + no
  // completion timestamp for that letter + not removed + not rejected.
  const pending = rows.filter(r =>
    gating.has(r.letter as RaciLetter) &&
    !r.removedAt &&
    !r.rejectedAt &&
    !hasCompleted(r as RaciRowForEval),
  )
  const pendingByUser = new Map<string, RaciRowForEval>()
  for (const r of pending) {
    if (!pendingByUser.has(r.userId)) pendingByUser.set(r.userId, r as RaciRowForEval)
  }

  const explicit = args.targetUserIds && args.targetUserIds.length > 0
    ? Array.from(new Set(args.targetUserIds))
    : Array.from(pendingByUser.keys())

  const channels = args.channels ?? ['in_app']
  const decisions: NudgeDecision[] = []
  const notificationsToCreate: Array<{
    recipientId: string
    kind:        string
    title:       string
    body:        string
    linkPath:    string
    channels:    string[]
    payload:     Record<string, unknown>
  }> = []

  for (const targetId of explicit) {
    const row = pendingByUser.get(targetId)
    if (!row) {
      // Not pending — either done, rejected, removed, or not in cohort.
      const anyRow = rows.find(r => r.userId === targetId && gating.has(r.letter as RaciLetter))
      if (anyRow && hasCompleted(anyRow as RaciRowForEval)) {
        decisions.push({ targetUserId: targetId, status: 'already_done' })
      } else {
        decisions.push({ targetUserId: targetId, status: 'not_in_cohort' })
      }
      continue
    }

    const key = keyFor({ documentId: args.documentId, actorId: args.actor.id, targetId })
    const last = throttle.get(key) ?? 0
    const sinceMs = now.getTime() - last
    if (sinceMs < NUDGE_COOLDOWN_MS) {
      const hoursLeft = Math.ceil((NUDGE_COOLDOWN_MS - sinceMs) / (60 * 60 * 1000))
      decisions.push({
        targetUserId: targetId,
        status: 'throttled',
        reason: `you already nudged this user; try again in ${hoursLeft}h`,
      })
      continue
    }

    throttle.set(key, now.getTime())
    decisions.push({ targetUserId: targetId, status: 'nudged' })
    notificationsToCreate.push({
      recipientId: targetId,
      kind: 'document_nudge',
      title: `Nudge: "${doc.title}" needs your ${letterLabel(row.letter as RaciLetter)}`,
      body: args.message?.trim() || `${args.actor.email} nudged you to complete your part on "${doc.title}".`,
      linkPath: `/projects/${doc.projectId}/clinical-writing/documents/${doc.id}`,
      channels,
      payload: {
        documentId: doc.id,
        letter: row.letter,
        nudgedBy: args.actor.id,
      },
    })
  }

  if (notificationsToCreate.length > 0) {
    await prisma.notification.createMany({
      data: notificationsToCreate.map(n => ({
        recipientId: n.recipientId,
        kind: n.kind,
        title: n.title,
        body: n.body,
        linkPath: n.linkPath,
        channels: n.channels,
        payload: n.payload as never,
      })),
    })
  }

  return { decisions, gatingLetters: evalResult.gatingLetters }
}

function hasCompleted(row: RaciRowForEval): boolean {
  if (row.letter === 'R') return row.submittedAt !== null
  if (row.letter === 'C' || row.letter === 'Q') return row.reviewedAt !== null
  if (row.letter === 'A') return row.approvedAt !== null
  return false
}

function letterLabel(letter: RaciLetter): string {
  if (letter === 'R') return 'submission'
  if (letter === 'A') return 'approval'
  if (letter === 'C') return 'review'
  if (letter === 'Q') return 'QC release'
  return 'input'
}
