import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { RegSubmissionType, GatewayTarget, RegulatorySubmission } from '@platform/types'
import { GATEWAY_PRIORITY } from '@platform/types'
import { regulatoryWritingApi } from '../../modules/regulatory-writing/api/regulatoryWriting'
import { ECTDStatusDot } from '../../components/ui'

// --- Static config ---

const SUBMISSION_TYPES: { id: RegSubmissionType; label: string }[] = [
  { id: 'ind',         label: 'IND' },
  { id: 'nda-maa',     label: 'NDA/MAA' },
  { id: 'psur-pbrer',  label: 'PSUR/PBRER' },
  { id: 'rmp-rems',    label: 'RMP/REMS' },
  { id: 'ha-response', label: 'HA Response' },
  { id: 'cer',         label: 'CER' },
  { id: 'orphan-drug', label: 'ODD' },
]

const HA_TARGETS: GatewayTarget[] = ['fda-esg', 'ema-cesp', 'mhra', 'cdsco']

// --- Helpers ---

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

interface CheckRowProps { label: string; passed: boolean }
function CheckRow({ label, passed }: CheckRowProps) {
  return (
    <div className="flex items-center gap-2" data-check-item={label} data-check-passed={passed}>
      <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ backgroundColor: passed ? '#15803D' : '#CBD5E1' }}>
        {passed ? '✓' : ''}
      </span>
      <span className="text-[13px]" style={{ color: passed ? '#0F172A' : '#64748B' }}>{label}</span>
    </div>
  )
}

interface Section { section: string; title: string; status: 'complete' | 'gap' | 'not-started'; completePct: number; missingItems: { item: string; required: boolean; expectedDate: string | null }[] }

function sectionStatusMeta(s: Section) {
  if (s.status === 'complete')   return { symbol: '✓', bg: '#F0FDF4', fg: '#15803D' }
  if (s.status === 'gap')        return { symbol: '⚠', bg: '#FFFBEB', fg: '#B45309' }
                                 return { symbol: '○', bg: '#F1F5F9', fg: '#64748B' }
}

