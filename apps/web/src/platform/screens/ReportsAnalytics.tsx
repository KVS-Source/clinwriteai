import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ReportDefinition, ModuleHealthScore, Subscription } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { apiConfig } from '../../api/client'
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
  const { t } = useTranslation()
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
    () => [{ id: 'dashboard', label: t('page.reports_analytics.nav_dashboard') }, ...reports.map(r => ({ id: r.type, label: r.label }))],
    [reports, t],
  )

  const dateSpanDays = useMemo(() => {
    if (!dateFrom || !dateTo) return 0
    return Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86_400_000)
  }, [dateFrom, dateTo])

  const isLargeDataset = dateSpanDays > 30
  const generateLabel  = isLargeDataset
    ? t('page.reports_analytics.queue_report')
    : t('page.reports_analytics.generate_format', { format: format.toUpperCase() })

  const heading = navItems.find(n => n.id === activeNav)?.label ?? t('page.reports_analytics.nav_dashboard')

  const effectiveMultiple = sub
    ? (sub.marketValueSavings.total / sub.currentPeriod.estimatedSpend).toFixed(1) + '×'
    : '—'

  const [generateError, setGenerateError] = useState<string | null>(null)
  const handleGenerate = async () => {
    setGenerateError(null)
    setGenerateResult(null)
    try {
      const res = await platformApi.generateReport(reportType, { format, dateFrom, dateTo })
      // The API returns a path relative to its base URL.
      setGenerateResult(res.downloadUrl.startsWith('http') ? res.downloadUrl : `${apiConfig.baseUrl}${res.downloadUrl}`)
    } catch {
      setGenerateError(t('page.reports_analytics.generate_error'))
    }
  }

  return (
    <div className="bg-slate-50" data-screen="reports-analytics">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.reports_analytics.crumb_platform')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.reports_analytics.crumb_reports')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span data-heading>{heading}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.reports_analytics.title')}</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>{t('page.reports_analytics.user_byline', { name: currentUser.name })}</p>
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
              {t('page.reports_analytics.date_range_label', { from: formatDay(dateFrom), to: formatDay(dateTo) })}
            </p>

            {/* Discipline health */}
            <div className="rounded-lg border border-slate-200 bg-white p-5" data-health-scores>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.discipline_health')}</p>
              <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                {scores.map(s => (
                  <div key={s.module} className="rounded-md border border-slate-200 p-3" data-health-card={s.module}>
                    <div className="flex items-center justify-between">
                      <p className="text-[13px] font-semibold text-slate-900">{s.label}</p>
                      {s.overdueDocuments > 0 && <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }} data-overdue-flag>{t('page.reports_analytics.overdue_count', { count: s.overdueDocuments })}</span>}
                    </div>
                    <p className="mt-1 text-[24px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-health-score>{s.healthScore}</p>
                    <p className="font-mono text-[10px] text-slate-500">{t('page.reports_analytics.health_score_label')}</p>
                    <p className="mt-2 font-mono text-[11px] text-slate-500">
                      {t('page.reports_analytics.health_stats', { completion: s.completionRate, pass: s.reviewPassRate, days: s.avgStageDays })}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Cost + productivity panel */}
            {sub && (
              <div className="rounded-lg border border-slate-200 bg-white p-5" data-cost-panel>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.cost_productivity')}</p>
                <p className="mt-1 text-[12px] text-slate-600">{t('page.reports_analytics.cost_productivity_hint')}</p>

                <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                  <div>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.tokens_consumed')}</p>
                    <p className="mt-1 text-[20px] font-bold text-slate-900" data-tokens>{sub.currentPeriod.tokensConsumed.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.platform_cost')}</p>
                    <p className="mt-1 text-[20px] font-bold text-slate-900" data-cost>{formatUSD(sub.currentPeriod.estimatedSpend)}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.market_value_saving')}</p>
                    <p className="mt-1 text-[20px] font-bold text-slate-900" data-saving>{formatUSD(sub.marketValueSavings.total)}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.effective_multiple')}</p>
                    <p className="mt-1 text-[20px] font-bold" style={{ color: PLATFORM_ACCENT.primary }} data-effective-multiple>{effectiveMultiple}</p>
                  </div>
                </div>

                <p className="mt-3 font-mono text-[11px] text-slate-500" data-rate-attribution>
                  {t('page.reports_analytics.rate_attribution', {
                    version: sub.marketValueSavings.rateCardVersion,
                    setBy:   sub.marketValueSavings.rateCardSetBy,
                    date:    formatDay(sub.marketValueSavings.rateCardEffectiveDate),
                  })}
                </p>
                <p className="mt-1 rounded-md p-2 text-[12px]" style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }} data-savings-footnote>
                  {t('page.reports_analytics.savings_footnote', {
                    version: sub.marketValueSavings.rateCardVersion,
                    setBy:   sub.marketValueSavings.rateCardSetBy,
                    date:    formatDay(sub.marketValueSavings.rateCardEffectiveDate),
                  })}
                </p>
              </div>
            )}

            {/* Generate report panel */}
            <div className="rounded-lg border border-slate-200 bg-white p-5" data-generate-panel>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.generate_report')}</p>

              <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.report_type')}</span>
                  <select value={reportType} onChange={(e) => setReportType(e.currentTarget.value)}
                    data-report-type
                    className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
                    {reports.map(r => <option key={r.id} value={r.type}>{r.label}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.from_label')}</span>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.currentTarget.value)}
                    data-report-from
                    className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.to_label')}</span>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.currentTarget.value)}
                    data-report-to
                    className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
                </label>
              </div>

              <div className="mt-3 flex items-center gap-3" data-format-select>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.format_label')}</span>
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
                  {t('page.reports_analytics.email_delivery_prefix')} <strong>{DEMO_ADMIN_EMAIL}</strong>{t('page.reports_analytics.email_delivery_suffix')}
                </p>
              )}

              {generateResult && (
                <p className="mt-2 rounded-md p-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-generate-result>
                  {t('page.reports_analytics.result_prefix')}{' '}
                  <a href={generateResult} className="font-semibold underline" data-generate-download>{t('page.reports_analytics.download_format', { format: format.toUpperCase() })}</a>
                </p>
              )}
              {generateError && (
                <p className="mt-2 rounded-md bg-red-50 p-2 text-[12px] text-red-800" data-generate-error>{generateError}</p>
              )}
            </div>

          </section>
        </div>
      </div>
    </div>
  )
}
