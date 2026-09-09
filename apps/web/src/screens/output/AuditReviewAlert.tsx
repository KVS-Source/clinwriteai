import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AuditEntry } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { useProjectStore } from '../../store'

// The canonical document surfaced by this alert (matches prototype)
const CANONICAL_DOC_ID = 'DOC-001'
const LOGGED_IN_USER = 'Dr. Sarah Chen'

// Avatar palette — Pattern 7
const AVATAR_COLOURS: Record<string, { bg: string; fg: string }> = {
  MW: { bg: '#DBEAFE', fg: '#1D4ED8' },
  SC: { bg: '#F0FDF4', fg: '#15803D' },
  JO: { bg: '#F5F3FF', fg: '#7C3AED' },
  EV: { bg: '#FEF3C7', fg: '#D97706' },
  AI: { bg: '#F5F3FF', fg: '#7C3AED' },
}

// Event-type badge palette + label
const EVENT_META: Record<AuditEntry['eventType'], { label: string; bg: string; fg: string; verb: string }> = {
  'document-signed':      { label: 'DOCUMENT SIGNED',      bg: '#F0FDF4', fg: '#15803D', verb: 'signed' },
  'comment-resolved':     { label: 'COMMENT RESOLVED',     bg: '#F0FDF4', fg: '#15803D', verb: 'resolved' },
  'checklist-completed':  { label: 'CHECKLIST COMPLETED',  bg: '#F0FDF4', fg: '#15803D', verb: 'completed' },
  'checklist-waived':     { label: 'CHECKLIST WAIVED',     bg: '#FFFBEB', fg: '#B45309', verb: 'waived item' },
  'comment-added':        { label: 'COMMENT ADDED',        bg: '#FFFBEB', fg: '#B45309', verb: 'added comment' },
  'content-edited':       { label: 'CONTENT EDITED',       bg: '#EFF6FF', fg: '#2563EB', verb: 'authored' },
  'ai-draft':             { label: 'AI DRAFT',             bg: '#F5F3FF', fg: '#7C3AED', verb: 'generated draft' },
  'version-restore':      { label: 'VERSION RESTORE',      bg: '#EFF6FF', fg: '#2563EB', verb: 'restored' },
  'voice-note-added':     { label: 'VOICE NOTE ADDED',     bg: '#EFF6FF', fg: '#2563EB', verb: 'added voice note' },
  'qa-review-completed':  { label: 'QA REVIEW COMPLETED',  bg: '#F0FDF4', fg: '#15803D', verb: 'logged QA review' },
}

// QA review checklist rows — matches prototype exactly
const CHECKLIST_ITEMS = [
  'Verify all entries are present and complete',
  'Confirm no unauthorised edits',
  'Review all waived checklist items',
  'Confirm AI provenance records are intact',
  'Check signature chain for completeness',
  'Log review completion with signature',
]

function WarningTriangle({ size = 18, colour = '#D97706' }: { size?: number; colour?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" className="flex-none">
      <path d="M9 2.2l7 12.4H2z" fill="none" stroke={colour} strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="8.25" y="6.6" width="1.5" height="4.2" rx="0.75" fill={colour} />
      <circle cx="9" cy="12.4" r="0.9" fill={colour} />
    </svg>
  )
}

