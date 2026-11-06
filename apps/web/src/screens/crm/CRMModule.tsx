// Comments Resolution Meeting (PRD stage 5 — Comments Resolution & Finalisation).
//
// Lifecycle, all on the real API (apps/api/src/modules/clinical-writing/crm):
//   Schedule  → POST /documents/:id/crm          (document in review)
//   Start     → POST /crm/:id/start              (document → CRM in progress)
//   Resolve   → POST /crm/:id/resolve            (per open comment, note required)
//   End       → POST /crm/:id/complete           (document → Pending signature;
//                refused while real comments are unresolved — reviewer
//                "approve" verdicts don't need resolving)
// The document comes from ?doc=<id> (Reviewer View links here) with a picker —
// or, on a document's own CRM tab (/documents/:documentId/crm), is fixed to
// that document and the picker is hidden.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { CRMMeeting, CRMResolution, Comment, ResolutionType } from '@platform/types'
import i18n from '../../i18n'
import { documentStatusLabel } from '../../utils/documentLabels'
import { dateLocale, isPastDate, localToday } from '../../utils/formatDate'
import { PastDateError } from '../../components/ui/PastDateError'
import { crmApi, documentsApi, projectsApi } from '../../api'
import { ApiError } from '../../api/client'
import { MyRaciRole } from '../clinical-writing/MyRaciRole'
import type { CRMResolutionRow, ScheduleMeetingBody } from '../../api/crm'
import { assignableUsersApi } from '../../api/raci'
import { useProjectPeople } from '../../hooks/useProjectPeople'
import { useCurrentUser } from '../../hooks'
import { useCRMStore } from '../../store'
import { CommentResolutionPanel } from '../../panels/CommentResolutionPanel'
import { cleanSectionRef } from '../../panels/CommentComposer'
import { CRMDocumentViewer } from './CRMDocumentViewer'
import { useSignatureAccess } from '../output/useSignatureAccess'

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

const RESOLUTION_LABEL_KEY: Record<CRMResolutionRow['resolutionType'], string> = {
  accept: 'page.crm_module.resolution_accept',
  accept_with_modification: 'page.crm_module.resolution_accept_mod',
  reject: 'page.crm_module.resolution_reject',
}

const SEVERITY_KEY: Record<string, string> = {
  major: 'page.crm_module.severity_major',
  minor: 'page.crm_module.severity_minor',
  query: 'page.crm_module.severity_query',
}
const severityLabel = (severity: string) => (SEVERITY_KEY[severity] ? i18n.t(SEVERITY_KEY[severity]!) : severity)

// A meeting attendee's role as the API stores it; shown translated.
const ATTENDEE_ROLE_KEY: Record<string, string> = {
  Chair: 'page.crm_module.role_chair',
  Reviewer: 'page.crm_module.role_reviewer',
}

const TRANSCRIPT_SOURCE_KEY: Record<string, string> = {
  manual_paste: 'page.crm_module.source_manual_paste',
  zoom_native: 'page.crm_module.source_zoom_native',
  teams_export: 'page.crm_module.source_teams_export',
  otter: 'page.crm_module.source_otter',
}

