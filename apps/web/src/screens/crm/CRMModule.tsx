import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Comment, ResolutionType } from '@platform/types'
import { crmApi, documentsApi } from '../../api'
import { useCRMStore } from '../../store'
import { CommentResolutionPanel } from '../../panels/CommentResolutionPanel'

const CANONICAL_DOC_ID = 'DOC-001'
const LOGGED_IN_USER   = 'Marcus Webb'

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

// Pre-populated resolution note for the resolved comment (CMT-041)
const RESOLVED_LOG_NOTE = 'CI will be amended to two decimal places throughout §11.4. Marcus Webb to update before final QC.'

function Avatar({ initials, size = 20 }: { initials: string; size?: number }) {
  const c = AVATAR_COLOURS[initials] ?? AVATAR_COLOURS.MW
  return (
    <div
      className="flex flex-none items-center justify-center rounded-full font-mono font-bold"
      style={{
        width: size, height: size,
        backgroundColor: c.bg, color: c.fg,
        fontSize: size >= 20 ? 10 : 9,
      }}
    >
      {initials}
    </div>
  )
}

function MonoLabel({ children, color = '#64748B' }: { children: React.ReactNode; color?: string }) {
  return (
    <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color }}>
      {children}
    </p>
  )
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5 py-1.5 text-[13px]">
      <span className="flex-none text-slate-500">{label}</span>
      <span
        className="truncate text-right"
        style={mono ? { fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#475569', fontWeight: 500 } : { fontWeight: 600, color: '#1E293B' }}
      >
        {value}
      </span>
    </div>
  )
}

// --- Comment cards in three states ---

function ResolvedCard({ comment }: { comment: Comment }) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg p-4"
      style={{ border: '1px solid #BBF7D0', backgroundColor: '#F0FDF4' }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9px] tracking-wider text-slate-500">{comment.id}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900" style={{ backgroundColor: '#F1F5F9' }}>{comment.sectionRef}</span>
        <div className="flex-1" />
        <span
          className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ backgroundColor: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' }}
        >
          Resolved ✓
        </span>
      </div>

      {/* Reviewer */}
      <div className="flex items-center gap-2">
        <Avatar initials={comment.reviewerInitials} size={18} />
        <p className="text-xs text-slate-500">{comment.reviewerName}</p>
        <p className="font-mono text-[9px] tracking-wider text-slate-500">· CONSULTED</p>
      </div>

      {/* Muted italic text */}
      <p className="text-[13px] italic leading-relaxed text-slate-500">{comment.text}</p>

      {/* Resolution */}
      <div className="mt-0.5 flex flex-col gap-1.5 border-t pt-2.5" style={{ borderColor: '#BBF7D0' }}>
        <MonoLabel color="#15803D">Resolution</MonoLabel>
        <div>
          <span
            className="inline-block rounded border px-2 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' }}
          >
            Accept with modification
          </span>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: '#15803D' }}>{RESOLVED_LOG_NOTE}</p>
        <p className="text-[11px] text-slate-500">Resolved by {LOGGED_IN_USER} · 14:23 UTC</p>
      </div>
    </div>
  )
}

