import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { RegulatoryAlert } from '@platform/types'
import { regulatoryWritingApi } from '../../modules/regulatory-writing/api/regulatoryWriting'
import { useRegulatoryIntelligenceStore, unreadAlertCount } from '../../modules/regulatory-writing/store'

const CURRENT_USER_ID = 'user-jh'

const MODULE_LABELS: Record<string, string> = {
  'clinical-writing':   'Clinical Writing · A',
  'scientific-writing': 'Scientific Writing · B',
  'medical-writing':    'Medical Writing · C',
  'regulatory-writing': 'Regulatory Writing · D',
  'ideation-publishing': 'Ideation & Publishing · E',
}

interface Framework {
  name:        string
  issuer:      string
  lastUpdated: string
  status:      'current' | 'updated' | 'draft-revision'
}

const FRAMEWORK_TABLE: Framework[] = [
  { name: '21 CFR Part 11',    issuer: 'FDA', lastUpdated: 'Mar 2024',  status: 'current' },
  { name: '21 CFR Part 314',   issuer: 'FDA', lastUpdated: 'Sept 2026', status: 'updated' },
  { name: 'ICH M4E(R2)',       issuer: 'ICH', lastUpdated: 'Jun 2022',  status: 'current' },
  { name: 'ICH M2 v3.2.2',     issuer: 'ICH', lastUpdated: '2008',      status: 'current' },
  { name: 'ICH E2C(R2)',       issuer: 'ICH', lastUpdated: 'Nov 2012',  status: 'draft-revision' },
  { name: 'ICH E2F (DSUR)',    issuer: 'ICH', lastUpdated: 'Jul 2011',  status: 'current' },
  { name: 'ICH E2A',           issuer: 'ICH', lastUpdated: 'Oct 1994',  status: 'current' },
  { name: 'EU Reg 726/2004',   issuer: 'EMA', lastUpdated: '2019',      status: 'current' },
  { name: 'EMA GVP Module V',  issuer: 'EMA', lastUpdated: '2014',      status: 'current' },
  { name: 'GDPR (EU) 2016/679',issuer: 'EU',  lastUpdated: '2018',      status: 'current' },
]