// Document statuses (UI hyphen-case) in which a CRM meeting may be scheduled.
const SCHEDULABLE = new Set(['in-review', 'crm-in-progress'])

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string; issues?: Array<{ message: string }>; unresolvedCommentIds?: string[] } | null
    if (body?.error === 'comments_unresolved') return i18n.t('page.crm_module.err_unresolved', { count: body.unresolvedCommentIds?.length ?? 0 })
    if (body?.error === 'date_in_past') return i18n.t('component.deadlines.past')
    if (body?.error === 'only_chair') return i18n.t('page.crm_module.err_only_chair')
    if (body?.error === 'wrong_status') return i18n.t('page.crm_module.err_wrong_status')
    if (body?.error === 'meeting_closed' || body?.error === 'already_closed') return i18n.t('page.crm_module.err_meeting_closed')
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
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2 rounded-lg p-4" style={{ border: '1px solid #BBF7D0', backgroundColor: '#F0FDF4' }} data-crm-comment={comment.id} data-state="resolved">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9px] tracking-wider text-slate-500">{comment.id}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900" style={{ backgroundColor: '#F1F5F9' }}>{cleanSectionRef(comment.sectionRef)}</span>
        <div className="flex-1" />
        <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' }}>{t('page.crm_module.resolved_badge')}</span>
      </div>
      <div className="flex items-center gap-2">
        <Avatar initials={comment.reviewerInitials} size={18} />
        <p className="text-xs text-slate-500">{comment.reviewerName}</p>
      </div>
      <p className="text-[13px] italic leading-relaxed text-slate-500">{comment.text || t('page.crm_module.no_text')}</p>
      {resolution && (
        <div className="mt-0.5 flex flex-col gap-1.5 border-t pt-2.5" style={{ borderColor: '#BBF7D0' }}>
          <MonoLabel color="#15803D">{t('page.crm_module.resolution_label')}</MonoLabel>
          <div>
            <span className="inline-block rounded border px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' }}>
              {t(RESOLUTION_LABEL_KEY[resolution.resolutionType])}
            </span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: '#15803D' }}>{resolution.resolutionNote}</p>
          <p className="text-[11px] text-slate-500">{t('page.crm_module.resolved_by', { name: resolverName ?? resolution.resolvedBy, time: fmtTime(resolution.resolvedAt) })}</p>
        </div>
      )}
    </div>
  )
}

