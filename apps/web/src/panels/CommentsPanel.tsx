import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Comment, ResolutionType } from '@platform/types'
import { documentsApi, describeApiError } from '../api'
import { ResolveForm, parseResolutionNote } from './ResolveCommentForm'
import { CommentComposer, cleanSectionRef, sectionOfRef, withSectionMark, type ComposerSection } from './CommentComposer'

interface Props {
  documentId:   string
  // Sections of the document + the one being viewed: the "Add comment" form tags
  // the comment to a section (mandatory per FR-A-052) and defaults to this one.
  sections?:        ComposerSection[]
  activeSectionId?: string | null
  // Overrides the built-in form (a screen with its own composer can focus that instead).
  onAddComment?: () => void
  // A comment to scroll to and highlight (deep link from the project's comments panel).
  focusCommentId?: string | null
  // List only the active section's comments (with a "Show all comments in document" switch).
  // Off by default: the Reviewer View keeps the document-wide list.
  scopeToSection?: boolean
}

// "3 days ago" style age for an ISO timestamp.
export function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (Number.isNaN(mins)) return ''
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  return `${Math.floor(months / 12)} year${Math.floor(months / 12) === 1 ? '' : 's'} ago`
}

// Creator line + last-edited line, shared by the project panel and this one. "Last edited" is the
// last save of the section the comment is tagged to (who and when), not a change to the comment.
export function CommentMeta({ comment, section }: { comment: Comment; section?: ComposerSection | null }) {
  const edited = section?.lastEditedByName && section.lastEditedAt
    ? `Last edited by ${section.lastEditedByName} · ${timeAgo(section.lastEditedAt)}`
    : 'Not edited yet'
  return (
    <div className="flex flex-col gap-0.5 text-[11px] text-slate-500">
      <p data-meta="created">Created by {comment.reviewerName} · {comment.age}</p>
      <p data-meta="edited" title="Last save of this comment's section">{edited}</p>
    </div>
  )
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

// Every comment carries a severity (FR-A-052); same colours as the Comments dashboard.
const SEVERITY_PILL: Record<string, { bg: string; fg: string; label: string }> = {
  major: { bg: '#FEE2E2', fg: '#DC2626', label: 'Major' },
  minor: { bg: '#FFFBEB', fg: '#B45309', label: 'Minor' },
  query: { bg: '#EFF6FF', fg: '#2563EB', label: 'Query' },
}

function SeverityPill({ severity }: { severity: string }) {
  const s = SEVERITY_PILL[severity]
  if (!s) return null
  return (
    <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: s.bg, color: s.fg }} data-severity={severity}>
      {s.label}
    </span>
  )
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
  focused?: boolean
  section?: ComposerSection | null
}

// Scrolls the card into view and rings it for a couple of seconds when it's the focused comment.
function useFocusRing(focused: boolean | undefined) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [ring, setRing] = useState(false)
  useEffect(() => {
    if (!focused) return
    ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setRing(true)
    const t = window.setTimeout(() => setRing(false), 2800)
    return () => window.clearTimeout(t)
  }, [focused])
  return { ref, ring }
}

function CommentCard({ comment, resolving, isPending, error, onResolveClick, onResolveCancel, onResolveConfirm, focused, section }: CardProps) {
  const { ref, ring } = useFocusRing(focused)
  return (
    <div
      ref={ref}
      className="mb-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 transition-shadow"
      style={ring ? { borderColor: '#2563EB', boxShadow: '0 0 0 3px rgba(37,99,235,0.25)' } : undefined}
      data-comment-id={comment.id}
      data-focused={ring || undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Avatar initials={comment.reviewerInitials} />
        <p className="whitespace-nowrap text-[13px] font-bold">{comment.reviewerName}</p>
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900"
          style={{ backgroundColor: '#F1F5F9' }}
        >
          {cleanSectionRef(comment.sectionRef)}
        </span>
        <div className="flex-1" />
        <p className="whitespace-nowrap font-mono text-[10px] text-slate-500">{comment.id}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
        >
          {comment.status === 'open' ? 'Open' : 'Resolved'}
        </span>
        <SeverityPill severity={comment.severity} />
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
      <CommentMeta comment={comment} section={section} />
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
          {/* No Reply control: replies aren't part of the PRD (FR-A-052) — a comment's answer is its
              resolution note, and discussion happens in the CRM meeting. */}
        </div>
      )}
    </div>
  )
}

