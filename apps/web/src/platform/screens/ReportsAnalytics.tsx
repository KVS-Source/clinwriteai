import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ReportDefinition, ModuleHealthScore, Subscription } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

const DEMO_ADMIN_EMAIL = 'j.hartley@genbioca.com'

function formatUSD(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`
}
function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function ReportsAnalytics() {
  const currentUser = usePlatformStore(s => s.currentUser)

  const { data: reports = [] }  = useQuery<ReportDefinition[]>({  queryKey: ['reports'],          queryFn: () => platformApi.listReports() })
  const { data: scores = [] }   = useQuery<ModuleHealthScore[]>({ queryKey: ['health-scores'],   queryFn: () => platformApi.getHealthScores() })
  const { data: sub }           = useQuery<Subscription>({        queryKey: ['services-dashboard'], queryFn: () => platformApi.getServicesDashboard() })

  const [activeNav,   setActiveNav]   = useState<string>('dashboard')
  const [reportType,  setReportType]  = useState<string>('project-summary')
  const [format,      setFormat]      = useState<'pdf' | 'csv'>('pdf')
  const [dateFrom,    setDateFrom]    = useState<string>('2026-09-01')
  const [dateTo,      setDateTo]      = useState<string>('2026-09-09')
  const [generateResult, setGenerateResult] = useState<string | null>(null)

  const navItems = useMemo(
    () => [{ id: 'dashboard', label: 'Dashboard' }, ...reports.map(r => ({ id: r.type, label: r.label }))],
    [reports],
  )

  const dateSpanDays = useMemo(() => {
    if (!dateFrom || !dateTo) return 0
    return Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86_400_000)
  }, [dateFrom, dateTo])

  const isLargeDataset = dateSpanDays > 30
  const generateLabel  = isLargeDataset ? 'Queue report →' : 'Generate PDF'

  const heading = navItems.find(n => n.id === activeNav)?.label ?? 'Dashboard'

  const effectiveMultiple = sub
    ? (sub.marketValueSavings.total / sub.currentPeriod.estimatedSpend).toFixed(1) + '×'
    : '—'

  const handleGenerate = async () => {
    const res = await platformApi.generateReport(reportType, { format, dateFrom, dateTo }).catch(() => null)
    if (res) setGenerateResult(res.downloadUrl)
  }

  return (
    <div className="bg-slate-50" data-screen="reports-analytics">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Platform</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Reports</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span data-heading>{heading}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Reports &amp; Analytics</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>{currentUser.name} · Admin</p>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '240px 1fr' }}>

          {/* Left nav */}
          <aside className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2" data-report-nav data-nav-count={navItems.length}>
            {navItems.map(n => {
              const isActive = n.id === activeNav
              return (
                <button
                  key={n.id} type="button" onClick={() => setActiveNav(n.id)}
                  data-nav-item={n.id} data-active={isActive || undefined}
                  className="rounded-md px-3 py-2 text-left text-[13px] font-semibold"
                  style={{
                    backgroundColor: isActive ? PLATFORM_ACCENT.primary : 'transparent',
                    color:           isActive ? '#FFFFFF' : '#334155',
                  }}
                >{n.label}</button>
              )
            })}
          </aside>

          {/* Right content */}
          <section className="flex flex-col gap-5">

            <p className="font-mono text-[11px] text-slate-500" data-date-range-label>
              {formatDay(dateFrom)} → {formatDay(dateTo)} · GenBioCa Sciences
            </p>

            {/* Discipline health */}
            <div className="rounded-lg border border-slate-200 bg-white p-5" data-health-scores>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Discipline health</p>
              <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                {scores.map(s => (
                  <div key={s.module} className="rounded-md border border-slate-200 p-3" data-health-card={s.module}>
                    <div className="flex items-center justify-between">
                      <p className="text-[13px] font-semibold text-slate-900">{s.label}</p>
                      {s.overdueDocuments > 0 && <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }} data-overdue-flag>{s.overdueDocuments} overdue</span>}
                    </div>
                    <p className="mt-1 text-[24px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-health-score>{s.healthScore}</p>
                    <p className="font-mono text-[10px] text-slate-500">Health score</p>
                    <p className="mt-2 font-mono text-[11px] text-slate-500">
                      Completion {s.completionRate}% · Review pass {s.reviewPassRate}% · Avg {s.avgStageDays}d/stage
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Cost + productivity panel */}
            {sub && (
              <div className="rounded-lg border border-slate-200 bg-white p-5" data-cost-panel>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Cost and productivity</p>
                <p className="mt-1 text-[12px] text-slate-600">Measured against the rate card in force for the reporting period.</p>

                <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                  <div>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Tokens consumed</p>
                    <p className="mt-1 text-[20px] font-bold text-slate-900" data-tokens>{sub.currentPeriod.tokensConsumed.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Platform cost</p>
                    <p className="mt-1 text-[20px] font-bold text-slate-900" data-cost>{formatUSD(sub.currentPeriod.estimatedSpend)}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Market value saving</p>
                    <p className="mt-1 text-[20px] font-bold text-slate-900" data-saving>{formatUSD(sub.marketValueSavings.total)}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Effective multiple</p>
                    <p className="mt-1 text-[20px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-effective-multiple>{effectiveMultiple}</p>
                  </div>
                </div>

                <p className="mt-3 font-mono text-[11px] text-slate-500" data-rate-attribution>
                  Rate card {sub.marketValueSavings.rateCardVersion} · {sub.marketValueSavings.rateCardSetBy} · effective {formatDay(sub.marketValueSavings.rateCardEffectiveDate)}
                </p>
                <p className="mt-1 rounded-md p-2 text-[12px]" style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }} data-savings-footnote>
                  Market value savings are calculated using Rate Card {sub.marketValueSavings.rateCardVersion} ({sub.marketValueSavings.rateCardSetBy} · {formatDay(sub.marketValueSavings.rateCardEffectiveDate)}) against standard consultancy hourly rates for equivalent output.
                </p>
              </div>
            )}

            {/* Generate report panel */}
            <div className="rounded-lg border border-slate-200 bg-white p-5" data-generate-panel>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Generate report</p>

              <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Report type</span>
                  <select value={reportType} onChange={(e) => setReportType(e.currentTarget.value)}
                    data-report-type
                    className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
                    {reports.map(r => <option key={r.id} value={r.type}>{r.label}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">From</span>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.currentTarget.value)}
                    data-report-from
                    className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">To</span>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.currentTarget.value)}
                    data-report-to
                    className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
                </label>
              </div>

              <div className="mt-3 flex items-center gap-3" data-format-select>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Format</span>
                {(['pdf','csv'] as const).map(f => (
                  <label key={f} className="flex items-center gap-1 text-[12px] text-slate-700">
                    <input type="radio" name="fmt" checked={format === f} onChange={() => setFormat(f)}
                      data-format={f} style={{ accentColor: PLATFORM_ACCENT.primary }} />
                    {f.toUpperCase()}
                  </label>
                ))}
              </div>

              <button type="button" onClick={handleGenerate}
                data-generate-report
                data-large-dataset={isLargeDataset || undefined}
                className="mt-3 h-9 rounded-md px-4 text-[13px] font-semibold text-white"
                style={{ backgroundColor: PLATFORM_ACCENT.primary }}
              >{generateLabel}</button>

              {isLargeDataset && (
                <p className="mt-2 rounded-md p-2 text-[12px]" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }} data-email-delivery-note>
                  For datasets over 30 days the report is emailed to <strong>{DEMO_ADMIN_EMAIL}</strong> on completion, as a secure link that expires after 24 hours.
                </p>
              )}

              {generateResult && (
                <p className="mt-2 rounded-md p-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-generate-result>✓ Report ready · {generateResult}</p>
              )}
            </div>

          </section>
        </div>
      </div>
    </div>
  )
}
