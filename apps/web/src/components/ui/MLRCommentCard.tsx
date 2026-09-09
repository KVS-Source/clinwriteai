// MLR comment card — shows MLR-C-### id, reviewer stamp, tag, and escalation chip (Module C).
import type { MLRComment } from '@platform/types'

interface Props {
  comment: MLRComment
}

export function MLRCommentCard({ comment }: Props) {
  const resolved = comment.resolvedAt !== null

  return (
    <article
      className="rounded-lg border p-3"
      style={{
        backgroundColor: resolved ? '#F8FAFC' : '#FFFFFF',
        borderColor:     '#E2E8F0',
        opacity:         resolved ? 0.7 : 1,
      }}
      data-mlr-comment-card
      data-mlr-comment-id={comment.id}
      data-mlr-comment-resolved={resolved}
    >
      <header className="flex items-center gap-2 text-[11px]">
        <span className="font-mono font-semibold text-slate-700">{comment.id}</span>
        <span
          className="inline-flex items-center rounded px-1.5 py-0.5 font-medium"
          style={{ backgroundColor: comment.tagBg, color: comment.tagFg }}
          data-mlr-comment-tag={comment.tag}
        >
          {comment.tag}
        </span>
        {comment.escalatedFromAgentic && (
          <span
            className="inline-flex items-center rounded px-1.5 py-0.5 font-medium"
            style={{ backgroundColor: '#EFF6FF', color: '#005F8E', border: '1px solid #93C5FD' }}
            data-mlr-comment-escalated
          >
            Escalated from Agentic
          </span>
        )}
        <span className="ml-auto text-slate-500">{comment.reviewerStamp}</span>
      </header>
      <p className="mt-2 text-sm text-slate-800">{comment.text}</p>
      {resolved && (
        <p className="mt-2 text-[11px] text-slate-500">
          Resolved by {comment.resolvedBy} · {comment.resolvedAt}
        </p>
      )}
    </article>
  )
}
