import { ResolveForm } from '../../panels/ResolveCommentForm'
import { cleanSectionRef } from '../../panels/CommentComposer'
import { useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { Comment, CommentSeverity, Document, ResolutionType, TeamMember } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { ApiError } from '../../api/client'

// Comments dashboard (PRD A FR-A-052, AC-A-034) — every review comment across the project's
// documents. Comments are fetched per document (the same cache key the Comments panel and the
// module home use). Reviewer "approve" verdicts are stored as comments but are approvals, not
// review issues, so they're left out here.

// The API returns a few fields the shared Comment type doesn't declare yet.
type ProjectComment = Comment & {
  resolvedBy?: string | null
  resolvedAt?: string | null
  resolutionNote?: string | null
  documentTitle: string
}

const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: '#DBEAFE', fg: '#1D4ED8' },
  { bg: '#F0FDF4', fg: '#15803D' },
  { bg: '#F5F3FF', fg: '#7C3AED' },
  { bg: '#FEF3C7', fg: '#D97706' },
  { bg: '#FEE2E2', fg: '#DC2626' },
  { bg: '#E0F2FE', fg: '#0369A1' },
  { bg: '#FCE7F3', fg: '#9D174D' },
]

const RACI_META_LOCAL: Record<string, { bg: string; fg: string; border?: string }> = {
  R: { bg: '#EFF6FF', fg: '#2563EB' },
  A: { bg: '#F0FDF4', fg: '#15803D' },
  C: { bg: '#F8FAFC', fg: '#64748B', border: '#E2E8F0' },
  I: { bg: '#F8FAFC', fg: '#94A3B8', border: '#E2E8F0' },
}

const SEVERITY_META: Record<CommentSeverity, { bg: string; fg: string; label: string; dotColour: string }> = {
  major: { bg: '#FEE2E2', fg: '#DC2626', label: 'Major', dotColour: '#DC2626' },
  minor: { bg: '#FFFBEB', fg: '#B45309', label: 'Minor', dotColour: '#D97706' },
  query: { bg: '#EFF6FF', fg: '#2563EB', label: 'Query', dotColour: '#2563EB' },
}
const SEVERITY_RANK: Record<CommentSeverity, number> = { major: 0, minor: 1, query: 2 }

type FilterKey = 'all' | 'open' | 'resolved' | 'major' | 'minor' | 'query'
type SortKey = 'newest' | 'oldest' | 'severity'

const FILTER_CHIPS: { key: FilterKey; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'open',     label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'major',    label: 'Major' },
  { key: 'minor',    label: 'Minor' },
  { key: 'query',    label: 'Query' },
]

// --- Small helpers ---

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Initials skip honorifics, so "Dr Elena Vasquez" → "EV", not "DE".
const initialsOf = (name: string) =>
  name.trim().split(/\s+/).filter(w => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w))
    .slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?'

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

const RESOLUTION_LABEL: Record<string, string> = {
  accept:                   'Accepted',
  accept_with_modification: 'Accepted with modification',
  reject:                   'Rejected',
}

// Resolution notes are stored with a tag in front: "[accept] text" when resolved directly, or
// "[CRM:CRM-002:accept_with_modification] text" when resolved in a CRM meeting. Split it off.
function parseResolutionNote(note: string | null | undefined): { text: string; viaCrm: string | null; decision: string | null } {
  const raw = note ?? ''
  const crm = /^\[CRM:([^:\]]+):([^\]]*)\]\s*/.exec(raw)
  if (crm) return { text: raw.slice(crm[0].length), viaCrm: crm[1], decision: RESOLUTION_LABEL[crm[2]] ?? null }
  const plain = /^\[([a-z_]+)\]\s*/.exec(raw)
  if (plain && RESOLUTION_LABEL[plain[1]]) return { text: raw.slice(plain[0].length), viaCrm: null, decision: RESOLUTION_LABEL[plain[1]] }
  return { text: raw, viaCrm: null, decision: null }
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// --- Small primitives ---

