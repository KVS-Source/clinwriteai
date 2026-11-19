import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { ReportDefinition, ModuleHealthScore } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { api } from '../../api/client'
import { usePlatformStore } from '../store'
import { useTopNavSection } from '../../components/layout/topNavSection'

function formatUSD(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`
}
function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// yyyy-mm-dd in the user's own calendar, as <input type="date"> expects.
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ReportsAnalytics() {
  const { t } = useTranslation()
  const currentUser = usePlatformStore(s => s.currentUser)

  const { data: reports = [] }  = useQuery<ReportDefinition[]>({  queryKey: ['reports'],          queryFn: () => platformApi.listReports() })
  const { data: scores = [] }   = useQuery<ModuleHealthScore[]>({ queryKey: ['health-scores'],   queryFn: () => platformApi.getHealthScores() })
  // AI use on the PM's projects this billing period (not the tenant's whole subscription).
  const { data: cost }          = useQuery({ queryKey: ['reports', 'cost-summary'], queryFn: () => platformApi.getReportCostSummary() })

  const [activeNav,   setActiveNav]   = useState<string>('dashboard')
  const [reportType,  setReportType]  = useState<string>('project-summary')
  const [format,      setFormat]      = useState<'pdf' | 'csv'>('pdf')
  // Default range: the current month to date (CW-073: was pinned to 01–09 Sep 2026).
  const [dateFrom,    setDateFrom]    = useState<string>(() => localDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [dateTo,      setDateTo]      = useState<string>(() => localDay(new Date()))
  const [generateResult, setGenerateResult] = useState<string | null>(null)

  const navItems = useMemo(
    () => [{ id: 'dashboard', label: t('page.reports_analytics.nav_dashboard') }, ...reports.map(r => ({ id: r.type, label: r.label }))],
    [reports, t],
  )
  // The left menu and the Report type dropdown pick the same thing: a report chosen in one shows in the other,
  // and its name heads the page. A download made earlier is cleared, so the link always matches the report shown.
  // Dashboard keeps the last report in the dropdown.
  const activeReport = reports.find(r => r.type === activeNav) ?? null
  const pickNav = (id: string) => {
    setActiveNav(id)
    if (id !== 'dashboard') setReportType(id)
    setGenerateResult(null)
  }

  // The top bar reads "Reports / <this report>".
  useTopNavSection('/reports', navItems.find(n => n.id === activeNav)?.label ?? t('page.reports_analytics.nav_dashboard'))

  // Every report downloads straight away. (Nothing queues or emails a large report, so the page doesn't say it does.)
  const generateLabel = t('page.reports_analytics.generate_format', { format: format.toUpperCase() })

  const [generateError, setGenerateError] = useState<string | null>(null)
  const handleGenerate = async () => {
    setGenerateError(null)
    setGenerateResult(null)
    try {
      const res = await platformApi.generateReport(reportType, { format, dateFrom, dateTo })
      // A path relative to the API base. It's fetched through the API client (not a plain link) so the
      // request carries the session, persona and X-Active-Role headers — a user who is both Tenant Admin
      // and PM would otherwise be answered as Tenant Admin and refused.
      setGenerateResult(res.downloadUrl)
    } catch {
      setGenerateError(t('page.reports_analytics.generate_error'))
    }
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (!generateResult) return
    setGenerateError(null)
    try {
      const { blob, filename } = await api.download(generateResult)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename ?? `${reportType}.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setGenerateError(t('page.reports_analytics.generate_error'))
    }
  }

  return (
    <div className="bg-slate-50" data-screen="reports-analytics">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            {/* The heading names the report picked on the left (sPM16 design: heading = active nav item). */}
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }} data-report-heading>{activeReport?.label ?? t('page.reports_analytics.title')}</h1>
            {activeReport && <p className="mt-1 text-[13px] text-slate-600" data-report-description>{activeReport.description}</p>}
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
                  key={n.id} type="button" onClick={() => pickNav(n.id)}
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
              {/* The real organisation name when the user belongs to one (not a fixed client name). */}
              {formatDay(dateFrom)} → {formatDay(dateTo)}{cost?.tenantName ? ` · ${cost.tenantName}` : ''}
            </p>

            {/* A report picked on the left: its own figures and rows (sPM16 report types). */}
            {activeReport && (
              <ReportView type={activeReport.type} dateFrom={dateFrom} dateTo={dateTo} />
            )}

            {/* Dashboard (PRD sPM16 "Dashboard landing"): discipline health + cost and productivity. */}
            {!activeReport && (<>
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
                      {/* Only what is measured: review pass rate and stage time aren't recorded, so they aren't shown as 0. */}
                      {t('page.reports_analytics.health_stats_measured', { completion: s.completionRate, active: s.activeDocuments, overdue: s.overdueDocuments })}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Cost + productivity panel */}
            {cost && (
              <div className="rounded-lg border border-slate-200 bg-white p-5" data-cost-panel>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.cost_productivity')}</p>
                <p className="mt-1 text-[12px] text-slate-600" data-cost-hint>{t('page.reports_analytics.cost_from_call_log', { from: formatDay(cost.periodStart) })}</p>

                <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                  <div>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.tokens_consumed')}</p>
                    <p className="mt-1 text-[20px] font-bold text-slate-900" data-tokens>{cost.tokensConsumed.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.platform_cost')}</p>
                    <p className="mt-1 text-[20px] font-bold text-slate-900" data-cost>{formatUSD(cost.estimatedSpend)}</p>
                  </div>
                </div>
              </div>
            )}
            </>)}

            {/* Generate report panel */}
            <div className="rounded-lg border border-slate-200 bg-white p-5" data-generate-panel>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.generate_report')}</p>

              <div className="mt-3 grid gap-3" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.reports_analytics.report_type')}</span>
                  <select value={reportType} onChange={(e) => pickNav(e.currentTarget.value)}
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
                className="mt-3 h-9 rounded-md px-4 text-[13px] font-semibold text-white"
                style={{ backgroundColor: PLATFORM_ACCENT.primary }}
              >{generateLabel}</button>

              {generateResult && (
                <p className="mt-2 rounded-md p-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-generate-result>
                  {t('page.reports_analytics.result_prefix')}{' '}
                  <a href="#" onClick={handleDownload} className="font-semibold underline" data-generate-download>{t('page.reports_analytics.download_format', { format: format.toUpperCase() })}</a>
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

// A cell from the report API: ISO times as a date + time, status codes in words.
function formatCell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    // Shift UTC to India Standard Time (UTC+05:30, no DST), then read the UTC fields.
    const ist = new Date(new Date(v).getTime() + (5 * 60 + 30) * 60 * 1000).toISOString()
    return `${formatDay(ist)} ${ist.slice(11, 16)} IST`
  }
  if (typeof v === 'number') return v.toLocaleString('en-US')
  return String(v).replace(/_/g, ' ')
}

