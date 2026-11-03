// ICH E3 Validator — Module A reference tooling (FR-A-026).
//
// Reads GET /documents/:id/ich-e3, which returns the 18 ICH E3 mandatory
// sections with a status computed from the document's live section rows
// plus any IchSectionWaiver rows. Waived rows show amber with reviewer +
// reason + waived-at date. Each row carries the editor `sectionId` to open
// and an `inDocument` flag, so "Open →" only shows when there's a section
// to jump to. ICH E3 governs full CSRs only — other document types get a
// short "not applicable" note instead of the list.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { documentsApi } from '../api'
import { useDocumentStore, useAuthStore } from '../store'
import { ApiError } from '../api/client'

type IchStatus = 'complete' | 'in_progress' | 'not_started' | 'waived' | 'warning'

type IchE3Report = Awaited<ReturnType<typeof documentsApi.getICHE3>>
type IchSection = IchE3Report['sections'][number]

function errorMessage(err: unknown, fallback: string, t: TFunction): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string } | null
    return body?.message ?? t('page.ich_validator_panel.err_with_http', { fallback, status: err.status })
  }
  return t('page.ich_validator_panel.err_please_retry', { fallback })
}

// --- Status glyphs ---

function CompleteIcon() {
  return (
    <div
      className="flex h-4 w-4 flex-none items-center justify-center rounded-full"
      style={{ backgroundColor: '#16A34A' }}
      data-status-icon="complete"
    >
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
        <polyline points="2,6.4 4.6,9 10,3.2" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function InProgressIcon() {
  return (
    <div className="flex h-4 w-4 flex-none items-center justify-center" data-status-icon="in-progress">
      <svg width="12" height="12" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="6" fill="none" stroke="#2563EB" strokeWidth="2" strokeDasharray="28 10" transform="rotate(-90 9 9)" />
      </svg>
    </div>
  )
}

function NotStartedIcon() {
  return (
    <div
      className="h-4 w-4 flex-none rounded-full"
      style={{ border: '1px solid #CBD5E1', backgroundColor: '#FFFFFF' }}
      data-status-icon="not-started"
    />
  )
}

function WaivedIcon() {
  return (
    <div
      className="flex h-4 w-4 flex-none items-center justify-center text-xs font-extrabold"
      style={{ color: '#D97706' }}
      data-status-icon="waived"
    >
      ⚠
    </div>
  )
}

// Marked complete, then emptied — distinct from a waiver.
function WarningIcon() {
  return (
    <div
      className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-extrabold"
      style={{ border: '1.5px solid #D97706', color: '#D97706' }}
      data-status-icon="warning"
    >
      !
    </div>
  )
}

function StatusIcon({ status }: { status: IchStatus }) {
  if (status === 'complete')    return <CompleteIcon />
  if (status === 'in_progress') return <InProgressIcon />
  if (status === 'waived')      return <WaivedIcon />
  if (status === 'warning')     return <WarningIcon />
  return <NotStartedIcon />
}

// --- Waive form (inline, under its row) ---

function WaiveForm({ code, onCancel, onConfirm, submitting, error }: {
  code: string
  onCancel: () => void
  onConfirm: (reason: string) => void
  submitting: boolean
  error: string | null
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  return (
    <div
      className="mt-2 ml-6 flex flex-col gap-2 rounded-lg p-3"
      style={{ border: '1px solid #FDE68A', backgroundColor: '#FFFBEB' }}
      data-form="waive"
      data-section-code={code}
    >
      <p className="text-[12px] font-semibold" style={{ color: '#B45309' }}>
        {t('page.ich_validator_panel.waive_form_title', { code })}
      </p>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder={t('page.ich_validator_panel.waive_reason_placeholder')}
        rows={3}
        className="rounded border border-slate-200 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-blue-600"
        autoFocus
      />
      {error && (
        <p className="text-[11px] font-semibold text-red-700" role="alert">{error}</p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t('button.cancel')}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(reason.trim())}
          disabled={submitting || reason.trim().length < 10}
          className="rounded px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: '#B45309' }}
          data-action="confirm-waive"
        >
          {submitting ? t('page.ich_validator_panel.waiving') : t('page.ich_validator_panel.confirm_waive')}
        </button>
      </div>
    </div>
  )
}

// --- Un-waive confirmation (inline, under its row) ---

function ClearWaiverConfirm({ code, onCancel, onConfirm, submitting, error }: {
  code: string
  onCancel: () => void
  onConfirm: () => void
  submitting: boolean
  error: string | null
}) {
  const { t } = useTranslation()
  return (
    <div
      className="mt-2 ml-6 flex flex-col gap-2 rounded-lg p-3"
      style={{ border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}
      data-form="clear-waiver"
      data-section-code={code}
    >
      <p className="text-[12px] text-slate-700">
        {t('page.ich_validator_panel.clear_waiver_prompt_prefix')}<span className="font-semibold">{code}</span>{t('page.ich_validator_panel.clear_waiver_prompt_suffix')}
      </p>
      {error && (
        <p className="text-[11px] font-semibold text-red-700" role="alert">{error}</p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t('button.cancel')}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          data-action="confirm-clear-waiver"
        >
          {submitting ? t('page.ich_validator_panel.removing') : t('page.ich_validator_panel.remove_waiver')}
        </button>
      </div>
    </div>
  )
}

// --- Row ---

// A section with fewer words than this gets a "check it's finished" hint.
const SHORT_SECTION_WORDS = 20

interface RowProps {
  section:       IchSection
  isActive:      boolean
  onOpen:        (sectionId: string) => void
  canWaive:      boolean
  isWaiving:     boolean
  isClearing:    boolean
  onBeginWaive:  () => void
  onBeginClear:  () => void
  onCancel:      () => void
  onWaive:       (reason: string) => void
  onClearWaiver: () => void
  isMutating:    boolean
  error:         string | null
}

function ICHRow(p: RowProps) {
  const { t } = useTranslation()
  const { section }   = p
  const isWaived      = section.status === 'waived'
  const isWarning     = section.status === 'warning'
  const isNotStarted  = section.status === 'not_started'
  const [showReason, setShowReason] = useState(false)
  const fullTitle     = `${section.code} ${section.title}`

  return (
    <div
      className="border-b px-4 py-2 transition-colors hover:bg-slate-50"
      style={{
        borderColor:     '#F1F5F9',
        backgroundColor: p.isActive ? '#EFF6FF' : undefined,
        boxShadow:       p.isActive ? 'inset 2px 0 0 #2563EB' : undefined,
      }}
      data-ich-row={section.code}
      data-ich-status={section.status}
      data-active={p.isActive || undefined}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex flex-none"><StatusIcon status={section.status} /></span>
        <span
          className="min-w-0 flex-1 break-words text-[13px] leading-snug"
          style={{ color: isNotStarted ? '#64748B' : '#1E293B' }}
          title={fullTitle}
        >
          {fullTitle}
        </span>

        {section.conditional && (
          <span
            className="flex-none whitespace-nowrap rounded px-1.5 py-px text-[10px] font-semibold text-slate-500"
            style={section.requirement === 'required' ? { backgroundColor: '#FEF3C7', color: '#92400E' } : { backgroundColor: '#F1F5F9' }}
            title={t('page.ich_validator_panel.us_only_tooltip')}
            data-ich-requirement={section.requirement ?? 'unknown'}
          >
            {section.requirement === 'required' ? t('page.ich_validator_panel.required_us')
              : section.requirement === 'not-required' ? t('page.ich_validator_panel.not_required_no_us')
              : t('page.ich_validator_panel.us_only')}
          </span>
        )}

        {isWaived && (
          <span className="flex-none whitespace-nowrap text-[11px] font-semibold" style={{ color: '#B45309' }}>
            {t('page.ich_validator_panel.waived_badge')}
          </span>
        )}

        {isWarning && (
          <span
            className="flex-none whitespace-nowrap text-[11px] font-semibold"
            style={{ color: '#B45309' }}
            title={t('page.ich_validator_panel.needs_attention_tooltip')}
          >
            {t('page.ich_validator_panel.needs_attention')}
          </span>
        )}

        {section.inDocument ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); p.onOpen(section.sectionId) }}
            className="flex-none whitespace-nowrap text-[11px] font-semibold text-blue-600 hover:text-blue-700"
            data-open-in-editor={section.sectionId}
          >
            {t('page.ich_validator_panel.open_arrow')}
          </button>
        ) : (
          <span
            className="flex-none whitespace-nowrap text-[11px] text-slate-400"
            title={t('page.ich_validator_panel.not_in_document_tooltip')}
            data-not-in-document
          >
            {t('page.ich_validator_panel.not_in_document')}
          </span>
        )}

        {p.canWaive && !isWaived && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); p.onBeginWaive() }}
            disabled={p.isMutating}
            className="flex-none whitespace-nowrap text-[11px] font-semibold hover:text-amber-700 disabled:opacity-50"
            style={{ color: '#B45309' }}
            data-action="waive"
          >
            {t('page.ich_validator_panel.waive_action')}
          </button>
        )}

        {p.canWaive && isWaived && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); p.onBeginClear() }}
            disabled={p.isMutating}
            className="flex-none whitespace-nowrap text-[11px] font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
            data-action="clear-waiver"
          >
            {t('page.ich_validator_panel.unwaive_action')}
          </button>
        )}
      </div>

      {isWaived && section.hasContent && (
        <p className="mt-1 ml-6 text-[11px] font-semibold" style={{ color: '#B45309' }} data-ich-waived-has-content>
          {t('page.ich_validator_panel.waived_has_content')}
        </p>
      )}

      {!isWaived && (section.status === 'complete' || section.status === 'in_progress')
        && (section.wordCount ?? 0) > 0 && (section.wordCount ?? 0) < SHORT_SECTION_WORDS && (
        <p className="mt-1 ml-6 text-[11px] text-slate-500" data-ich-short-section>
          {t('page.ich_validator_panel.short_section', { count: section.wordCount })}
        </p>
      )}

      {isWaived && section.waiver && (
        <div className="mt-1 ml-6">
          <button
            type="button"
            onClick={() => setShowReason(v => !v)}
            className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
          >
            {showReason ? t('page.ich_validator_panel.hide_waiver_reason') : t('page.ich_validator_panel.view_waiver_reason')}
          </button>
          {showReason && (
            <div
              className="mt-1 rounded border px-2.5 py-2 text-[11px]"
              style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A', color: '#B45309' }}
            >
              <p className="font-semibold">{section.waiver.reason}</p>
              <p className="mt-0.5 text-[10px]">
                {section.waiver.waivedByName ?? t('page.ich_validator_panel.unknown_user')} · {new Date(section.waiver.waivedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · {t('page.ich_validator_panel.at_version', { version: section.waiver.versionAtWaiver })}
              </p>
            </div>
          )}
        </div>
      )}

      {p.isWaiving && (
        <WaiveForm
          code={section.code}
          onCancel={p.onCancel}
          onConfirm={p.onWaive}
          submitting={p.isMutating}
          error={p.error}
        />
      )}

      {p.isClearing && (
        <ClearWaiverConfirm
          code={section.code}
          onCancel={p.onCancel}
          onConfirm={p.onClearWaiver}
          submitting={p.isMutating}
          error={p.error}
        />
      )}
    </div>
  )
}