function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const c = AVATAR_PALETTE[hashString(name) % AVATAR_PALETTE.length]
  return (
    <div
      className="flex flex-none items-center justify-center rounded-full font-mono font-bold"
      style={{
        width: size, height: size,
        backgroundColor: c.bg, color: c.fg,
        fontSize: size >= 24 ? 10 : 9,
      }}
    >
      {initialsOf(name)}
    </div>
  )
}

function RACIBadge({ role }: { role: 'R' | 'A' | 'C' | 'I' }) {
  const m = RACI_META_LOCAL[role]
  return (
    <span
      className="rounded font-mono text-[9px] font-bold"
      title="Role on this project (RACI)"
      style={{
        backgroundColor: m.bg,
        color: m.fg,
        border: m.border ? `1px solid ${m.border}` : undefined,
        padding: '2px 6px',
      }}
    >
      {role}
    </span>
  )
}

function DocIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="#94A3B8" strokeWidth="1.3">
      <rect x="2.4" y="1.4" width="9.2" height="11.2" rx="1.2"/>
      <rect x="4.4" y="4.2" width="5.2" height="1.2" rx="0.6" fill="#94A3B8"/>
      <rect x="4.4" y="7" width="5.2" height="1.2" rx="0.6" fill="#94A3B8"/>
    </svg>
  )
}

