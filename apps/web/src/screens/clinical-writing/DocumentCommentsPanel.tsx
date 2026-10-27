// Floating comments panel for one document, opened from the "Comments" column of the
// documents table. Drag the header to move it, drag the left edge to resize it. Closes on
// Esc, the X button, or a click anywhere outside it. Comments can be searched, filtered,
// sorted and added here. Resolving happens in the Editor: "Open at §x" jumps to the comment there.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Comment, CommentSeverity, Document } from '@platform/types'
import { documentsApi } from '../../api'
import { CommentComposer, cleanSectionRef, sectionLabelFor, sectionOfRef } from '../../panels/CommentComposer'
import { CommentMeta } from '../../panels/CommentsPanel'

const SEVERITY_BADGE: Record<CommentSeverity, { label: string; bg: string; fg: string }> = {
  major: { label: 'Major', bg: '#FEE2E2', fg: '#DC2626' },
  minor: { label: 'Minor', bg: '#FFFBEB', fg: '#B45309' },
  query: { label: 'Query', bg: '#EFF6FF', fg: '#2563EB' },
}
const SEVERITY_RANK: Record<CommentSeverity, number> = { major: 0, minor: 1, query: 2 }

const MIN_WIDTH = 340
const MAX_WIDTH = 720
const DEFAULT_WIDTH = 440
const TOP_GAP = 72      // clears the app's top bar
const EDGE_GAP = 16
const ANIM_MS = 180

type Filter = 'all' | 'open' | 'resolved'
type SeverityFilter = CommentSeverity | 'all'
type SortKey = 'newest' | 'oldest' | 'severity'

const initialsOf = (name: string) =>
  name.trim().split(/\s+/).filter(w => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w))
    .slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

interface Props {
  doc: Document
  comments: Comment[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  onClose: () => void
  // Opens the document in the editor; with a comment, at its section with that comment highlighted.
  onOpenDocument: (comment?: Comment) => void
}

export function DocumentCommentsPanel({ doc, comments, isLoading, isError, onRetry, onClose, onOpenDocument }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeTimer = useRef<number | null>(null)
  const [shown, setShown] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  const [composing, setComposing] = useState(false)
  const [postedNote, setPostedNote] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Position and size are kept in state, so they survive switching to another document.
  const [box, setBox] = useState(() => {
    const width = Math.min(DEFAULT_WIDTH, window.innerWidth - EDGE_GAP * 2)
    return {
      left:   Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP),
      top:    TOP_GAP,
      width,
      height: Math.max(320, window.innerHeight - TOP_GAP - EDGE_GAP),
    }
  })
  const [interacting, setInteracting] = useState(false)

