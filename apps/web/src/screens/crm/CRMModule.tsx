// Comments Resolution Meeting (PRD stage 5 — Comments Resolution & Finalisation).
//
// Lifecycle, all on the real API (apps/api/src/modules/clinical-writing/crm):
//   Schedule  → POST /documents/:id/crm          (document in review)
//   Start     → POST /crm/:id/start              (document → CRM in progress)
//   Resolve   → POST /crm/:id/resolve            (per open comment, note required)
//   End       → POST /crm/:id/complete           (document → Pending signature;
//                refused while real comments are unresolved — reviewer
//                "approve" verdicts don't need resolving)
// The document comes from ?doc=<id> (Reviewer View links here) with a picker.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CRMMeeting, Comment, ResolutionType } from '@platform/types'
import { crmApi, documentsApi, projectsApi } from '../../api'
import { ApiError } from '../../api/client'
import type { CRMResolutionRow, ScheduleMeetingBody } from '../../api/crm'
import { platformApi } from '../../platform/api/platformApi'
import { useCurrentUser } from '../../hooks'
import { useCRMStore } from '../../store'
import { CommentResolutionPanel } from '../../panels/CommentResolutionPanel'
import { cleanSectionRef } from '../../panels/CommentComposer'
import { CRMDocumentViewer } from './CRMDocumentViewer'

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

const RESOLUTION_LABEL: Record<CRMResolutionRow['resolutionType'], string> = {
  accept: 'Accept',
  accept_with_modification: 'Accept with modification',
  reject: 'Reject',
}

// Document statuses (UI hyphen-case) in which a CRM meeting may be scheduled.
const SCHEDULABLE = new Set(['in-review', 'crm-in-progress'])

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string; issues?: Array<{ message: string }> } | null
    if (body?.error === 'comments_unresolved') return `${body.message ?? 'Some comments are unresolved'} — resolve them before ending the meeting.`
    if (body?.error === 'only_chair') return 'Only the meeting chair (or an Admin) can do this.'
    if (body?.error === 'wrong_status') return body.message ?? 'The meeting or document is not in the right state for this.'
    if (body?.issues?.[0]?.message) return body.issues[0].message
    if (body?.message) return body.message
  }
  return fallback
}

const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(11, 16) + ' UTC' : '—')

function Avatar({ initials, size = 20 }: { initials: string; size?: number }) {
  const c = AVATAR_COLOURS[initials] ?? AVATAR_COLOURS.MW
  return (
    <div
      className="flex flex-none items-center justify-center rounded-full font-mono font-bold"
      style={{ width: size, height: size, backgroundColor: c.bg, color: c.fg, fontSize: size >= 20 ? 10 : 9 }}
    >
      {initials}
    </div>
  )
}

function MonoLabel({ children, color = '#64748B' }: { children: React.ReactNode; color?: string }) {
  return <p className="font-mono text-[10px] font-medium uppercase tracking-widest" style={{ color }}>{children}</p>
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

// --- Comment cards ---

function ResolvedCard({ comment, resolution, resolverName }: { comment: Comment; resolution?: CRMResolutionRow; resolverName?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg p-4" style={{ border: '1px solid #BBF7D0', backgroundColor: '#F0FDF4' }} data-crm-comment={comment.id} data-state="resolved">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9px] tracking-wider text-slate-500">{comment.id}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900" style={{ backgroundColor: '#F1F5F9' }}>{cleanSectionRef(comment.sectionRef)}</span>
        <div className="flex-1" />
        <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' }}>Resolved ✓</span>
      </div>
      <div className="flex items-center gap-2">
        <Avatar initials={comment.reviewerInitials} size={18} />
        <p className="text-xs text-slate-500">{comment.reviewerName}</p>
      </div>
      <p className="text-[13px] italic leading-relaxed text-slate-500">{comment.text || '(no text)'}</p>
      {resolution && (
        <div className="mt-0.5 flex flex-col gap-1.5 border-t pt-2.5" style={{ borderColor: '#BBF7D0' }}>
          <MonoLabel color="#15803D">Resolution</MonoLabel>
          <div>
            <span className="inline-block rounded border px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' }}>
              {RESOLUTION_LABEL[resolution.resolutionType]}
            </span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: '#15803D' }}>{resolution.resolutionNote}</p>
          <p className="text-[11px] text-slate-500">Resolved by {resolverName ?? resolution.resolvedBy} · {fmtTime(resolution.resolvedAt)}</p>
        </div>
      )}
    </div>
  )
}

