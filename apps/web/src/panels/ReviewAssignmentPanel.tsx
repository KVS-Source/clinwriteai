import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RACI_META, type RACIRole, type TeamMember } from '@platform/types'
import { documentsApi, projectsApi } from '../api'
import { useDocumentStore } from '../store'

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
    <div className="flex items-center gap-2.5 border-b px-4 py-2.5 transition-colors hover:bg-slate-50" style={{ borderColor: '#F1F5F9' }}>
      <RACIBadge role={member.raci} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-[13px] font-semibold text-slate-900">{member.role}</p>
        <p className="truncate text-[11px] text-slate-500">{RACI_DESCRIPTION[member.raci]}</p>
      </div>
      <div className="flex-1" />
      <div className="flex flex-none items-center gap-2">
        <Avatar initials={member.initials} />
        <p className="whitespace-nowrap text-[13px] font-semibold">{member.name}</p>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove reviewer"
            title="Remove reviewer"
            className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        ) : (
          <div className="w-[18px]" aria-hidden="true" />
        )}
      </div>
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
      setActiveDocument(updated)
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

  if (!document) {
    return <div className="p-4 text-sm text-slate-500">Loading document…</div>
  }

  // Notification preview: due date formatted DD MMM YYYY
  const dueDateLabel = dueDate
    ? new Date(dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'not set'

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ===== Document summary card ===== */}
      <div className="flex flex-none flex-col gap-2.5 border-b border-slate-200 px-4 py-4" style={{ backgroundColor: '#F8FAFC' }}>
        <p className="text-[14px] font-bold">{document.title}</p>
        <p className="text-xs text-slate-500">
          {document.type.toUpperCase()} · v{document.version} · {document.stage.replace(/-/g, ' ')}
        </p>
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ backgroundColor: '#EFF6FF', color: '#2563EB' }}
          >
            In Authoring
          </span>
          <ArrowRight />
          <span
            className="rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
          >
            In Review
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2.5">
          <label htmlFor="review-due" className="flex-none text-xs text-slate-500">Review due</label>
          <input
            id="review-due"
            type="date"
            value={dueDate}
            onChange={e => { setDueDate(e.target.value); if (dateError) setDateError(null) }}
            className="rounded-md border px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-600 focus:shadow-focus"
            style={{ borderColor: dateError ? '#DC2626' : '#E2E8F0' }}
          />
        </div>
        {dateError && (
          <p className="text-[11px] font-semibold" style={{ color: '#DC2626' }}>{dateError}</p>
        )}
      </div>

      {/* ===== Review type selector ===== */}
      <div className="flex flex-none flex-col gap-2 border-b border-slate-200 px-4 py-3">
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Review type</p>
        <div className="flex gap-2">
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

      {/* ===== Reviewers list (scroll) ===== */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-3 pb-1.5">
          <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Assign reviewers</p>
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
            className="w-full rounded-md border border-dashed px-3 py-2 text-center text-[12px] text-slate-600 transition-colors hover:bg-slate-50"
            style={{ borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' }}
          >
            ＋ Add reviewer
          </button>
        </div>
      </div>

      {/* ===== Notification preview ===== */}
      <div className="flex-none border-t border-slate-200 px-4 py-3" style={{ backgroundColor: '#F8FAFC' }}>
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Notification preview</p>
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
      </div>

      {/* ===== Footer ===== */}
      <div className="flex flex-none flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3">
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
            disabled={submitMut.isPending}
            className="flex-1 rounded-md bg-blue-600 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-70"
          >
            {submitMut.isPending ? 'Submitting…' : 'Submit for review →'}
          </button>
        </div>
        <p className="text-center text-[11px] italic leading-[1.5] text-slate-500">
          Submitting will lock the document for authoring and notify all reviewers.
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
      className="relative flex flex-1 flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors"
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
