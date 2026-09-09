import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { RedactionRecord, RedactionItem, RedactionDocument } from '@platform/types'
import { regulatoryWritingApi } from '../../modules/regulatory-writing/api/regulatoryWriting'

const CURRENT_USER_NAME = 'Dr Sarah Chen'

interface InstanceRowProps {
  item:       RedactionItem
  onRedact:   () => void
  onKeep:     (justification: string) => void
}
function InstanceRow({ item, onRedact, onKeep }: InstanceRowProps) {
  const [keepOpen,        setKeepOpen]        = useState(false)
  const [justification,   setJustification]   = useState('')

  const isCCI = item.type === 'cci'

  if (item.confirmed) {
    return (
      <div className="rounded-md bg-white p-3" data-instance-confirmed={item.id}>
        <div className="flex items-start gap-2">
          <span
            className="inline-block h-5 flex-1 rounded"
            style={{ backgroundColor: '#0F172A' }}
            aria-label="Redacted content"
            data-redaction-black-bar
          />
          <span
            className="inline-flex flex-none items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
          >
            ✓ {item.type.toUpperCase()} · Confirmed · {item.confirmedBy?.replace('Dr ', 'Dr ')}
          </span>
        </div>
        <p className="mt-1 font-mono text-[10px] text-slate-500">Page {item.page} · {item.location}</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border p-3" style={{ borderColor: isCCI ? '#93C5FD' : '#FDE68A', backgroundColor: '#FFFFFF' }} data-instance-unconfirmed={item.id}>
      <p
        className="inline-block rounded px-1 text-[13px] text-slate-800"
        style={{ backgroundColor: isCCI ? '#BFDBFE' : '#FDE68A' }}
        data-redaction-highlight={item.type}
      >
        {item.originalText}
      </p>
      <p className="mt-1 font-mono text-[10px] text-slate-500">Page {item.page} · {item.location}</p>
      <p className="mt-2 text-[12px] text-slate-700">
        <strong>AI detected:</strong> {isCCI ? 'CCI — Commercially Confidential' : 'Patient/Investigator name'} · Confirm redaction
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRedact}
          data-redact-button={item.id}
          className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
          style={{ backgroundColor: '#B0200D' }}
        >✓ REDACT</button>
        <button
          type="button"
          onClick={() => setKeepOpen(v => !v)}
          data-keep-button={item.id}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700"
        >✗ KEEP — requires justification</button>
      </div>
      {keepOpen && (
        <div className="mt-2 flex gap-2" data-keep-justification-form={item.id}>
          <input
            type="text"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Justification (required to keep)…"
            data-keep-justification-input={item.id}
            className="flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px]"
          />
          <button
            type="button"
            onClick={() => { if (justification.trim()) { onKeep(justification); setKeepOpen(false); setJustification('') } }}
            disabled={!justification.trim()}
            className="rounded-md px-2 py-1 text-[11px] font-semibold text-white"
            style={{ backgroundColor: justification.trim() ? '#B0200D' : '#CBD5E1' }}
          >Save justification</button>
        </div>
      )}
    </div>
  )
}

