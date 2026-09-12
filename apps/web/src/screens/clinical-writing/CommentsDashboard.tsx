import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { Comment, CommentSeverity, ResolutionType } from '@platform/types'
import { documentsApi } from '../../api'

// Static: for the prototype, all comments belong to DOC-001
const CANONICAL_DOC_ID = 'DOC-001'
const DOC_LABEL = 'Clinical Study Report — VELORA-301'
const LOGGED_IN_USER = 'Marcus Webb'

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

const RACI_META_LOCAL: Record<string, { bg: string; fg: string; border?: string }> = {
  R: { bg: '#EFF6FF', fg: '#2563EB' },
  A: { bg: '#F0FDF4', fg: '#15803D' },
  C: { bg: '#F8FAFC', fg: '#64748B', border: '#E2E8F0' },
  I: { bg: '#F8FAFC', fg: '#94A3B8', border: '#E2E8F0' },
}

// Reviewer initials → RACI role (matches study.json team)
const REVIEWER_RACI: Record<string, 'R' | 'A' | 'C' | 'I'> = {
  MW: 'R', SC: 'A', JO: 'C', EV: 'C', PN: 'C', AH: 'C', RT: 'I', LP: 'I',
}

const SEVERITY_META: Record<CommentSeverity, { bg: string; fg: string; label: string; dotColour: string }> = {
  major: { bg: '#FEE2E2', fg: '#DC2626', label: 'Major', dotColour: '#DC2626' },
  minor: { bg: '#FFFBEB', fg: '#B45309', label: 'Minor', dotColour: '#D97706' },
  query: { bg: '#EFF6FF', fg: '#2563EB', label: 'Query', dotColour: '#2563EB' },
}

type FilterKey = 'all' | 'open' | 'resolved' | 'major' | 'minor' | 'query'

const FILTER_CHIPS: { key: FilterKey; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'open',     label: 'Open' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'major',    label: 'Major' },
  { key: 'minor',    label: 'Minor' },
  { key: 'query',    label: 'Query' },
]

// Hardcoded reviewer response list for the "Review progress" card (prototype fixture)
const REVIEWER_STATUS = [
  { initials: 'SC', name: 'Dr. Sarah Chen',    status: 'Responded ✓', tone: '#15803D' },
  { initials: 'EV', name: 'Dr. Elena Vasquez', status: 'Responded ✓', tone: '#15803D' },
  { initials: 'PN', name: 'Dr. Priya Nair',    status: 'Pending',     tone: '#64748B' },
  { initials: 'JO', name: 'Dr. James Okonkwo', status: 'Pending',     tone: '#64748B' },
  { initials: 'AH', name: 'Dr. Amir Hossain',  status: 'Informed',    tone: '#64748B', italic: true },
]

// --- Small primitives ---

function Avatar({ initials, size = 24 }: { initials: string; size?: number }) {
  const c = AVATAR_COLOURS[initials] ?? AVATAR_COLOURS.MW
  return (
    <div
      className="flex flex-none items-center justify-center rounded-full font-mono font-bold"
      style={{
        width: size, height: size,
        backgroundColor: c.bg, color: c.fg,
        fontSize: size >= 24 ? 10 : 9,
      }}
    >
      {initials}
    </div>
  )
}

