import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Comment, ResolutionType } from '@platform/types'
import { documentsApi, describeApiError } from '../api'
import { ResolveForm } from './ResolveCommentForm'
import { CommentComposer, type ComposerSection } from './CommentComposer'

interface Props {
  documentId:   string
  // Sections of the document + the one being viewed: the "Add comment" form tags
  // the comment to a section (mandatory per FR-A-052) and defaults to this one.
  sections?:        ComposerSection[]
  activeSectionId?: string | null
  // Overrides the built-in form (a screen with its own composer can focus that instead).
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

interface CardProps {
  comment:   Comment
  resolving: boolean
  isPending: boolean
  error:     string | null
  onResolveClick:   () => void
  onResolveCancel:  () => void
  onResolveConfirm: (type: ResolutionType, note: string) => void
}

function CommentCard({ comment, resolving, isPending, error, onResolveClick, onResolveCancel, onResolveConfirm }: CardProps) {
  return (
    <div className="mb-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3" data-comment-id={comment.id}>
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
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
        >
          {comment.status === 'open' ? 'Open' : 'Resolved'}
        </span>
        {comment.verdict === 'request_changes' && (
          <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#FFF7ED', color: '#C2410C' }} data-verdict="request_changes">
            ↩ Returned for revision
          </span>
        )}
        {comment.verdict === 'block_approval' && (
          <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#FEF2F2', color: '#B91C1C' }} data-verdict="block_approval">
            ⊘ Approval blocked
          </span>
        )}
      </div>
      <p className="text-[13px] leading-relaxed text-slate-900">{comment.text}</p>
      {resolving ? (
        <ResolveForm onCancel={onResolveCancel} onConfirm={onResolveConfirm} isPending={isPending} error={error} />
      ) : (
        <div className="flex items-center gap-3.5 border-t pt-2" style={{ borderColor: '#F1F5F9' }}>
          <button
            type="button"
            onClick={onResolveClick}
            data-action="resolve-comment"
            className="text-xs font-semibold text-blue-600 hover:text-blue-700"
          >Resolve</button>
          {/* Replies are not part of the PRD (no reply entity or endpoint), so the control is shown but inactive. */}
          <button
            type="button"
            disabled
            title="Replies aren't available yet"
            className="cursor-not-allowed text-xs font-semibold text-slate-400"
          >Reply</button>
        </div>
      )}
    </div>
  )
}

// A reviewer's "Approve section" is stored as a comment with verdict='approve'
// and no text (docs/decisions/module-a-defaults.md §3). It needs no action, so
// it's shown as a read-only approval record — no Resolve/Reply, not "open".
function ApprovalCard({ comment }: { comment: Comment }) {
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border p-2.5"
      style={{ borderColor: '#BBF7D0', backgroundColor: '#F0FDF4' }}
      data-comment-id={comment.id}
      data-verdict="approve"
    >
      <span className="text-[12px] font-semibold" style={{ color: '#15803D' }}>✓ Approved</span>
      <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900" style={{ backgroundColor: '#FFFFFF' }}>
        {comment.sectionRef}
      </span>
      <span className="text-[12px] text-slate-700">by {comment.reviewerName}</span>
      <div className="flex-1" />
      <p className="whitespace-nowrap font-mono text-[10px] text-slate-500">{comment.id}</p>
      <p className="whitespace-nowrap text-[11px] text-slate-500">{comment.age}</p>
    </div>
  )
}

export function CommentsPanel({ documentId, sections = [], activeSectionId = null, onAddComment }: Props) {
  const qc = useQueryClient()
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [postedNote, setPostedNote] = useState<string | null>(null)

  const { data: comments = [] } = useQuery({
    queryKey: ['comments', documentId],
    queryFn:  () => documentsApi.getComments(documentId),
    enabled:  !!documentId,
  })

  // Resolve = PATCH /comments/:id/resolve with a resolution type + mandatory note.
  // The comment is kept (never deleted); it leaves the open list once resolved.
  const resolveMut = useMutation({
    mutationFn: (args: { id: string; type: ResolutionType; note: string }) =>
      documentsApi.resolveComment(documentId, args.id, { resolutionType: args.type, note: args.note }),
    onSuccess: () => {
      setResolvingId(null)
      qc.invalidateQueries({ queryKey: ['comments', documentId] })
      qc.invalidateQueries({ queryKey: ['document-audit', documentId] })
    },
    onError: (err) => {
      // Someone else resolved it first: refresh so the card drops out of the open list.
      if ((err as { status?: number }).status === 409) qc.invalidateQueries({ queryKey: ['comments', documentId] })
    },
  })
  const resolveError = resolveMut.isError
    ? ((resolveMut.error as { status?: number }).status === 409
        ? 'This comment was already resolved.'
        : describeApiError(resolveMut.error).message)
    : null

  const openComments = useMemo(
    () => comments.filter((c: Comment) => c.status === 'open' && c.verdict !== 'approve'),
    [comments],
  )
  const approvals = useMemo(
    () => comments.filter((c: Comment) => c.verdict === 'approve'),
    [comments],
  )

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      {composing && (
        <CommentComposer
          documentId={documentId}
          sections={sections}
          defaultSectionId={activeSectionId}
          onClose={() => setComposing(false)}
          onPosted={c => setPostedNote(`Comment ${c.id} posted.`)}
        />
      )}
      {postedNote && !composing && (
        <p className="mb-2 rounded-md bg-green-50 p-2 text-center text-[11px] font-semibold text-green-700" role="status" data-posted-note>{postedNote}</p>
      )}
      {openComments.length === 0 && !composing && (
        <p className="mb-2 rounded-md border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500" data-state="no-open-comments">
          No open comments.
        </p>
      )}
      {openComments.map((c: Comment) => (
        <CommentCard
          key={c.id}
          comment={c}
          resolving={resolvingId === c.id}
          isPending={resolveMut.isPending}
          error={resolvingId === c.id ? resolveError : null}
          onResolveClick={() => { resolveMut.reset(); setResolvingId(c.id) }}
          onResolveCancel={() => { resolveMut.reset(); setResolvingId(null) }}
          onResolveConfirm={(type, note) => resolveMut.mutate({ id: c.id, type, note })}
        />
      ))}

      {approvals.length > 0 && (
        <div className="mb-2 mt-1" data-section="approvals">
          <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Section approvals ({approvals.length})
          </p>
          {approvals.map((c: Comment) => <ApprovalCard key={c.id} comment={c} />)}
        </div>
      )}

      <button
        type="button"
        onClick={() => { if (onAddComment) onAddComment(); else { setPostedNote(null); setComposing(true) } }}
        disabled={composing}
        data-action="add-comment"
        className="rounded-md border border-dashed px-3 py-2.5 text-center text-xs text-slate-600 transition-colors hover:bg-slate-50"
        style={{ borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' }}
      >
        ＋ Add comment
      </button>
    </div>
  )
}
