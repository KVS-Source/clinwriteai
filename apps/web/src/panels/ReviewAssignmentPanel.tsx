import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RACI_META, STATUS_META, type Document, type DocumentStatus, type RACIRole, type TeamMember } from '@platform/types'
import { fromSQLEnum } from '../utils/enumConvert'
import { documentsApi, projectsApi } from '../api'
import { ApiError } from '../api/client'
import { useDocumentStore } from '../store'

// Plain-language reason for a failed submit — never the server's internal wording
// (e.g. "Invalid document transition: crm_in_progress → in_review").
function submitErrorMessage(err: unknown, currentStatus: string): string {
  if (!(err instanceof ApiError)) return 'Could not reach the server. Check your connection and try again.'
  // Checklist gate (Phase 2) — the API returns 409 with error='checklist_blocked'
  // and a `blocking` list. Enumerate the blockers so the writer knows what to tick.
  if (err.status === 409) {
    const body = err.body as { error?: string; blocking?: Array<{ text: string; framework: string }>; blockingCount?: number } | null
    if (body?.error === 'checklist_blocked' && Array.isArray(body.blocking)) {
      const bullets = body.blocking.slice(0, 4).map(b => `• ${b.text} (${b.framework})`).join('\n')
      const extra = (body.blockingCount ?? body.blocking.length) > 4 ? `\n…and ${(body.blockingCount ?? body.blocking.length) - 4} more` : ''
      return `${body.blockingCount ?? body.blocking.length} mandatory checklist item(s) must be completed or waived before submitting:\n${bullets}${extra}`
    }
  }
  switch (err.status) {
    case 400: return 'Check the review due date and the reviewers, then try again.'
    case 401: return 'Your session has expired. Sign in again to continue.'
    case 403: return "You don't have permission to submit this document for review."
    case 404: return 'This document no longer exists. Refresh the page.'
    case 409:
    case 422: return `This document is "${currentStatus}", so it can't be sent for review right now. Documents are submitted for review from In Authoring — finish or cancel the current step first.`
    default:  return 'Something went wrong on our side. Please try again.'
  }
}

interface Props {
  documentId: string
  projectId:  string
  onClose:    () => void
}

const RACI_DESCRIPTION: Record<RACIRole, string> = {
  R: 'Authors and owns the document',
  A: 'Approves and manages sign-off',
  C: 'Reviews assigned sections',
  I: 'Informed of review completion',
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

// --- Sub-components ---

function RACIBadge({ role }: { role: RACIRole }) {
  const m = RACI_META[role]
  return (
    <span
      className="flex-none rounded font-mono text-[9px] font-bold"
      style={{
        backgroundColor: m.bg,
        color:           m.fg,
        border:          m.border ? `1px solid ${m.border}` : undefined,
        padding:         '2px 6px',
      }}
    >
      {role}
    </span>
  )
}

function Avatar({ initials, size = 20 }: { initials: string; size?: number }) {
  const c = AVATAR_COLOURS[initials] ?? AVATAR_COLOURS.MW
  return (
    <div
      className="flex flex-none items-center justify-center rounded-full font-mono font-bold"
      style={{
        width:  size,
        height: size,
        backgroundColor: c.bg,
        color: c.fg,
        fontSize: size >= 20 ? 10 : 9,
      }}
    >
      {initials}
    </div>
  )
}

function ArrowRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className="flex-none">
      <rect x="1" y="5.3" width="7" height="1.4" rx="0.7" fill="#94A3B8"/>
      <polygon points="7.4,3.2 11,6 7.4,8.8" fill="#94A3B8"/>
    </svg>
  )
}