  // Enter animation; a switch to another document while closing cancels the close.
  useEffect(() => {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [doc.id])
  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current) }, [])

  // Per-document view state starts fresh when the panel switches documents (sort is kept).
  useEffect(() => {
    setFilter('all'); setSearch(''); setSeverityFilter('all')
    setComposing(false); setPostedNote(null)
  }, [doc.id])

  const requestClose = () => {
    setShown(false)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(onClose, ANIM_MS)
  }
  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose

  // Esc and outside click. The "View" buttons are exempt so they can switch the panel to
  // another document. Drag and resize start inside the panel and only listen for pointer
  // moves, so releasing the mouse outside never counts as an outside click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestCloseRef.current() }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (!t || panelRef.current?.contains(t)) return
      if (t.closest('[data-comments-trigger]')) return
      requestCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [])

  // Keep the panel inside the viewport when the window shrinks.
  useEffect(() => {
    const onResize = () => setBox(b => {
      const width  = Math.min(b.width, window.innerWidth - EDGE_GAP)
      const height = Math.min(b.height, window.innerHeight - EDGE_GAP)
      return {
        width, height,
        left: clamp(b.left, 0, Math.max(0, window.innerWidth - width)),
        top:  clamp(b.top, 0, Math.max(0, window.innerHeight - 56)),
      }
    })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Drag by the header (ignores presses on its buttons).
  const beginMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX, startY = e.clientY, startLeft = box.left, startTop = box.top
    setInteracting(true)
    const onMove = (ev: PointerEvent) => setBox(b => ({
      ...b,
      left: clamp(startLeft + ev.clientX - startX, 0, Math.max(0, window.innerWidth - b.width)),
      top:  clamp(startTop + ev.clientY - startY, 0, Math.max(0, window.innerHeight - 56)),
    }))
    const onUp = () => {
      el.releasePointerCapture(e.pointerId)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      setInteracting(false)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  // Resize by the left edge: the right edge stays put.
  const beginResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const right = box.left + box.width
    setInteracting(true)
    const onMove = (ev: PointerEvent) => {
      const width = clamp(right - ev.clientX, MIN_WIDTH, Math.min(MAX_WIDTH, right))
      setBox(b => ({ ...b, width, left: right - width }))
    }
    const onUp = () => {
      el.releasePointerCapture(e.pointerId)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      setInteracting(false)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  // The document's own section list (the Editor's Sections list): used for "Open at §x <title>" and
  // for the composer's section picker.
  const fullDoc = useQuery({
    queryKey: ['document', doc.id],
    queryFn:  () => documentsApi.get(doc.id),
    staleTime: 60_000,
  })
  const sections = fullDoc.data?.sections ?? []

  const copyId = (id: string) => {
    navigator.clipboard?.writeText(id).then(
      () => { setCopiedId(id); window.setTimeout(() => setCopiedId(cur => (cur === id ? null : cur)), 1200) },
      () => undefined,
    )
  }

  const issues   = comments.filter(c => c.verdict !== 'approve')
  const openN    = issues.filter(c => c.status === 'open').length
  const resolveN = issues.filter(c => c.status === 'resolved').length

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = issues.filter(c =>
      (filter === 'all' || c.status === filter) &&
      (severityFilter === 'all' || c.severity === severityFilter) &&
      (q === '' ||
        c.text.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        cleanSectionRef(c.sectionRef).toLowerCase().includes(q) ||
        (c.reviewerName ?? '').toLowerCase().includes(q)))
    return list.sort((a, b) =>
      sort === 'oldest'   ? a.createdAt.localeCompare(b.createdAt) :
      sort === 'severity' ? (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || b.createdAt.localeCompare(a.createdAt) :
                            b.createdAt.localeCompare(a.createdAt))
  }, [issues, filter, severityFilter, search, sort])

  const filtersActive = search.trim() !== '' || severityFilter !== 'all'
  const chips: Array<[Filter, string, number]> = [
    ['all', 'All', issues.length], ['open', 'Open', openN], ['resolved', 'Resolved', resolveN],
  ]

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Comments for ${doc.title}`}
      data-comments-panel
      className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
      style={{
        left: box.left, top: box.top, width: box.width, height: box.height,
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateX(0)' : 'translateX(24px)',
        transition: interacting ? 'none' : `opacity ${ANIM_MS}ms ease-out, transform ${ANIM_MS}ms ease-out`,
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onPointerDown={beginResize}
        title="Drag to resize"
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize touch-none bg-transparent hover:bg-blue-200 active:bg-blue-400"
      />

      <div
        onPointerDown={beginMove}
        title="Drag to move"
        className="flex flex-none cursor-move touch-none select-none items-start justify-between gap-3 border-b border-slate-200 px-5 py-4"
      >
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-bold text-slate-900">{doc.title}</h2>
          <p className="mt-0.5 text-[12px] text-slate-500">
            {isLoading ? 'Loading comments…' : `${openN} open · ${resolveN} resolved`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenDocument()}
          data-action="open-document"
          className="flex-none cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 hover:bg-slate-100"
        >
          Open document
        </button>
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close comments"
          className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      </div>

      <div className="flex flex-none flex-col gap-2.5 border-b border-slate-100 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2" role="tablist">
            {chips.map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  filter === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {label} ({n})
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => { setPostedNote(null); setComposing(true) }}
            disabled={composing}
            data-action="add-comment"
            className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            + Add comment
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search comments…"
            aria-label="Search comments"
            className="h-8 min-w-[140px] flex-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-600"
          />
          <select
            value={severityFilter}
            onChange={e => setSeverityFilter(e.target.value as SeverityFilter)}
            aria-label="Filter by severity"
            className="h-8 rounded-md border border-slate-200 bg-slate-50 px-2 text-[12px] text-slate-900"
          >
            <option value="all">All severities</option>
            <option value="major">Major</option>
            <option value="minor">Minor</option>
            <option value="query">Query</option>
          </select>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            aria-label="Sort comments"
            className="h-8 rounded-md border border-slate-200 bg-slate-50 px-2 text-[12px] text-slate-900"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="severity">Severity</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4" data-comments-list>
        {composing && (
          <CommentComposer
            documentId={doc.id}
            sections={sections}
            defaultSectionId={null}
            onClose={() => setComposing(false)}
            onPosted={c => setPostedNote(`Comment ${c.id} posted.`)}
          />
        )}
        {composing && fullDoc.isLoading && <p className="mb-3 text-[12px] text-slate-400">Loading sections…</p>}
        {postedNote && !composing && (
          <p className="mb-3 rounded-md bg-green-50 p-2 text-center text-[11px] font-semibold text-green-700" role="status" data-posted-note>{postedNote}</p>
        )}

        {isLoading && <p className="text-[13px] text-slate-400">Loading comments…</p>}

        {!isLoading && isError && (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
            <span>Comments could not be loaded.</span>
            <button type="button" onClick={onRetry} className="font-semibold underline">Try again</button>
          </div>
        )}

        {!isLoading && !isError && visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-[13px] text-slate-500" data-empty-comments>
            <p>
              {issues.length === 0 ? 'No comments yet'
                : filtersActive ? 'No comments match your search'
                : `No ${filter} comments`}
            </p>
            {filtersActive && (
              <button type="button" onClick={() => { setSearch(''); setSeverityFilter('all') }} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
                Clear search and filters
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {!isLoading && visible.map(c => {
            const sev = SEVERITY_BADGE[c.severity] ?? SEVERITY_BADGE.minor
            const resolved = c.status === 'resolved'
            return (
              <div key={c.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3" data-comment-card={c.id}>
                <div className="flex w-full items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copyId(c.id)}
                    title="Copy comment ID"
                    data-copy-id={c.id}
                    className="font-mono text-[10px] text-slate-500 hover:text-blue-600"
                  >
                    {copiedId === c.id ? 'Copied ✓' : c.id}
                  </button>
                  {c.sectionRef && (
                    <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>{cleanSectionRef(c.sectionRef)}</span>
                  )}
                  <div className="flex-1" />
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: sev.bg, color: sev.fg }}>{sev.label}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={resolved ? { backgroundColor: '#F0FDF4', color: '#15803D' } : { backgroundColor: '#FFFBEB', color: '#B45309' }}
                  >
                    {resolved ? 'Resolved' : 'Open'}
                  </span>
                </div>
                <div className="flex w-full min-w-0 items-start gap-2">
                  <div className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }}>
                    {c.reviewerInitials || initialsOf(c.reviewerName ?? '')}
                  </div>
                  <div className="min-w-0 break-words text-[13px] text-slate-900">
                    {c.text || <span className="italic text-slate-400">No comment text</span>}
                  </div>
                </div>
                <CommentMeta comment={c} section={sectionOfRef(c.sectionRef, sections)} />

                <div className="flex min-w-0 items-center border-t border-slate-100 pt-2">
                  {(() => {
                    const sec = sectionLabelFor(c.sectionRef, sections)
                    const label = sec.ref ? `Open at ${sec.ref}${sec.title ? ` ${sec.title}` : ''}` : 'Open document'
                    return (
                      <button
                        type="button"
                        onClick={() => onOpenDocument(c)}
                        data-action="open-at-section"
                        title={label}
                        className="min-w-0 max-w-full truncate text-left text-xs font-semibold text-blue-600 hover:text-blue-700"
                      >
                        {label}
                      </button>
                    )
                  })()}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
