// ICH E3 Validator — Module A reference tooling (FR-A-026).
//
// Reads GET /documents/:id/ich-e3, which returns the 18 ICH E3 mandatory
// sections with a status computed from the document's live section rows
// plus any IchSectionWaiver rows. Waived rows show amber with reviewer +
// reason + waived-at date. Each row carries a canonical `sectionId` so
// "Open in editor →" always resolves (no hard-coded §11/§12 map).

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { documentsApi } from '../api'
import { useDocumentStore, useAuthStore } from '../store'
import { ApiError } from '../api/client'

type IchStatus = 'complete' | 'in_progress' | 'not_started' | 'waived' | 'warning'

type IchE3Report = Awaited<ReturnType<typeof documentsApi.getICHE3>>
type IchSection = IchE3Report['sections'][number]

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

function StatusIcon({ status }: { status: IchStatus }) {
  if (status === 'complete')    return <CompleteIcon />
  if (status === 'in_progress') return <InProgressIcon />
  if (status === 'waived')      return <WaivedIcon />
  if (status === 'warning')     return <WaivedIcon />
  return <NotStartedIcon />
}

interface RowProps {
  section:         IchSection
  onOpen:          (sectionId: string) => void
  canWaive:        boolean
  onBeginWaive:    (code: string) => void
  onClearWaiver:   (code: string) => void
  isMutating:      boolean
}