// A resolved comment: read-only record (there is no reopen). Shows the resolution record —
// type, resolver, when and the note (AC-A-055). The API returns the resolver + time as
// lastEditedByName / lastEditedAge and the note (with its type tag) as resolutionNote.
function ResolvedCard({ comment, focused, section }: { comment: Comment; focused?: boolean; section?: ComposerSection | null }) {
  const { ref, ring } = useFocusRing(focused)
  const resolution = parseResolutionNote((comment as Comment & { resolutionNote?: string | null }).resolutionNote)
  return (
    <div
      ref={ref}
      className="mb-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 transition-shadow"
      style={ring ? { borderColor: '#2563EB', boxShadow: '0 0 0 3px rgba(37,99,235,0.25)' } : undefined}
      data-comment-id={comment.id}
      data-resolved-card
      data-focused={ring || undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Avatar initials={comment.reviewerInitials} />
        <p className="whitespace-nowrap text-[13px] font-bold">{comment.reviewerName}</p>
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900" style={{ backgroundColor: '#F1F5F9' }}>
          {cleanSectionRef(comment.sectionRef)}
        </span>
        <div className="flex-1" />
        <p className="whitespace-nowrap font-mono text-[10px] text-slate-500">{comment.id}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#15803D' }}>Resolved</span>
        <SeverityPill severity={comment.severity} />
      </div>
      <p className="text-[13px] leading-relaxed text-slate-900">{comment.text}</p>
      <CommentMeta comment={comment} section={section} />
      <div className="flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-[11px] leading-relaxed" style={{ backgroundColor: '#F0FDF4', color: '#15803D' }} data-resolution>
        <p className="font-semibold">
          {resolution.decision ?? 'Resolved'}
          {comment.lastEditedByName ? ` · by ${comment.lastEditedByName}` : ''}
          {comment.lastEditedAge ? ` · ${comment.lastEditedAge}` : ''}
          {resolution.viaCrm ? ` · in CRM ${resolution.viaCrm}` : ''}
        </p>
        {resolution.text && <p className="text-slate-700">{resolution.text}</p>}
      </div>
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
        {cleanSectionRef(comment.sectionRef)}
      </span>
      <span className="text-[12px] text-slate-700">by {comment.reviewerName}</span>
      <div className="flex-1" />
      <p className="whitespace-nowrap font-mono text-[10px] text-slate-500">{comment.id}</p>
      <p className="whitespace-nowrap text-[11px] text-slate-500">{comment.age}</p>
    </div>
  )
}

export function CommentsPanel({ documentId, sections = [], activeSectionId = null, onAddComment, focusCommentId = null, scopeToSection = false }: Props) {
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

  // Section scope: a comment belongs to a section when its stored section tag ("§3") equals the
  // section's number (same tag the composer writes). Matching is by that tag, never by title.
  const activeSection = sections.find(s => s.id === activeSectionId) ?? null
  const [showAll, setShowAll] = useState(false)
  // Moving to another section goes back to that section's own comments.
  useEffect(() => { setShowAll(false) }, [activeSectionId])
  const scoped = scopeToSection && !showAll && !!activeSection
  const scopeRef = activeSection ? withSectionMark(activeSection.number) : ''
  const inScope = (c: Comment) => !scoped || cleanSectionRef(c.sectionRef) === scopeRef
  const scopedComments = useMemo(
    () => comments.filter((c: Comment) => inScope(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comments, scoped, scopeRef],
  )

  // Deep link to a comment that isn't in the section the editor landed on (e.g. a section tag
  // that matches no section): show the whole document so the comment is still found. Runs once,
  // after the editor has settled on its section.
  const focusChecked = useRef(false)
  useEffect(() => {
    if (!scopeToSection || !focusCommentId || focusChecked.current || comments.length === 0 || !activeSection) return
    const t = window.setTimeout(() => {
      focusChecked.current = true
      const target = comments.find(c => c.id === focusCommentId)
      if (target && cleanSectionRef(target.sectionRef) !== scopeRef) setShowAll(true)
    }, 300)
    return () => window.clearTimeout(t)
  }, [scopeToSection, focusCommentId, comments, activeSection, scopeRef])

  const openComments = useMemo(
    () => scopedComments.filter((c: Comment) => c.status === 'open' && c.verdict !== 'approve'),
    [scopedComments],
  )
  const resolvedComments = useMemo(
    () => scopedComments.filter((c: Comment) => c.status === 'resolved' && c.verdict !== 'approve'),
    [scopedComments],
  )
  // Resolved comments are collapsed unless the deep link points at one of them.
  const focusIsResolved = resolvedComments.some(c => c.id === focusCommentId)
  const [showResolved, setShowResolved] = useState(false)
  useEffect(() => { if (focusIsResolved) setShowResolved(true) }, [focusIsResolved])
  const approvals = useMemo(
    () => scopedComments.filter((c: Comment) => c.verdict === 'approve'),
    [scopedComments],
  )
  const issueCount = openComments.length + resolvedComments.length
  const sectionName = activeSection ? `${withSectionMark(activeSection.number)} ${activeSection.title}`.trim() : ''

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      {scopeToSection && activeSection && (
        <div className="mb-3 flex flex-col gap-0.5 border-b border-slate-200 pb-2.5" data-comments-scope={scoped ? 'section' : 'document'}>
          <p className="truncate text-[13px] font-bold text-slate-900" title={scoped ? sectionName : 'All comments in this document'}>
            {scoped ? sectionName : 'All comments in this document'}
          </p>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500" data-scope-counts>
              {openComments.length} open · {resolvedComments.length} resolved
            </p>
            <button
              type="button"
              onClick={() => setShowAll(v => !v)}
              data-action="toggle-comment-scope"
              className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
            >
              {scoped ? 'Show all comments in document' : 'Show this section only'}
            </button>
          </div>
        </div>
      )}
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
          {scoped && issueCount === 0 ? 'No comments on this section yet' : 'No open comments.'}
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
          focused={focusCommentId === c.id}
          section={sectionOfRef(c.sectionRef, sections)}
        />
      ))}

      {resolvedComments.length > 0 && (
        <div className="mb-2 mt-1" data-section="resolved">
          <button
            type="button"
            onClick={() => setShowResolved(v => !v)}
            aria-expanded={showResolved}
            className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500 hover:text-slate-700"
          >
            {showResolved ? '▾' : '▸'} Resolved ({resolvedComments.length})
          </button>
          {showResolved && resolvedComments.map((c: Comment) => <ResolvedCard key={c.id} comment={c} focused={focusCommentId === c.id} section={sectionOfRef(c.sectionRef, sections)} />)}
        </div>
      )}

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