function RACIBadge({ role }: { role: 'R' | 'A' | 'C' | 'I' }) {
  const m = RACI_META_LOCAL[role]
  return (
    <span
      className="rounded font-mono text-[9px] font-bold"
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

// --- Resolve inline form ---

interface ResolveFormProps {
  onCancel:  () => void
  onConfirm: (type: ResolutionType, note: string) => void
  isPending: boolean
}

function ResolveForm({ onCancel, onConfirm, isPending }: ResolveFormProps) {
  const [type, setType] = useState<ResolutionType>('accept')
  const [note, setNote] = useState('')
  const [err,  setErr]  = useState<string | null>(null)

  const submit = () => {
    if (!note.trim()) { setErr('Resolution note is required'); return }
    onConfirm(type, note.trim())
  }

  return (
    <div
      className="flex flex-col gap-2 rounded border p-2.5"
      style={{ borderColor: '#BFDBFE', backgroundColor: '#EFF6FF' }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-slate-700">Type:</span>
        {(['accept', 'accept-with-modification', 'reject'] as ResolutionType[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors"
            style={type === t ? {
              backgroundColor: '#2563EB', color: '#FFFFFF', border: '1px solid #2563EB',
            } : {
              backgroundColor: '#FFFFFF', color: '#475569', border: '1px solid #E2E8F0',
            }}
          >
            {t === 'accept' ? 'Accept' : t === 'accept-with-modification' ? 'Accept w/ mod' : 'Reject'}
          </button>
        ))}
      </div>
      <label>
        <span className="text-[11px] font-semibold text-slate-700">Resolution note (required)</span>
        <input
          type="text"
          value={note}
          onChange={e => { setNote(e.target.value); if (err) setErr(null) }}
          placeholder="Describe how this comment was resolved"
          className="mt-1 h-8 w-full rounded border px-2 text-[12px] outline-none focus:border-blue-600 focus:shadow-focus"
          style={{ borderColor: '#E2E8F0' }}
          autoFocus
        />
      </label>
      {err && <p className="text-[11px] font-semibold" style={{ color: '#DC2626' }}>{err}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? 'Resolving…' : 'Confirm resolve'}
        </button>
      </div>
    </div>
  )
}

// --- Comment card ---

interface CardProps {
  comment: Comment
  resolvingId: string | null
  onResolveClick: (id: string) => void
  onResolveCancel: () => void
  onResolveConfirm: (id: string, type: ResolutionType, note: string) => void
  isPending: boolean
}

function CommentCard({ comment, resolvingId, onResolveClick, onResolveCancel, onResolveConfirm, isPending }: CardProps) {
  const isResolved  = comment.status === 'resolved'
  const isResolving = resolvingId === comment.id
  const raci        = REVIEWER_RACI[comment.reviewerInitials] ?? 'C'
  const sev         = SEVERITY_META[comment.severity]

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
        <Avatar initials={comment.reviewerInitials} />
        <p className="whitespace-nowrap text-sm font-bold">{comment.reviewerName}</p>
        <RACIBadge role={raci} />
        <div className="flex-1" />
        <span
          className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900"
          style={{ backgroundColor: '#F1F5F9' }}
        >
          {comment.sectionRef}
        </span>
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
        <p className="text-xs text-slate-500">{DOC_LABEL}</p>
      </div>

      {/* Comment text */}
      <p className="text-sm leading-relaxed text-slate-900">{comment.text}</p>

      {/* Resolution note — only when resolved */}
      {isResolved && (
        <div
          className="rounded-md px-2.5 py-2 text-xs leading-relaxed"
          style={{ backgroundColor: '#F0FDF4', color: '#15803D' }}
        >
          Resolved by {LOGGED_IN_USER} · 21 Oct 2024 · Table added to §9.1 per checklist requirement.
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
          onConfirm={(type, note) => onResolveConfirm(comment.id, type, note)}
          isPending={isPending}
        />
      )}

      {/* Action row */}
      {!isResolving && (
        <div className="flex items-center gap-2 border-t pt-2.5" style={{ borderColor: '#F1F5F9' }}>
          {!isResolved ? (
            <>
              <button
                type="button"
                onClick={() => onResolveClick(comment.id)}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                Resolve
              </button>
              <button className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 transition-colors">
                Reply
              </button>
              <div className="flex-1" />
              <button className="whitespace-nowrap text-xs font-semibold text-blue-600 hover:text-blue-700">
                Open in document →
              </button>
            </>
          ) : (
            <>
              <button className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 transition-colors">
                Reopen
              </button>
              <div className="flex-1" />
              <button className="whitespace-nowrap text-xs font-semibold text-blue-600 hover:text-blue-700">
                View resolution →
              </button>
            </>
          )}
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

  const [filter, setFilter] = useState<FilterKey>('all')
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['comments', CANONICAL_DOC_ID],
    queryFn:  () => documentsApi.getComments(CANONICAL_DOC_ID),
  })

  const resolveMut = useMutation({
    mutationFn: (args: { id: string; type: ResolutionType; note: string }) =>
      documentsApi.resolveComment(CANONICAL_DOC_ID, args.id, {
        resolutionType: args.type,
        note:           args.note,
      }),
    onSuccess: () => {
      setResolvingId(null)
      qc.invalidateQueries({ queryKey: ['comments', CANONICAL_DOC_ID] })
    },
  })

  const filtered = useMemo(() => {
    return comments.filter((c: Comment) => {
      switch (filter) {
        case 'all':      return true
        case 'open':     return c.status === 'open'
        case 'resolved': return c.status === 'resolved'
        case 'major':    return c.severity === 'major'
        case 'minor':    return c.severity === 'minor'
        case 'query':    return c.severity === 'query'
      }
    })
  }, [comments, filter])

  // Counts
  const openCount     = comments.filter((c: Comment) => c.status === 'open').length
  const resolvedCount = comments.filter((c: Comment) => c.status === 'resolved').length
  const totalCount    = comments.length
  const resolutionPct = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0

  // By-severity counts (of OPEN comments) — matches spec: "2 Major, 0 Minor, 1 Query, 1 Resolved"
  const openBySeverity: Record<CommentSeverity, number> = {
    major: comments.filter((c: Comment) => c.status === 'open' && c.severity === 'major').length,
    minor: comments.filter((c: Comment) => c.status === 'open' && c.severity === 'minor').length,
    query: comments.filter((c: Comment) => c.status === 'open' && c.severity === 'query').length,
  }

  // By-reviewer counts
  const byReviewer = useMemo(() => {
    const map = new Map<string, { name: string; count: number; resolved: boolean }>()
    for (const c of comments) {
      const cur = map.get(c.reviewerName)
      if (cur) cur.count += 1
      else map.set(c.reviewerName, { name: c.reviewerName, count: 1, resolved: c.status === 'resolved' })
    }
    return [...map.values()]
  }, [comments])

  return (
    <div className="flex h-full flex-col" data-screen="comments-dashboard">

      {/* Page header */}
      <div className="flex flex-none flex-col gap-2.5 border-b border-slate-200 bg-white px-8 py-5">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900 transition-colors">All Projects</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900 transition-colors">VELORA-301</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}/clinical-writing`)} className="hover:text-slate-900 transition-colors">Clinical Writing</button>
          <span className="text-slate-300">›</span>
          <span className="font-semibold text-slate-900">Comments</span>
        </div>
        <div className="flex items-end justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight">Comments</h1>
            <p className="text-sm text-slate-500">
              VELORA-301 · Clinical Writing · {openCount} open · {resolvedCount} resolved
            </p>
          </div>
          <div className="flex flex-none items-center gap-2.5">
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
            >
              Export comments
            </button>
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/clinical-writing/crm`)}
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
        <span className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">All documents ▾</span>
        <span className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">All reviewers ▾</span>
        <span className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">All sections ▾</span>
        <span className="h-5 w-px" style={{ backgroundColor: '#E2E8F0' }} />
        <span className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">Newest first ▾</span>
      </div>

      {/* Main content row */}
      <div className="flex flex-1 items-start gap-6 overflow-auto px-8 py-6">

        {/* Left — cards */}
        <div className="min-w-0 flex-1">
          {isLoading && (
            <p className="p-8 text-center font-mono text-xs text-slate-400">Loading comments…</p>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-8 py-12 text-center">
              <p className="text-sm font-semibold text-slate-900">No comments match this filter</p>
              <button
                onClick={() => setFilter('all')}
                className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Reset filter
              </button>
            </div>
          )}
          {!isLoading && filtered.map((c: Comment) => (
            <CommentCard
              key={c.id}
              comment={c}
              resolvingId={resolvingId}
              onResolveClick={setResolvingId}
              onResolveCancel={() => setResolvingId(null)}
              onResolveConfirm={(id, type, note) => resolveMut.mutate({ id, type, note })}
              isPending={resolveMut.isPending}
            />
          ))}
        </div>

        {/* Right — summary panels */}
        <div className="flex w-[280px] flex-none flex-col gap-3">

          {/* Review progress */}
          <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-[13px] font-bold">Review progress</p>
            <p className="text-xs text-slate-500">Due 05 Nov 2024 · 10 days remaining</p>
            <div className="mt-0.5 flex items-baseline justify-between">
              <p className="text-xs text-slate-900">{resolvedCount} of {totalCount} comments resolved</p>
              <p className="text-xs font-bold" style={{ color: '#2563EB' }}>{resolutionPct}%</p>
            </div>
            <div className="h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
              <div className="h-full transition-all" style={{ width: `${resolutionPct}%`, backgroundColor: '#2563EB' }} />
            </div>
            <div className="border-t pt-1" style={{ borderColor: '#F1F5F9' }}>
              {REVIEWER_STATUS.map(r => (
                <div key={r.initials} className="flex items-center gap-2 py-1.5">
                  <Avatar initials={r.initials} size={20} />
                  <p className="min-w-0 flex-1 truncate text-xs">{r.name}</p>
                  <p
                    className="whitespace-nowrap text-[11px]"
                    style={{ color: r.tone, fontStyle: r.italic ? 'italic' : 'normal' }}
                  >
                    {r.status}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* By severity + By reviewer */}
          <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-[13px] font-bold">By severity</p>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#DC2626' }} />
              <p className="text-xs text-slate-500">Major</p>
              <div className="flex-1" />
              <p className="text-[13px] font-bold">{openBySeverity.major}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#D97706' }} />
              <p className="text-xs text-slate-500">Minor</p>
              <div className="flex-1" />
              <p className="text-[13px] font-bold">{openBySeverity.minor}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#2563EB' }} />
              <p className="text-xs text-slate-500">Query</p>
              <div className="flex-1" />
              <p className="text-[13px] font-bold">{openBySeverity.query}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#15803D' }} />
              <p className="text-xs text-slate-500">Resolved</p>
              <div className="flex-1" />
              <p className="text-[13px] font-bold">{resolvedCount}</p>
            </div>
            <div className="h-px" style={{ backgroundColor: '#E2E8F0' }} />
            <p className="text-[13px] font-bold">By reviewer</p>
            {byReviewer.map(r => (
              <div key={r.name} className="flex items-center justify-between text-xs text-slate-500">
                <span>{r.name}{r.resolved && <span style={{ color: '#94A3B8' }}> · resolved</span>}</span>
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
              {openCount} of {totalCount} comments still open. You can start the CRM now or wait for all resolutions.
            </p>
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/clinical-writing/crm`)}
              className="mt-0.5 w-full rounded-md bg-blue-600 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Start CRM →
            </button>
            <div className="text-center">
              <button className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                Wait for all reviewers
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
