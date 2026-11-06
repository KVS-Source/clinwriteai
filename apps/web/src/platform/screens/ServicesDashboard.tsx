import { formatNumber } from '../../utils/formatNumber'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Subscription } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi, type RateCardVersionSummary } from '../api/platformApi'
import { describeApiError } from '../../api'
import { usePlatformStore } from '../store'

function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}
function formatUSD(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`
}

function StatusChip({ status }: { status: 'healthy' | 'monitor' | 'over' }) {
  const { t } = useTranslation()
  const meta = status === 'healthy'  ? { bg: '#F0FDF4', fg: '#166534', label: t('page.services_dashboard.chip_healthy') }
             : status === 'monitor'  ? { bg: '#FFFBEB', fg: '#B45309', label: t('page.services_dashboard.chip_monitor') }
             :                         { bg: '#FEF2F2', fg: '#B0200D', label: t('page.services_dashboard.chip_over') }
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: meta.bg, color: meta.fg }}
      data-status-chip={status}
    >{meta.label}</span>
  )
}

// Midnight UTC today — renewal dates are calendar days, so whole-day maths.
function startOfTodayUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

// Tokens still needed to reach renewal at the current daily consumption rate,
// beyond what is left — the "deficit" sPM11 asks Top up to pre-fill. Zero when
// the remaining balance is projected to last until renewal.
function projectedShortfall(period: Subscription['currentPeriod'], today: Date, renewalDays: number): number {
  const periodStart = new Date(`${period.month}-01T00:00:00Z`)
  const daysElapsed = Math.max(1, daysBetween(periodStart, today) + 1)
  const tokensPerDay = period.tokensConsumed / daysElapsed
  const needed = tokensPerDay * Math.max(0, renewalDays)
  return Math.max(0, Math.round(needed - period.tokensRemaining))
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function buildServicesCsv(sub: Subscription, today: Date): string {
  // CSV content is machine data, not UI chrome — keep headers in English for
  // interop with downstream tools. Only the alert "Note" line is prose.
  const p = sub.currentPeriod
  const rows: (string | number)[][] = [
    ['ClinWrite.AI services consumption'],
    ['Generated (UTC)', new Date().toISOString()],
    ['Period', p.month],
    ['Plan', sub.planName],
    ['Currency', sub.currency],
    ['Renewal date', sub.renewalDate],
    ['Days to renewal', daysBetween(today, new Date(sub.renewalDate))],
    ['Contracted tokens per month', sub.contractedTokensPerMonth],
    ['Contracted amount per month', sub.monthlyFee],
    ['Tokens consumed', p.tokensConsumed],
    ['Tokens remaining', p.tokensRemaining],
    ['Estimated spend', p.estimatedSpend],
  ]
  // The API currently serves placeholder figures (billing pipeline deferred);
  // say so in the file rather than let it pass as real consumption data.
  if ((sub as Subscription & { stub?: boolean }).stub) {
    rows.push(['Note', 'Placeholder figures - billing pipeline not yet connected'])
  }
  rows.push([])
  rows.push(['Discipline', 'Tokens consumed', `Cost (${sub.currency})`, '% of total', 'Burn rate', 'Status'])
  for (const r of sub.moduleBreakdown) {
    rows.push([r.label, r.tokensConsumed, r.cost, r.pctOfTotal, r.burnRate, r.status])
  }
  rows.push(['Total', p.tokensConsumed, p.estimatedSpend, 100, '', ''])
  return rows.map(r => r.map(csvCell).join(',')).join('\n')
}

function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// "November 2026" for a 'YYYY-MM' billing period, in the UI language (CW-073: the title and
// stat captions used to say "September" whatever the period was).
function billingPeriodName(month: string | undefined, lang: string): string {
  const d = month && /^\d{4}-\d{2}$/.test(month) ? new Date(`${month}-01T00:00:00Z`) : new Date()
  return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
}

export function ServicesDashboard() {
  const { t, i18n } = useTranslation()
  const currentUser = usePlatformStore(s => s.currentUser)
  const navigate = useNavigate()
  const today = useMemo(() => startOfTodayUTC(), [])

  const { data: sub, error, isError, refetch, isFetching } = useQuery<Subscription>({
    queryKey: ['services-dashboard'],
    queryFn:  () => platformApi.getServicesDashboard(),
  })
  const { data: rateCards = [] } = useQuery<RateCardVersionSummary[]>({
    queryKey: ['rate-card-versions'],
    queryFn:  () => platformApi.listRateCardVersions(),
  })

  // Six-panel usage analytics driven by the AI gateway's /ai/usage-analytics
  // endpoint. 30-day default window. Rendered-but-empty state when the
  // tenant has had no AI activity in-window.
  const { data: analytics } = useQuery({
    queryKey: ['ai-usage-analytics', 30],
    queryFn:  () => platformApi.getUsageAnalytics(30),
    staleTime: 60_000,
  })

  const [exportResult, setExportResult] = useState<string | null>(null)

  const activeRateCard = useMemo(() => rateCards.find(r => r.isActive), [rateCards])
  // The live API does not store a validity end date yet, so only cards that
  // carry one (mock data) can be detected as expired.
  const rateCardExpired = activeRateCard?.validUntil ? new Date(activeRateCard.validUntil) < today : false

  if (isError) {
    return (
      <div className="p-8" data-screen="services-dashboard">
        <div className="mx-auto max-w-xl rounded-md border p-4 text-[13px]" style={{ backgroundColor: '#FEF2F2', borderColor: '#FCA5A5', color: '#7F1D1D' }} data-load-error>
          <p className="font-semibold">{t('page.services_dashboard.load_error_title')}</p>
          <p className="mt-1">{describeApiError(error).message}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >{isFetching ? t('page.services_dashboard.retrying') : t('page.services_dashboard.retry')}</button>
        </div>
      </div>
    )
  }
  if (!sub) return <div className="p-8 text-center text-sm text-slate-500" data-screen="services-dashboard">{t('status.loading')}</div>

  const period = sub.currentPeriod
  const periodName = billingPeriodName(period.month, i18n.language)
  const remainingPct = Math.round((period.tokensRemaining / sub.contractedTokensPerMonth) * 100)
  const renewalDays = daysBetween(today, new Date(sub.renewalDate))
  const alert = sub.burnRateAlert
  const shortfall = projectedShortfall(period, today, renewalDays)

  const handleTopUp = () => {
    if (rateCardExpired) return
    navigate(shortfall > 0 ? `/admin/subscription?prefill=${shortfall}` : '/admin/subscription')
  }

  const handleExportCsv = () => {
    const filename = `services-${period.month}.csv`
    downloadFile(filename, buildServicesCsv(sub, today), 'text/csv;charset=utf-8')
    setExportResult(filename)
  }

  return (
    <div className="bg-slate-50" data-screen="services-dashboard">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.services_dashboard.crumb_platform')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.services_dashboard.crumb_services')}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.services_dashboard.title', { period: periodName })}</h1>
            <p className="mt-1 text-[13px] text-slate-600" data-header-blurb>
              {t('page.services_dashboard.header_blurb', { date: formatDay(sub.renewalDate) })}
            </p>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>{t('page.services_dashboard.user_byline', { name: currentUser.name })}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleExportCsv}
              data-export-csv
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >{t('page.services_dashboard.export_csv')}</button>
            <button type="button" onClick={handleTopUp} disabled={rateCardExpired}
              data-top-up
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >{t('page.services_dashboard.top_up_tokens')}</button>
          </div>
        </div>

        {rateCardExpired && (
          <p className="rounded-md p-3 text-[12px]" style={{ backgroundColor: '#FEF2F2', color: '#7F1D1D', border: '1px solid #FCA5A5' }} data-rate-card-expired>
            {t('page.services_dashboard.rate_card_expired')}
          </p>
        )}

        {/* 5 stat cards */}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} data-stat-cards>
          <div className="rounded-lg border border-slate-200 bg-white p-4" data-stat="tokens-consumed">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.services_dashboard.stat_tokens_consumed')}</p>
            <p className="mt-1 text-[22px] font-bold" style={{ color: PLATFORM_ACCENT.primary }}>{formatNumber(period.tokensConsumed)}</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">{t('page.services_dashboard.period_to_date', { period: periodName })}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4" data-stat="remaining-balance">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.services_dashboard.stat_remaining_balance')}</p>
            <p className="mt-1 text-[22px] font-bold" style={{ color: PLATFORM_ACCENT.primary }}>{remainingPct}%</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">{t('page.services_dashboard.tokens_count', { count: period.tokensRemaining })}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4" data-stat="estimated-spend">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.services_dashboard.stat_estimated_spend')}</p>
            <p className="mt-1 text-[22px] font-bold" style={{ color: PLATFORM_ACCENT.primary }}>{formatUSD(period.estimatedSpend)}</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">{t('page.services_dashboard.period_to_date', { period: periodName })}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4" data-stat="contracted">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.services_dashboard.stat_contracted')}</p>
            <p className="mt-1 text-[22px] font-bold" style={{ color: PLATFORM_ACCENT.primary }}>{formatUSD(sub.monthlyFee)}</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">{t('page.services_dashboard.per_month')}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4" data-stat="renewal">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.services_dashboard.stat_renewal')}</p>
            <p className="mt-1 text-[22px] font-bold" style={{ color: PLATFORM_ACCENT.primary }}>{formatDay(sub.renewalDate)}</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">{t('page.services_dashboard.days_from_today', { count: renewalDays })}</p>
          </div>
        </div>

        {/* Burn rate alert */}
        {alert?.active && (
          <div className="rounded-lg border p-4" style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }} data-monitor-panel>
            <p className="text-[13px] font-semibold" style={{ color: '#B45309' }} data-monitor-label>{t('page.services_dashboard.monitor_label')}</p>
            <p className="mt-2 text-[12px] text-slate-700" data-monitor-message>{alert.message}</p>
          </div>
        )}

        {/* Breakdown table */}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-breakdown-table>
          <table className="w-full text-[13px]">
            <thead style={{ backgroundColor: '#F8FAFC' }}>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2">{t('page.services_dashboard.col_discipline')}</th>
                <th className="px-4 py-2 text-right">{t('page.services_dashboard.col_tokens_consumed')}</th>
                <th className="px-4 py-2 text-right">{t('page.services_dashboard.col_cost')}</th>
                <th className="px-4 py-2 text-right">{t('page.services_dashboard.col_pct_total')}</th>
                <th className="px-4 py-2">{t('page.services_dashboard.col_burn_rate')}</th>
                <th className="px-4 py-2">{t('page.services_dashboard.col_status')}</th>
              </tr>
            </thead>
            <tbody>
              {sub.moduleBreakdown.map(r => (
                <tr key={r.module} className="border-t border-slate-200" data-breakdown-row={r.module} data-breakdown-status={r.status}>
                  <td className="px-4 py-3 font-semibold text-slate-900">{r.label}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{formatNumber(r.tokensConsumed)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{formatUSD(r.cost)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{r.pctOfTotal}%</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-500 capitalize">{r.burnRate.replace('-', ' ')}</td>
                  <td className="px-4 py-3"><StatusChip status={r.status} /></td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 font-semibold" style={{ backgroundColor: '#F8FAFC' }} data-breakdown-total>
                <td className="px-4 py-3">{t('page.services_dashboard.total')}</td>
                <td className="px-4 py-3 text-right font-mono">{formatNumber(period.tokensConsumed)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatUSD(period.estimatedSpend)}</td>
                <td className="px-4 py-3 text-right font-mono">100%</td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-500">—</td>
                <td className="px-4 py-3">—</td>
              </tr>
            </tbody>
          </table>
          <p className="border-t border-slate-200 p-3 font-mono text-[11px] text-slate-500" data-burn-note>{t('page.services_dashboard.burn_note')}</p>
        </section>

        {exportResult && (
          <p className="rounded-md p-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-export-result>{t('page.services_dashboard.export_result', { filename: exportResult })}</p>
        )}

        <p
          className="rounded-md p-3 text-[12px]"
          style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
          data-settlement-note
        >
          {t('page.services_dashboard.settlement_note')}
        </p>

        {/* ── Usage analytics ────────────────────────────────────────────────
            Six AI-gateway aggregates fetched live from
            GET /ai/usage-analytics?windowDays=30. Tenant admins see their
            tenant only; platform admins (tenantId=null) see all tenants.
            Window defaults to 30 days. Empty / zero states handled per panel.
            ────────────────────────────────────────────────────────────────── */}
        {analytics && (
          <section className="flex flex-col gap-3" data-section="usage-analytics">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-slate-900">{t('page.services_dashboard.usage_analytics')}</h2>
              <p className="font-mono text-[11px] text-slate-500">
                {t('page.services_dashboard.usage_summary', {
                  calls:  formatNumber(analytics.totals.calls),
                  tokens: formatNumber(analytics.totals.tokens),
                  cost:   analytics.totals.costUsd.toFixed(2),
                  days:   analytics.windowDays,
                })}
              </p>
            </div>

            {analytics.totals.calls === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-[13px] text-slate-500" data-empty="no-ai-activity">
                {t('page.services_dashboard.no_ai_activity', { days: analytics.windowDays })}
              </div>
            ) : (
              <>
                {/* Daily tokens — N-day bar chart */}
                <div className="rounded-lg border border-slate-200 bg-white p-4" data-chart="daily-tokens">
                  <div className="flex items-baseline justify-between">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                      {t('page.services_dashboard.tokens_per_day', { days: analytics.windowDays })}
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {t('page.services_dashboard.avg_peak', {
                        avg:  formatNumber(Math.round(analytics.dailyTokens.reduce((a, r) => a + r.tokens, 0) / Math.max(1, analytics.dailyTokens.length))),
                        peak: formatNumber(Math.max(0, ...analytics.dailyTokens.map(r => r.tokens))),
                      })}
                    </p>
                  </div>
                  <DailyBars values={analytics.dailyTokens.map(r => r.tokens)} />
                </div>

                {/* Two-column: Prompt intents + Model mix */}
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
                  <RankCard
                    title={t('page.services_dashboard.prompt_intents_title')}
                    rows={analytics.promptIntents}
                    valueFormat={(n) => `${n}%`}
                    dataAttr="prompt-intents"
                  />
                  <RankCard
                    title={t('page.services_dashboard.model_mix_title')}
                    rows={analytics.modelMix}
                    valueFormat={(n) => `${n}%`}
                    dataAttr="model-mix"
                  />
                </div>

                {/* Two-column: Top prompts + Top users */}
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
                  <TopList
                    title={t('page.services_dashboard.most_fired_prompts', { days: analytics.windowDays })}
                    rows={analytics.topPrompts}
                    dataAttr="top-prompts"
                    emptyLabel={t('page.services_dashboard.empty_prompts')}
                  />
                  <TopList
                    title={t('page.services_dashboard.top_users_by_cost', { days: analytics.windowDays })}
                    rows={analytics.topUsers}
                    dataAttr="top-users"
                    emptyLabel={t('page.services_dashboard.empty_users')}
                  />
                </div>

                {/* Hourly heatmap */}
                <div className="rounded-lg border border-slate-200 bg-white p-4" data-chart="hourly-heatmap">
                  <div className="flex items-baseline justify-between">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                      {t('page.services_dashboard.hourly_title')}
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {t('page.services_dashboard.busiest_hour', { hour: analytics.hourlyPeakLabel })}
                    </p>
                  </div>
                  <HourlyHeatmap values={analytics.hourlyDistribution} />
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Small SVG + list helpers (kept local — the shapes aren't reused elsewhere).
// -----------------------------------------------------------------------------

function DailyBars({ values }: { values: number[] }) {
  const { t } = useTranslation()
  const max = Math.max(...values, 1)
  const barW = 100 / values.length
  const gap = 0.35
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-2 h-24 w-full" aria-label={t('page.services_dashboard.daily_bars_aria')}>
      {values.map((v, i) => {
        const h = (v / max) * 36
        return (
          <rect
            key={i}
            x={i * barW + gap}
            y={38 - h}
            width={barW - gap * 2}
            height={h}
            rx={0.6}
            fill={PLATFORM_ACCENT.primary}
            opacity={0.85}
          >
            <title>{t('page.services_dashboard.day_bar_tooltip', { day: i + 1, tokens: formatNumber(v) })}</title>
          </rect>
        )
      })}
      <line x1={0} y1={38} x2={100} y2={38} stroke="#E2E8F0" strokeWidth={0.4} />
    </svg>
  )
}

function RankCard({ title, rows, valueFormat, dataAttr }: {
  title: string
  rows: Array<{ label: string; value: number; hint?: string }>
  valueFormat: (v: number) => string
  dataAttr: string
}) {
  const max = Math.max(...rows.map(r => r.value), 1)
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4" data-rank={dataAttr}>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{title}</p>
      <div className="mt-2 flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-3" data-rank-row>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between">
                <p className="truncate text-[13px] text-slate-900">{r.label}</p>
                <p className="font-mono text-[11px] font-semibold text-slate-700">{valueFormat(r.value)}</p>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: '#E2E8F0' }}>
                <div
                  className="h-full"
                  style={{ width: `${(r.value / max) * 100}%`, backgroundColor: PLATFORM_ACCENT.primary }}
                />
              </div>
              {r.hint && <p className="mt-0.5 font-mono text-[10px] text-slate-500">{r.hint}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TopList({ title, rows, dataAttr, emptyLabel }: {
  title: string
  rows: Array<{ label: string; hint?: string }>
  dataAttr: string
  emptyLabel?: string
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4" data-top-list={dataAttr}>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-[12px] text-slate-500" data-top-empty>{emptyLabel ?? t('page.services_dashboard.no_data')}</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-2">
          {rows.map((r, i) => (
            <li key={i} className="flex items-start gap-3 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0" data-top-row>
              <span
                className="flex h-5 w-5 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold"
                style={{ backgroundColor: '#F1F5F9', color: '#475569' }}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-slate-900">{r.label}</p>
                {r.hint && <p className="mt-0.5 font-mono text-[10px] text-slate-500">{r.hint}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function HourlyHeatmap({ values }: { values: number[] }) {
  const { t } = useTranslation()
  // 24 cells; opacity ∝ value / 100 so busy hours darken toward PLATFORM_ACCENT.
  return (
    <div className="mt-2" data-chart-grid="hourly">
      <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
        {values.map((v, h) => (
          <div
            key={h}
            className="h-6 rounded-sm"
            style={{
              backgroundColor: PLATFORM_ACCENT.primary,
              opacity: 0.15 + (v / 100) * 0.85,
            }}
            title={t('page.services_dashboard.hour_tooltip', { hour: String(h).padStart(2, '0'), pct: v })}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-400">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
    </div>
  )
}