function ActiveCard({ comment, canResolve, onResolve, aiDraftNote }: { comment: Comment; canResolve: boolean; onResolve: (type: ResolutionType) => void; aiDraftNote?: string | null }) {
  const btn = 'rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div
      className="flex flex-col gap-2 rounded-lg p-4"
      style={{ border: '2px solid #2563EB', backgroundColor: '#FFFFFF', boxShadow: '0 0 0 3px rgba(37,99,235,0.08)' }}
      data-crm-comment={comment.id}
      data-state="active"
    >
      <MonoLabel color="#2563EB">Active discussion</MonoLabel>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9px] tracking-wider text-slate-500">{comment.id}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900" style={{ backgroundColor: '#F1F5F9' }}>{cleanSectionRef(comment.sectionRef)}</span>
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500" style={{ backgroundColor: '#F8FAFC' }}>{comment.verdict === 'request_changes' ? 'Return for revision' : comment.severity}</span>
        <div className="flex-1" />
        <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}>In discussion</span>
      </div>
      <div className="flex items-center gap-2">
        <Avatar initials={comment.reviewerInitials} size={18} />
        <p className="text-xs text-slate-500">{comment.reviewerName}</p>
      </div>
      <p className="text-[13px] leading-relaxed text-slate-900">{comment.text || '(no text)'}</p>

      {aiDraftNote && (
        <div
          className="rounded-md border border-indigo-200 bg-indigo-50/60 p-2.5 text-[12px] text-slate-800"
          data-ai-draft-note
        >
          <div className="mb-1 flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 14 14"><polygon points="7,1.2 8.6,5.4 12.8,7 8.6,8.6 7,12.8 5.4,8.6 1.2,7 5.4,5.4" fill="#4338CA" /></svg>
            <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-indigo-700">AI draft note</span>
          </div>
          {aiDraftNote}
          <p className="mt-1 text-[10px] italic text-indigo-700/70">
            The resolution composer will prefill with this; edit before saving.
          </p>
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: '#E2E8F0' }}>
        <span className="text-xs text-slate-500">Resolve as:</span>
        <button type="button" disabled={!canResolve} onClick={() => onResolve('accept')} className={btn} style={{ backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' }} data-resolve="accept">Accept</button>
        <button type="button" disabled={!canResolve} onClick={() => onResolve('accept-with-modification')} className={`${btn} border-slate-200 bg-white text-slate-900 hover:bg-slate-50`} data-resolve="accept-with-modification">Accept with modification</button>
        <button type="button" disabled={!canResolve} onClick={() => onResolve('reject')} className={btn} style={{ backgroundColor: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' }} data-resolve="reject">Reject</button>
      </div>
      {!canResolve && <p className="text-[11px] italic text-slate-500">Start the meeting to log resolutions.</p>}
    </div>
  )
}

function PendingCard({ comment, onSelect }: { comment: Comment; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-crm-comment={comment.id}
      data-state="pending"
      className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 text-left transition-opacity hover:opacity-100"
      style={{ opacity: 0.6 }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9px] tracking-wider text-slate-500">{comment.id}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#94A3B8' }}>{cleanSectionRef(comment.sectionRef)}</span>
        <div className="flex-1" />
        <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: '#F8FAFC', color: '#64748B', border: '1px solid #E2E8F0' }}>Pending</span>
      </div>
      <div className="flex items-center gap-2">
        <Avatar initials={comment.reviewerInitials} size={18} />
        <p className="text-xs text-slate-500">{comment.reviewerName}</p>
      </div>
      <p className="text-[13px] leading-relaxed text-slate-500">{comment.text || '(no text)'}</p>
    </button>
  )
}

