import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { RegulatorySubmission, RegSubmissionType, ECTDNode, RegulatoryAlert } from '@platform/types'
import { GATEWAY_PRIORITY } from '@platform/types'
import { regulatoryWritingApi } from '../../modules/regulatory-writing/api/regulatoryWriting'
import {
  useRegulatorySubmissionStore,
  useRegulatoryIntelligenceStore,
  useECTDStore,
} from '../../modules/regulatory-writing/store'
import gatewaySubmissionsFixture from '../../data/gatewaySubmissions.json'

// --- Static config ---

const TYPE_META: Record<RegSubmissionType, { label: string; bg: string; fg: string }> = {
  'ind':          { label: 'IND',         bg: '#FFF5F5', fg: '#B0200D' },
  'nda-maa':      { label: 'NDA/MAA',     bg: '#FFF5F5', fg: '#B0200D' },
  'psur-pbrer':   { label: 'PSUR/PBRER',  bg: '#FFE0E0', fg: '#B0200D' },
  'rmp-rems':     { label: 'RMP/REMS',    bg: '#FFE0E0', fg: '#B0200D' },
  'ha-response':  { label: 'HA Response', bg: '#FFF5F5', fg: '#B0200D' },
  'cer':          { label: 'CER',         bg: '#FFF5F5', fg: '#B0200D' },
  'orphan-drug':  { label: 'ODD',         bg: '#FFF5F5', fg: '#B0200D' },
}

const STAGE_COUNT = 6

// --- Helpers ---

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function isQ4_2026(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return d.getUTCFullYear() === 2026 && d.getUTCMonth() >= 9 && d.getUTCMonth() <= 11
}

function routeForStage(sub: RegulatorySubmission, projectId: string): string {
  const base = `/projects/${projectId}/regulatory-writing/submissions/${sub.id}`
  switch (sub.status) {
    case 'source-gathering':
    case 'module2-authoring':  return base                    // sD02
    case 'finalisation':       return `${base}/finalisation`  // sD05
    case 'super-review':       return `${base}/super-review`  // sD06
    case 'publishing':         return `${base}/publishing`    // sD07
    case 'submitted':
    case 'post-submission':    return `${base}/final`         // sD12
    default:                   return base
  }
}

// --- Subcomponents ---

interface StatChipProps {
  value:  number | string
  label:  string
  dot?:   string
}
function StatChip({ value, label, dot }: StatChipProps) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white"
      style={{ padding: '16px 20px', borderLeft: '3px solid #B0200D' }}
      data-stat-chip={label}
    >
      <div className="flex items-center gap-2">
        <p className="text-[28px] font-bold leading-none" style={{ color: '#B0200D' }}>{value}</p>
        {dot && <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: dot }} />}
      </div>
      <p className="font-mono text-[11px] font-medium uppercase tracking-widest text-slate-500">{label}</p>
    </div>
  )
}

interface StageDotsProps {
  stage:      number
  isComplete: boolean
}
function StageDots({ stage, isComplete }: StageDotsProps) {
  return (
    <div className="flex items-center gap-1" data-stage-dots data-stage={stage}>
      {Array.from({ length: STAGE_COUNT }, (_, i) => i + 1).map(n => {
        const filled = isComplete ? true : n <= stage
        const active = !isComplete && n === stage
        const bg =
          isComplete ? '#15803D'
          : active ? '#B0200D'
          : filled ? '#B0200D'
          : '#E2E8F0'
        return (
          <span
            key={n}
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: bg }}
            data-stage-dot={n}
            data-stage-dot-active={active || undefined}
          />
        )
      })}
    </div>
  )
}