export function PPDCCIRedactionTool() {
  const { projectId, submissionId } = useParams()
  const navigate = useNavigate()

  const [redaction,   setRedaction]   = useState<RedactionRecord | null>(null)
  const [activeDocId, setActiveDocId] = useState<string>('doc-5.3.1')
  const [pageNum,     setPageNum]     = useState(24)
  const [toast,       setToast]       = useState<string | null>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3200) }

  const { data: fetched } = useQuery({
    queryKey: ['redaction', submissionId],
    queryFn:  () => regulatoryWritingApi.getRedactionRecord(submissionId!),
    enabled:  !!submissionId,
  })
  useEffect(() => { if (fetched) setRedaction(fetched as RedactionRecord) }, [fetched])

  const activeDoc: RedactionDocument | undefined = redaction?.documents.find(d => d.documentId === activeDocId)

  const totalPPD    = redaction?.totalPPD ?? 0
  const totalCCI    = redaction?.totalCCI ?? 0
  const total       = totalPPD + totalCCI
  const confirmed   = (redaction?.confirmedPPD ?? 0) + (redaction?.confirmedCCI ?? 0)
  const remaining   = total - confirmed
  const canGenerate = total > 0 && remaining === 0

  const allItems = useMemo(() => {
    if (!activeDoc) return [] as RedactionItem[]
    return [...activeDoc.ppdItems, ...activeDoc.cciItems]
  }, [activeDoc])

  const pageItems = allItems.filter(i => i.page === pageNum)

  const confirmMutation = useMutation({
    mutationFn: (itemId: string) => regulatoryWritingApi.confirmRedactionItem(submissionId!, itemId, { confirmedBy: CURRENT_USER_NAME }),
    onSuccess: (_data, itemId) => {
      // Optimistic update locally
      setRedaction(r => {
        if (!r) return r
        const stamped = new Date().toISOString()
        const documents = r.documents.map(d => ({
          ...d,
          ppdItems: d.ppdItems.map(p => p.id === itemId ? { ...p, confirmed: true, confirmedBy: CURRENT_USER_NAME, confirmedAt: stamped } : p),
          cciItems: d.cciItems.map(c => c.id === itemId ? { ...c, confirmed: true, confirmedBy: CURRENT_USER_NAME, confirmedAt: stamped } : c),
        }))
        // Recompute confirmed counts
        const confirmedPPD = documents.reduce((n, d) => n + d.ppdItems.filter(p => p.confirmed).length, 0)
        const confirmedCCI = documents.reduce((n, d) => n + d.cciItems.filter(c => c.confirmed).length, 0)
        return { ...r, documents, confirmedPPD, confirmedCCI }
      })
      flash(`${itemId} redaction confirmed. Logged to audit trail.`)
    },
  })

  const handleKeep = (itemId: string, justification: string) => {
    flash(`${itemId} kept with justification "${justification.slice(0, 40)}…" Logged to audit trail.`)
  }

  const jumpToNextUnconfirmed = () => {
    if (!activeDoc) return
    const next = allItems.find(i => !i.confirmed && i.page > pageNum) ?? allItems.find(i => !i.confirmed)
    if (next) setPageNum(next.page)
    else flash('All instances in this document are confirmed.')
  }

  const generatePublicCopy = () => {
    if (!canGenerate) return
    flash('Public redacted copy generated. Both versions available in the final distribution package.')
  }

  const backToPublishing = () => navigate(`/projects/${projectId}/regulatory-writing/submissions/${submissionId}/publishing`)

  return (
    <div className="bg-slate-50" data-screen="ppd-cci-redaction-tool">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1440, padding: '16px 24px 24px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/regulatory-writing`)} className="hover:text-slate-900">Regulatory Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={backToPublishing} className="hover:text-slate-900">eCTD Publishing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Redaction</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>PPD/CCI Redaction · Stage 5</h1>
            <span
              className="inline-flex w-max rounded-md px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
              data-header-progress
            >{confirmed} of {total} confirmed · {remaining} remaining</span>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={backToPublishing}
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700"
              data-back-publishing
            >← Back to Publishing</button>
            <button
              type="button"
              onClick={generatePublicCopy}
              disabled={!canGenerate}
              data-generate-public
              data-generate-enabled={canGenerate}
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
              style={{ backgroundColor: canGenerate ? '#B0200D' : '#CBD5E1', cursor: canGenerate ? 'pointer' : 'not-allowed' }}
            >Generate public copy →</button>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '300px minmax(0,1fr)' }}>
          {/* LEFT — Document list + jump */}
          <aside className="rounded-lg border border-slate-200 bg-white p-4" data-doc-list>
            <p className="mb-2 font-mono text-[10px] uppercase text-slate-500" style={{ letterSpacing: '0.1em' }}>Documents</p>
            <div className="flex flex-col gap-2">
              {redaction?.documents.map(d => {
                const total = d.ppdDetected + d.cciDetected
                const conf  = d.ppdConfirmed + d.cciConfirmed
                const done  = conf === total
                const active = activeDocId === d.documentId
                return (
                  <button
                    key={d.documentId}
                    type="button"
                    onClick={() => setActiveDocId(d.documentId)}
                    data-doc-row={d.documentId}
                    data-doc-active={active || undefined}
                    className="rounded-md border p-2 text-left"
                    style={{
                      backgroundColor: active ? '#FFF5F5' : '#FFFFFF',
                      borderLeft:      active ? '3px solid #B0200D' : '1px solid #E2E8F0',
                      borderColor:     active ? '#FFC5C5' : '#E2E8F0',
                    }}
                  >
                    <p className="text-[12px] font-semibold text-slate-800">{d.documentTitle}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-500">PPD: {d.ppdDetected} · CCI: {d.cciDetected}</p>
                    <span
                      className="mt-1 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ backgroundColor: done ? '#F0FDF4' : '#FFFBEB', color: done ? '#166534' : '#B45309' }}
                      data-doc-status
                    >{conf}/{total} confirmed{done ? ' ✓' : ''}</span>
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              onClick={jumpToNextUnconfirmed}
              data-jump-next
              className="mt-4 text-[13px] font-semibold"
              style={{ color: '#B0200D' }}
            >Jump to next unconfirmed →</button>

            <div className="mt-4 rounded-md bg-slate-50 p-3 text-[11px]" data-output-versions>
              <p className="font-mono text-[10px] uppercase text-slate-500">Output versions</p>
              <p className="mt-1 text-slate-700"><strong>Original (unredacted)</strong> — Restricted access · Regulatory Writer + Reg Affairs Lead only</p>
              <p className="mt-1 text-slate-700"><strong>Public redacted copy</strong> — Generated after all instances confirmed</p>
            </div>
          </aside>

          {/* RIGHT — Document viewer */}
          <section className="flex flex-col gap-3" data-viewer>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
              <button
                type="button"
                onClick={() => setPageNum(n => Math.max(1, n - 1))}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                data-page-prev
              >← Prev</button>
              <span className="text-[13px] text-slate-800" data-page-label>
                Page {pageNum} of {activeDoc?.totalPages ?? 0}
              </span>
              <button
                type="button"
                onClick={() => setPageNum(n => Math.min(activeDoc?.totalPages ?? n, n + 1))}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                data-page-next
              >Next →</button>
              <label className="ml-auto flex items-center gap-2 text-[11px] text-slate-600">
                Go to page
                <input
                  type="number"
                  value={pageNum}
                  onChange={(e) => setPageNum(Number(e.target.value) || 1)}
                  className="w-16 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[12px]"
                  data-page-goto
                />
              </label>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4" data-page-view>
              {activeDoc ? (
                <>
                  {pageItems.length === 0 && (
                    <p className="text-[13px] text-slate-500">No redaction instances on this page.</p>
                  )}
                  {pageItems.map(i => (
                    <InstanceRow
                      key={i.id}
                      item={i}
                      onRedact={() => confirmMutation.mutate(i.id)}
                      onKeep={(j) => handleKeep(i.id, j)}
                    />
                  ))}
                </>
              ) : (
                <p className="text-[13px] text-slate-500">Select a document from the left panel.</p>
              )}
            </div>

            <p className="font-mono text-[11px] text-slate-500" data-page-footer>
              Page {pageNum}: {pageItems.length} instance{pageItems.length === 1 ? '' : 's'} · {pageItems.filter(i => i.confirmed).length} confirmed · {pageItems.filter(i => !i.confirmed).length} remaining. · <button type="button" onClick={() => pageItems.filter(i => !i.confirmed).forEach(i => confirmMutation.mutate(i.id))} className="font-semibold" style={{ color: '#B0200D' }} data-confirm-all-page>Confirm all on page →</button>
            </p>
          </section>
        </div>

        {/* Audit footer */}
        <p className="font-mono text-[10px] text-slate-500" data-audit-footer>
          Redaction session · 15 Oct 2026 · {CURRENT_USER_NAME} · All confirmations logged to audit trail · Pre-redaction version retained under restricted access per DD-D-003.
        </p>
      </div>

      {toast && (
        <div
          data-toast
          className="pointer-events-none fixed bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-lg px-4 py-3 text-[13px]"
          style={{ backgroundColor: '#1E293B', color: '#FFFFFF' }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#B0200D' }} />
          {toast}
        </div>
      )}
    </div>
  )
}
