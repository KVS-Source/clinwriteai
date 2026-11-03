import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Comment, ResolutionType } from '@platform/types'
import { crmApi, documentsApi } from '../api'
import { useCRMStore } from '../store'
import { useAuthStore } from '../store/authStore'

interface Props {
  documentId: string
  meetingId:  string
  onClose:    () => void
}

const NOTE_MAX_LENGTH = 500

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

const SEVERITY_META = {
  major: { bg: '#FEE2E2', fg: '#DC2626', labelKey: 'page.comment_resolution.severity_major' },
  minor: { bg: '#FFFBEB', fg: '#B45309', labelKey: 'page.comment_resolution.severity_minor' },
  query: { bg: '#EFF6FF', fg: '#2563EB', labelKey: 'page.comment_resolution.severity_query' },
}

const RESOLUTION_ACTIONS: { type: ResolutionType; titleKey: string; subKey: string }[] = [
  { type: 'accept',                   titleKey: 'page.comment_resolution.action_accept',           subKey: 'page.comment_resolution.action_accept_sub' },
  { type: 'accept-with-modification', titleKey: 'page.comment_resolution.action_accept_mod',       subKey: 'page.comment_resolution.action_accept_mod_sub' },
  { type: 'reject',                   titleKey: 'page.comment_resolution.action_reject',           subKey: 'page.comment_resolution.action_reject_sub' },
]

function Avatar({ initials, size = 20 }: { initials: string; size?: number }) {
  const c = AVATAR_COLOURS[initials] ?? AVATAR_COLOURS.MW
  return (
    <div
      className="flex flex-none items-center justify-center rounded-full font-mono font-bold"
      style={{
        width: size, height: size,
        backgroundColor: c.bg, color: c.fg,
        fontSize: 10,
      }}
    >
      {initials}
    </div>
  )
}

// --- Toggle switch ---

function ToggleSwitch({ checked, onChange, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; ariaLabel: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="relative flex-none rounded-full transition-colors"
      style={{
        width: 36, height: 20,
        backgroundColor: checked ? '#2563EB' : '#E2E8F0',
        padding: 2,
        boxSizing: 'border-box',
      }}
    >
      <span
        aria-hidden="true"
        className="block rounded-full bg-white transition-transform"
        style={{
          width: 16, height: 16,
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
        }}
      />
    </button>
  )
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#94A3B8" strokeWidth="1.2" className="flex-none">
      <rect x="2.2" y="5.2" width="7.6" height="5.4" rx="1"/>
      <path d="M4 5.2V3.8a2 2 0 0 1 4 0v1.4"/>
    </svg>
  )
}

function SignatureIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" className="flex-none">
      <rect x="1.6" y="11" width="10.8" height="1.6" rx="0.8" fill="currentColor"/>
      <path d="M2.8 8.5L8.5 2.8a1.4 1.4 0 0 1 2 2L4.8 10.5H2.8V8.5Z"/>
    </svg>
  )
}