interface SubmissionCardProps {
  submission: RegulatorySubmission
  onOpen:     () => void
}
function SubmissionCard({ submission: s, onOpen }: SubmissionCardProps) {
  const typeMeta = TYPE_META[s.submissionType]
  const isSubmitted = s.status === 'submitted' || s.status === 'post-submission'
  const gwRecord = (gatewaySubmissionsFixture as { submissionId: string; status: string; gatewayLabel: string; ack2At: string | null }[])
    .find(g => g.submissionId === s.id && (g.status === 'ack2' || g.status === 'ack3'))

  return (
    <button
      type="button"
      onClick={onOpen}
      data-submission-card={s.id}
      className="flex w-full items-start gap-4 rounded-lg border border-slate-200 bg-white p-5 text-left transition-shadow hover:border-slate-300"
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(15,23,42,0.08)' }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none' }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="font-mono font-semibold uppercase"
            style={{
              fontSize:        10,
              letterSpacing:   '0.08em',
              borderRadius:    4,
              padding:         '3px 7px',
              backgroundColor: typeMeta.bg,
              color:           typeMeta.fg,
            }}
            data-submission-type={s.submissionType}
          >{typeMeta.label}</span>
          <StageDots stage={s.stage} isComplete={isSubmitted} />
          <span className="font-mono text-[11px] text-slate-500">Stage {s.stage} of {STAGE_COUNT}</span>
        </div>
        <p className="text-[15px] font-bold text-slate-900">{s.title}</p>
        <p className="text-[13px] text-slate-600">{s.compound} · {s.indication}</p>
        <p className="font-mono text-[11px] text-slate-500">
          {s.project ?? s.projectId} · {s.taTag} · Updated {formatDate(s.updatedAt)}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {s.consistencyFlagged && s.consistencyContradictions ? (
            <span
              className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}
              data-consistency-chip
            >
              Cross-module check: {s.consistencyContradictions} contradiction{s.consistencyContradictions === 1 ? '' : 's'} flagged
            </span>
          ) : null}
          {s.status === 'super-review' && s.raciTotalCount ? (
            <span
              className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}
              data-super-review-chip
            >
              Super Review — {s.raciSignedCount ?? 0} of {s.raciTotalCount} roles signed
            </span>
          ) : null}
          {isSubmitted && gwRecord ? (
            <span
              className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: '#F0FDF4', color: '#166534' }}
              data-ack-badge
            >
              ACK2 ✓ — {gwRecord.gatewayLabel} · {formatDate(gwRecord.ack2At)}
            </span>
          ) : null}
          {s.sourceModuleAProjectId ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: '#EFF6FF', color: '#005F8E', border: '1px solid #93C5FD' }}
              data-source-chip
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#005F8E' }} />
              Source: {s.project ?? s.projectId} CSR v1.0 · Module A ✓
            </span>
          ) : null}
        </div>
      </div>
    </button>
  )
}

interface AlertCardProps {
  alert:  RegulatoryAlert
  onOpen: () => void
}
function AlertCard({ alert: a, onOpen }: AlertCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-alert-card={a.id}
      className="flex w-full flex-col items-start gap-1 rounded-md bg-white p-3 text-left transition-colors hover:bg-slate-50"
      style={{ borderLeft: '4px solid #D97706', border: '1px solid #E2E8F0', borderLeftColor: '#D97706' }}
    >
      <p className="text-[13px] font-semibold text-slate-900">{a.frameworkName}</p>
      <p className="text-[12px] text-slate-600" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {a.changeSummary}
      </p>
      <span className="text-[11px] font-semibold" style={{ color: '#B0200D' }}>View affected sections →</span>
      <p className="font-mono text-[10px] text-slate-500">{formatDate(a.alertedAt)}</p>
    </button>
  )
}

// --- Screen ---