function ReviewerRow({
  member,
  canRemove,
  onRemove,
}: {
  member:   TeamMember
  canRemove: boolean
  onRemove: () => void
}) {
  return (
    // Two lines so the person's name is never squeezed by the role text in a narrow panel:
    // who (avatar + name) on top, their role and what it means underneath.
    <div className="flex items-start gap-2.5 border-b px-4 py-2.5 transition-colors hover:bg-slate-50" style={{ borderColor: '#F1F5F9' }}>
      <span className="mt-0.5"><RACIBadge role={member.raci} /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar initials={member.initials} />
          <p className="min-w-0 truncate text-[13px] font-semibold text-slate-900">{member.name}</p>
        </div>
        <p className="text-[11px] leading-snug text-slate-500">
          <span className="font-semibold text-slate-600">{member.role}</span> · {RACI_DESCRIPTION[member.raci]}
        </p>
      </div>
      {canRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${member.name}`}
          title="Remove reviewer"
          className="mt-0.5 flex h-[22px] w-[22px] flex-none items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          ✕
        </button>
      ) : (
        <div className="w-[22px] flex-none" aria-hidden="true" />
      )}
    </div>
  )
}

// --- Main panel ---

export function ReviewAssignmentPanel({ documentId, projectId, onClose }: Props) {
  const qc          = useQueryClient()
  const setActiveDocument = useDocumentStore(s => s.setActiveDocument)

  const { data: document } = useQuery({
    queryKey: ['document', documentId],
    queryFn:  () => documentsApi.get(documentId),
    enabled:  !!documentId,
  })
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId),
    enabled:  !!projectId,
  })

  const [reviewType, setReviewType] = useState<'parallel' | 'sequential'>('parallel')
  const [dueDate,    setDueDate]    = useState('')
  const [dateError,  setDateError]  = useState<string | null>(null)
  const [reviewers,  setReviewers]  = useState<TeamMember[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [adding,      setAdding]      = useState(false)

  // Seed reviewers from project.team on first load
  useEffect(() => {
    if (project?.team && reviewers.length === 0) {
      setReviewers(project.team)
    }
  }, [project, reviewers.length])

  const owner = useMemo(() => reviewers.find(r => r.raci === 'R'), [reviewers])
  const nonOwnerReviewers = useMemo(() => reviewers.filter(r => r.raci !== 'R'), [reviewers])

  const submitMut = useMutation({
    mutationFn: () => documentsApi.submitForReview(documentId, {
      reviewType,
      reviewers:  nonOwnerReviewers.map(r => ({ userId: r.userId, raci: r.raci })),
      dueDate,
    }),
    onSuccess: (updated) => {
      // The server may answer with the raw row (snake_case status, no sections), so apply the new
      // status onto the document the screen already has — the editor flips to "In Review" at once,
      // and the refetch below then confirms it.
      const newStatus = fromSQLEnum(String((updated as { status?: string } | null)?.status ?? 'in-review')) as DocumentStatus
      qc.setQueryData<Document>(['document', documentId], old => (old ? { ...old, status: newStatus } : old))
      if (document) setActiveDocument({ ...document, status: newStatus })
      qc.invalidateQueries({ queryKey: ['document',  documentId] })
      qc.invalidateQueries({ queryKey: ['documents', projectId] })
      onClose()
    },
  })

  const handleSubmit = () => {
    if (!dueDate) {
      setDateError('Due date is required')
      return
    }
    setDateError(null)
    submitMut.mutate()
  }

  const removeReviewer = (userId: string) => {
    setReviewers(prev => prev.filter(r => r.userId !== userId))
  }

  // Project team members who aren't on the list right now (removed earlier, or never seeded).
  const availableToAdd = useMemo(
    () => (project?.team ?? []).filter(m => !reviewers.some(r => r.userId === m.userId)),
    [project, reviewers],
  )
  const addReviewer = (member: TeamMember) => {
    setReviewers(prev => (prev.some(r => r.userId === member.userId) ? prev : [...prev, member]))
    setAdding(false)
  }

  if (!document) {
    return <div className="p-4 text-sm text-slate-500">Loading document…</div>
  }

  // The document's real current status (the "from" side of the transition).
  const statusMeta = STATUS_META[document.status] ?? { bg: '#EFF6FF', fg: '#2563EB', label: document.status }

  // Notification preview: due date formatted DD MMM YYYY
  const dueDateLabel = dueDate
    ? new Date(dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'not set'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">

      {/* One scroll area for everything above the footer, so no section is ever squeezed
          out of view at 100% zoom; the footer below always stays on screen. */}
      <div className="min-h-0 flex-1 overflow-y-auto">

      {/* ===== Document summary card ===== */}
      <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3" style={{ backgroundColor: '#F8FAFC' }}>
        <p className="text-[14px] font-bold leading-snug">{document.title}</p>
        <p className="text-xs text-slate-500">
          {document.type.toUpperCase()} · v{String(document.version).replace(/^v/i, '')} · {document.stage.replace(/-/g, ' ')}
        </p>
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ backgroundColor: statusMeta.bg, color: statusMeta.fg }}
          >
            {statusMeta.label}
          </span>
          <ArrowRight />
          <span
            className="rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
          >
            In Review
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <label htmlFor="review-due" className="flex-none text-xs text-slate-500">
            Review due <span className="text-red-600" aria-hidden="true">*</span>
          </label>
          <input
            id="review-due"
            type="date"
            required
            aria-required="true"
            value={dueDate}
            onChange={e => { setDueDate(e.target.value); if (dateError) setDateError(null) }}
            className="min-w-0 flex-1 rounded-md border px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-600 focus:shadow-focus"
            style={{ borderColor: dateError ? '#DC2626' : '#E2E8F0' }}
          />
        </div>
        {dateError && (
          <p className="text-[11px] font-semibold" style={{ color: '#DC2626' }}>{dateError}</p>
        )}
      </div>

      {/* ===== Review type selector ===== */}
      <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3">
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Review type</p>
        <div className="flex flex-wrap gap-2">
          <ReviewTypeCard
            active={reviewType === 'parallel'}
            title="Parallel review"
            subtitle="All reviewers receive simultaneously"
            onClick={() => setReviewType('parallel')}
          />
          <ReviewTypeCard
            active={reviewType === 'sequential'}
            title="Sequential review"
            subtitle="Reviewers notified in order"
            onClick={() => setReviewType('sequential')}
          />
        </div>
      </div>

      {/* ===== Reviewers list ===== */}
      <div>
        <div className="flex items-baseline justify-between px-4 pt-3 pb-1.5">
          <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Assign reviewers</p>
          <p className="text-[11px] text-slate-500">{nonOwnerReviewers.length} reviewer{nonOwnerReviewers.length === 1 ? '' : 's'} + author</p>
        </div>
        {reviewers.map(member => (
          <ReviewerRow
            key={member.userId}
            member={member}
            canRemove={member.raci !== 'R'}
            onRemove={() => removeReviewer(member.userId)}
          />
        ))}
        <div className="m-4">
          <button
            type="button"
            onClick={() => setAdding(a => !a)}
            disabled={availableToAdd.length === 0}
            aria-expanded={adding}
            className="w-full rounded-md border border-dashed px-3 py-2 text-center text-[12px] text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white"
            style={{ borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' }}
            data-add-reviewer
          >
            {availableToAdd.length === 0
              ? 'Everyone on the team is already assigned'
              : adding ? 'Cancel' : '＋ Add reviewer'}
          </button>
          {adding && availableToAdd.length > 0 && (
            <ul
              className="mt-2 max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white"
              aria-label="Team members you can add as reviewers"
              data-add-reviewer-list
            >
              {availableToAdd.map(m => (
                <li key={m.userId}>
                  <button
                    type="button"
                    onClick={() => addReviewer(m)}
                    className="flex w-full items-start gap-2.5 border-b border-slate-100 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className="mt-0.5"><RACIBadge role={m.raci} /></span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar initials={m.initials} />
                        <span className="min-w-0 truncate text-[13px] font-semibold text-slate-900">{m.name}</span>
                      </span>
                      <span className="text-[11px] leading-snug text-slate-500">
                        <span className="font-semibold text-slate-600">{m.role}</span> · {RACI_DESCRIPTION[m.raci]}
                      </span>
                    </span>
                    <span className="mt-0.5 flex-none text-[11px] font-semibold text-blue-600">Add</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ===== Notification preview (collapsed by default — it only repeats what's above) ===== */}
      <div className="border-t border-slate-200 px-4 py-3" style={{ backgroundColor: '#F8FAFC' }}>
        <button
          type="button"
          onClick={() => setShowPreview(v => !v)}
          aria-expanded={showPreview}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Notification preview</span>
          <span aria-hidden="true" className="text-[10px] text-slate-400">{showPreview ? '▾' : '▸'}</span>
        </button>
        {showPreview && (
        <div className="mt-1.5 flex flex-col gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2.5">
          <p className="text-[12px] font-bold text-slate-900">Review requested: {document.title}</p>
          <p className="text-[11px] leading-[1.5] text-slate-500">
            {owner?.name ?? 'The author'} has submitted the above document for your review. Due: {dueDateLabel}.
          </p>
          <div className="flex items-center gap-2">
            <div className="flex items-center">
              {nonOwnerReviewers.map((r, i) => (
                <div
                  key={r.userId}
                  style={{ marginLeft: i === 0 ? 0 : -5, boxShadow: '0 0 0 2px #FFFFFF' }}
                  className="rounded-full"
                >
                  <Avatar initials={r.initials} size={18} />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">{nonOwnerReviewers.length} reviewer{nonOwnerReviewers.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        )}
      </div>

      </div>{/* end scroll area */}

      {/* ===== Footer ===== */}
      <div className="flex flex-none flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3">
        {submitMut.isError && (
          <div className="whitespace-pre-line rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">
            {submitErrorMessage(submitMut.error, statusMeta.label)}
          </div>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitMut.isPending}
            className="flex-1 rounded-md border border-slate-200 bg-white py-2.5 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            Save as draft
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitMut.isPending || !dueDate}
            title={!dueDate ? 'Set a review-due date first' : undefined}
            className="flex-1 rounded-md bg-blue-600 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:bg-slate-300 disabled:hover:bg-slate-300"
          >
            {submitMut.isPending ? 'Submitting…' : 'Submit for review →'}
          </button>
        </div>
        <p className="text-center text-[11px] italic leading-[1.5] text-slate-500">
          {!dueDate
            ? 'Pick a review-due date above to enable the Submit button.'
            : 'Submitting will lock the document for authoring and notify all reviewers.'}
        </p>
      </div>
    </div>
  )
}

// --- Review type card ---

function ReviewTypeCard({
  active, title, subtitle, onClick,
}: {
  active: boolean; title: string; subtitle: string; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex min-w-[140px] flex-1 flex-col gap-1 rounded-lg py-2.5 pl-3 pr-7 text-left transition-colors"
      style={{
        border:          active ? '2px solid #2563EB' : '1px solid #E2E8F0',
        backgroundColor: active ? '#EFF6FF' : '#FFFFFF',
      }}
    >
      <p className="text-[13px] font-bold" style={{ color: active ? '#1D4ED8' : '#1E293B' }}>{title}</p>
      <p className="text-[11px] leading-tight" style={{ color: active ? '#475569' : '#64748B' }}>{subtitle}</p>
      {active && (
        <div
          className="absolute right-2 top-2 flex h-[15px] w-[15px] items-center justify-center rounded-full font-mono text-[9px] font-extrabold text-white"
          style={{ backgroundColor: '#2563EB' }}
        >
          ✓
        </div>
      )}
    </button>
  )
}