function ActiveCard({ comment, meetingRunning, onResolve, aiDraftNote }: { comment: Comment; meetingRunning: boolean; onResolve: (type: ResolutionType) => void; aiDraftNote?: string | null }) {
  const { t } = useTranslation()
  const allowed = comment.canResolve !== false
  const canResolve = meetingRunning && allowed
  const btn = 'rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div
      className="flex flex-col gap-2 rounded-lg p-4"
      style={{ border: '2px solid #2563EB', backgroundColor: '#FFFFFF', boxShadow: '0 0 0 3px rgba(37,99,235,0.08)' }}
      data-crm-comment={comment.id}
      data-state="active"
    >
      <MonoLabel color="#2563EB">{t('page.crm_module.active_label')}</MonoLabel>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9px] tracking-wider text-slate-500">{comment.id}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900" style={{ backgroundColor: '#F1F5F9' }}>{cleanSectionRef(comment.sectionRef)}</span>
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500" style={{ backgroundColor: '#F8FAFC' }}>{comment.verdict === 'request_changes' ? t('page.crm_module.return_for_revision') : severityLabel(comment.severity)}</span>
        <div className="flex-1" />
        <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}>{t('page.crm_module.in_discussion')}</span>
      </div>
      <div className="flex items-center gap-2">
        <Avatar initials={comment.reviewerInitials} size={18} />
        <p className="text-xs text-slate-500">{comment.reviewerName}</p>
      </div>
      <p className="text-[13px] leading-relaxed text-slate-900">{comment.text || t('page.crm_module.no_text')}</p>

      {aiDraftNote && (
        <div
          className="rounded-md border border-indigo-200 bg-indigo-50/60 p-2.5 text-[12px] text-slate-800"
          data-ai-draft-note
        >
          <div className="mb-1 flex items-center gap-1.5">
            <svg width="10" height="10" viewBox="0 0 14 14"><polygon points="7,1.2 8.6,5.4 12.8,7 8.6,8.6 7,12.8 5.4,8.6 1.2,7 5.4,5.4" fill="#4338CA" /></svg>
            <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-indigo-700">{t('page.crm_module.ai_draft_note')}</span>
          </div>
          {aiDraftNote}
          <p className="mt-1 text-[10px] italic text-indigo-700/70">
            {t('page.crm_module.ai_draft_hint')}
          </p>
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: '#E2E8F0' }}>
        <span className="text-xs text-slate-500">{t('page.crm_module.resolve_as')}</span>
        <button type="button" disabled={!canResolve} onClick={() => onResolve('accept')} className={btn} style={{ backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' }} data-resolve="accept">{t('page.crm_module.resolution_accept')}</button>
        <button type="button" disabled={!canResolve} onClick={() => onResolve('accept-with-modification')} className={`${btn} border-slate-200 bg-white text-slate-900 hover:bg-slate-50`} data-resolve="accept-with-modification">{t('page.crm_module.resolution_accept_mod')}</button>
        <button type="button" disabled={!canResolve} onClick={() => onResolve('reject')} className={btn} style={{ backgroundColor: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' }} data-resolve="reject">{t('page.crm_module.resolution_reject')}</button>
      </div>
      {!allowed && <p className="text-[11px] italic text-slate-500" data-resolve-not-allowed>{t('page.crm_module.not_allowed')}</p>}
      {allowed && !meetingRunning && <p className="text-[11px] italic text-slate-500">{t('page.crm_module.start_to_log')}</p>}
    </div>
  )
}

function PendingCard({ comment, onSelect }: { comment: Comment; onSelect: () => void }) {
  const { t } = useTranslation()
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
        <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ backgroundColor: '#F8FAFC', color: '#64748B', border: '1px solid #E2E8F0' }}>{t('page.crm_module.pending')}</span>
      </div>
      <div className="flex items-center gap-2">
        <Avatar initials={comment.reviewerInitials} size={18} />
        <p className="text-xs text-slate-500">{comment.reviewerName}</p>
      </div>
      <p className="text-[13px] leading-relaxed text-slate-500">{comment.text || t('page.crm_module.no_text')}</p>
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
  const { t } = useTranslation()
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
        aria-label={t('page.crm_module.transcript_title')}
        className="w-full max-w-2xl rounded-lg bg-white shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-sm font-bold text-slate-900">{t('page.crm_module.transcript_title')}</h3>
          <button type="button" onClick={onClose} aria-label={t('page.crm_module.close')} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" /></svg>
          </button>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-[12px] text-slate-600">
            {t('page.crm_module.transcript_intro')}
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-700">{t('page.crm_module.source_label')}</span>
            <select
              value={source}
              onChange={e => setSource(e.target.value as typeof source)}
              className="h-8 rounded border border-slate-300 bg-white px-2 text-[12px]"
            >
              <option value="manual_paste">{t('page.crm_module.source_manual_paste')}</option>
              <option value="zoom_native">{t('page.crm_module.source_zoom_native')}</option>
              <option value="teams_export">{t('page.crm_module.source_teams_export')}</option>
              <option value="otter">{t('page.crm_module.source_otter')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-slate-700">{t('page.crm_module.transcript_label')}</span>
            <textarea
              rows={14}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={t('page.crm_module.transcript_placeholder')}
              className="w-full resize-y rounded border border-slate-300 p-2 font-mono text-[12px] outline-none focus:border-blue-600"
              autoFocus
            />
          </label>
          <p className="text-[11px] text-slate-500">
            {t('page.crm_module.word_count', { count: wordCount, words: wordCount.toLocaleString() })}
          </p>
          {error && <p className="text-[11px] text-rose-600" role="alert">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >{t('page.crm_module.cancel')}</button>
          <button
            type="button"
            onClick={() => onSubmit(text, source)}
            disabled={isSubmitting || wordCount < 5}
            className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSubmitting ? t('page.crm_module.extracting') : t('page.crm_module.upload_extract')}
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Schedule form (no active meeting yet) ---

function ScheduleMeetingForm({ documentId, projectId, onScheduled }: { documentId: string; projectId: string; onScheduled: () => void }) {
  const { t } = useTranslation()
  const { data: me } = useCurrentUser()
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => projectsApi.get(projectId), enabled: !!projectId })
  const assignable = useQuery({ queryKey: ['assignable-users', projectId, 'assignee'], queryFn: () => assignableUsersApi.listForAssignee(projectId), enabled: !!projectId, retry: false })
  const people = useMemo(() => {
    const candidates = (assignable.data ?? []).map(u => ({ id: u.id, name: u.name }))
    const list = candidates.length ? candidates
      : (project.data?.team ?? []).map(t => ({ id: t.userId, name: t.name }))
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [assignable.data, project.data])

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
        <p className="text-sm font-bold text-slate-900">{t('page.crm_module.schedule_title')}</p>
        <p className="mt-1 text-xs text-slate-500">{t('page.crm_module.schedule_intro')}</p>
      </div>
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-slate-600">
        {t('page.crm_module.chair')}
        <select value={chair} onChange={e => setChairId(e.currentTarget.value)} className="h-9 rounded-md border border-slate-300 px-2 text-[13px] font-normal" data-crm-chair>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          {me && !people.some(p => p.id === me.id) && <option value={me.id}>{me.name}</option>}
        </select>
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-slate-600">{t('page.crm_module.date')}
          <input type="date" value={date} min={localToday()} onChange={e => setDate(e.currentTarget.value)} className="h-9 rounded-md border border-slate-300 px-2 text-[13px] font-normal" data-crm-date />
          <PastDateError value={date} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-slate-600">{t('page.crm_module.start_time')}
          <input type="time" value={startTime} onChange={e => setStartTime(e.currentTarget.value)} className="h-9 rounded-md border border-slate-300 px-2 text-[13px] font-normal" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-slate-600">{t('page.crm_module.end_time')}
          <input type="time" value={endTime} onChange={e => setEndTime(e.currentTarget.value)} className="h-9 rounded-md border border-slate-300 px-2 text-[13px] font-normal" />
        </label>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[12px] font-semibold text-slate-600">{t('page.crm_module.attendees')}</p>
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
      {schedule.isError && <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800">{apiMessage(schedule.error, t('page.crm_module.schedule_failed'))}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => schedule.mutate()}
          disabled={!chair || !date || isPastDate(date) || schedule.isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          data-crm-schedule-submit
        >{schedule.isPending ? t('page.crm_module.scheduling') : t('page.crm_module.schedule')}</button>
      </div>
    </div>
  )
}

// --- Main screen ---

export function CRMModule() {
  const { t } = useTranslation()
  // documentId is set on a document's CRM tab; the project-level CRM screen has none.
  const { projectId, documentId: routeDocumentId } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  // Store is keyed by meetingId; readers return null for unknown keys. The
  // caller passes the current meeting id (null while loading / between
  // meetings) and the store ignores stale writes against a different id.
  const setMeetingInStore     = useCRMStore(s => s.setMeeting)
  const setResolutionDraftRaw = useCRMStore(s => s.setResolutionDraft)
  const getResolutionDraft    = useCRMStore(s => s.getResolutionDraft)
  // Subscribe to the entries map so the component re-renders when THIS
  // meeting's draft changes; we re-derive via the getter below.
  const entries               = useCRMStore(s => s.entries)

  const { data: projectDocs = [] } = useQuery({
    queryKey: ['documents', projectId],
    queryFn:  () => documentsApi.list(projectId!),
    enabled:  !!projectId,
  })
  // The document tab's own document, else ?doc=, else the first document
  // already in CRM, then in review.
  const activeDocId =
    routeDocumentId
    ?? searchParams.get('doc')
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

  useEffect(() => { if (meeting) setMeetingInStore(meeting) }, [meeting, setMeetingInStore])

  const { data: me } = useCurrentUser()
  const signatureAccess = useSignatureAccess(activeDocId ?? undefined)
  const { data: crmAccess } = useQuery({
    queryKey: ['crm-access', activeDocId],
    queryFn:  () => crmApi.getAccess(activeDocId!),
    enabled:  !!activeDocId,
    retry:    false,
  })

  // Scoped wrappers — supply the current meeting.id so writes never land on
  // another document's CRM entry. no-op when there is no live meeting yet.
  const resolutionDraft = meeting ? (entries[meeting.id]?.resolutionDraft ?? null) : null
  const setResolutionDraft = (draft: Partial<CRMResolution> | null) => {
    if (!meeting) return
    setResolutionDraftRaw(meeting.id, draft)
  }
  // Store getter kept available (used by future call sites).
  void getResolutionDraft

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
  const { usersById } = useProjectPeople(projectId)
  const nameOf = (id: string) => usersById.get(id)?.name

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
    ? `${cleanSectionRef(activeComment.sectionRef)}${activeComment.severity ? ` · ${severityLabel(activeComment.severity)}` : ''}`
    : null

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['crm-meetings', activeDocId] })
    qc.invalidateQueries({ queryKey: ['crm-resolutions', meeting?.id] })
    qc.invalidateQueries({ queryKey: ['comments', activeDocId] })
    qc.invalidateQueries({ queryKey: ['project-comments'] })
    qc.invalidateQueries({ queryKey: ['documents', projectId] })
    qc.invalidateQueries({ queryKey: ['document', activeDocId] })
  }

  // The resolve panel's draft lives in the CRM store, so clear it when the chair leaves
  // CRM or switches document — otherwise the panel reopens on return.
  // Note: the pre-keyed-store version cleared resolutionDraft on activeDocId
  // change to prevent cross-meeting bleed. With the meetingId-keyed store,
  // drafts live naturally per-meeting and preserve across doc switches —
  // explicit close actions still null them (see onClose at the resolve
  // panel below).

  // A click outside the resolve panel, or Esc, closes it — unless a resolution note is
  // typed, so the draft isn't lost. The Resolve-as buttons ([data-resolve]) open it and are
  // not "outside". Paused while the transcript modal or document viewer is on top. Outside
  // clicks are judged on mousedown + click so a press that starts inside the panel never closes it.
  const resolvePanelRef = useRef<HTMLDivElement>(null)
  const resolvePanelOpen = resolutionDraft !== null
  useEffect(() => {
    if (!resolvePanelOpen || transcriptModalOpen || docViewerOpen) return
    const hasNote = () => Array.from(resolvePanelRef.current?.querySelectorAll('textarea') ?? [])
      .some(el => el.value.trim() !== '')
    const close = () => { if (!hasNote()) setResolutionDraft(null) }
    let pressedOutside = false
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      pressedOutside = !!t && !resolvePanelRef.current?.contains(t) && !t.closest('[data-resolve]')
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null
      const outside = pressedOutside
      pressedOutside = false
      if (!outside || !t?.isConnected || resolvePanelRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close()
    }
    window.document.addEventListener('mousedown', onDown, true)
    window.document.addEventListener('click', onClick)
    window.document.addEventListener('keydown', onKey)
    return () => {
      window.document.removeEventListener('mousedown', onDown, true)
      window.document.removeEventListener('click', onClick)
      window.document.removeEventListener('keydown', onKey)
    }
  }, [resolvePanelOpen, transcriptModalOpen, docViewerOpen, setResolutionDraft])

  const startMut = useMutation({ mutationFn: () => crmApi.startMeeting(meeting!.id), onSuccess: refresh })
  const endMut   = useMutation({ mutationFn: () => crmApi.completeMeeting(meeting!.id), onSuccess: refresh })

  const resolvedCount = resolvedIds.length
  const totalCount    = queueIds.length
  const pct           = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 100
  const inProgress    = meeting?.status === 'in_progress'
  const isComplete    = meeting?.status === 'complete'

  // The meetings request fixes a document stuck in CRM after its meeting completed; pick that up.
  const stuckInCrm = isComplete && activeDoc?.status === 'crm-in-progress'
  useEffect(() => {
    if (!stuckInCrm) return
    const t = setTimeout(() => {
      qc.invalidateQueries({ queryKey: ['documents', projectId] })
      qc.invalidateQueries({ queryKey: ['document', activeDocId] })
    }, 800)
    return () => clearTimeout(t)
  }, [stuckInCrm, qc, projectId, activeDocId])

  const docPicker = routeDocumentId ? null : (
    <label className="flex items-center gap-2 text-xs text-slate-500">
      {t('page.crm_module.document')}
      <select
        value={activeDocId ?? ''}
        onChange={e => { setSearchParams({ doc: e.currentTarget.value }); setActiveCommentId(null) }}
        className="h-8 max-w-[360px] rounded-md border border-slate-300 bg-white px-2 text-[12px] text-slate-800"
        data-crm-doc-picker
      >
        {projectDocs.map(d => <option key={d.id} value={d.id}>{d.title} · {documentStatusLabel(d.status)}</option>)}
      </select>
    </label>
  )

  if (!activeDocId || meetingsLoading) {
    return <div className="flex h-full items-center justify-center"><p className="font-mono text-sm text-slate-400">{projectDocs.length === 0 && !meetingsLoading ? t('page.crm_module.no_documents') : t('page.crm_module.loading_meeting')}</p></div>
  }

  // No live meeting (none yet, or the last one was cancelled) → schedule.
  if (!meeting || meeting.status === 'cancelled') {
    const canSchedule = SCHEDULABLE.has(String(activeDoc?.status))
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto p-10 text-center" data-screen="crm-module">
        {docPicker}
        {canSchedule && crmAccess?.canSchedule === false ? (
          <div className="flex flex-col items-center gap-2" data-crm-schedule-not-allowed>
            <p className="font-mono text-sm text-slate-500">{t('page.crm_module.no_meeting')}</p>
            <p className="max-w-md text-xs text-slate-500">
              {t('page.crm_module.schedule_not_allowed')}
            </p>
          </div>
        ) : canSchedule ? (
          <ScheduleMeetingForm documentId={activeDocId} projectId={projectId!} onScheduled={refresh} />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <p className="font-mono text-sm text-slate-500">{t('page.crm_module.no_meeting')}</p>
            <p className="max-w-md text-xs text-slate-500">
              {t('page.crm_module.schedule_after_review', { status: documentStatusLabel(activeDoc?.status, '—') })}
            </p>
          </div>
        )}
      </div>
    )
  }

  // Informed (I) changes nothing in a meeting they don't chair; the API refuses it too.
  const informedNonChair = signatureAccess.isInformedOnly && meeting.chair.userId !== me?.id

  const statusPill =
    isComplete ? { label: t('page.crm_module.status_complete'), bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0' }
    : inProgress ? { label: t('page.crm_module.status_in_progress'), bg: '#F0FDF4', fg: '#15803D', border: '#BBF7D0' }
    : { label: t('page.crm_module.status_scheduled'), bg: '#EFF6FF', fg: '#2563EB', border: '#BFDBFE' }
  const meetingDateLabel = new Date(meeting.date).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: 'numeric' })

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
            <h1 className="text-2xl font-bold tracking-tight">{t('page.crm_module.title')}</h1>
            <p className="text-[13px] text-slate-500">
              {meeting.meetingRef} · {meeting.documentTitle} · {meetingDateLabel} · {meeting.startTime}–{meeting.endTime}
            </p>
          </div>
          <div className="flex-1" />
          {routeDocumentId && <MyRaciRole documentId={routeDocumentId} />}
          <div className="flex flex-none items-center gap-2 rounded-full px-3.5 py-1.5" style={{ backgroundColor: statusPill.bg, border: `1px solid ${statusPill.border}` }} data-crm-status-pill>
            {inProgress && <span className="h-2 w-2 rounded-full animate-pulse-green" style={{ backgroundColor: '#16A34A' }} />}
            <span className="whitespace-nowrap text-[13px] font-semibold" style={{ color: statusPill.fg }}>{statusPill.label}</span>
          </div>
          {meeting.status === 'scheduled' && !informedNonChair && (
            <button
              type="button"
              onClick={() => startMut.mutate()}
              disabled={startMut.isPending}
              className="whitespace-nowrap rounded-md bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              data-crm-start
            >{startMut.isPending ? t('page.crm_module.starting') : t('page.crm_module.start_meeting')}</button>
          )}
          {inProgress && !informedNonChair && (
            <button
              type="button"
              onClick={() => endMut.mutate()}
              disabled={endMut.isPending}
              className="whitespace-nowrap rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' }}
              data-crm-end
            >{endMut.isPending ? t('page.crm_module.ending') : t('page.crm_module.end_meeting')}</button>
          )}
          {isComplete && (
            <button
              type="button"
              onClick={() => navigate(`/projects/${projectId}/clinical-writing/documents/${activeDocId}/sign`)}
              className="whitespace-nowrap rounded-md bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700"
              data-crm-to-signature
            >{t('page.crm_module.go_to_signature')}</button>
          )}
        </div>
        {(startMut.isError || endMut.isError) && (
          <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" data-crm-error>
            {startMut.isError ? apiMessage(startMut.error, t('page.crm_module.start_failed')) : apiMessage(endMut.error, t('page.crm_module.end_failed'))}
          </p>
        )}
        {isComplete && (activeDoc?.status === 'crm-in-progress' ? (
          <p className="rounded-md bg-amber-50 p-2 text-[12px] text-amber-800" data-crm-complete-pending>
            {t('page.crm_module.complete_pending')}
          </p>
        ) : (
          <p className="rounded-md bg-green-50 p-2 text-[12px] text-green-800" data-crm-complete>
            {t('page.crm_module.complete_done')}
          </p>
        ))}
      </div>

      {/* 3-panel row */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left panel */}
        <div className="flex w-[280px] flex-none flex-col overflow-y-auto border-r border-slate-200" style={{ backgroundColor: '#F8FAFC' }}>
          <div className="border-b border-slate-200 p-4">
            <div className="mb-2.5"><MonoLabel>{t('page.crm_module.details_label')}</MonoLabel></div>
            <MetaRow label={t('page.crm_module.chair')}    value={meeting.chair.name} />
            <MetaRow label={t('page.crm_module.document')} value={meeting.documentTitle} />
            <MetaRow label={t('page.crm_module.version')}  value={meeting.version} mono />
            <MetaRow label={t('page.crm_module.started')}  value={meeting.startedAt ? fmtTime(meeting.startedAt) : t('page.crm_module.not_started')} />
            {meeting.endedAt && <MetaRow label={t('page.crm_module.ended')} value={fmtTime(meeting.endedAt)} />}
          </div>

          <div className="border-b border-slate-200 p-4">
            <div className="mb-2.5"><MonoLabel>{t('page.crm_module.attendees')}</MonoLabel></div>
            {meeting.attendees.map(a => (
              <div key={a.userId} className="flex min-w-0 items-center gap-2 py-1">
                <Avatar initials={a.initials} />
                <p className="min-w-0 flex-1 truncate text-[13px]">{a.name}</p>
                <p className="font-mono text-[9px] tracking-wider text-slate-500">{ATTENDEE_ROLE_KEY[a.role] ? t(ATTENDEE_ROLE_KEY[a.role]!) : a.role}</p>
              </div>
            ))}
          </div>

          {/* AI Note-Taker (Phase 1). Audio is never stored; the chair pastes
              a pre-transcribed text. Server extracts per-comment draft notes
              + an optional minutes HTML. Phase 3 adds a Recall.ai bot that
              feeds the transcript automatically. */}
          <div className="border-b border-slate-200 p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <MonoLabel>{t('page.crm_module.ai_note_taker')}</MonoLabel>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-blue-700">{t('page.crm_module.beta')}</span>
            </div>
            {aiNoteTaker?.transcript ? (
              <>
                <p className="text-[11px] text-slate-700">
                  {t('page.crm_module.transcript_loaded', { words: aiNoteTaker.transcript.wordCount.toLocaleString() })}
                </p>
                <p className="text-[10px] text-slate-500">
                  {TRANSCRIPT_SOURCE_KEY[aiNoteTaker.transcript.source] ? t(TRANSCRIPT_SOURCE_KEY[aiNoteTaker.transcript.source]!) : aiNoteTaker.transcript.source.replace(/_/g, ' ')} · {fmtTime(aiNoteTaker.transcript.uploadedAt)}
                </p>
                <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                  {t('page.crm_module.drafts_ready', { count: aiNoteTaker.drafts.length })}
                </p>
              </>
            ) : (
              <p className="text-[11px] italic text-slate-500">
                {t('page.crm_module.no_transcript')}
              </p>
            )}
            {!informedNonChair && <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setTranscriptModalOpen(true)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                data-action="upload-transcript"
              >
                {aiNoteTaker?.transcript ? t('page.crm_module.replace_transcript') : t('page.crm_module.upload_transcript')}
              </button>
              <button
                type="button"
                onClick={() => minutesMut.mutate()}
                disabled={minutesMut.isPending || meeting.status === 'scheduled'}
                className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                title={meeting.status === 'scheduled' ? t('page.crm_module.start_first') : t('page.crm_module.minutes_tooltip')}
                data-action="generate-minutes"
              >
                {minutesMut.isPending ? t('page.crm_module.generating') : t('page.crm_module.generate_minutes')}
              </button>
            </div>}
            {minutesMut.isError && (
              <p className="mt-1.5 text-[10px] text-rose-600" role="alert">{t('page.crm_module.minutes_failed')}</p>
            )}
            {minutesMut.isSuccess && minutesMut.data?.minutesHtml && (
              <a
                href={URL.createObjectURL(new Blob([minutesMut.data.minutesHtml], { type: 'text/html' }))}
                download={`${meeting.meetingRef ?? 'crm'}-minutes.html`}
                className="mt-1.5 inline-block text-[11px] font-semibold text-blue-600 underline"
              >
                {t('page.crm_module.download_minutes')}
              </a>
            )}
          </div>

          <div className="p-4">
            <div className="mb-2.5"><MonoLabel>{t('page.crm_module.progress_label')}</MonoLabel></div>
            <div className="flex items-baseline justify-between">
              <p className="text-xs text-slate-900" data-crm-progress>{t('page.crm_module.progress_value', { resolved: resolvedCount, total: totalCount })}</p>
              <p className="text-xs font-bold" style={{ color: '#2563EB' }}>{pct}%</p>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
              <div className="h-full" style={{ width: `${pct}%`, backgroundColor: '#2563EB' }} />
            </div>
            {totalCount === 0 && (
              <p className="mt-2 text-[11px] italic text-slate-500">{t('page.crm_module.no_open_comments')}</p>
            )}
          </div>
        </div>

        {/* Centre panel — resolution queue */}
        <div className="flex flex-1 min-w-0 flex-col overflow-y-auto border-r border-slate-200 bg-white p-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="text-base font-bold">{t('page.crm_module.queue_title')}</h2>
            <div className="flex-1" />
            <p className="whitespace-nowrap text-xs text-slate-500">{t('page.crm_module.queue_counts', { total: totalCount, resolved: resolvedCount, remaining: totalCount - resolvedCount })}</p>
            <button
              onClick={() => setDocViewerOpen(true)}
              className="whitespace-nowrap text-xs font-semibold text-blue-600 hover:text-blue-700"
              data-action="open-doc-viewer"
            >{t('page.crm_module.view_document')}</button>
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
                    meetingRunning={inProgress}
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
            <MonoLabel>{t('page.crm_module.log_label')}</MonoLabel>
            <p className="mt-0.5 text-[11px] italic text-slate-500">{t('page.crm_module.log_note')}</p>
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
                  {t(RESOLUTION_LABEL_KEY[r.resolutionType])}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-900">{r.resolutionNote}</p>
              <p className="text-[11px] text-slate-500">{t('page.crm_module.logged_resolution', { name: nameOf(r.resolvedBy) ?? r.resolvedBy })}</p>
            </div>
          ))}
          {pendingIds.filter(id => !resolvedIds.includes(id)).map(cid => (
            <div key={`placeholder-${cid}`} className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-dashed px-3 py-3" style={{ borderColor: '#E2E8F0' }}>
              <span className="font-mono text-[9px] tracking-wider text-slate-400">{cid}</span>
              <div className="flex-1" />
              <span className="text-[11px] text-slate-400">{t('page.crm_module.awaiting_resolution')}</span>
            </div>
          ))}
          {resolutions.length === 0 && pendingIds.length === 0 && (
            <p className="m-4 text-[12px] text-slate-500">{t('page.crm_module.no_resolutions')}</p>
          )}
        </div>
      </div>

      {/* Comment Resolution Panel — note + confirm, then POST /crm/:id/resolve */}
      {resolutionDraft !== null && (
        <div ref={resolvePanelRef} className="absolute top-0 right-0 bottom-0 flex flex-col border-l border-slate-200 bg-white" style={{ width: 400, zIndex: 10, boxShadow: '-16px 0 40px rgba(15,23,42,0.12)' }}>
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
            ? t('page.crm_module.upload_failed_http', { status: uploadTranscriptMut.error.status })
            : t('page.crm_module.upload_failed')) : null}
        />
      )}
    </div>
  )
}