function AISparkle({ colour = '#7C3AED' }: { colour?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
      <polygon points="7,1.2 8.6,5.4 12.8,7 8.6,8.6 7,12.8 5.4,8.6 1.2,7 5.4,5.4" fill={colour} />
    </svg>
  )
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm} UTC`
}

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

interface AuditRowProps {
  entry: AuditEntry
}

function AuditRow({ entry }: AuditRowProps) {
  const meta = EVENT_META[entry.eventType]
  const colours = AVATAR_COLOURS[entry.actorInitials] ?? AVATAR_COLOURS.MW
  const isAI = entry.actorInitials === 'AI' || entry.actor.toLowerCase().includes(' ai')

  return (
    <div
      className="mb-2 flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-3.5 hover:border-slate-300 transition-colors cursor-pointer"
      data-audit-entry={entry.id}
      data-event-type={entry.eventType}
    >
      <div className="flex items-center justify-between gap-2.5">
        <p className="font-mono text-[10px] font-medium text-slate-500">{formatTimestamp(entry.timestamp)}</p>
        <span
          className="whitespace-nowrap rounded font-mono text-[9px] font-medium uppercase tracking-wider"
          style={{ backgroundColor: meta.bg, color: meta.fg, padding: '2px 6px' }}
          data-event-badge={entry.eventType}
        >
          {meta.label}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <div
          className="flex h-5 w-5 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold"
          style={{ backgroundColor: colours.bg, color: colours.fg }}
        >
          {isAI ? <AISparkle colour={colours.fg} /> : entry.actorInitials}
        </div>
        <p className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]">
          <span className="font-bold text-slate-900">{entry.actor}</span>{' '}
          <span className="text-slate-500">{meta.verb}</span>
        </p>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">{entry.detail}</p>
    </div>
  )
}

export function AuditReviewAlert() {
  const { projectId }    = useParams()
  const navigate         = useNavigate()
  const qc               = useQueryClient()
  const setActiveProject = useProjectStore(s => s.setActiveProject)

  const [checked, setChecked]     = useState<Set<number>>(new Set())
  const [alertDismissed, setAlertDismissed] = useState(false)

  const { data: auditData } = useQuery({
    queryKey: ['audit', CANONICAL_DOC_ID],
    queryFn:  () => documentsApi.getAuditTrail(CANONICAL_DOC_ID),
  })

  const { data: qaReview } = useQuery({
    queryKey: ['qa-review', CANONICAL_DOC_ID],
    queryFn:  () => documentsApi.getQAReview(CANONICAL_DOC_ID),
  })

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId!),
    enabled:  !!projectId,
  })

  useEffect(() => {
    if (project) setActiveProject(project)
  }, [project, setActiveProject])

  const entries = useMemo(() => auditData?.entries ?? [], [auditData])
  const totalEntries = auditData?.total ?? entries.length

  // Effective overdue: false once the user has logged a review this session
  const isOverdue = !alertDismissed && (qaReview?.isOverdue ?? false)
  const cadenceDays   = qaReview?.cadenceDays ?? 30
  const lastReviewedAt = qaReview?.lastReviewedAt ?? null
  const nextDueAt      = qaReview?.nextDueAt ?? null

  const logMut = useMutation({
    mutationFn: () => documentsApi.logQAReview(CANONICAL_DOC_ID, {
      reviewedBy: LOGGED_IN_USER,
      notes:      `QA review logged; ${checked.size} of ${CHECKLIST_ITEMS.length} checklist items complete.`,
    }),
    onSuccess: () => {
      setAlertDismissed(true)
      qc.invalidateQueries({ queryKey: ['qa-review', CANONICAL_DOC_ID] })
      qc.invalidateQueries({ queryKey: ['audit',     CANONICAL_DOC_ID] })
    },
  })

  const toggleChecked = (idx: number) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  const scrollToCompliance = () => {
    window.document.getElementById('compliance-record')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="flex h-full flex-col" data-screen="audit-review-alert">

      {/* ============ Header ============ */}
      <div className="flex flex-none flex-col gap-2.5 border-b border-slate-200 bg-white px-8 py-5">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900 transition-colors">All Projects</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900 transition-colors">
            {project?.shortTitle ?? '…'}
          </button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}/clinical-writing`)} className="hover:text-slate-900 transition-colors">
            Clinical Writing
          </button>
          <span className="text-slate-300">›</span>
          <span className="font-semibold text-slate-900">Audit Review</span>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Audit Trail Review</h1>
            <p className="text-[13px] text-slate-500">
              {project?.shortTitle ?? 'VELORA-301'} · Clinical Writing · QA review cadence: {cadenceDays} days · Last reviewed: {formatDateShort(lastReviewedAt)}
            </p>
          </div>
          <div className="flex flex-none items-center gap-2.5">
            {isOverdue && (
              <div
                className="flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5"
                style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}
                data-overdue-pill
              >
                <span
                  className="h-2 w-2 rounded-full animate-pulse-amber"
                  style={{ backgroundColor: '#D97706' }}
                  data-overdue-dot
                />
                <span className="text-[13px] font-semibold" style={{ color: '#B45309' }}>
                  Review overdue · {cadenceDays} days elapsed
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => logMut.mutate()}
              disabled={logMut.isPending}
              className="whitespace-nowrap rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {logMut.isPending ? 'Logging…' : 'Begin QA review'}
            </button>
          </div>
        </div>
      </div>

      {/* ============ Full-width amber alert banner ============ */}
      {isOverdue && (
        <div
          className="flex flex-none items-center gap-3 border-b px-8 py-3.5"
          style={{ backgroundColor: '#FFFBEB', borderBottomColor: '#FDE68A' }}
          data-alert-banner
        >
          <WarningTriangle size={18} colour="#D97706" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-sm font-bold" style={{ color: '#B45309' }}>Audit trail review is overdue.</p>
            <p className="text-[13px] leading-snug" style={{ color: '#B45309' }}>
              The Admin-configured {cadenceDays}-day review cadence elapsed on {formatDateShort(nextDueAt)}. A QA review event must be logged to maintain compliance.
            </p>
          </div>
          <button
            type="button"
            onClick={scrollToCompliance}
            className="flex-none whitespace-nowrap text-[13px] font-semibold hover:opacity-80 transition-opacity"
            style={{ color: '#B45309' }}
          >
            View compliance record →
          </button>
        </div>
      )}

      {/* ============ Body ============ */}
      <div className="flex flex-1 min-h-0 gap-6 overflow-auto px-8 py-6">

        {/* Left: audit entries list */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3 pb-3">
            <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
              Entries since last review
            </p>
            <p className="font-mono text-[10px] font-medium text-slate-500">
              {formatDateShort(lastReviewedAt)} → {formatDateShort(nextDueAt)}
            </p>
          </div>

          {entries.map(entry => <AuditRow key={entry.id} entry={entry} />)}

          <div className="flex items-center justify-between gap-2.5 px-1 pt-1.5">
            <p className="text-xs text-slate-500">
              Showing {entries.length} of {totalEntries} entries since last review
            </p>
            <button className="text-xs font-semibold text-blue-600 hover:text-blue-700">Load all →</button>
          </div>
        </div>

        {/* Right: 3 stacked cards */}
        <div className="flex w-[280px] flex-none flex-col gap-3">

          {/* Review status — amber-bordered */}
          <div
            className="flex flex-col gap-1.5 rounded-lg bg-white p-4"
            style={{ border: '2px solid #FDE68A' }}
            data-panel="review-status"
          >
            <div className="flex items-center gap-2">
              <WarningTriangle size={16} colour="#D97706" />
              <p className="text-[13px] font-bold" style={{ color: '#B45309' }}>
                {isOverdue ? 'Review overdue' : 'Review current'}
              </p>
            </div>
            <p className="text-xs text-slate-500">
              Last QA review: {formatDateShort(lastReviewedAt)} · by Dr. Linda Park
            </p>
            <p className="text-xs font-semibold" style={{ color: isOverdue ? '#B45309' : '#15803D' }} data-next-due>
              Next review due: {formatDateShort(nextDueAt)}{isOverdue ? ' (today)' : ''}
            </p>
            <p className="text-xs font-semibold" style={{ color: isOverdue ? '#B45309' : '#15803D' }}>
              Days overdue: {qaReview?.daysOverdue ?? 0}
            </p>
            <button
              type="button"
              onClick={() => logMut.mutate()}
              disabled={logMut.isPending}
              className="mt-1.5 w-full rounded-md bg-blue-600 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {logMut.isPending ? 'Logging…' : 'Begin QA review'}
            </button>
          </div>

          {/* QA review checklist */}
          <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-4" data-panel="qa-checklist">
            <p className="mb-2.5 font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
              QA review checklist
            </p>
            {CHECKLIST_ITEMS.map((item, idx) => {
              const isChecked = checked.has(idx)
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleChecked(idx)}
                  className="flex items-center gap-2 border-b py-1.5 text-left text-[13px]"
                  style={{ borderColor: '#F1F5F9' }}
                  data-checklist-item={idx}
                  data-checked={isChecked || undefined}
                >
                  <span
                    className="flex h-4 w-4 flex-none items-center justify-center rounded"
                    style={{
                      border: isChecked ? '1px solid #2563EB' : '1px solid #CBD5E1',
                      backgroundColor: isChecked ? '#2563EB' : '#FFFFFF',
                    }}
                  >
                    {isChecked && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <polyline points="1.5,5 4,7.5 8.5,2.5" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 text-slate-900">{item}</span>
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => logMut.mutate()}
              disabled={logMut.isPending}
              className="mt-3 w-full rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-50"
            >
              {logMut.isPending ? 'Logging…' : 'Log completed review'}
            </button>
          </div>

          {/* Compliance record */}
          <div
            id="compliance-record"
            className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-white p-4"
            data-panel="compliance-record"
          >
            <p className="mb-1 text-[13px] font-bold text-slate-900">Compliance record</p>
            <div className="flex items-baseline justify-between gap-2.5 py-1 text-xs">
              <span className="text-slate-500">Cadence</span>
              <span className="font-bold text-slate-900">{cadenceDays} days (Admin)</span>
            </div>
            <div className="flex items-baseline justify-between gap-2.5 py-1 text-xs">
              <span className="text-slate-500">Reviews on time</span>
              <span className="font-bold text-slate-900">11 of 12</span>
            </div>
            <div className="flex items-baseline justify-between gap-2.5 py-1 text-xs">
              <span className="text-slate-500">Current streak</span>
              <span className="font-bold" style={{ color: isOverdue ? '#B45309' : '#15803D' }}>
                {isOverdue ? '0 days ⚠' : '30 days'}
              </span>
            </div>
            <button className="mt-2 self-start text-xs font-semibold" style={{ color: '#B45309' }}>
              View full compliance history →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
