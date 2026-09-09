import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Comment } from '@platform/types'
import { documentsApi } from '../api'

interface Props {
  documentId:   string
  onAddComment?: () => void
}

const AVATAR_COLOURS: Record<string, { bg: string; fg: string }> = {
  MW: { bg: '#DBEAFE', fg: '#1D4ED8' },
  SC: { bg: '#F0FDF4', fg: '#15803D' },
  JO: { bg: '#F5F3FF', fg: '#7C3AED' },
  EV: { bg: '#FEF3C7', fg: '#D97706' },
  PN: { bg: '#FEE2E2', fg: '#DC2626' },
  AH: { bg: '#E0F2FE', fg: '#0369A1' },
  RT: { bg: '#FCE7F3', fg: '#9D174D' },
  LP: { bg: '#F3F4F6', fg: '#374151' },
}

function Avatar({ initials }: { initials: string }) {
  const c = AVATAR_COLOURS[initials] ?? AVATAR_COLOURS.MW
  return (
    <div
      className="flex h-5 w-5 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {initials}
    </div>
  )
}

function CommentCard({ comment }: { comment: Comment }) {
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Avatar initials={comment.reviewerInitials} />
        <p className="whitespace-nowrap text-[13px] font-bold">{comment.reviewerName}</p>
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900"
          style={{ backgroundColor: '#F1F5F9' }}
        >
          {comment.sectionRef}
        </span>
        <div className="flex-1" />
        <p className="whitespace-nowrap font-mono text-[10px] text-slate-500">{comment.id}</p>
        <p className="whitespace-nowrap text-[11px] text-slate-500">{comment.age}</p>
      </div>
      <div>
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
        >
          {comment.status === 'open' ? 'Open' : 'Resolved'}
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-slate-900">{comment.text}</p>
      <div className="flex items-center gap-3.5 border-t pt-2" style={{ borderColor: '#F1F5F9' }}>
        <button className="text-xs font-semibold text-blue-600 hover:text-blue-700">Resolve</button>
        <button className="text-xs font-semibold text-slate-500 hover:text-slate-700">Reply</button>
      </div>
    </div>
  )
}

export function CommentsPanel({ documentId, onAddComment }: Props) {
  const { data: comments = [] } = useQuery({
    queryKey: ['comments', documentId],
    queryFn:  () => documentsApi.getComments(documentId),
    enabled:  !!documentId,
  })

  const openComments = useMemo(
    () => comments.filter((c: Comment) => c.status === 'open'),
    [comments],
  )

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      {openComments.map((c: Comment) => <CommentCard key={c.id} comment={c} />)}

      <button
        type="button"
        onClick={onAddComment}
        className="rounded-md border border-dashed px-3 py-2.5 text-center text-xs text-slate-600 transition-colors hover:bg-slate-50"
        style={{ borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' }}
      >
        ＋ Add comment
      </button>
    </div>
  )
}
