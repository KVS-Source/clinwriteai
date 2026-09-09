import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { ECTDNode, ECTDValidationResult, RedactionRecord } from '@platform/types'
import { regulatoryWritingApi } from '../../modules/regulatory-writing/api/regulatoryWriting'
import { useECTDStore } from '../../modules/regulatory-writing/store'

interface LogEntry { at: string; text: string; done: boolean }

const PUBLISHING_LOG: LogEntry[] = [
  { at: '15 Oct 2026 16:22 UTC', text: '2.5-clinical-overview v0.4 → compiling',      done: false },
  { at: '15 Oct 2026 16:20 UTC', text: '2.7-clinical-summaries v0.3 → compiled ✓',    done: true },
  { at: '15 Oct 2026 16:18 UTC', text: '3.2.P v1.0 → compiled ✓',                     done: true },
  { at: '15 Oct 2026 14:03 UTC', text: '5.3.1 CSR import → compiled ✓ [Module A]',    done: true },
]

// Which nodes get the animated crimson pulse (visual proof of continuous publishing)
const PULSING_SECTIONS = new Set<string>(['2.5', '2.7'])
const STABILITY_GAP_NODE_ID = 'nd-033'

interface TreeRowProps {
  node:    ECTDNode
  pulsing: boolean
  amber:   boolean
}
function TreeRow({ node, pulsing, amber }: TreeRowProps) {
  const isSigned    = node.status === 'signed'
  const isAuthoring = node.status === 'in-authoring'
  const isSysGen    = node.isSystemGenerated
  const isNotStart  = node.status === 'not-started'

  let dot = '○'
  let dotColor = '#94A3B8'
  if (amber)           { dot = '⚠'; dotColor = '#B45309' }
  else if (isSysGen)   { dot = '◉'; dotColor = '#005F8E' }
  else if (isSigned)   { dot = '✓'; dotColor = '#15803D' }
  else if (isAuthoring){ dot = '●'; dotColor = '#B0200D' }
  else if (isNotStart) { dot = '○'; dotColor = '#94A3B8' }

  const fileName = `${node.moduleSection}-${node.sectionTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}.pdf`

  return (
    <div
      className="flex items-center gap-2 px-2 py-1 text-[12px]"
      data-package-node={node.id}
      data-package-pulsing={pulsing || undefined}
      data-package-amber={amber || undefined}
    >
      <span
        className={pulsing ? 'inline-block h-2 w-2 flex-none rounded-full animate-pulse' : 'inline-block h-2 w-2 flex-none rounded-full'}
        style={{ backgroundColor: dotColor }}
        aria-hidden
      />
      <span className="font-mono text-[10px] text-slate-500 w-14 flex-none">{node.moduleSection}</span>
      <span className="flex-1 truncate font-mono text-[11px] text-slate-700">{fileName}</span>
      {isSysGen && <span className="font-mono text-[10px]" style={{ color: '#005F8E' }}>[auto]</span>}
      {node.isReadOnly && <span title="Read-only · Module A" className="text-[10px]" style={{ color: '#005F8E' }}>🔒</span>}
      <span className="font-mono text-[11px]" style={{ color: dotColor }}>{dot}</span>
    </div>
  )
}

