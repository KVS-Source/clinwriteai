// Sequential review, as the screen sees it (FR-A-042). Mirrors apps/api/.../document-raci/review-order.ts:
// when a review is sequential the Reviewers (C) have a place in line (`approvalOrder`, 1 first) and a
// Reviewer can mark their review done once everyone ahead of them has.

interface RowLike { userId: string; letter: string; approvalOrder: number | null; reviewedAt: string | null; removedAt: string | null; userName?: string | null }

const reviewerRows = <R extends RowLike>(rows: readonly R[]) => rows.filter(r => r.letter === 'C' && r.removedAt === null)

/** Whether the document's Reviewers are in a line. */
export const isSequentialReview = (rows: readonly RowLike[]) => reviewerRows(rows).some(r => r.approvalOrder !== null)

/** The Reviewers ahead of `userId` who haven't finished (names where known). Empty when it's their turn or the review is parallel. */
export function reviewersAhead(rows: readonly RowLike[], userId: string | undefined): Array<{ userId: string; name: string }> {
  if (!userId) return []
  const orders = reviewerRows(rows).filter(r => r.userId === userId && r.approvalOrder !== null).map(r => r.approvalOrder as number)
  if (orders.length === 0) return []
  const mine = Math.min(...orders)
  const out = new Map<string, string>()
  for (const r of reviewerRows(rows)) {
    if (r.userId !== userId && r.approvalOrder !== null && r.approvalOrder < mine && r.reviewedAt === null) out.set(r.userId, r.userName ?? r.userId)
  }
  return [...out].map(([id, name]) => ({ userId: id, name }))
}