/** One report on screen: its headline figures and the rows the PDF / CSV download carries. */
function ReportView({ type, dateFrom, dateTo }: { type: string; dateFrom: string; dateTo: string }) {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['reports', 'preview', type, dateFrom, dateTo],
    queryFn:  () => platformApi.getReportPreview(type, { dateFrom, dateTo }),
  })
  return (
    <div className="flex flex-col gap-4" data-report-view={type}>
      {type === 'project-summary' && (
        <p className="text-[12px] text-slate-500" data-report-as-of>{t('page.reports_analytics.report_as_of_today')}</p>
      )}
      {isLoading && <p className="text-[13px] text-slate-500">{t('page.reports_analytics.report_loading')}</p>}
      {isError && <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800">{t('page.reports_analytics.report_error')}</p>}
      {data && (<>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }} data-report-summary>
          {data.summary.map(s => (
            <div key={s.label} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{s.label}</p>
              <p className="mt-1 text-[20px] font-bold text-slate-900" style={{ overflowWrap: 'anywhere' }}>{typeof s.value === 'number' ? s.value.toLocaleString('en-US') : s.value}</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white" data-report-table>
          {data.rows.length === 0 ? (
            <p className="p-5 text-[13px] text-slate-500" data-report-empty>{t('page.reports_analytics.report_empty')}</p>
          ) : (
            <table className="w-full text-left text-[12px]">
              <thead className="bg-slate-50">
                <tr>{data.header.map(h => <th key={h} className="whitespace-nowrap px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{h}</th>)}</tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100" data-report-row>
                    {r.map((c, j) => <td key={j} className="px-3 py-2 text-slate-700">{formatCell(c)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {data.totalRows > data.rows.length && (
          <p className="text-[12px] text-slate-500">{t('page.reports_analytics.report_rows_shown', { shown: data.rows.length, total: data.totalRows })}</p>
        )}
      </>)}
    </div>
  )
}