function FilterSelect({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="max-w-[220px] rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

// --- Comment card ---

interface CardProps {
  comment: ProjectComment
  raci: 'R' | 'A' | 'C' | 'I' | null
  resolverName: string | null
  resolvingId: string | null
  onResolveClick: (id: string) => void
  onResolveCancel: () => void
  onResolveConfirm: (comment: ProjectComment, type: ResolutionType, note: string) => void
  onOpen: (comment: ProjectComment) => void
  isPending: boolean
  resolveError: string | null
}

function CommentCard({ comment, raci, resolverName, resolvingId, onResolveClick, onResolveCancel, onResolveConfirm, onOpen, isPending, resolveError }: CardProps) {
  const isResolved  = comment.status === 'resolved'
  const isResolving = resolvingId === comment.id
  const sev         = SEVERITY_META[comment.severity] ?? SEVERITY_META.minor
  const resolution  = parseResolutionNote(comment.resolutionNote)

  const cardStyle = isResolved
    ? { borderColor: '#BBF7D0', backgroundColor: '#F0FDF4' }
    : { borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' }

  return (
    <div
      data-comment-id={comment.id}
      data-status={comment.status}
      className="mb-3 flex flex-col gap-2.5 rounded-lg border p-4"
      style={cardStyle}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Avatar name={comment.reviewerName ?? ''} />
        <p className="whitespace-nowrap text-sm font-bold">{comment.reviewerName}</p>
        {raci && <RACIBadge role={raci} />}
        <div className="flex-1" />
        {comment.sectionRef && (
          <span
            className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900"
            style={{ backgroundColor: '#F1F5F9' }}
          >
            {cleanSectionRef(comment.sectionRef)}
          </span>
        )}
        <p className="whitespace-nowrap font-mono text-[9px] tracking-wider text-slate-500">{comment.id}</p>
        <p className="whitespace-nowrap text-xs text-slate-500">{comment.age}</p>
        {isResolved ? (
          <span
            className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ backgroundColor: '#F0FDF4', color: '#15803D' }}
          >
            Resolved ✓
          </span>
        ) : (
          <span
            className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
          >
            Open
          </span>
        )}
      </div>

      {/* Doc reference */}
      <div className="flex items-center gap-2">
        <DocIcon />
        <p className="text-xs text-slate-500">{comment.documentTitle}</p>
      </div>

      {/* Comment text */}
      <p className="text-sm leading-relaxed text-slate-900">
        {comment.text || <span className="italic text-slate-400">No comment text</span>}
      </p>

      {/* Resolution note — only when resolved */}
      {isResolved && (
        <div
          className="rounded-md px-2.5 py-2 text-xs leading-relaxed"
          style={{ backgroundColor: '#F0FDF4', color: '#15803D' }}
          data-resolution
        >
          {resolution.decision ?? 'Resolved'}
          {resolverName ? ` by ${resolverName}` : ''}
          {comment.resolvedAt ? ` · ${fmtDate(comment.resolvedAt)}` : ''}
          {resolution.viaCrm ? ` · in CRM ${resolution.viaCrm}` : ''}
          {resolution.text ? ` · ${resolution.text}` : ''}
        </div>
      )}

      {/* Severity row */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">Severity:</span>
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: sev.bg, color: sev.fg }}
        >
          {sev.label}
        </span>
      </div>

      {/* Resolve inline form */}
      {isResolving && (
        <ResolveForm
          onCancel={onResolveCancel}
          onConfirm={(type, note) => onResolveConfirm(comment, type, note)}
          isPending={isPending}
          error={resolveError}
        />
      )}

      {/* Action row */}
      {!isResolving && (
        <div className="flex items-center gap-2 border-t pt-2.5" style={{ borderColor: '#F1F5F9' }}>
          {!isResolved && (
            <>
              <button
                type="button"
                onClick={() => onResolveClick(comment.id)}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                Resolve
              </button>
              <button
                type="button"
                disabled
                title="Replies aren't available yet"
                className="cursor-not-allowed rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-400"
              >
                Reply
              </button>
            </>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => onOpen(comment)}
            className="whitespace-nowrap text-xs font-semibold text-blue-600 hover:text-blue-700"
            data-action="open-in-document"
          >
            {isResolved ? 'View in document →' : 'Open in document →'}
          </button>
        </div>
      )}
    </div>
  )
}

// --- Main screen ---

export function CommentsDashboard() {
  const { projectId } = useParams()
  const navigate      = useNavigate()
  const qc            = useQueryClient()

  const [filter, setFilter]           = useState<FilterKey>('all')
  const [docFilter, setDocFilter]     = useState('all')
  const [reviewerFilter, setReviewer] = useState('all')
  const [sectionFilter, setSection]   = useState('all')
  const [sort, setSort]               = useState<SortKey>('newest')
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId!),
    enabled:  !!projectId,
  })

  const { data: documents = [], isLoading: docsLoading } = useQuery({
    queryKey: ['documents', projectId],
    queryFn:  () => documentsApi.list(projectId!),
    enabled:  !!projectId,
  })

  const commentQueries = useQueries({
    queries: documents.map((d: Document) => ({
      queryKey: ['comments', d.id],
      queryFn:  () => documentsApi.getComments(d.id),
      staleTime: 30_000,
    })),
  })
  const isLoading      = docsLoading || commentQueries.some(q => q.isLoading)
  const someFailed     = commentQueries.some(q => q.isError)

  const docTitleById = new Map(documents.map((d: Document) => [d.id, d.title]))
  const comments: ProjectComment[] = commentQueries
    .flatMap(q => (q.data ?? []) as ProjectComment[])
    .filter(c => c.verdict !== 'approve')
    .map(c => ({ ...c, documentTitle: docTitleById.get(c.documentId) ?? c.documentId }))

  // Project team → RACI badge + resolver names. People outside the team get no badge.
  const teamById = useMemo(() => {
    const map = new Map<string, TeamMember>()
    project?.team.forEach(t => map.set(t.userId, t))
    return map
  }, [project])
  // Reviewer ids → names, from the comments themselves (covers people outside the team).
  const nameById = new Map<string, string>()
  comments.forEach(c => { if (c.reviewerId && c.reviewerName) nameById.set(c.reviewerId, c.reviewerName) })
  const resolverNameOf = (c: ProjectComment) =>
    c.resolvedBy ? (teamById.get(c.resolvedBy)?.name ?? nameById.get(c.resolvedBy) ?? null) : null

  const resolveMut = useMutation({
    mutationFn: (args: { comment: ProjectComment; type: ResolutionType; note: string }) =>
      documentsApi.resolveComment(args.comment.documentId, args.comment.id, {
        resolutionType: args.type,
        note:           args.note,
      }),
    onSuccess: (_data, args) => {
      setResolvingId(null)
      qc.invalidateQueries({ queryKey: ['comments', args.comment.documentId] })
    },
  })
  const resolveError = resolveMut.isError
    ? resolveMut.error instanceof ApiError && resolveMut.error.status === 403
      ? "You don't have permission to resolve this comment."
      : 'Could not resolve the comment. Please try again.'
    : null

  // Dropdown options come from the loaded comments.
  const docOptions = [...new Set(comments.map(c => c.documentId))]
    .map(id => ({ value: id, label: docTitleById.get(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const reviewerOptions = [...new Set(comments.map(c => c.reviewerName).filter(Boolean))].sort()
  const sectionOptions  = [...new Set(comments.map(c => c.sectionRef).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  const filtered = comments
    .filter(c => {
      switch (filter) {
        case 'all':      break
        case 'open':     if (c.status !== 'open') return false; break
        case 'resolved': if (c.status !== 'resolved') return false; break
        default:         if (c.severity !== filter) return false
      }
      if (docFilter !== 'all' && c.documentId !== docFilter) return false
      if (reviewerFilter !== 'all' && c.reviewerName !== reviewerFilter) return false
      if (sectionFilter !== 'all' && c.sectionRef !== sectionFilter) return false
      return true
    })
    .sort((a, b) => {
      if (sort === 'oldest') return a.createdAt.localeCompare(b.createdAt)
      if (sort === 'severity') return (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.createdAt.localeCompare(a.createdAt)
      return b.createdAt.localeCompare(a.createdAt)
    })
  const filtersDirty = filter !== 'all' || docFilter !== 'all' || reviewerFilter !== 'all' || sectionFilter !== 'all'
  const resetFilters = () => { setFilter('all'); setDocFilter('all'); setReviewer('all'); setSection('all') }

  // Counts
  const openCount     = comments.filter(c => c.status === 'open').length
  const resolvedCount = comments.filter(c => c.status === 'resolved').length
  const totalCount    = comments.length
  const resolutionPct = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0

  // By-severity counts (of OPEN comments)
  const openBySeverity: Record<CommentSeverity, number> = {
    major: comments.filter(c => c.status === 'open' && c.severity === 'major').length,
    minor: comments.filter(c => c.status === 'open' && c.severity === 'minor').length,
    query: comments.filter(c => c.status === 'open' && c.severity === 'query').length,
  }

  // By reviewer — total comments and how many are still open
  const byReviewer = (() => {
    const map = new Map<string, { name: string; count: number; open: number }>()
    for (const c of comments) {
      const cur = map.get(c.reviewerName) ?? { name: c.reviewerName, count: 0, open: 0 }
      cur.count += 1
      if (c.status === 'open') cur.open += 1
      map.set(c.reviewerName, cur)
    }
    return [...map.values()].sort((a, b) => b.open - a.open || b.count - a.count)
  })()

  // The document with the most open comments is the natural one to take into CRM.
  const crmDocId = (() => {
    const openByDoc = new Map<string, number>()
    comments.forEach(c => { if (c.status === 'open') openByDoc.set(c.documentId, (openByDoc.get(c.documentId) ?? 0) + 1) })
    return [...openByDoc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  })()
  const startCrm = () => navigate(`/projects/${projectId}/clinical-writing/crm${crmDocId ? `?doc=${encodeURIComponent(crmDocId)}` : ''}`)

  const openInDocument = (c: ProjectComment) =>
    navigate(`/projects/${projectId}/clinical-writing/documents/${c.documentId}/review?panel=comments`)

  // CSV of the comments currently shown (respects the filters).
  const exportCsv = () => {
    const header = ['Comment ID', 'Document', 'Section', 'Severity', 'Status', 'Reviewer', 'Comment', 'Created', 'Resolved by', 'Resolved at', 'Decision', 'Resolution note']
    const rows = filtered.map(c => {
      const r = parseResolutionNote(c.resolutionNote)
      return [
        c.id, c.documentTitle, c.sectionRef, SEVERITY_META[c.severity]?.label ?? c.severity, c.status,
        c.reviewerName, c.text, c.createdAt, resolverNameOf(c) ?? c.resolvedBy ?? '', c.resolvedAt ?? '',
        r.decision ?? '', r.text,
      ]
    })
    const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = window.document.createElement('a')
    a.href = url
    a.download = `comments-${project?.shortTitle ?? projectId}-${new Date().toISOString().slice(0, 10)}.csv`
    window.document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const projectLabel = project?.shortTitle ?? '…'

  return (
    <div className="flex h-full flex-col" data-screen="comments-dashboard">

      {/* Page header */}
      <div className="flex flex-none flex-col gap-2.5 border-b border-slate-200 bg-white px-8 py-5">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900 transition-colors">All Projects</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900 transition-colors">{projectLabel}</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}/clinical-writing`)} className="hover:text-slate-900 transition-colors">Clinical Writing</button>
          <span className="text-slate-300">›</span>
          <span className="font-semibold text-slate-900">Comments</span>
        </div>
        <div className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight">Comments</h1>
            <p className="text-sm text-slate-500">
              {projectLabel} · Clinical Writing · {isLoading ? '…' : `${openCount} open · ${resolvedCount} resolved`}
            </p>
          </div>
          <div className="flex flex-none items-center gap-2.5">
            <button
              type="button"
              onClick={exportCsv}
              disabled={isLoading || filtered.length === 0}
              title="Download the comments currently shown as a CSV file"
              className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              data-action="export-comments"
            >
              Export comments
            </button>
            <button
              type="button"
              onClick={startCrm}
              className="rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Start CRM →
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-none flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-8 py-3">
        {FILTER_CHIPS.map(chip => {
          const active = filter === chip.key
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors"
              style={active ? {
                border: '1px solid #2563EB', backgroundColor: '#EFF6FF', color: '#1D4ED8',
              } : {
                border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', color: '#475569',
              }}
            >
              {chip.label}
            </button>
          )
        })}
        <span className="h-5 w-px" style={{ backgroundColor: '#E2E8F0' }} />
        <FilterSelect label="Filter by document" value={docFilter} onChange={setDocFilter}
          options={[{ value: 'all', label: 'All documents' }, ...docOptions]} />
        <FilterSelect label="Filter by reviewer" value={reviewerFilter} onChange={setReviewer}
          options={[{ value: 'all', label: 'All reviewers' }, ...reviewerOptions.map(r => ({ value: r, label: r }))]} />
        <FilterSelect label="Filter by section" value={sectionFilter} onChange={setSection}
          options={[{ value: 'all', label: 'All sections' }, ...sectionOptions.map(s => ({ value: s, label: s }))]} />
        <span className="h-5 w-px" style={{ backgroundColor: '#E2E8F0' }} />
        <FilterSelect label="Sort comments" value={sort} onChange={v => setSort(v as SortKey)}
          options={[
            { value: 'newest',   label: 'Newest first' },
            { value: 'oldest',   label: 'Oldest first' },
            { value: 'severity', label: 'Severity (Major first)' },
          ]} />
        {filtersDirty && (
          <button type="button" onClick={resetFilters} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
            Reset filters
          </button>
        )}
      </div>

      {/* Main content row */}
      <div className="flex flex-1 items-start gap-6 overflow-auto px-8 py-6">

        {/* Left — cards */}
        <div className="min-w-0 flex-1">
          {someFailed && (
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert">
              Some documents' comments could not be loaded, so this list may be incomplete.
            </p>
          )}
          {isLoading && (
            <p className="p-8 text-center font-mono text-xs text-slate-400">Loading comments…</p>
          )}
          {!isLoading && totalCount === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-8 py-12 text-center" data-empty-comments>
              <p className="text-sm font-semibold text-slate-900">No review comments in this project yet</p>
              <p className="mt-1 text-xs text-slate-500">Comments added in a document's Reviewer View appear here.</p>
            </div>
          )}
          {!isLoading && totalCount > 0 && filtered.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-8 py-12 text-center">
              <p className="text-sm font-semibold text-slate-900">No comments match these filters</p>
              <button
                onClick={resetFilters}
                className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Reset filters
              </button>
            </div>
          )}
          {!isLoading && filtered.map(c => (
            <CommentCard
              key={c.id}
              comment={c}
              raci={(teamById.get(c.reviewerId)?.raci as 'R' | 'A' | 'C' | 'I' | undefined) ?? null}
              resolverName={resolverNameOf(c)}
              resolvingId={resolvingId}
              onResolveClick={id => { resolveMut.reset(); setResolvingId(id) }}
              onResolveCancel={() => setResolvingId(null)}
              onResolveConfirm={(comment, type, note) => resolveMut.mutate({ comment, type, note })}
              onOpen={openInDocument}
              isPending={resolveMut.isPending}
              resolveError={resolveError}
            />
          ))}
        </div>

        {/* Right — summary panels */}
        <div className="flex w-[280px] flex-none flex-col gap-3">

          {/* Review progress */}
          <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-[13px] font-bold">Review progress</p>
            <div className="mt-0.5 flex items-baseline justify-between">
              <p className="text-xs text-slate-900">{resolvedCount} of {totalCount} comments resolved</p>
              <p className="text-xs font-bold" style={{ color: '#2563EB' }}>{resolutionPct}%</p>
            </div>
            <div className="h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
              <div className="h-full transition-all" style={{ width: `${resolutionPct}%`, backgroundColor: '#2563EB' }} />
            </div>
            {byReviewer.length > 0 && (
              <div className="border-t pt-1" style={{ borderColor: '#F1F5F9' }}>
                {byReviewer.map(r => (
                  <div key={r.name} className="flex items-center gap-2 py-1.5">
                    <Avatar name={r.name} size={20} />
                    <p className="min-w-0 flex-1 truncate text-xs">{r.name}</p>
                    <p className="whitespace-nowrap text-[11px]" style={{ color: r.open ? '#B45309' : '#15803D' }}>
                      {r.open ? `${r.open} open` : 'All resolved ✓'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* By severity + By reviewer */}
          <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-[13px] font-bold">By severity <span className="font-normal text-slate-400">(open)</span></p>
            {(['major', 'minor', 'query'] as const).map(s => (
              <div key={s} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SEVERITY_META[s].dotColour }} />
                <p className="text-xs text-slate-500">{SEVERITY_META[s].label}</p>
                <div className="flex-1" />
                <p className="text-[13px] font-bold">{openBySeverity[s]}</p>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#15803D' }} />
              <p className="text-xs text-slate-500">Resolved</p>
              <div className="flex-1" />
              <p className="text-[13px] font-bold">{resolvedCount}</p>
            </div>
            <div className="h-px" style={{ backgroundColor: '#E2E8F0' }} />
            <p className="text-[13px] font-bold">By reviewer</p>
            {byReviewer.length === 0 && <p className="text-xs text-slate-400">No comments yet.</p>}
            {byReviewer.map(r => (
              <div key={r.name} className="flex items-center justify-between text-xs text-slate-500">
                <span className="min-w-0 truncate">{r.name}</span>
                <span className="font-bold" style={{ color: '#1E293B' }}>{r.count}</span>
              </div>
            ))}
          </div>

          {/* Ready for CRM? */}
          <div
            className="flex flex-col gap-2 rounded-lg bg-white p-4"
            style={{ border: '2px solid #2563EB' }}
          >
            <p className="text-[13px] font-bold">Ready for CRM?</p>
            <p className="text-xs leading-relaxed text-slate-500">
              {totalCount === 0
                ? 'No review comments yet.'
                : `${openCount} of ${totalCount} comments still open. Open comments get a recorded decision in the Comments Resolution Meeting.`}
            </p>
            <button
              type="button"
              onClick={startCrm}
              className="mt-0.5 w-full rounded-md bg-blue-600 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Start CRM →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