export function ECTDPublishingMonitor() {
  const { projectId, submissionId } = useParams()
  const navigate = useNavigate()

  const nodes    = useECTDStore(s => s.nodes)
  const setNodes = useECTDStore(s => s.setNodes)

  const [validation, setValidation] = useState<ECTDValidationResult | null>(null)
  const [isRunningValidation, setRunningValidation] = useState(false)
  const [redaction, setRedaction]   = useState<RedactionRecord | null>(null)
  const [toast, setToast]           = useState<string | null>(null)
  const [autoFixedMap, setAutoFixedMap] = useState<Record<string, boolean>>({})

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3400) }

  const { data: fetched = [] } = useQuery({
    queryKey: ['reg-ectd-map', submissionId],
    queryFn:  () => regulatoryWritingApi.getECTDMap(submissionId!),
    enabled:  !!submissionId,
  })
  const { data: fetchedVal } = useQuery({
    queryKey: ['ectd-validation', submissionId],
    queryFn:  () => regulatoryWritingApi.getECTDValidation(submissionId!),
    enabled:  !!submissionId,
  })
  const { data: fetchedRed } = useQuery({
    queryKey: ['redaction', submissionId],
    queryFn:  () => regulatoryWritingApi.getRedactionRecord(submissionId!),
    enabled:  !!submissionId,
  })

  useEffect(() => { setNodes(fetched as ECTDNode[]) }, [fetched, setNodes])
  useEffect(() => { if (fetchedVal) setValidation(fetchedVal as ECTDValidationResult) }, [fetchedVal])
  useEffect(() => { if (fetchedRed) setRedaction(fetchedRed as RedactionRecord) }, [fetchedRed])

  const compiled   = nodes.filter(n => n.status === 'signed').length
  const totalNodes = nodes.length
  const compiledPct = totalNodes === 0 ? 0 : Math.round((compiled / totalNodes) * 100)

  const majorErrors  = validation?.errors.filter(e => e.severity === 'major' && !autoFixedMap[e.id] && !e.fixed).length ?? 0
  const criticalErrors = validation?.errors.filter(e => e.severity === 'critical' && !autoFixedMap[e.id] && !e.fixed).length ?? 0
  const minorErrors  = validation?.errors.filter(e => e.severity === 'minor').length ?? 0

  const totalRedactions       = (redaction?.totalPPD ?? 0) + (redaction?.totalCCI ?? 0)
  const confirmedRedactions   = (redaction?.confirmedPPD ?? 0) + (redaction?.confirmedCCI ?? 0)
  const remainingRedactions   = totalRedactions - confirmedRedactions
  const allRedacted           = totalRedactions > 0 && remainingRedactions === 0

  const canProceedStage6 = criticalErrors === 0 && majorErrors === 0 && allRedacted

  const runValidationMutation = useMutation({
    mutationFn: () => {
      setRunningValidation(true)
      return regulatoryWritingApi.runECTDValidation(submissionId!)
    },
    onSuccess: (data) => {
      setValidation(data.result)
      setRunningValidation(false)
      flash('eCTD validation complete.')
    },
    onError: () => setRunningValidation(false),
  })

  const autoFix = (errorId: string) => {
    setAutoFixedMap(m => ({ ...m, [errorId]: true }))
    flash("File renamed to 'm2-3-quality-overall-summary.pdf' — major error resolved. Re-run validation to confirm.")
  }

  const openRedaction = () => navigate(`/projects/${projectId}/regulatory-writing/submissions/${submissionId}/redaction`)
  const proceedGateway = () => {
    if (!canProceedStage6) return
    navigate(`/projects/${projectId}/regulatory-writing/submissions/${submissionId}/gateway`)
  }

  const unconfirmedPPD = useMemo(() => {
    if (!redaction) return []
    const all = redaction.documents.flatMap(d => d.ppdItems.filter(i => !i.confirmed))
    return all.slice(0, 2)
  }, [redaction])

  // Package tree — show high-value nodes for the demo (Module 2 + Module 3 signed + one Module 5 read-only)
  const packageNodes = useMemo(() => {
    return nodes.filter(n => {
      const top = n.moduleSection.split('.')[0]
      if (top === '2') return true
      if (n.moduleSection.startsWith('3.2')) return true
      if (n.moduleSection === '5.3.1') return true
      return false
    })
  }, [nodes])

  return (
    <div className="bg-slate-50" data-screen="ectd-publishing-monitor">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1440, padding: '16px 24px 24px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/regulatory-writing`)} className="hover:text-slate-900">Regulatory Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">eCTD Publishing · Stage 5</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>eCTD Publishing · Stage 5 · Veloricept NDA</h1>
            <div className="flex items-center gap-3 text-[12px]" data-header-progress>
              <span className="text-slate-600">{compiled} of {totalNodes} sections compiled · <strong>{compiledPct}%</strong></span>
              <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full" style={{ width: `${compiledPct}%`, backgroundColor: '#B0200D' }} data-header-progress-bar />
              </div>
            </div>
          </div>
          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={() => runValidationMutation.mutate()}
              disabled={isRunningValidation}
              data-run-validation
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
              style={{ backgroundColor: isRunningValidation ? '#CBD5E1' : '#B0200D' }}
            >{isRunningValidation ? 'Running…' : 'Run eCTD validation ✦'}</button>
            <button
              type="button"
              onClick={proceedGateway}
              disabled={!canProceedStage6}
              data-proceed-stage-6
              data-proceed-enabled={canProceedStage6}
              className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
              style={{ backgroundColor: canProceedStage6 ? '#B0200D' : '#CBD5E1', cursor: canProceedStage6 ? 'pointer' : 'not-allowed' }}
            >Proceed to Stage 6 →</button>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '420px minmax(0,1fr)' }}>
          {/* LEFT — Package status + log */}
          <aside className="flex flex-col gap-3">
            <div className="rounded-lg border border-slate-200 bg-white p-3" data-package-status>
              <p className="font-mono text-[10px] uppercase text-slate-500" style={{ letterSpacing: '0.1em' }}>Continuous Publishing Monitor · Auto-compiling as sections lock</p>
              <p className="mt-1 font-mono text-[10px] text-slate-500">eCTD v3.2.2 · Validator: EXTEDO EXTEDOpulse · Gateway: FDA ESG (Priority 1) + EMA CESP (Priority 2)</p>
              <div className="mt-3 flex flex-col">
                {packageNodes.map(n => {
                  const topLevel = n.moduleSection.split('.')[0]
                  const pulsing  = PULSING_SECTIONS.has(topLevel + (n.moduleSection.length > 1 ? '.' + n.moduleSection.split('.')[1] : ''))
                    || PULSING_SECTIONS.has(n.moduleSection.slice(0, 3))
                  const amber    = n.id === STABILITY_GAP_NODE_ID || n.moduleSection === '3.2.A'
                  return <TreeRow key={n.id} node={n} pulsing={pulsing && n.status === 'in-authoring'} amber={amber} />
                })}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3" data-publishing-log>
              <p className="font-mono text-[10px] uppercase text-slate-500" style={{ letterSpacing: '0.1em' }}>Publishing log</p>
              <ul className="mt-2 flex flex-col gap-1 font-mono text-[11px] text-slate-500">
                {PUBLISHING_LOG.map((entry, i) => (
                  <li key={i} data-log-entry={i}>{entry.at}  {entry.text}</li>
                ))}
              </ul>
            </div>
          </aside>

          {/* RIGHT — Redaction + Validation */}
          <div className="flex flex-col gap-3">
            {/* Redaction summary */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-redaction-summary>
              <h3 className="text-[13px] font-bold text-slate-900">PPD/CCI Anonymisation</h3>
              <p className="text-[11px] text-slate-500">Required for public disclosure (EMA Policy 0070/0043)</p>
              <p className="mt-2 text-[13px] text-slate-800">
                AI detection complete · <strong>{redaction?.totalPPD ?? 0} PPD + {redaction?.totalCCI ?? 0} CCI</strong> instances marked ✓
              </p>
              <p className="mt-1 text-[13px]" data-redaction-progress>
                <strong>{confirmedRedactions} of {totalRedactions} confirmed</strong> · {remainingRedactions} remaining
              </p>

              <div className="mt-3 flex flex-col gap-1">
                {unconfirmedPPD.map(i => (
                  <div key={i.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1 text-[11px]" data-redaction-unconfirmed={i.id}>
                    <span className="font-mono text-slate-500">{i.id}</span>
                    <span className="flex-1 truncate text-slate-700">{i.location} · page {i.page}</span>
                    <span className="rounded px-1.5 text-[10px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}>Pending</span>
                  </div>
                ))}
              </div>

              <p className="mt-3 rounded-md px-3 py-2 text-[12px]" style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }} data-irreversible-warning>
                Redactions are irreversible after submission. Pre-redaction version retained under restricted access per DD-D-003.
              </p>

              <button
                type="button"
                onClick={openRedaction}
                data-open-redaction
                className="mt-3 text-[13px] font-semibold"
                style={{ color: '#B0200D' }}
              >Review all {remainingRedactions} remaining instances →</button>
            </section>

            {/* Validation */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-validation-panel>
              <h3 className="text-[13px] font-bold text-slate-900">eCTD Validation · EXTEDO EXTEDOpulse</h3>
              {validation && (
                <>
                  <div className="mt-2 grid gap-2 text-[12px] md:grid-cols-3" data-validation-counts>
                    <span className="rounded-md p-2" style={{ backgroundColor: criticalErrors === 0 ? '#F0FDF4' : '#EFF6FF', color: criticalErrors === 0 ? '#166534' : '#005F8E' }}>
                      <strong>Critical: {criticalErrors}</strong> {criticalErrors === 0 ? '✓' : '⚠'}
                    </span>
                    <span className="rounded-md p-2" style={{ backgroundColor: majorErrors === 0 ? '#F0FDF4' : '#FFFBEB', color: majorErrors === 0 ? '#166534' : '#B45309' }}>
                      <strong>Major: {majorErrors}</strong> {majorErrors === 0 ? '✓' : '⚠'}
                    </span>
                    <span className="rounded-md p-2 text-slate-600" style={{ backgroundColor: '#F1F5F9' }}>
                      <strong>Minor: {minorErrors}</strong> (advisory)
                    </span>
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    {validation.errors.filter(e => e.severity === 'major').map(e => (
                      <div key={e.id} className="rounded-md border p-3" style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }} data-validation-major-error={e.id}>
                        <p className="text-[12px] font-mono font-semibold" style={{ color: '#B45309' }}>{e.rule}</p>
                        <p className="mt-1 text-[13px] text-slate-800">{e.description}</p>
                        <p className="mt-1 text-[12px] text-slate-600">{e.detail}</p>
                        <p className="mt-1 text-[12px] text-slate-700"><strong>Fix:</strong> {e.fixInstructions}</p>
                        {!autoFixedMap[e.id] && e.autoFixAvailable && (
                          <button
                            type="button"
                            onClick={() => autoFix(e.id)}
                            data-auto-fix={e.id}
                            className="mt-2 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                            style={{ backgroundColor: '#B0200D' }}
                          >Fix automatically →</button>
                        )}
                        {autoFixedMap[e.id] && (
                          <span className="mt-2 inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>Auto-fixed ✓ · Re-run validation</span>
                        )}
                      </div>
                    ))}
                  </div>

                  <p className="mt-3 text-[12px] text-slate-500" data-minor-note>
                    {minorErrors} minor errors · advisory only · do not block submission.
                  </p>

                  {!canProceedStage6 && (
                    <p className="mt-2 rounded-md px-3 py-2 text-[12px]" style={{ backgroundColor: '#EFF6FF', color: '#005F8E', border: '1px solid #93C5FD' }} data-stage6-blocker>
                      {majorErrors > 0 && `${majorErrors} major validation error${majorErrors === 1 ? '' : 's'} must be resolved.`}
                      {majorErrors > 0 && !allRedacted && ' '}
                      {!allRedacted && `${remainingRedactions} redaction${remainingRedactions === 1 ? '' : 's'} still to confirm.`}
                    </p>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
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