export function RegulatoryWritingHome() {
  const { projectId } = useParams()
  const navigate      = useNavigate()

  const submissions      = useRegulatorySubmissionStore(s => s.submissions)
  const setSubmissions   = useRegulatorySubmissionStore(s => s.setSubmissions)
  const alerts           = useRegulatoryIntelligenceStore(s => s.alerts)
  const setAlerts        = useRegulatoryIntelligenceStore(s => s.setAlerts)
  const nodes            = useECTDStore(s => s.nodes)
  const setNodes         = useECTDStore(s => s.setNodes)

  const { data: fetchedSubs = [] } = useQuery({
    queryKey: ['reg-submissions', projectId],
    queryFn:  () => regulatoryWritingApi.listSubmissions(projectId!),
    enabled:  !!projectId,
  })
  const { data: fetchedAlerts = [] } = useQuery({
    queryKey: ['regulatory-alerts'],
    queryFn:  () => regulatoryWritingApi.listRegulatoryAlerts(),
  })
  const { data: fetchedNodes = [] } = useQuery({
    queryKey: ['reg-ectd-map', 'sub-001'],
    queryFn:  () => regulatoryWritingApi.getECTDMap('sub-001'),
  })

  useEffect(() => { setSubmissions(fetchedSubs as RegulatorySubmission[]) }, [fetchedSubs, setSubmissions])
  useEffect(() => { setAlerts(fetchedAlerts as RegulatoryAlert[]) }, [fetchedAlerts, setAlerts])
  useEffect(() => { setNodes(fetchedNodes as ECTDNode[]) }, [fetchedNodes, setNodes])

  const metrics = useMemo(() => {
    const active       = submissions.filter(s => s.status !== 'submitted').length
    const superReview  = submissions.filter(s => s.status === 'super-review').length
    const gwQuarter    = (gatewaySubmissionsFixture as { transmittedAt: string | null }[])
      .filter(g => isQ4_2026(g.transmittedAt)).length
    const unreadAlerts = alerts.filter(a => a.acknowledgedByIds.length === 0).length
    return { active, superReview, gwQuarter, unreadAlerts }
  }, [submissions, alerts])

  const ectdMetrics = useMemo(() => {
    const total    = nodes.length
    const compiled = nodes.filter(n => n.status === 'signed').length
    const pending  = total - compiled
    const pct      = total === 0 ? 0 : Math.round((compiled / total) * 100)
    return { total, compiled, pending, pct }
  }, [nodes])

  const openSubmission = (s: RegulatorySubmission) => navigate(routeForStage(s, projectId!))
  const openIntelligence = () => navigate(`/projects/${projectId}/regulatory-writing/intelligence`)
  const openEctdMap = () => navigate(`/projects/${projectId}/regulatory-writing/submissions/sub-001/ectd-map`)
  const openNewSubmission = () => navigate(`/projects/${projectId}/regulatory-writing/submissions/new`)

  return (
    <div className="bg-slate-50" data-screen="regulatory-writing-home">
      <div className="mx-auto flex flex-col gap-5" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900">All projects</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900">VELORA-301</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Regulatory Writing</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Regulatory Writing</h1>
            <p className="font-mono text-xs" style={{ color: '#64748B' }}>
              VELORA-301 · Oncology · CTD dossier authoring & submission · GATEWAY: {GATEWAY_PRIORITY['fda-esg'].label} + {GATEWAY_PRIORITY['ema-cesp'].label}
            </p>
          </div>
          <button
            type="button"
            onClick={openNewSubmission}
            data-new-submission
            className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
            style={{ backgroundColor: '#B0200D' }}
          >+ New Submission</button>
        </div>

        {/* Metrics strip */}
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
          data-metrics-strip
        >
          <StatChip value={metrics.active}       label="Active submissions" />
          <StatChip value={metrics.superReview}  label="Super Review pending" />
          <StatChip value={metrics.gwQuarter}    label="Gateway submissions · Q4 2026" />
          <StatChip value={metrics.unreadAlerts} label="Regulatory alerts" dot={metrics.unreadAlerts > 0 ? '#D97706' : undefined} />
        </div>

        {/* Two-column: submission list + right rail */}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
          <div className="flex flex-col gap-3" data-submission-list>
            {submissions.map(s => (
              <SubmissionCard key={s.id} submission={s} onOpen={() => openSubmission(s)} />
            ))}
            {submissions.length === 0 && (
              <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-500">
                No submissions yet for this project.
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {/* Regulatory Intelligence */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-ri-panel>
              <header className="mb-3 flex items-center justify-between">
                <h3 className="text-[13px] font-bold text-slate-900">Regulatory Intelligence</h3>
                <button type="button" onClick={openIntelligence} data-ri-view-all className="text-[11px] font-semibold" style={{ color: '#B0200D' }}>View all →</button>
              </header>
              <div className="flex flex-col gap-2">
                {alerts.map(a => <AlertCard key={a.id} alert={a} onOpen={openIntelligence} />)}
                {alerts.length === 0 && (
                  <p className="rounded-md bg-slate-50 p-3 text-[12px] text-slate-500">No regulatory alerts.</p>
                )}
              </div>
            </section>

            {/* eCTD Publishing Monitor mini */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-ectd-mini>
              <header className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-bold text-slate-900">eCTD Publishing Monitor</h3>
                <button type="button" onClick={openEctdMap} data-ectd-view-map className="text-[11px] font-semibold" style={{ color: '#B0200D' }}>View eCTD map →</button>
              </header>
              <p className="text-[13px] text-slate-800" data-ectd-counts>
                {ectdMetrics.compiled} of {ectdMetrics.total} sections compiled ✓ · {ectdMetrics.pending} pending
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full transition-all"
                  style={{ width: `${ectdMetrics.pct}%`, backgroundColor: '#B0200D' }}
                  data-ectd-progress-bar
                  data-ectd-pct={ectdMetrics.pct}
                />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