export function SubmissionSetupStrategy() {
  const { projectId, submissionId } = useParams()
  const navigate = useNavigate()

  const [selectedType,    setSelectedType]    = useState<RegSubmissionType>('nda-maa')
  const [selectedHAs,     setSelectedHAs]     = useState<Set<GatewayTarget>>(new Set<GatewayTarget>(['fda-esg', 'ema-cesp']))
  const [ectdVersion,     setEctdVersion]     = useState<'3.2.2' | '4.0'>('3.2.2')
  const [taTag,           setTaTag]           = useState('Oncology')
  const [targetDate,      setTargetDate]      = useState('2027-01-15')
  const [toast,           setToast]           = useState<string | null>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const isNew = !submissionId || submissionId === 'new'
  const activeId = isNew ? 'sub-001' : submissionId

  const { data: submission } = useQuery({
    queryKey: ['reg-submission', activeId],
    queryFn:  () => regulatoryWritingApi.getSubmission(activeId!),
    enabled:  !!activeId,
  })
  const { data: cmc } = useQuery({
    queryKey: ['cmc-readiness', activeId],
    queryFn:  () => regulatoryWritingApi.getCMCReadiness(activeId!),
    enabled:  !!activeId,
  })
  const { data: nodes = [] } = useQuery({
    queryKey: ['reg-ectd-map', activeId],
    queryFn:  () => regulatoryWritingApi.getECTDMap(activeId!),
    enabled:  !!activeId,
  })

  useEffect(() => {
    if (submission) {
      setSelectedType(submission.submissionType)
      setSelectedHAs(new Set(submission.targetHAs))
      setEctdVersion(submission.ectdVersion)
      setTaTag(submission.taTag)
    }
  }, [submission])

  const currentSub: RegulatorySubmission | undefined = submission

  const cmcAcknowledged = !!cmc?.acknowledgedBy

  const checks = useMemo(() => ([
    { label: 'Module A source project linked',        passed: !!currentSub?.sourceModuleAProjectId },
    { label: 'External CMC/nonclinical data uploaded', passed: true },
    { label: 'Submission type selected',              passed: !!selectedType },
    { label: 'Target HA(s) selected',                 passed: selectedHAs.size > 0 },
    { label: 'TA tag set',                            passed: taTag.trim().length > 0 },
    { label: 'CMC Readiness Report acknowledged',      passed: cmcAcknowledged },
  ]), [currentSub, selectedType, selectedHAs, taTag, cmcAcknowledged])

  const allReady = checks.every(c => c.passed)

  const toggleHA = (id: GatewayTarget) => {
    if (!GATEWAY_PRIORITY[id].apiReady) {
      flash(`${GATEWAY_PRIORITY[id].label} — Priority ${GATEWAY_PRIORITY[id].priority} · API procurement required before production.`)
      return
    }
    setSelectedHAs(s => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const proceed = () => {
    if (!allReady) return
    navigate(`/projects/${projectId}/regulatory-writing/submissions/${activeId}/module2-editor`)
  }
  const openFullMap = () => navigate(`/projects/${projectId}/regulatory-writing/submissions/${activeId}/ectd-map`)

  // Compact preview — top-level modules only
  const topLevelPreview = useMemo(() => {
    const seen = new Set<string>()
    return nodes.filter(n => {
      const top = n.moduleSection.split('.')[0]
      if (seen.has(top)) return false
      seen.add(top)
      return true
    })
  }, [nodes])

  const compiledPct = useMemo(() => {
    if (nodes.length === 0) return 0
    return Math.round((nodes.filter(n => n.status === 'signed').length / nodes.length) * 100)
  }, [nodes])

  return (
    <div className="bg-slate-50" data-screen="submission-setup-strategy">
      <div className="mx-auto flex flex-col gap-5" style={{ maxWidth: 1360, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/regulatory-writing`)} className="hover:text-slate-900">Regulatory Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{currentSub?.title ?? 'New Submission'}</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Submission Setup &amp; Strategy</h1>
            <p className="font-mono text-xs" style={{ color: '#64748B' }}>Stage 1 of 6 · Source linking + strategy + CMC readiness</p>
          </div>
          <button
            type="button"
            onClick={proceed}
            disabled={!allReady}
            data-proceed-stage-2
            data-proceed-enabled={allReady}
            className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
            style={{ backgroundColor: allReady ? '#B0200D' : '#CBD5E1', cursor: allReady ? 'pointer' : 'not-allowed' }}
          >Proceed to Stage 2 →</button>
        </div>

        <div className="grid gap-5" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)' }}>
          {/* LEFT */}
          <div className="flex flex-col gap-5">

            {/* Source Documents */}
            <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="source-documents">
              <h2 className="mb-2 text-[14px] font-bold text-slate-900">Source Documents · Module A</h2>
              <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }} data-source-module-a>
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#16A34A' }} />
                {currentSub?.project ?? 'VELORA-301'} · Module A ✓
              </span>
              <div className="mt-3 flex flex-wrap gap-2" data-linked-docs>
                {['CSR v1.0 ✓', 'IB v3.0 ✓', 'SAP v1.1 ✓', 'TLF Package v1.0 ✓'].map(d => (
                  <span key={d} className="rounded-md px-2 py-1 text-[12px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }}>{d}</span>
                ))}
              </div>
              <p className="mt-3 font-mono text-[11px] font-medium" style={{ color: '#15803D' }} data-canonical-json-status>
                Indexing complete · {currentSub?.canonicalJsonDataPoints ?? 847} data points extracted · Logged to audit trail
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <div className="rounded-md bg-slate-50 p-2 text-[12px] text-slate-700">Module 3 CMC Data (3 files uploaded ✓)</div>
                <div className="rounded-md bg-slate-50 p-2 text-[12px] text-slate-700">Module 4 Nonclinical Reports (2 files uploaded ✓)</div>
              </div>
            </section>

            {/* Submission Strategy */}
            <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="submission-strategy">
              <h2 className="mb-2 text-[14px] font-bold text-slate-900">Submission strategy</h2>

              <p className="mb-1 text-[11px] font-mono uppercase text-slate-500">Submission type</p>
              <div className="mb-3 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }} data-type-grid>
                {SUBMISSION_TYPES.map(t => {
                  const active = selectedType === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedType(t.id)}
                      data-submission-type-card={t.id}
                      data-submission-type-active={active || undefined}
                      className="rounded-md px-3 py-2 text-left"
                      style={{
                        backgroundColor: active ? '#FFF5F5' : '#FFFFFF',
                        border:          active ? '2px solid #B0200D' : '1px solid #E2E8F0',
                      }}
                    >
                      <p className="text-[13px] font-semibold" style={{ color: active ? '#B0200D' : '#0F172A' }}>{t.label}</p>
                    </button>
                  )
                })}
              </div>

              <p className="mb-1 text-[11px] font-mono uppercase text-slate-500">Target HAs</p>
              <div className="mb-3 flex flex-wrap gap-2" data-ha-picker>
                {HA_TARGETS.map(id => {
                  const meta = GATEWAY_PRIORITY[id]
                  const active = selectedHAs.has(id)
                  const disabled = !meta.apiReady
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleHA(id)}
                      disabled={disabled}
                      data-ha-checkbox={id}
                      data-ha-active={active || undefined}
                      data-ha-disabled={disabled || undefined}
                      title={disabled ? `Priority ${meta.priority} — API procurement required before production` : ''}
                      className="rounded-md px-2.5 py-1 text-[12px] font-semibold"
                      style={{
                        backgroundColor: disabled ? '#F1F5F9' : active ? '#F0FDF4' : '#FFFFFF',
                        color:           disabled ? '#94A3B8' : active ? '#166534' : '#475569',
                        border:          `1px solid ${disabled ? '#E2E8F0' : active ? '#BBF7D0' : '#E2E8F0'}`,
                        cursor:          disabled ? 'not-allowed' : 'pointer',
                      }}
                    >{active ? '✓ ' : ''}{meta.label}{disabled ? ' 🔒' : ''}</button>
                  )
                })}
              </div>

              <div className="mb-3 grid gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-mono uppercase text-slate-500">eCTD version</span>
                  <select
                    value={ectdVersion}
                    onChange={(e) => setEctdVersion(e.target.value as '3.2.2' | '4.0')}
                    data-ectd-version
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[13px]"
                  >
                    <option value="3.2.2">v3.2.2 (default)</option>
                    <option value="4.0" disabled>v4.0 (Phase 2)</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-mono uppercase text-slate-500">TA tag</span>
                  <input
                    type="text"
                    value={taTag}
                    onChange={(e) => setTaTag(e.target.value)}
                    data-input-ta
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[13px]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-mono uppercase text-slate-500">Timeline</span>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    data-input-timeline
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-[13px]"
                  />
                </label>
              </div>
            </section>

            {/* Stage 1 Readiness */}
            <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="stage1-readiness">
              <h2 className="mb-2 text-[14px] font-bold text-slate-900">Stage 1 readiness</h2>
              <div className="flex flex-col gap-1.5" data-readiness-checklist>
                {checks.map(c => <CheckRow key={c.label} label={c.label} passed={c.passed} />)}
              </div>
            </section>
          </div>

          {/* RIGHT */}
          <div className="flex flex-col gap-5">
            {/* eCTD preview */}
            <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="ectd-preview">
              <header className="mb-3 flex items-center justify-between">
                <h2 className="text-[14px] font-bold text-slate-900">eCTD Granularity Map preview</h2>
                <button type="button" onClick={openFullMap} data-view-full-map className="text-[11px] font-semibold" style={{ color: '#B0200D' }}>View full map →</button>
              </header>
              <p className="mb-2 text-[12px] text-slate-500">{compiledPct}% complete</p>
              <div className="flex flex-col gap-1.5">
                {topLevelPreview.slice(0, 10).map(n => (
                  <div key={n.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-[12px]" data-ectd-preview-row={n.id}>
                    <span className="font-mono text-[11px] text-slate-500 w-14 flex-none">{n.moduleSection}</span>
                    <span className="flex-1 truncate text-slate-800">{n.sectionTitle}</span>
                    <ECTDStatusDot status={n.status} />
                    {n.isReadOnly && <span className="text-[10px]" style={{ color: '#005F8E' }}>🔒</span>}
                  </div>
                ))}
              </div>
            </section>

            {/* CMC Readiness */}
            <section className="rounded-lg border border-slate-200 bg-white p-5" data-panel="cmc-readiness">
              <h2 className="mb-3 text-[14px] font-bold text-slate-900">CMC Data Readiness</h2>
              {cmc && (
                <>
                  <div className="flex items-center gap-4">
                    <div className="relative flex h-20 w-20 flex-none items-center justify-center rounded-full" data-cmc-ring
                         style={{
                           background: `conic-gradient(#B0200D ${cmc.completenessPct}%, #F1F5F9 0)`,
                         }}>
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white">
                        <span className="text-[16px] font-bold" style={{ color: '#B0200D' }} data-cmc-pct>{cmc.completenessPct}%</span>
                      </div>
                    </div>
                    <div className="flex-1 flex flex-col gap-1">
                      {cmc.sections.map(sec => {
                        const m = sectionStatusMeta(sec as Section)
                        return (
                          <div key={sec.section} className="flex items-center justify-between text-[12px]" data-cmc-section={sec.section}>
                            <span className="font-mono text-slate-700">{sec.section} · {sec.title}</span>
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold"
                                  style={{ backgroundColor: m.bg, color: m.fg }}>{m.symbol}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Missing items — from 3.2.A */}
                  {cmc.sections.map(sec => (
                    sec.status === 'gap' && (
                      <p key={sec.section} className="mt-3 rounded-md px-3 py-2 text-[12px]" style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }} data-cmc-gap={sec.section}>
                        <strong>{sec.section}</strong> — Stability data — batches 3 and 4 — required before Stage 3 CMC finalisation
                      </p>
                    )
                  ))}

                  {cmc.acknowledgedBy ? (
                    <div className="mt-3 rounded-md px-3 py-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }} data-cmc-acknowledged>
                      Acknowledged · Dr James Hartley · {formatDate(cmc.acknowledgedAt)} · Risk note on file
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-cmc-acknowledge
                      className="mt-3 rounded-md px-3 py-1.5 text-[12px] font-semibold text-white"
                      style={{ backgroundColor: '#B0200D' }}
                    >Acknowledge CMC Readiness Report</button>
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
