// Sequential review (FR-A-042). When the author submits for review as "sequential", the document's
// Reviewers (C) are put in a line: each C row's `approvalOrder` is its place (1 = first). A row with no
// order means parallel — everyone reviews at once. A reviewer can mark their review done only when
// everyone ahead of them has; reviewers sharing a place go together.
//
// (`approvalOrder` was only used for Approvers and nothing read it, so the Reviewer line reuses the
// column rather than adding one. Pure functions: the routes load the rows.)

export interface ReviewOrderRow {
  userId: string
  letter: string
  approvalOrder?: number | null
  reviewedAt: Date | string | null
  removedAt: Date | string | null
}

const activeReviewerRows = <R extends ReviewOrderRow>(rows: readonly R[]) => rows.filter(r => r.letter === 'C' && !r.removedAt)

/** A person's place in line: their lowest order among active C rows, or null when parallel. */
function placeOf(rows: readonly ReviewOrderRow[], userId: string): number | null {
  const orders = activeReviewerRows(rows).filter(r => r.userId === userId).map(r => r.approvalOrder).filter((o): o is number => o != null)
  return orders.length > 0 ? Math.min(...orders) : null
}

const hasFinished = (rows: readonly ReviewOrderRow[], userId: string) =>
  activeReviewerRows(rows).filter(r => r.userId === userId).every(r => r.reviewedAt)

/** The reviewers still ahead of `userId` who haven't finished. Empty when it is their turn, the review is parallel, or they aren't a reviewer. */
export function reviewersAhead(rows: readonly ReviewOrderRow[], userId: string): string[] {
  const mine = placeOf(rows, userId)
  if (mine === null) return []
  const ahead = new Set<string>()
  for (const r of activeReviewerRows(rows)) {
    if (r.userId === userId || r.approvalOrder == null || r.approvalOrder >= mine || r.reviewedAt) continue
    ahead.add(r.userId)
  }
  return [...ahead]
}

/** Reviewers who can act now and haven't finished: everyone when parallel, else the front of the line. */
export function reviewersWhoseTurnItIs(rows: readonly ReviewOrderRow[]): string[] {
  const users = [...new Set(activeReviewerRows(rows).map(r => r.userId))]
  return users.filter(u => !hasFinished(rows, u) && reviewersAhead(rows, u).length === 0)
}

/** True when the reviewers are in a line (any active C row has a place). */
export const isSequentialReview = (rows: readonly ReviewOrderRow[]) => activeReviewerRows(rows).some(r => r.approvalOrder != null)

/**
 * The places to give the Reviewers on submit. `payloadOrder` is the order the author saw in the panel
 * (top first); reviewers it doesn't name follow, in the order given by `reviewerIds`. Parallel returns no places.
 */
export function assignReviewOrder(args: {
  reviewType: 'parallel' | 'sequential' | null | undefined
  reviewerIds: readonly string[]
  payloadOrder: readonly string[]
}): Map<string, number | null> {
  const out = new Map<string, number | null>()
  const reviewers = [...new Set(args.reviewerIds)]
  if (args.reviewType !== 'sequential') { for (const id of reviewers) out.set(id, null); return out }
  const named = [...new Set(args.payloadOrder)].filter(id => reviewers.includes(id))
  const rest = reviewers.filter(id => !named.includes(id))
  const line = [...named, ...rest]
  line.forEach((id, i) => out.set(id, i + 1))
  return out
}