interface Props {
  documentId: string
}

export function ICHValidatorPanel({ documentId }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const activeSection    = useDocumentStore(s => s.activeSection)
  const setActiveSection = useDocumentStore(s => s.setActiveSection)
  const currentUser      = useAuthStore(s => s.user)

  // One inline action open at a time: waiving or clearing a waiver on a row.
  const [pending, setPending]       = useState<{ code: string; action: 'waive' | 'clear' } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'incomplete' | 'waived'>('all')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['ich-e3', documentId],
    queryFn:  () => documentsApi.getICHE3(documentId),
    enabled:  !!documentId,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ich-e3', documentId] })
  const closeAction = () => { setPending(null); setActionError(null) }

  const waiveMut = useMutation({
    mutationFn: (args: { code: string; reason: string }) =>
      documentsApi.waiveICHE3Section(documentId, args.code, args.reason),
    onSuccess: () => { closeAction(); invalidate() },
    onError:   (err: unknown) => setActionError(errorMessage(err, t('page.ich_validator_panel.err_could_not_waive'), t)),
  })

  const clearMut = useMutation({
    mutationFn: (code: string) => documentsApi.unwaiveICHE3Section(documentId, code),
    onSuccess:  () => { closeAction(); invalidate() },
    onError:    (err: unknown) => setActionError(errorMessage(err, t('page.ich_validator_panel.err_could_not_clear'), t)),
  })

  const applicable        = data?.applicable ?? true
  const sections          = data?.sections          ?? []
  const completeCount     = data?.completeCount     ?? 0
  const waivedCount       = data?.waivedCount       ?? 0
  const totalSections     = data?.totalSections     ?? sections.length
  const completionPercent = data?.completionPercent ?? 0

  // The API runs the same role check as the waive route (tenant-admin, or
  // a contributor with can-review) and tells us the result.
  const canWaive = applicable && (data?.canWaive ?? false)

  // Keep the panel open: the editor shows the chosen section beside it.
  const handleOpenInEditor = (sectionId: string) => setActiveSection(sectionId)

  // The row for the editor's current section — its own id or a parent
  // heading (§11 for s11_4).
  const isActiveRow = (s: IchSection) =>
    !!activeSection && s.inDocument && (activeSection === s.sectionId || activeSection.startsWith(`${s.sectionId}_`))

  const visibleSections = sections.filter(s =>
    filter === 'all' ? true
    : filter === 'waived' ? s.status === 'waived'
    : s.status !== 'complete' && s.status !== 'waived')

  const fileSlug = () => (data?.documentTitle || `Document ${documentId}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || documentId

  // Spreadsheet-friendly export for auditors. Quotes every cell.
  const handleExportCsv = () => {
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const rows = [
      [
        t('page.ich_validator_panel.csv_col_section'),
        t('page.ich_validator_panel.csv_col_title'),
        t('page.ich_validator_panel.csv_col_status'),
        t('page.ich_validator_panel.csv_col_in_document'),
        t('page.ich_validator_panel.csv_col_words'),
        t('page.ich_validator_panel.csv_col_us_only'),
        t('page.ich_validator_panel.csv_col_waived_by'),
        t('page.ich_validator_panel.csv_col_waived_at'),
        t('page.ich_validator_panel.csv_col_waiver_reason'),
      ],
      ...sections.map(s => [
        s.code, s.title, s.status.replace('_', ' '), s.inDocument ? t('page.ich_validator_panel.yes') : t('page.ich_validator_panel.no'), s.wordCount ?? '',
        s.conditional ? t('page.ich_validator_panel.yes') : t('page.ich_validator_panel.no'), s.waiver?.waivedByName ?? '', s.waiver?.waivedAt ?? '', s.waiver?.reason ?? '',
      ]),
    ]
    const blob = new Blob(['\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ich-e3-${fileSlug()}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExport = () => {
    // Build a plain-text report in-browser so admins can hand it to a
    // reviewer without a round-trip. A PDF variant via pdfkit can swap in
    // here later without touching the panel.
    const title = data?.documentTitle || `Document ${documentId}`
    const lines: string[] = [
      t('page.ich_validator_panel.report_title'),
      t('page.ich_validator_panel.report_document', { title }),
      t('page.ich_validator_panel.report_generated_by', { name: currentUser?.name ?? t('page.ich_validator_panel.unknown_user') }),
      t('page.ich_validator_panel.report_generated_at', { time: new Date().toISOString().replace('T', ' ').slice(0, 19) }),
      t('page.ich_validator_panel.report_completion', { pct: completionPercent, complete: completeCount, waived: waivedCount, total: totalSections }),
      '',
      ...sections.map(s => {
        const status = s.status.toUpperCase().replace('_', ' ')
        const tag    = s.conditional ? ' ' + t('page.ich_validator_panel.report_tag_us_only') : ''
        const where  = s.inDocument ? '' : ' ' + t('page.ich_validator_panel.report_tag_not_in_doc')
        const waiver = s.waiver ? '  — ' + t('page.ich_validator_panel.report_waived_by', { name: s.waiver.waivedByName ?? t('page.ich_validator_panel.unknown_user_lc'), reason: s.waiver.reason }) : ''
        return `${s.code.padEnd(7)} ${status.padEnd(13)} ${s.title}${tag}${where}${waiver}`
      }),
    ]
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || documentId
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ich-e3-${slug}-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (data && !applicable) {
    return (
      <div className="flex h-full flex-col" data-panel-body="ich-e3">
        <div className="px-4 py-6" data-ich-not-applicable>
          <p className="text-[13px] font-semibold text-slate-900">{t('page.ich_validator_panel.not_applicable_title')}</p>
          <p className="mt-1 text-[12px] text-slate-500">
            {t('page.ich_validator_panel.not_applicable_body')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-panel-body="ich-e3">

      {/* Completion strip */}
      <div className="flex-none border-b border-slate-200 px-4 py-3" style={{ backgroundColor: '#F8FAFC' }} data-ich-completion>
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-bold text-slate-900">
            {waivedCount > 0
              ? t('page.ich_validator_panel.completion_with_waived', { complete: completeCount, waived: waivedCount, total: totalSections })
              : t('page.ich_validator_panel.completion', { complete: completeCount, total: totalSections })}
          </p>
          <p className="text-xs font-bold" style={{ color: '#2563EB' }}>{completionPercent}%</p>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
          <div className="h-full transition-all" style={{ width: `${completionPercent}%`, backgroundColor: '#2563EB' }} />
        </div>
      </div>

      {/* Filter */}
      <div className="flex flex-none gap-1.5 border-b border-slate-200 px-4 py-2" role="group" aria-label={t('page.ich_validator_panel.filter_aria')} data-ich-filter>
        {([
          ['all', t('page.ich_validator_panel.filter_all')],
          ['incomplete', t('page.ich_validator_panel.filter_incomplete')],
          ['waived', t('page.ich_validator_panel.filter_waived')],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            data-ich-filter-option={key}
            className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors hover:bg-slate-50"
            style={{
              borderColor:     filter === key ? '#2563EB' : '#E2E8F0',
              backgroundColor: filter === key ? '#EFF6FF' : '#FFFFFF',
              color:           filter === key ? '#2563EB' : '#64748B',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Scroll region */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="px-4 py-6 text-[12px] text-slate-400">{t('page.ich_validator_panel.loading_report')}</p>
        )}
        {isError && (
          <p className="px-4 py-6 text-[12px] text-red-700" role="alert">
            {t('page.ich_validator_panel.load_failed')}
          </p>
        )}
        {!isLoading && !isError && sections.length === 0 && (
          <p className="px-4 py-6 text-[12px] text-slate-500" data-ich-empty>
            {t('page.ich_validator_panel.empty_sections')}
          </p>
        )}

        {!isLoading && !isError && sections.length > 0 && (
          <>
            <div className="px-4 pb-1.5 pt-3">
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
                {t('page.ich_validator_panel.mandatory_sections_header')}
              </p>
            </div>

            {visibleSections.length === 0 && (
              <p className="px-4 py-6 text-center text-[12px] text-slate-500" data-ich-filter-empty>
                {filter === 'waived' ? t('page.ich_validator_panel.filter_empty_waived') : t('page.ich_validator_panel.filter_empty_other')}
              </p>
            )}

            {visibleSections.map(section => (
              <ICHRow
                key={section.code}
                section={section}
                isActive={isActiveRow(section)}
                onOpen={handleOpenInEditor}
                canWaive={canWaive}
                isWaiving={pending?.code === section.code && pending.action === 'waive'}
                isClearing={pending?.code === section.code && pending.action === 'clear'}
                onBeginWaive={() => { setPending({ code: section.code, action: 'waive' }); setActionError(null) }}
                onBeginClear={() => { setPending({ code: section.code, action: 'clear' }); setActionError(null) }}
                onCancel={closeAction}
                onWaive={(reason) => waiveMut.mutate({ code: section.code, reason })}
                onClearWaiver={() => clearMut.mutate(section.code)}
                isMutating={waiveMut.isPending || clearMut.isPending}
                error={pending?.code === section.code ? actionError : null}
              />
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex-none border-t border-slate-200 px-4 py-3">
        {waivedCount > 0 && (
          <p className="mb-2 text-[11px] text-slate-500" data-ich-compliance-note>
            {t('page.ich_validator_panel.compliance_disclosure_note')}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={sections.length === 0}
            data-ich-export
            className="flex-1 rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:text-slate-400"
          >
            {t('page.ich_validator_panel.export_report_txt')}
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={sections.length === 0}
            data-ich-export-csv
            className="flex-1 rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:text-slate-400"
          >
            {t('page.ich_validator_panel.export_csv')}
          </button>
        </div>
      </div>
    </div>
  )
}