export function CommentResolutionPanel({ documentId, meetingId, onClose }: Props) {
  const { t } = useTranslation()
  const qc                 = useQueryClient()
  const currentUserName    = useAuthStore(s => s.user?.name ?? 'unknown')
  // Store is keyed by meetingId since the CRM store refactor — read via
  // getter + reactive subscription on the entries map so a draft change
  // on THIS meeting re-renders this panel.
  const entries            = useCRMStore(s => s.entries)
  const resolutionDraft    = entries[meetingId]?.resolutionDraft ?? null
  const setResolutionDraftRaw = useCRMStore(s => s.setResolutionDraft)
  const saveResolutionRaw     = useCRMStore(s => s.saveResolution)
  const setResolutionDraft = (draft: Parameters<typeof setResolutionDraftRaw>[1]) =>
    setResolutionDraftRaw(meetingId, draft)
  const saveResolution     = (resolution: Parameters<typeof saveResolutionRaw>[1]) =>
    saveResolutionRaw(meetingId, resolution)

  // Selected type comes from draft (seeded when user clicked a Resolve button in the CRM active card)
  const [selectedType, setSelectedType] = useState<ResolutionType | null>(resolutionDraft?.type ?? null)
  const [note, setNote]                 = useState('')
  const [notify, setNotify]             = useState(true)
  const [noteError, setNoteError]       = useState<string | null>(null)

  // Fetch the comment being resolved
  const { data: comments = [] } = useQuery({
    queryKey: ['comments', documentId],
    queryFn:  () => documentsApi.getComments(documentId),
  })

  const activeComment = useMemo(
    () => comments.find(c => c.id === resolutionDraft?.commentId) as Comment | undefined,
    [comments, resolutionDraft],
  )

  const logMut = useMutation({
    mutationFn: (args: { type: ResolutionType; note: string }) =>
      crmApi.logResolution(meetingId, {
        commentId:      activeComment!.id,
        resolutionType: args.type,
        note:           args.note,
        notifyReviewer: notify,
      }),
    onSuccess: () => {
      if (!activeComment || !selectedType) return
      saveResolution({
        commentId:  activeComment.id,
        type:       selectedType,
        note,
        resolvedBy: currentUserName,
        resolvedAt: new Date().toISOString(),
      })
      qc.invalidateQueries({ queryKey: ['crm-meetings', documentId] })
      onClose()
    },
  })

  const canSubmit = selectedType !== null && note.trim().length > 0 && !logMut.isPending

  const handleSubmit = () => {
    if (!selectedType) return
    if (!note.trim()) {
      setNoteError(t('page.comment_resolution.error_note_required'))
      return
    }
    logMut.mutate({ type: selectedType, note: note.trim() })
  }

  const handleCancel = () => {
    setResolutionDraft(null)
    onClose()
  }

  if (!activeComment) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="font-mono text-xs text-slate-400">{t('page.comment_resolution.no_comment_selected')}</p>
      </div>
    )
  }

  const sev = SEVERITY_META[activeComment.severity]

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* Header (48px) */}
      <div className="flex h-12 flex-none items-center gap-2 border-b border-slate-200 px-4">
        <span style={{ color: '#2563EB' }}><SignatureIcon /></span>
        <h3 className="whitespace-nowrap text-sm font-bold">{t('page.comment_resolution.title')}</h3>
        <span className="ml-1 font-mono text-[10px] tracking-wider text-slate-500">{activeComment.id}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label={t('page.comment_resolution.close_aria')}
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Scroll body */}
      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">

        {/* Comment context card */}
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3.5" style={{ backgroundColor: '#F8FAFC' }}>
          <div className="flex flex-wrap items-center gap-2">
            <Avatar initials={activeComment.reviewerInitials} />
            <p className="text-[13px] font-bold">{activeComment.reviewerName}</p>
            <div className="flex-1" />
            <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900" style={{ backgroundColor: '#F1F5F9' }}>
              {activeComment.sectionRef}
            </span>
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: sev.bg, color: sev.fg }}
            >
              {t(sev.labelKey)}
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-slate-900">{activeComment.text}</p>
        </div>

        {/* Source excerpt */}
        <div className="rounded-lg border border-slate-200 bg-white p-3.5">
          <p className="mb-1.5 font-mono text-[9px] font-medium uppercase tracking-widest text-slate-500">
            {t('page.comment_resolution.source_excerpt_prefix', { section: activeComment.sectionRef })}
          </p>
          <p className="text-[13px] italic leading-relaxed text-slate-500">
            …Grade ≥3 TEAE in the Veloricept arm was{' '}
            <span className="rounded px-0.5" style={{ backgroundColor: '#FEF3C7' }}>pneumonitis</span>
            {' '}(6.2%), which was managed with corticosteroid therapy in all cases.
          </p>
          <div className="mt-2 text-right">
            <button className="text-xs font-semibold text-blue-600 hover:text-blue-700">{t('page.comment_resolution.open_in_editor')}</button>
          </div>
        </div>

        {/* Resolution action */}
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-bold">{t('page.comment_resolution.resolution_action_label')}</p>
          <div className="flex flex-wrap gap-2">
            {RESOLUTION_ACTIONS.map(action => {
              const isSelected = selectedType === action.type
              return (
                <button
                  key={action.type}
                  type="button"
                  onClick={() => setSelectedType(action.type)}
                  className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 rounded-lg p-3 text-left transition-colors"
                  style={isSelected ? {
                    border:          '2px solid #2563EB',
                    backgroundColor: '#EFF6FF',
                  } : {
                    border:          '1px solid #E2E8F0',
                    backgroundColor: '#FFFFFF',
                  }}
                  data-action-type={action.type}
                  data-selected={isSelected || undefined}
                >
                  <p className="text-[13px] font-bold text-slate-900">{t(action.titleKey)}</p>
                  <p className="text-[11px] leading-tight text-slate-500">{t(action.subKey)}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Resolution note */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="cr-note" className="text-[13px] font-bold">{t('page.comment_resolution.resolution_note_label')}</label>
            <p className="font-mono text-[9px] font-medium tracking-widest text-slate-500">{t('page.comment_resolution.required_label')}</p>
          </div>
          <textarea
            id="cr-note"
            rows={4}
            value={note}
            onChange={e => {
              const val = e.target.value.slice(0, NOTE_MAX_LENGTH)
              setNote(val)
              if (noteError) setNoteError(null)
            }}
            placeholder={t('page.comment_resolution.resolution_note_placeholder')}
            className="w-full rounded-md border p-2.5 text-[13px] leading-relaxed outline-none focus:border-blue-600 focus:shadow-focus"
            style={{ borderColor: noteError ? '#DC2626' : '#E2E8F0', resize: 'vertical' }}
          />
          <div className="flex justify-between">
            {noteError ? (
              <p className="text-[11px] font-semibold" style={{ color: '#DC2626' }}>{noteError}</p>
            ) : <span />}
            <p className="text-[11px] text-slate-500">{note.length} / {NOTE_MAX_LENGTH}</p>
          </div>
        </div>

        {/* Notify toggle */}
        <div className="flex items-start gap-2.5">
          <ToggleSwitch
            checked={notify}
            onChange={setNotify}
            ariaLabel={notify ? t('page.comment_resolution.notification_on') : t('page.comment_resolution.notification_off')}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[13px] text-slate-900">{t('page.comment_resolution.notify_reviewer', { name: activeComment.reviewerName })}</p>
            <p className="text-[11px] text-slate-500">{t('page.comment_resolution.notify_hint')}</p>
          </div>
        </div>

        {/* Audit trail note */}
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 px-3.5 py-2.5" style={{ backgroundColor: '#F8FAFC' }}>
          <span className="mt-0.5"><LockIcon /></span>
          <p className="text-[12px] italic leading-relaxed text-slate-500">
            {t('page.comment_resolution.audit_trail_note')}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-none flex-col border-t border-slate-200" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={logMut.isPending}
            className="rounded-md border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            {t('button.cancel')}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="whitespace-nowrap rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {logMut.isPending ? t('page.comment_resolution.signing') : t('page.comment_resolution.sign_and_confirm')}
          </button>
        </div>
        <p className="pb-2.5 text-center font-mono text-[10px] font-medium tracking-wider text-slate-500">
          {t('page.comment_resolution.part11_note')}
        </p>
      </div>
    </div>
  )
}