function ActiveCard({
  comment,
  onResolve,
}: {
  comment: Comment
  onResolve: (type: ResolutionType) => void
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg p-4"
      style={{
        border:          '2px solid #2563EB',
        backgroundColor: '#FFFFFF',
        boxShadow:       '0 0 0 3px rgba(37,99,235,0.08)',
      }}
    >
      <MonoLabel color="#2563EB">Active discussion</MonoLabel>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9px] tracking-wider text-slate-500">{comment.id}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900" style={{ backgroundColor: '#F1F5F9' }}>{comment.sectionRef}</span>
        <div className="flex-1" />
        <span
          className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}
        >
          In discussion
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Avatar initials={comment.reviewerInitials} size={18} />
        <p className="text-xs text-slate-500">{comment.reviewerName}</p>
        <p className="font-mono text-[9px] tracking-wider text-slate-500">· CONSULTED</p>
      </div>

      <p className="text-[13px] leading-relaxed text-slate-900">{comment.text}</p>

      {/* Source excerpt */}
      <div className="mt-0.5 rounded-md border px-3 py-2.5" style={{ borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' }}>
        <MonoLabel>SOURCE EXCERPT · §12.2</MonoLabel>
        <p className="mt-1 text-xs italic leading-relaxed text-slate-500">
          Treatment-emergent adverse events (TEAEs)… Grade ≥3 TEAE in the Veloricept arm was{' '}
          <span className="rounded px-0.5" style={{ backgroundColor: '#FEF3C7' }}>pneumonitis</span>{' '}(6.2%)…
        </p>
      </div>

      {/* Actions */}
      <div className="mt-1 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: '#E2E8F0' }}>
        <span className="text-xs text-slate-500">Resolve as:</span>
        <button
          type="button"
          onClick={() => onResolve('accept')}
          className="rounded-md border px-3 py-1.5 text-xs font-semibold hover:opacity-90 transition-colors"
          style={{ backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' }}
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => onResolve('accept-with-modification')}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
        >
          Accept with modification
        </button>
        <button
          type="button"
          onClick={() => onResolve('reject')}
          className="rounded-md border px-3 py-1.5 text-xs font-semibold hover:opacity-90 transition-colors"
          style={{ backgroundColor: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' }}
        >
          Reject
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onResolve('accept')}
          className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          Resolve →
        </button>
      </div>
    </div>
  )
}

function PendingCard({ comment, onSelect }: { comment: Comment; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-status="pending"
      className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 text-left transition-opacity hover:opacity-100"
      style={{ opacity: 0.6 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9px] tracking-wider text-slate-500">{comment.id}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#94A3B8' }}>{comment.sectionRef}</span>
        <div className="flex-1" />
        <span
          className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={{ backgroundColor: '#F8FAFC', color: '#64748B', border: '1px solid #E2E8F0' }}
        >
          Pending
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Avatar initials={comment.reviewerInitials} size={18} />
        <p className="text-xs text-slate-500">{comment.reviewerName}</p>
      </div>
      <p className="text-[13px] leading-relaxed text-slate-500">{comment.text}</p>
    </button>
  )
}

// --- Main screen ---

export function CRMModule() {
  const { projectId } = useParams()
  const navigate      = useNavigate()

  const meeting            = useCRMStore(s => s.meeting)
  const activeCommentId    = useCRMStore(s => s.activeCommentId)
  const resolutionDraft    = useCRMStore(s => s.resolutionDraft)
  const setMeeting         = useCRMStore(s => s.setMeeting)
  const setActiveComment   = useCRMStore(s => s.setActiveComment)
  const setResolutionDraft = useCRMStore(s => s.setResolutionDraft)

  // Fetch meetings for the document
  const { data: meetings = [] } = useQuery({
    queryKey: ['crm-meetings', CANONICAL_DOC_ID],
    queryFn:  () => crmApi.getMeetings(CANONICAL_DOC_ID),
  })

  const { data: comments = [] } = useQuery({
    queryKey: ['comments', CANONICAL_DOC_ID],
    queryFn:  () => documentsApi.getComments(CANONICAL_DOC_ID),
  })

  // Hydrate store when meeting loads
  useEffect(() => {
    if (meetings.length > 0 && (!meeting || meeting.id !== meetings[0].id)) {
      setMeeting(meetings[0])
      // Also seed active comment from fixture's activeId
      if (meetings[0].activeId) setActiveComment(meetings[0].activeId)
    }
  }, [meetings, meeting, setMeeting, setActiveComment])

  // Look up comments referenced by the meeting
  const commentsById = useMemo(() => {
    const m = new Map<string, Comment>()
    comments.forEach((c: Comment) => m.set(c.id, c))
    return m
  }, [comments])

  const orderedCommentIds = meeting?.commentIds ?? []
  const resolvedCount = meeting?.resolvedIds.length ?? 0
  const totalCount    = orderedCommentIds.length
  const pct           = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0
  const remaining     = totalCount - resolvedCount

  const handleSelectPending = (id: string) => {
    setActiveComment(id)
  }

  const handleResolve = (commentId: string, type: ResolutionType) => {
    setResolutionDraft({ commentId, type, note: '', resolvedBy: LOGGED_IN_USER })
    // Screen 19 (Comment Resolution panel) will build the full draft-editing flow
    console.log('[crm] open resolution draft', { commentId, type })
  }

  const handleEndMeeting = () => {
    console.log('[crm] end meeting', { meetingId: meeting?.id })
  }

  const isResolved = (id: string) => meeting?.resolvedIds.includes(id) ?? false

  if (!meeting) {
    return <div className="flex h-full items-center justify-center"><p className="font-mono text-sm text-slate-400">Loading meeting…</p></div>
  }

  const chairName = meeting.chair.name
  const meetingDateLabel = new Date(meeting.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const startedAtLabel = meeting.startedAt
    ? new Date(meeting.startedAt).toISOString().slice(11, 16) + ' UTC'
    : meeting.startTime

  return (
    <div className="relative flex h-full flex-col">

      {/* Page header */}
      <div className="flex flex-none flex-col gap-2.5 border-b border-slate-200 bg-white px-8 py-5">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900 transition-colors">All Projects</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900 transition-colors">VELORA-301</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}/clinical-writing`)} className="hover:text-slate-900 transition-colors">Clinical Writing</button>
          <span className="text-slate-300">›</span>
          <span className="font-semibold text-slate-900">CRM</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">Comments Resolution Meeting</h1>
            <p className="text-[13px] text-slate-500">
              {meeting.meetingRef} · VELORA-301 CSR · {meetingDateLabel} · {meeting.startTime}–{meeting.endTime}
            </p>
          </div>
          <div className="flex-1" />
          <div
            className="flex flex-none items-center gap-2 rounded-full px-3.5 py-1.5"
            style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}
          >
            <span
              className="h-2 w-2 rounded-full animate-pulse-green"
              style={{ backgroundColor: '#16A34A' }}
            />
            <span className="whitespace-nowrap text-[13px] font-semibold" style={{ color: '#15803D' }}>
              Meeting in progress
            </span>
          </div>
          <button
            type="button"
            onClick={handleEndMeeting}
            className="whitespace-nowrap rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors hover:opacity-90"
            style={{ backgroundColor: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' }}
          >
            End meeting
          </button>
        </div>
      </div>

      {/* 3-panel row */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left panel */}
        <div className="flex w-[280px] flex-none flex-col overflow-y-auto border-r border-slate-200" style={{ backgroundColor: '#F8FAFC' }}>

          {/* Meeting details */}
          <div className="border-b border-slate-200 p-4">
            <div className="mb-2.5"><MonoLabel>Meeting details</MonoLabel></div>
            <MetaRow label="Chair"    value={chairName} />
            <MetaRow label="Document" value="CSR — VELORA-301" />
            <MetaRow label="Version"  value={`${meeting.version} · Draft`} mono />
            <MetaRow label="Started"  value={startedAtLabel} />
          </div>

          {/* Attendees */}
          <div className="border-b border-slate-200 p-4">
            <div className="mb-2.5"><MonoLabel>Attendees</MonoLabel></div>
            <div className="flex min-w-0 items-center gap-2 py-1">
              <Avatar initials={meeting.chair.initials} />
              <p className="min-w-0 flex-1 truncate text-[13px]">{meeting.chair.name}</p>
              <p className="font-mono text-[9px] tracking-wider text-slate-500">Chair</p>
            </div>
            {meeting.attendees.map(a => (
              <div key={a.userId} className="flex min-w-0 items-center gap-2 py-1">
                <Avatar initials={a.initials} />
                <p className="min-w-0 flex-1 truncate text-[13px]">{a.name}</p>
                <p className="font-mono text-[9px] tracking-wider text-slate-500">{a.role}</p>
              </div>
            ))}
            <button className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700">＋ Invite</button>
          </div>

          {/* Meeting progress */}
          <div className="border-b border-slate-200 p-4">
            <div className="mb-2.5"><MonoLabel>Meeting progress</MonoLabel></div>
            <div className="flex items-baseline justify-between">
              <p className="text-xs text-slate-900">{resolvedCount} of {totalCount} comments resolved</p>
              <p className="text-xs font-bold" style={{ color: '#2563EB' }}>{pct}%</p>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
              <div className="h-full" style={{ width: `${pct}%`, backgroundColor: '#2563EB' }} />
            </div>
            <div className="mt-2">
              {orderedCommentIds.map(cid => {
                const resolved = isResolved(cid)
                const active   = activeCommentId === cid && !resolved
                const dotBg    = resolved ? '#16A34A' : active ? '#2563EB' : '#CBD5E1'
                const status   = resolved ? 'Resolved ✓' : active ? 'In discussion' : 'Pending'
                const statusColour = resolved ? '#15803D' : active ? '#2563EB' : '#64748B'
                return (
                  <div key={cid} className="flex items-center gap-1.5 py-0.5 text-xs">
                    <span
                      className={`h-1.5 w-1.5 flex-none rounded-full ${active ? 'animate-pulse-blue' : ''}`}
                      style={{ backgroundColor: dotBg }}
                    />
                    <span className="font-mono text-[9px] tracking-wider text-slate-500">{cid}</span>
                    <div className="flex-1" />
                    <span className="whitespace-nowrap" style={{ color: statusColour, fontWeight: active ? 600 : 400 }}>
                      {status}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="p-4">
            <button
              type="button"
              className="mb-2 w-full rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Export minutes
            </button>
            <div className="text-center">
              <button className="text-xs font-semibold text-blue-600 hover:text-blue-700">Add meeting note</button>
            </div>
          </div>
        </div>

        {/* Centre panel */}
        <div className="flex flex-1 min-w-0 flex-col overflow-y-auto border-r border-slate-200 bg-white p-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="text-base font-bold">Resolution Queue</h2>
            <div className="flex-1" />
            <p className="whitespace-nowrap text-xs text-slate-500">
              {totalCount} comments · {resolvedCount} resolved · {remaining} remaining
            </p>
            <button
              onClick={() => navigate(`/projects/${projectId}/clinical-writing/documents/${CANONICAL_DOC_ID}`)}
              className="whitespace-nowrap text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              View document →
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {orderedCommentIds.map(cid => {
              const c = commentsById.get(cid)
              if (!c) return null
              if (isResolved(cid))         return <ResolvedCard key={cid} comment={c} />
              if (activeCommentId === cid) return <ActiveCard key={cid} comment={c} onResolve={type => handleResolve(cid, type)} />
              return <PendingCard key={cid} comment={c} onSelect={() => handleSelectPending(cid)} />
            })}
          </div>
        </div>

        {/* Right panel — resolution log */}
        <div className="flex w-[280px] flex-none flex-col overflow-y-auto" style={{ backgroundColor: '#F8FAFC' }}>
          <div className="flex-none border-b border-slate-200 p-4">
            <MonoLabel>Resolution log</MonoLabel>
            <p className="mt-0.5 text-[11px] italic text-slate-500">Auto-saved to audit trail · tamper-evident</p>
          </div>

          <div className="m-3">
            <div className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] tracking-wider text-slate-500">CMT-041</span>
                <div className="flex-1" />
                <p className="text-[11px] text-slate-500">14:23 UTC</p>
              </div>
              <div>
                <span
                  className="inline-block rounded border px-2 py-0.5 text-[11px] font-semibold"
                  style={{ backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' }}
                >
                  Accept with modification
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-900">{RESOLVED_LOG_NOTE}</p>
              <div className="flex items-center gap-2">
                <Avatar initials="MW" size={16} />
                <p className="text-[11px] text-slate-500">{LOGGED_IN_USER} logged resolution</p>
              </div>
            </div>
          </div>

          {/* Pending placeholders — CMT-042, CMT-044 */}
          {orderedCommentIds
            .filter(cid => !isResolved(cid))
            .map(cid => (
              <div
                key={`placeholder-${cid}`}
                className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-3"
                style={{ borderColor: '#E2E8F0' }}
              >
                <span className="font-mono text-[9px] tracking-wider text-slate-400">{cid}</span>
                <div className="flex-1" />
                <span className="text-[11px] text-slate-400">Awaiting resolution</span>
              </div>
            ))}

          <div className="flex-1" />

          {/* Footer */}
          <div className="flex-none border-t border-slate-200 p-4">
            <button
              type="button"
              onClick={() => console.log('[crm] download minutes draft', { meetingId: meeting.id })}
              className="w-full rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors"
            >
              Download minutes draft
            </button>
          </div>
        </div>
      </div>

      {/* Comment Resolution Panel — absolute overlay when resolutionDraft is set */}
      {resolutionDraft !== null && (
        <div
          className="absolute top-0 right-0 bottom-0 flex flex-col border-l border-slate-200 bg-white"
          style={{
            width:     400,
            zIndex:    10,
            boxShadow: '-16px 0 40px rgba(15,23,42,0.12)',
          }}
        >
          <CommentResolutionPanel
            documentId={CANONICAL_DOC_ID}
            meetingId={meeting.id}
            onClose={() => setResolutionDraft(null)}
          />
        </div>
      )}
    </div>
  )
}