function statusMeta(s: Framework['status']) {
  if (s === 'current')        return { text: '✓ Current',         bg: '#F0FDF4', fg: '#166534' }
  if (s === 'updated')        return { text: '⚠ Updated',         bg: '#FFFBEB', fg: '#B45309' }
                              return { text: '⚠ Draft revision', bg: '#FFFBEB', fg: '#B45309' }
}

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function RegulatoryIntelligence() {
  const { projectId } = useParams()
  const navigate = useNavigate()

  const alerts             = useRegulatoryIntelligenceStore(s => s.alerts)
  const setAlerts          = useRegulatoryIntelligenceStore(s => s.setAlerts)
  const acknowledgeInStore = useRegulatoryIntelligenceStore(s => s.acknowledgeAlert)

  const [activeAlertId, setActiveAlertId] = useState<string>('alert-001')
  const [toast, setToast] = useState<string | null>(null)
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const { data: fetched = [] } = useQuery({
    queryKey: ['regulatory-alerts'],
    queryFn:  () => regulatoryWritingApi.listRegulatoryAlerts(),
  })
  useEffect(() => { setAlerts(fetched as RegulatoryAlert[]) }, [fetched, setAlerts])

  const unread = unreadAlertCount(alerts, CURRENT_USER_ID)
  const activeAlert = alerts.find(a => a.id === activeAlertId)

  const ackMutation = useMutation({
    mutationFn: (alertId: string) => regulatoryWritingApi.acknowledgeRegulatoryAlert(alertId, { userId: CURRENT_USER_ID }),
    onSuccess: (_data, alertId) => {
      acknowledgeInStore(alertId, CURRENT_USER_ID)
      flash(`Alert ${alertId} acknowledged.`)
    },
  })

  const markAllRead = () => {
    alerts.forEach(a => {
      if (!a.acknowledgedByIds.includes(CURRENT_USER_ID)) ackMutation.mutate(a.id)
    })
  }

  const openTriggerSection = () => navigate(`/projects/${projectId ?? 'proj-velora-301'}/regulatory-writing/submissions/sub-001/module2-editor`)

  const affectedModulesText = useMemo(() => {
    return (a: RegulatoryAlert) => {
      const labels = a.affectedModules.map(m => MODULE_LABELS[m] ?? m)
      if (labels.length === 1) return `${labels[0]} only`
      return labels.join(' + ')
    }
  }, [])

  return (
    <div className="bg-slate-50" data-screen="regulatory-intelligence">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1400, padding: '20px 32px 32px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId ?? 'proj-velora-301'}/regulatory-writing`)} className="hover:text-slate-900">Regulatory Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Regulatory Intelligence</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Regulatory Intelligence · Live Monitoring</h1>
            <p className="font-mono text-xs" style={{ color: '#64748B' }}>DD-D-005: shared cross-module service · Module D primary owner</p>
          </div>
          <div className="flex flex-none items-center gap-2">
            {unread > 0 && (
              <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }} data-unread-badge>
                {unread} unread alert{unread === 1 ? '' : 's'}
              </span>
            )}
            <button
              type="button"
              onClick={markAllRead}
              data-mark-all-read
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700"
            >Mark all read</button>
            <button
              type="button"
              disabled
              data-configure-monitoring
              title="Admin only"
              className="h-9 rounded-md border px-3 text-[13px] font-semibold"
              style={{ backgroundColor: '#F1F5F9', color: '#94A3B8', borderColor: '#E2E8F0', cursor: 'not-allowed' }}
            >Configure monitoring →</button>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '420px minmax(0,1fr)' }}>
          {/* LEFT — Alerts + framework monitor */}
          <div className="flex flex-col gap-3">
            <section data-alert-feed>
              <p className="mb-2 font-mono text-[10px] uppercase text-slate-500" style={{ letterSpacing: '0.1em' }}>Active alerts</p>
              <div className="flex flex-col gap-2">
                {alerts.map(a => {
                  const ack = a.acknowledgedByIds.includes(CURRENT_USER_ID)
                  const active = activeAlertId === a.id
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setActiveAlertId(a.id)}
                      data-alert-card={a.id}
                      data-alert-active={active || undefined}
                      className="w-full rounded-md bg-white p-3 text-left"
                      style={{
                        borderLeft:  '3px solid #D97706',
                        border:      '1px solid #E2E8F0',
                        borderLeftColor: '#D97706',
                        opacity:     ack ? 0.7 : 1,
                      }}
                    >
                      <p className="text-[13px] font-semibold text-slate-900">{a.frameworkName}</p>
                      <p className="mt-1 text-[11px] text-slate-500">Effective: {a.effectiveDate}{a.isEffectiveDateEstimate ? ' (estimated)' : ''}</p>
                      <p className="mt-1 text-[12px] text-slate-700">{a.changeSummary.slice(0, 120)}{a.changeSummary.length > 120 ? '…' : ''}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }} data-affected-sections>
                          {a.affectedDossierSections.length} section{a.affectedDossierSections.length === 1 ? '' : 's'} · Veloricept NDA
                        </span>
                        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F5F3FF', color: '#5B21B6' }} data-cross-module-chip={a.id}>
                          Affects: {affectedModulesText(a)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="font-mono text-[10px] text-slate-500">Detected {formatDateShort(a.alertedAt)}</span>
                        {!ack && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); ackMutation.mutate(a.id) }}
                            data-acknowledge={a.id}
                            className="ml-auto rounded-md px-2 py-0.5 text-[11px] font-semibold text-white"
                            style={{ backgroundColor: '#B0200D' }}
                          >Acknowledge ✓</button>
                        )}
                        {ack && (
                          <span className="ml-auto rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#166534' }}>Acknowledged ✓</span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>

              <p className="mt-2 font-mono text-[10px] text-slate-500" data-monitoring-status>
                Monitoring 17 frameworks · Last scan: 08 Sept 2026 06:00 UTC · Next scan: 09 Sept 2026 06:00 UTC
              </p>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-3" data-framework-monitor>
              <p className="mb-2 font-mono text-[10px] uppercase text-slate-500" style={{ letterSpacing: '0.1em' }}>Framework monitor</p>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10px] font-mono uppercase text-slate-500" style={{ letterSpacing: '0.06em' }}>
                    <th className="pb-1">Framework</th>
                    <th className="pb-1">Issuer</th>
                    <th className="pb-1">Last updated</th>
                    <th className="pb-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {FRAMEWORK_TABLE.map(f => {
                    const m = statusMeta(f.status)
                    return (
                      <tr key={f.name} className="border-t border-slate-100" data-framework-row={f.name}>
                        <td className="py-1 text-slate-800">{f.name}</td>
                        <td className="py-1 text-slate-600">{f.issuer}</td>
                        <td className="py-1 font-mono text-[11px] text-slate-500">{f.lastUpdated}</td>
                        <td className="py-1">
                          <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: m.bg, color: m.fg }} data-framework-status={f.status}>{m.text}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] font-semibold" style={{ color: '#B0200D' }}>Show all 17 →</p>
            </section>
          </div>

          {/* RIGHT — Affected sections + triggers */}
          <div className="flex flex-col gap-3">
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-affected-panel>
              <h3 className="mb-2 text-[13px] font-bold text-slate-900">
                {activeAlert?.frameworkName ?? '—'} — Sections affected in Veloricept NDA
              </h3>
              <div className="flex flex-col gap-2">
                {(activeAlert?.affectedDossierSections ?? []).map((section, i) => (
                  <div key={i} className="rounded-md border p-3" style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }} data-affected-section={i}>
                    <p className="text-[13px] font-semibold text-slate-800">{section}</p>
                    <p className="mt-1 text-[11px] text-slate-500">Last reviewed: 15 Oct 2026 · Regulatory basis: {activeAlert?.frameworkName} <span style={{ color: '#B45309' }}>⚠</span></p>
                    <button
                      type="button"
                      onClick={() => flash(`${section} flagged for re-review.`)}
                      data-flag-review={i}
                      className="mt-2 text-[12px] font-semibold"
                      style={{ color: '#B0200D' }}
                    >Flag for re-review →</button>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4" data-triggers-panel>
              <h3 className="mb-2 text-[13px] font-bold text-slate-900">Cross-Functional Triggers · Active</h3>
              <div className="flex flex-col gap-2">
                <article className="rounded-md border border-slate-200 p-3" data-trigger="csr-update">
                  <p className="text-[13px] font-semibold text-slate-800">Module A CSR updated — VELORA-301 CSR v1.1 (interim OS data added)</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">Triggered: 10 Oct 2026</p>
                  <p className="mt-1 text-[12px] text-slate-700">Affected: Module 2.5 §2.5.4 · Module 2.7 §2.7.2.1 · 3 cross-references</p>
                  <p className="mt-1 text-[12px]" style={{ color: '#B45309' }}>⚠ Review sign-off required — Dr Sarah Chen</p>
                  <button
                    type="button"
                    onClick={openTriggerSection}
                    data-trigger-review
                    className="mt-2 text-[12px] font-semibold"
                    style={{ color: '#B0200D' }}
                  >Review affected sections →</button>
                </article>

                <article className="rounded-md border border-slate-200 p-3" data-trigger="new-publication">
                  <p className="text-[13px] font-semibold text-slate-800">Module B publication — new manuscript from VELORA-301 source project</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">Triggered: 08 Oct 2026</p>
                  <p className="mt-1 text-[12px]" style={{ color: '#166534' }}>✓ Acknowledged — Dr J. Hartley · 09 Oct</p>
                </article>

                <article className="rounded-md border p-3" style={{ borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }} data-trigger="safety-signal">
                  <p className="text-[13px] font-semibold text-slate-800">Safety signal flagged — potential hepatotoxicity signal. Label update task auto-created: SmPC §4.4 Special Warnings.</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">Triggered: 05 Oct 2026</p>
                  <p className="mt-1 text-[12px]" style={{ color: '#B0200D' }}>● In progress — Dr R. Morton</p>
                </article>
              </div>
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