function ICHRow(p: RowProps) {
  const { section }   = p
  const isWaived      = section.status === 'waived'
  const isNotStarted  = section.status === 'not_started'
  const [showReason, setShowReason] = useState(false)

  return (
    <div
      className="border-b px-4 py-2 transition-colors hover:bg-slate-50"
      style={{ borderColor: '#F1F5F9' }}
      data-ich-row={section.code}
      data-ich-status={section.status}
    >
      <div className="flex items-center gap-2.5">
        <StatusIcon status={section.status} />
        <span
          className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]"
          style={{ color: isNotStarted ? '#64748B' : '#1E293B' }}
        >
          {section.code} {section.title}
        </span>

        {isWaived && (
          <span className="flex-none whitespace-nowrap text-[11px] font-semibold" style={{ color: '#B45309' }}>
            Waived
          </span>
        )}

        {!isWaived && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); p.onOpen(section.sectionId) }}
            className="flex-none whitespace-nowrap text-[11px] font-semibold text-blue-600 hover:text-blue-700"
            data-open-in-editor={section.sectionId}
          >
            Open →
          </button>
        )}

        {p.canWaive && !isWaived && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); p.onBeginWaive(section.code) }}
            disabled={p.isMutating}
            className="flex-none whitespace-nowrap text-[11px] font-semibold hover:text-amber-700 disabled:opacity-50"
            style={{ color: '#B45309' }}
            data-action="waive"
          >
            Waive
          </button>
        )}

        {p.canWaive && isWaived && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); p.onClearWaiver(section.code) }}
            disabled={p.isMutating}
            className="flex-none whitespace-nowrap text-[11px] font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
            data-action="clear-waiver"
          >
            Un-waive
          </button>
        )}
      </div>

      {isWaived && section.waiver && (
        <div className="mt-1 ml-6">
          <button
            type="button"
            onClick={() => setShowReason(v => !v)}
            className="text-[11px] font-semibold text-blue-600 hover:text-blue-700"
          >
            {showReason ? 'Hide waiver reason' : 'View waiver reason →'}
          </button>
          {showReason && (
            <div
              className="mt-1 rounded border px-2.5 py-2 text-[11px]"
              style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A', color: '#B45309' }}
            >
              <p className="font-semibold">{section.waiver.reason}</p>
              <p className="mt-0.5 text-[10px]">
                {section.waiver.waivedBy} · {new Date(section.waiver.waivedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · at {section.waiver.versionAtWaiver}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --- Waive form (inline modal-ish) ---

function WaiveForm({ code, onCancel, onConfirm, submitting, error }: {
  code: string
  onCancel: () => void
  onConfirm: (reason: string) => void
  submitting: boolean
  error: string | null
}) {
  const [reason, setReason] = useState('')
  return (
    <div
      className="mx-4 mb-2 flex flex-col gap-2 rounded-lg p-3"
      style={{ border: '1px solid #FDE68A', backgroundColor: '#FFFBEB' }}
      data-form="waive"
      data-section-code={code}
    >
      <p className="text-[12px] font-semibold" style={{ color: '#B45309' }}>
        Waive {code} — reason required (≥ 10 chars, Part 11 trail)
      </p>
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Explain why this section is being waived on this document…"
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
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(reason.trim())}
          disabled={submitting || reason.trim().length < 10}
          className="rounded px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: '#B45309' }}
          data-action="confirm-waive"
        >
          {submitting ? 'Waiving…' : 'Confirm waive'}
        </button>
      </div>
    </div>
  )
}

interface Props {
  documentId: string
}

export function ICHValidatorPanel({ documentId }: Props) {
  const qc = useQueryClient()
  const setActiveSection = useDocumentStore(s => s.setActiveSection)
  const setActivePanel   = useDocumentStore(s => s.setActivePanel)
  const currentUser      = useAuthStore(s => s.user)

  const [waivingCode, setWaivingCode] = useState<string | null>(null)
  const [waiveError,  setWaiveError]  = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['ich-e3', documentId],
    queryFn:  () => documentsApi.getICHE3(documentId),
    enabled:  !!documentId,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ich-e3', documentId] })

  const waiveMut = useMutation({
    mutationFn: (args: { code: string; reason: string }) =>
      documentsApi.waiveICHE3Section(documentId, args.code, args.reason),
    onSuccess: () => {
      setWaivingCode(null); setWaiveError(null); invalidate()
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const body = err.body as { message?: string } | null
        setWaiveError(body?.message ?? `Could not waive (HTTP ${err.status})`)
        return
      }
      setWaiveError('Could not waive the section. Please try again.')
    },
  })

  const clearMut = useMutation({
    mutationFn: (code: string) => documentsApi.unwaiveICHE3Section(documentId, code),
    onSuccess:  invalidate,
  })

  const sections          = data?.sections          ?? []
  const completeSections  = data?.completeSections  ?? 0
  const totalSections     = data?.totalSections     ?? sections.length
  const completionPercent = data?.completionPercent ?? 0

  // Only admins + reviewers can waive — matches the backend role gate.
  const canWaive = currentUser?.role === 'admin' || currentUser?.role === 'reviewer'

  const handleOpenInEditor = (sectionId: string) => {
    setActiveSection(sectionId)
    setActivePanel(null)
  }

  const handleExport = () => {
    // Build a plain-text report in-browser so admins can hand it to a
    // reviewer without a round-trip. A PDF variant via pdfkit can swap in
    // here later without touching the panel.
    const lines: string[] = [
      `ICH E3 Compliance Report — Document ${documentId}`,
      `Generated: ${new Date().toISOString()}`,
      `Completion: ${completeSections} / ${totalSections} (${completionPercent}%)`,
      '',
      ...sections.map(s => {
        const status = s.status.toUpperCase().replace('_', ' ')
        const waiver = s.waiver ? `  — waived by ${s.waiver.waivedBy} (${s.waiver.reason})` : ''
        return `${s.code.padEnd(7)} ${status.padEnd(13)} ${s.title}${waiver}`
      }),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ich-e3-${documentId}-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full flex-col" data-panel-body="ich-e3">

      {/* Completion strip */}
      <div className="flex-none border-b border-slate-200 px-4 py-3" style={{ backgroundColor: '#F8FAFC' }} data-ich-completion>
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-bold text-slate-900">{completeSections} of {totalSections} sections complete</p>
          <p className="text-xs font-bold" style={{ color: '#2563EB' }}>{completionPercent}%</p>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
          <div className="h-full transition-all" style={{ width: `${completionPercent}%`, backgroundColor: '#2563EB' }} />
        </div>
      </div>

      {/* Scroll region */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="px-4 py-6 text-[12px] text-slate-400">Loading ICH E3 report…</p>
        )}
        {isError && (
          <p className="px-4 py-6 text-[12px] text-red-700" role="alert">
            Could not load the ICH E3 report.
          </p>
        )}

        {!isLoading && !isError && sections.length > 0 && (
          <>
            <div className="px-4 pb-1.5 pt-3">
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
                ICH E3 mandatory sections
              </p>
            </div>

            {sections.map(section => (
              <ICHRow
                key={section.code}
                section={section}
                onOpen={handleOpenInEditor}
                canWaive={canWaive}
                onBeginWaive={(code) => { setWaivingCode(code); setWaiveError(null) }}
                onClearWaiver={(code) => clearMut.mutate(code)}
                isMutating={waiveMut.isPending || clearMut.isPending}
              />
            ))}
          </>
        )}

        {waivingCode && (
          <WaiveForm
            code={waivingCode}
            onCancel={() => { setWaivingCode(null); setWaiveError(null) }}
            onConfirm={(reason) => waiveMut.mutate({ code: waivingCode, reason })}
            submitting={waiveMut.isPending}
            error={waiveError}
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex-none border-t border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={handleExport}
          disabled={sections.length === 0}
          data-ich-export
          className="w-full rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:text-slate-400"
        >
          Export ICH E3 report
        </button>
      </div>
    </div>
  )
}