// --- AI Note-Taker: transcript upload modal (Phase 1) ---
//
// Thin modal with a textarea for pasting the transcript + a source selector.
// Everything else about the AI pass (extraction, draft notes) happens
// server-side when the chair clicks Upload. Audio is never collected here.
function TranscriptUploadModal({
  onClose,
  onSubmit,
  isSubmitting,
  error,
}: {
  onClose:     () => void
  onSubmit:    (rawText: string, source: 'manual_paste' | 'zoom_native' | 'teams_export' | 'otter') => void
  isSubmitting: boolean
  error:       string | null
}) {
  const [text, setText] = useState('')
  const [source, setSource] = useState<'manual_paste' | 'zoom_native' | 'teams_export' | 'otter'>('manual_paste')
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.document.addEventListener('keydown', onKey)
    return () => window.document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Upload meeting transcript"
        className="w-full max-w-2xl rounded-lg bg-white shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-sm font-bold text-slate-900">Upload meeting transcript</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" /></svg>
          </button>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-[12px] text-slate-600">
            Paste the transcript below. We'll generate draft resolution notes for every open comment. Audio is never stored — only the transcript text.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-700">Source</span>
            <select
              value={source}
              onChange={e => setSource(e.target.value as typeof source)}
              className="h-8 rounded border border-slate-300 bg-white px-2 text-[12px]"
            >
              <option value="manual_paste">Manual paste</option>
              <option value="zoom_native">Zoom (Save transcript export)</option>
              <option value="teams_export">Microsoft Teams export</option>
              <option value="otter">Otter.ai export</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-700">Transcript</span>
            <textarea
              rows={14}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Paste the meeting transcript here. Speaker-labelled formats (e.g. 'Chair:' / 'Dr Chen:') produce better per-comment attribution."
              className="w-full resize-y rounded border border-slate-300 p-2 font-mono text-[12px] outline-none focus:border-blue-600"
              autoFocus
            />
          </label>
          <p className="text-[11px] text-slate-500">
            {wordCount.toLocaleString()} word{wordCount === 1 ? '' : 's'} · Esc to cancel
          </p>
          {error && <p className="text-[11px] text-rose-600" role="alert">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >Cancel</button>
          <button
            type="button"
            onClick={() => onSubmit(text, source)}
            disabled={isSubmitting || wordCount < 5}
            className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting ? 'Extracting drafts…' : 'Upload + extract drafts'}
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Schedule form (no active meeting yet) ---

function ScheduleMeetingForm({ documentId, projectId, onScheduled }: { documentId: string; projectId: string; onScheduled: () => void }) {
  const { data: me } = useCurrentUser()
  const users = useQuery({ queryKey: ['platform-users'], queryFn: () => platformApi.listUsers(), retry: false })
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => projectsApi.get(projectId), enabled: !!projectId })
  const people = useMemo(() => {
    const active = (users.data ?? []).filter(u => u.status === 'active').map(u => ({ id: u.id, name: u.name }))
    const list = active.length ? active : (project.data?.team ?? []).map(t => ({ id: t.userId, name: t.name }))
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [users.data, project.data])

  const today = new Date().toISOString().slice(0, 10)
  const [chairId, setChairId] = useState('')
  const [date, setDate] = useState(today)
  const [startTime, setStartTime] = useState('15:00')
  const [endTime, setEndTime] = useState('16:00')
  const [attendees, setAttendees] = useState<string[]>([])
  const chair = chairId || me?.id || ''

  const schedule = useMutation({
    mutationFn: () => {
      const body: ScheduleMeetingBody = {
        chairId: chair,
        scheduledDate: new Date(`${date}T${startTime}:00`).toISOString(),
        startTime,
        endTime,
        attendees: [
          { userId: chair, roleInCrm: 'Chair' },
          ...attendees.filter(id => id !== chair).map(userId => ({ userId, roleInCrm: 'Reviewer' as const })),
        ],
      }
      return crmApi.createMeeting(documentId, body)
    },
    onSuccess: onScheduled,
  })

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 text-left" data-crm-schedule>
      <div>
        <p className="text-sm font-bold text-slate-900">Schedule Comments Resolution Meeting</p>
        <p className="mt-1 text-xs text-slate-500">The chair runs the meeting; every open comment gets a recorded decision before the document can go to signature.</p>
      </div>
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-slate-600">
        Chair
        <select value={chair} onChange={e => setChairId(e.currentTarget.value)} className="h-9 rounded-md border border-slate-300 px-2 text-[13px] font-normal" data-crm-chair>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          {me && !people.some(p => p.id === me.id) && <option value={me.id}>{me.name}</option>}
        </select>
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-slate-600">Date
          <input type="date" value={date} onChange={e => setDate(e.currentTarget.value)} className="h-9 rounded-md border border-slate-300 px-2 text-[13px] font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-slate-600">Start
          <input type="time" value={startTime} onChange={e => setStartTime(e.currentTarget.value)} className="h-9 rounded-md border border-slate-300 px-2 text-[13px] font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-slate-600">End
          <input type="time" value={endTime} onChange={e => setEndTime(e.currentTarget.value)} className="h-9 rounded-md border border-slate-300 px-2 text-[13px] font-normal" />
        </label>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[12px] font-semibold text-slate-600">Attendees</p>
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-slate-200 p-2">
          {people.filter(p => p.id !== chair).map(p => (
            <label key={p.id} className="flex items-center gap-2 text-[12px] text-slate-700">
              <input
                type="checkbox"
                checked={attendees.includes(p.id)}
                onChange={e => {
                  // Read before the updater runs — React clears currentTarget
                  // after the handler, so reading it inside the updater crashed.
                  const checked = e.currentTarget.checked
                  setAttendees(prev => checked ? [...prev, p.id] : prev.filter(x => x !== p.id))
                }}
              />
              {p.name}
            </label>
          ))}
        </div>
      </div>
      {schedule.isError && <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800">{apiMessage(schedule.error, 'Could not schedule the meeting.')}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => schedule.mutate()}
          disabled={!chair || !date || schedule.isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          data-crm-schedule-submit
        >{schedule.isPending ? 'Scheduling…' : 'Schedule meeting'}</button>
      </div>
    </div>
  )
}

// --- Main screen ---

export function CRMModule() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const resolutionDraft    = useCRMStore(s => s.resolutionDraft)
  const setResolutionDraft = useCRMStore(s => s.setResolutionDraft)
  const setMeetingInStore  = useCRMStore(s => s.setMeeting)

  const { data: projectDocs = [] } = useQuery({
    queryKey: ['documents', projectId],
    queryFn:  () => documentsApi.list(projectId!),
    enabled:  !!projectId,
  })
  // ?doc= wins; otherwise the first document already in CRM, then in review.
  const activeDocId =
    searchParams.get('doc')
    ?? projectDocs.find(d => d.status === 'crm-in-progress')?.id
    ?? projectDocs.find(d => d.status === 'in-review')?.id
    ?? projectDocs[0]?.id
    ?? null
  const activeDoc = projectDocs.find(d => d.id === activeDocId)

  const { data: meetings = [], isLoading: meetingsLoading } = useQuery({
    queryKey: ['crm-meetings', activeDocId],
    queryFn:  () => crmApi.getMeetings(activeDocId!),
    enabled:  !!activeDocId,
  })
  // The live meeting: in progress, else scheduled, else the newest one.
  const meeting: CRMMeeting | undefined =
    meetings.find(m => m.status === 'in_progress') ?? meetings.find(m => m.status === 'scheduled') ?? meetings[meetings.length - 1]

  useEffect(() => { setMeetingInStore(meeting ?? null) }, [meeting, setMeetingInStore])

  const { data: comments = [] } = useQuery({
    queryKey: ['comments', activeDocId],
    queryFn:  () => documentsApi.getComments(activeDocId!),
    enabled:  !!activeDocId,
  })
  const { data: resolutions = [] } = useQuery({
    queryKey: ['crm-resolutions', meeting?.id],
    queryFn:  () => crmApi.listResolutions(meeting!.id),
    enabled:  !!meeting?.id,
  })
  // AI Note-Taker: per-comment drafts + transcript metadata. Refetched when
  // the chair uploads a new transcript or regenerates drafts.
  const { data: aiNoteTaker } = useQuery({
    queryKey: ['crm-ai-drafts', meeting?.id],
    queryFn:  () => crmApi.getAiDrafts(meeting!.id),
    enabled:  !!meeting?.id,
  })
  const draftNoteByCommentId = useMemo(
    () => new Map((aiNoteTaker?.drafts ?? []).map(d => [d.commentId, d.draftText])),
    [aiNoteTaker],
  )
  const users = useQuery({ queryKey: ['platform-users'], queryFn: () => platformApi.listUsers(), retry: false })
  const nameOf = (id: string) => users.data?.find(u => u.id === id)?.name

  const commentsById = useMemo(() => new Map(comments.map((c: Comment) => [c.id, c])), [comments])
  const resolutionByComment = useMemo(() => new Map(resolutions.map(r => [r.commentId, r])), [resolutions])

  // Queue = comments still needing a decision + those resolved in this meeting.
  const pendingIds = meeting?.pendingIds ?? []
  const resolvedIds = meeting?.resolvedIds ?? []
  const queueIds = [...resolvedIds, ...pendingIds.filter(id => !resolvedIds.includes(id))]
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const effectiveActive = activeCommentId && pendingIds.includes(activeCommentId) ? activeCommentId : pendingIds[0] ?? null

  // AI Note-Taker — transcript upload modal + minutes generation mutation.
  const [transcriptModalOpen, setTranscriptModalOpen] = useState(false)
  const uploadTranscriptMut = useMutation({
    mutationFn: (body: { rawText: string; source: 'manual_paste' | 'zoom_native' | 'teams_export' | 'otter' }) =>
      crmApi.uploadTranscript(meeting!.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-ai-drafts', meeting?.id] })
      setTranscriptModalOpen(false)
    },
  })
  const minutesMut = useMutation({
    mutationFn: () => crmApi.generateMinutes(meeting!.id),
  })

  // Read-only document viewer overlay. Opens on "View document →"; stays
  // open as the chair picks different comments and the viewer auto-scrolls
  // to each new section ref. Closes on backdrop click / X / Esc.
  const [docViewerOpen, setDocViewerOpen] = useState(false)
  const activeComment = effectiveActive ? commentsById.get(effectiveActive) ?? null : null
  const activeCommentSectionRef = activeComment?.sectionRef ?? null
  // 1-based position within the full queue so the viewer's chrome can
  // render "Comment 3 of 7". queueIds is resolved + pending interleaved,
  // which is the same order the queue renders in the centre panel.
  const activeCommentPosition = effectiveActive ? queueIds.indexOf(effectiveActive) + 1 : 0
  const activeCommentLabel = activeComment
    ? `${cleanSectionRef(activeComment.sectionRef)}${activeComment.severity ? ` · ${activeComment.severity.charAt(0).toUpperCase()}${activeComment.severity.slice(1)}` : ''}`
    : null

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['crm-meetings', activeDocId] })
    qc.invalidateQueries({ queryKey: ['crm-resolutions', meeting?.id] })
    qc.invalidateQueries({ queryKey: ['comments', activeDocId] })
    qc.invalidateQueries({ queryKey: ['documents', projectId] })
    qc.invalidateQueries({ queryKey: ['document', activeDocId] })
  }

  const startMut = useMutation({ mutationFn: () => crmApi.startMeeting(meeting!.id), onSuccess: refresh })
  const endMut   = useMutation({ mutationFn: () => crmApi.completeMeeting(meeting!.id), onSuccess: refresh })

  const resolvedCount = resolvedIds.length
  const totalCount    = queueIds.length
  const pct           = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 100
  const inProgress    = meeting?.status === 'in_progress'
  const isComplete    = meeting?.status === 'complete'

  const docPicker = (
    <label className="flex items-center gap-2 text-xs text-slate-500">
      Document
      <select
        value={activeDocId ?? ''}
        onChange={e => { setSearchParams({ doc: e.currentTarget.value }); setActiveCommentId(null) }}
        className="h-8 max-w-[360px] rounded-md border border-slate-300 bg-white px-2 text-[12px] text-slate-800"
        data-crm-doc-picker
      >
        {projectDocs.map(d => <option key={d.id} value={d.id}>{d.title} · {String(d.status).replace(/-/g, ' ')}</option>)}
      </select>
    </label>
  )

  if (!activeDocId || meetingsLoading) {
    return <div className="flex h-full items-center justify-center"><p className="font-mono text-sm text-slate-400">{projectDocs.length === 0 && !meetingsLoading ? 'No documents in this project yet.' : 'Loading meeting…'}</p></div>
  }

  // No live meeting (none yet, or the last one was cancelled) → schedule.
  if (!meeting || meeting.status === 'cancelled') {
    const canSchedule = SCHEDULABLE.has(String(activeDoc?.status))
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto p-10 text-center" data-screen="crm-module">
        {docPicker}
        {canSchedule ? (
          <ScheduleMeetingForm documentId={activeDocId} projectId={projectId!} onScheduled={refresh} />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <p className="font-mono text-sm text-slate-500">No CRM meeting for this document.</p>
            <p className="max-w-md text-xs text-slate-500">
              A meeting can be scheduled once the document has been submitted for review
              (current status: <span className="font-semibold">{String(activeDoc?.status ?? '—').replace(/-/g, ' ')}</span>).
            </p>
          </div>
        )}
      </div>
    )
  }

  const statusPill =
    isComplete ? { label: 'Meeting complete', bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0' }
    : inProgress ? { label: 'Meeting in progress', bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0' }
    : { label: 'Scheduled', bg: '#EFF6FF', fg: '#2563EB', border: '#BFDBFE' }
  const meetingDateLabel = new Date(meeting.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="relative flex h-full flex-col" data-screen="crm-module" data-meeting-status={meeting.status}>

      {/* Page header */}
      <div className="flex flex-none flex-col gap-2.5 border-b border-slate-200 bg-white px-8 py-5">
        {/* Breadcrumb moved to TopNav; the doc picker it used to share this
            row with now sits on its own, right-aligned, so the layout grid
            doesn't change height. */}
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-slate-500">
          {docPicker}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">Comments Resolution Meeting</h1>
            <p className="text-[13px] text-slate-500">
              {meeting.meetingRef} · {meeting.documentTitle} · {meetingDateLabel} · {meeting.startTime}–{meeting.endTime}
            </p>
          </div>
          <div className="flex-1" />
          <div className="flex flex-none items-center gap-2 rounded-full px-3.5 py-1.5" style={{ backgroundColor: statusPill.bg, border: `1px solid ${statusPill.border}` }} data-crm-status-pill>
            {inProgress && <span className="h-2 w-2 rounded-full animate-pulse-green" style={{ backgroundColor: '#16A34A' }} />}
            <span className="whitespace-nowrap text-[13px] font-semibold" style={{ color: statusPill.fg }}>{statusPill.label}</span>
          </div>
          {meeting.status === 'scheduled' && (
            <button
              type="button"
              onClick={() => startMut.mutate()}
              disabled={startMut.isPending}
              className="whitespace-nowrap rounded-md bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              data-crm-start
            >{startMut.isPending ? 'Starting…' : 'Start meeting'}</button>
          )}
          {inProgress && (
            <button
              type="button"
              onClick={() => endMut.mutate()}
              disabled={endMut.isPending}
              className="whitespace-nowrap rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' }}
              data-crm-end
            >{endMut.isPending ? 'Ending…' : 'End meeting'}</button>
          )}
          {isComplete && (
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/clinical-writing/documents/${activeDocId}/sign`)}
              className="whitespace-nowrap rounded-md bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700"
              data-crm-to-signature
            >Go to E-Signature →</button>
          )}
        </div>
        {(startMut.isError || endMut.isError) && (
          <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" data-crm-error>
            {startMut.isError ? apiMessage(startMut.error, 'Could not start the meeting.') : apiMessage(endMut.error, 'Could not end the meeting.')}
          </p>
        )}
        {isComplete && (
          <p className="rounded-md bg-green-50 p-2 text-[12px] text-green-800" data-crm-complete>
            ✓ Meeting complete — all comments resolved. The document is now Pending signature.
          </p>
        )}
      </div>

      {/* 3-panel row */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left panel */}
        <div className="flex w-[280px] flex-none flex-col overflow-y-auto border-r border-slate-200" style={{ backgroundColor: '#F8FAFC' }}>
          <div className="border-b border-slate-200 p-4">
            <div className="mb-2.5"><MonoLabel>Meeting details</MonoLabel></div>
            <MetaRow label="Chair"    value={meeting.chair.name} />
            <MetaRow label="Document" value={meeting.documentTitle} />
            <MetaRow label="Version"  value={meeting.version} mono />
            <MetaRow label="Started"  value={meeting.startedAt ? fmtTime(meeting.startedAt) : 'Not started'} />
            {meeting.endedAt && <MetaRow label="Ended" value={fmtTime(meeting.endedAt)} />}
          </div>

          <div className="border-b border-slate-200 p-4">
            <div className="mb-2.5"><MonoLabel>Attendees</MonoLabel></div>
            {meeting.attendees.map(a => (
              <div key={a.userId} className="flex min-w-0 items-center gap-2 py-1">
                <Avatar initials={a.initials} />
                <p className="min-w-0 flex-1 truncate text-[13px]">{a.name}</p>
                <p className="font-mono text-[9px] tracking-wider text-slate-500">{a.role}</p>
              </div>
            ))}
          </div>

          {/* AI Note-Taker (Phase 1). Audio is never stored; the chair pastes
              a pre-transcribed text. Server extracts per-comment draft notes
              + an optional minutes HTML. Phase 3 adds a Recall.ai bot that
              feeds the transcript automatically. */}
          <div className="border-b border-slate-200 p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <MonoLabel>AI Note-Taker</MonoLabel>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-blue-700">Beta</span>
            </div>
            {aiNoteTaker?.transcript ? (
              <>
                <p className="text-[11px] text-slate-700">
                  Transcript loaded · {aiNoteTaker.transcript.wordCount.toLocaleString()} words
                </p>
                <p className="text-[10px] text-slate-500">
                  {aiNoteTaker.transcript.source.replace(/_/g, ' ')} · {fmtTime(aiNoteTaker.transcript.uploadedAt)}
                </p>
                <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                  {aiNoteTaker.drafts.length} comment draft{aiNoteTaker.drafts.length === 1 ? '' : 's'} ready
                </p>
              </>
            ) : (
              <p className="text-[11px] italic text-slate-500">
                No transcript yet. Paste one to get per-comment draft notes.
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setTranscriptModalOpen(true)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                data-action="upload-transcript"
              >
                {aiNoteTaker?.transcript ? 'Replace transcript' : 'Upload transcript'}
              </button>
              <button
                type="button"
                onClick={() => minutesMut.mutate()}
                disabled={minutesMut.isPending || meeting.status === 'scheduled'}
                className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                title={meeting.status === 'scheduled' ? 'Start the meeting first' : 'Generate minutes HTML'}
                data-action="generate-minutes"
              >
                {minutesMut.isPending ? 'Generating…' : 'Generate minutes'}
              </button>
            </div>
            {minutesMut.isError && (
              <p className="mt-1.5 text-[10px] text-rose-600" role="alert">Minutes generation failed — try again.</p>
            )}
            {minutesMut.isSuccess && minutesMut.data?.minutesHtml && (
              <a
                href={URL.createObjectURL(new Blob([minutesMut.data.minutesHtml], { type: 'text/html' }))}
                download={`${meeting.meetingRef ?? 'crm'}-minutes.html`}
                className="mt-1.5 inline-block text-[11px] font-semibold text-blue-600 underline"
              >
                Download minutes HTML →
              </a>
            )}
          </div>

          <div className="p-4">
            <div className="mb-2.5"><MonoLabel>Meeting progress</MonoLabel></div>
            <div className="flex items-baseline justify-between">
              <p className="text-xs text-slate-900" data-crm-progress>{resolvedCount} of {totalCount} comments resolved</p>
              <p className="text-xs font-bold" style={{ color: '#2563EB' }}>{pct}%</p>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
              <div className="h-full" style={{ width: `${pct}%`, backgroundColor: '#2563EB' }} />
            </div>
            {totalCount === 0 && (
              <p className="mt-2 text-[11px] italic text-slate-500">No open comments need resolving — reviewer approvals don't. The meeting can be ended once started.</p>
            )}
          </div>
        </div>

        {/* Centre panel — resolution queue */}
        <div className="flex flex-1 min-w-0 flex-col overflow-y-auto border-r border-slate-200 bg-white p-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="text-base font-bold">Resolution Queue</h2>
            <div className="flex-1" />
            <p className="whitespace-nowrap text-xs text-slate-500">{totalCount} comments · {resolvedCount} resolved · {totalCount - resolvedCount} remaining</p>
            <button
              onClick={() => setDocViewerOpen(true)}
              className="whitespace-nowrap text-xs font-semibold text-blue-600 hover:text-blue-700"
              data-action="open-doc-viewer"
            >View document →</button>
          </div>

          <div className="flex flex-col gap-3">
            {queueIds.map(cid => {
              const c = commentsById.get(cid)
              if (!c) return null
              if (resolvedIds.includes(cid)) {
                const r = resolutionByComment.get(cid)
                return <ResolvedCard key={cid} comment={c} resolution={r} resolverName={r ? nameOf(r.resolvedBy) : undefined} />
              }
              if (effectiveActive === cid) {
                const aiDraft = draftNoteByCommentId.get(cid) ?? null
                return (
                  <ActiveCard
                    key={cid}
                    comment={c}
                    canResolve={inProgress}
                    aiDraftNote={aiDraft}
                    onResolve={type => setResolutionDraft({ commentId: cid, type, note: aiDraft ?? '' })}
                  />
                )
              }
              return <PendingCard key={cid} comment={c} onSelect={() => setActiveCommentId(cid)} />
            })}
          </div>
        </div>

        {/* Right panel — resolution log */}
        <div className="flex w-[280px] flex-none flex-col overflow-y-auto" style={{ backgroundColor: '#F8FAFC' }}>
          <div className="flex-none border-b border-slate-200 p-4">
            <MonoLabel>Resolution log</MonoLabel>
            <p className="mt-0.5 text-[11px] italic text-slate-500">Recorded in the audit trail · tamper-evident</p>
          </div>
          {resolutions.map(r => (
            <div key={r.id} className="mx-3 mt-3 flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-3" data-crm-log-entry>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] tracking-wider text-slate-500">{r.commentId}</span>
                <div className="flex-1" />
                <p className="text-[11px] text-slate-500">{fmtTime(r.resolvedAt)}</p>
              </div>
              <div>
                <span className="inline-block rounded border px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' }}>
                  {RESOLUTION_LABEL[r.resolutionType]}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-900">{r.resolutionNote}</p>
              <p className="text-[11px] text-slate-500">{nameOf(r.resolvedBy) ?? r.resolvedBy} logged resolution</p>
            </div>
          ))}
          {pendingIds.filter(id => !resolvedIds.includes(id)).map(cid => (
            <div key={`placeholder-${cid}`} className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-3" style={{ borderColor: '#E2E8F0' }}>
              <span className="font-mono text-[9px] tracking-wider text-slate-400">{cid}</span>
              <div className="flex-1" />
              <span className="text-[11px] text-slate-400">Awaiting resolution</span>
            </div>
          ))}
          {resolutions.length === 0 && pendingIds.length === 0 && (
            <p className="m-4 text-[12px] text-slate-500">No resolutions recorded.</p>
          )}
        </div>
      </div>

      {/* Comment Resolution Panel — note + confirm, then POST /crm/:id/resolve */}
      {resolutionDraft !== null && (
        <div className="absolute top-0 right-0 bottom-0 flex flex-col border-l border-slate-200 bg-white" style={{ width: 400, zIndex: 10, boxShadow: '-16px 0 40px rgba(15,23,42,0.12)' }}>
          <CommentResolutionPanel
            documentId={activeDocId}
            meetingId={meeting.id}
            onClose={() => { setResolutionDraft(null); refresh() }}
          />
        </div>
      )}

      {/* Read-only document viewer overlay for the active doc. Only
          mounted when open so the heavy document render + section-jump
          side-effects don't fire for chairs who never ask for it. */}
      {docViewerOpen && activeDocId && (
        <CRMDocumentViewer
          documentId={activeDocId}
          jumpToSectionRef={activeCommentSectionRef}
          commentIndex={activeCommentPosition > 0 ? activeCommentPosition : null}
          commentTotal={queueIds.length}
          commentLabel={activeCommentLabel}
          onClose={() => setDocViewerOpen(false)}
        />
      )}

      {transcriptModalOpen && meeting && (
        <TranscriptUploadModal
          onClose={() => setTranscriptModalOpen(false)}
          onSubmit={(rawText, source) => uploadTranscriptMut.mutate({ rawText, source })}
          isSubmitting={uploadTranscriptMut.isPending}
          error={uploadTranscriptMut.isError ? (uploadTranscriptMut.error instanceof ApiError
            ? `Upload failed (HTTP ${uploadTranscriptMut.error.status})`
            : 'Upload failed') : null}
        />
      )}
    </div>
  )
}
