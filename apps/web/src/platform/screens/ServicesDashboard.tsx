import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
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
  const meta = status === 'healthy'  ? { bg: '#F0FDF4', fg: '#166534', label: '✓ Healthy' }
             : status === 'monitor'  ? { bg: '#FFFBEB', fg: '#B45309', label: '⚠ Monitor' }
             :                         { bg: '#FEF2F2', fg: '#B0200D', label: '⊘ Over' }
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

export function ServicesDashboard() {
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
          <p className="font-semibold">Couldn't load services data</p>
          <p className="mt-1">{describeApiError(error).message}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="mt-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >{isFetching ? 'Retrying…' : 'Retry'}</button>
        </div>
      </div>
    )
  }
  if (!sub) return <div className="p-8 text-center text-sm text-slate-500" data-screen="services-dashboard">Loading…</div>

  const period = sub.currentPeriod
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
          <span>Platform</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Services</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Services · September 2026</h1>
            <p className="mt-1 text-[13px] text-slate-600" data-header-blurb>
              Token consumption and cost for GenBioCa Sciences. Renewal date: {formatDay(sub.renewalDate)}.
            </p>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>{currentUser.name} · Admin</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleExportCsv}
              data-export-csv
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
            >Export CSV</button>
            <button type="button" onClick={handleTopUp} disabled={rateCardExpired}
              data-top-up
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >Top up tokens →</button>
          </div>
        </div>

        {rateCardExpired && (
          <p className="rounded-md p-3 text-[12px]" style={{ backgroundColor: '#FEF2F2', color: '#7F1D1D', border: '1px solid #FCA5A5' }} data-rate-card-expired>
            A new rate card must be published before purchases can resume.
          </p>
        )}

        {/* 5 stat cards */}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} data-stat-cards>
          <div className="rounded-lg border border-slate-200 bg-white p-4" data-stat="tokens-consumed">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Tokens consumed</p>
            <p className="mt-1 text-[22px] font-bold" style={{ color: PLATFORM_ACCENT.primary }}>{period.tokensConsumed.toLocaleString()}</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">September to date</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4" data-stat="remaining-balance">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Remaining balance</p>
            <p className="mt-1 text-[22px] font-bold" style={{ color: PLATFORM_ACCENT.primary }}>{remainingPct}%</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">{period.tokensRemaining.toLocaleString()} tokens</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4" data-stat="estimated-spend">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Estimated spend</p>
            <p className="mt-1 text-[22px] font-bold" style={{ color: PLATFORM_ACCENT.primary }}>{formatUSD(period.estimatedSpend)}</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">September to date</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4" data-stat="contracted">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Contracted amount</p>
            <p className="mt-1 text-[22px] font-bold" style={{ color: PLATFORM_ACCENT.primary }}>{formatUSD(sub.monthlyFee)}</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">Per month</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4" data-stat="renewal">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Renewal</p>
            <p className="mt-1 text-[22px] font-bold" style={{ color: PLATFORM_ACCENT.primary }}>{formatDay(sub.renewalDate)}</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">{renewalDays} days from today</p>
          </div>
        </div>

        {/* Burn rate alert */}
        {alert?.active && (
          <div className="rounded-lg border p-4" style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }} data-monitor-panel>
            <p className="text-[13px] font-semibold" style={{ color: '#B45309' }} data-monitor-label>⚠ Two disciplines are above their expected burn rate</p>
            <p className="mt-2 text-[12px] text-slate-700" data-monitor-message>{alert.message}</p>
          </div>
        )}

        {/* Breakdown table */}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-breakdown-table>
          <table className="w-full text-[13px]">
            <thead style={{ backgroundColor: '#F8FAFC' }}>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2">Discipline</th>
                <th className="px-4 py-2 text-right">Tokens consumed</th>
                <th className="px-4 py-2 text-right">Cost</th>
                <th className="px-4 py-2 text-right">% of total</th>
                <th className="px-4 py-2">Burn rate</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {sub.moduleBreakdown.map(r => (
                <tr key={r.module} className="border-t border-slate-200" data-breakdown-row={r.module} data-breakdown-status={r.status}>
                  <td className="px-4 py-3 font-semibold text-slate-900">{r.label}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{r.tokensConsumed.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{formatUSD(r.cost)}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-700">{r.pctOfTotal}%</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-500 capitalize">{r.burnRate.replace('-', ' ')}</td>
                  <td className="px-4 py-3"><StatusChip status={r.status} /></td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 font-semibold" style={{ backgroundColor: '#F8FAFC' }} data-breakdown-total>
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right font-mono">{period.tokensConsumed.toLocaleString()}</td>
                <td className="px-4 py-3 text-right font-mono">{formatUSD(period.estimatedSpend)}</td>
                <td className="px-4 py-3 text-right font-mono">100%</td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-500">—</td>
                <td className="px-4 py-3">—</td>
              </tr>
            </tbody>
          </table>
          <p className="border-t border-slate-200 p-3 font-mono text-[11px] text-slate-500" data-burn-note>Burn rate is measured against the same period last month.</p>
        </section>

        {exportResult && (
          <p className="rounded-md p-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-export-result>✓ Downloaded {exportResult}</p>
        )}

        <p
          className="rounded-md p-3 text-[12px]"
          style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
          data-settlement-note
        >
          Consumption figures are recalculated hourly and settle at 00:00 UTC on the renewal date. Settled periods cannot be adjusted.
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
              <h2 className="text-sm font-semibold text-slate-900">Usage analytics</h2>
              <p className="font-mono text-[11px] text-slate-500">
                {analytics.totals.calls.toLocaleString()} calls · {analytics.totals.tokens.toLocaleString()} tokens · ${analytics.totals.costUsd.toFixed(2)} over the last {analytics.windowDays} days
              </p>
            </div>

            {analytics.totals.calls === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-[13px] text-slate-500" data-empty="no-ai-activity">
                No AI gateway activity in the last {analytics.windowDays} days.
              </div>
            ) : (
              <>
                {/* Daily tokens — N-day bar chart */}
                <div className="rounded-lg border border-slate-200 bg-white p-4" data-chart="daily-tokens">
                  <div className="flex items-baseline justify-between">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                      Tokens per day · last {analytics.windowDays} days
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      avg {Math.round(analytics.dailyTokens.reduce((a, r) => a + r.tokens, 0) / Math.max(1, analytics.dailyTokens.length)).toLocaleString()}/day
                      · peak {Math.max(0, ...analytics.dailyTokens.map(r => r.tokens)).toLocaleString()}
                    </p>
                  </div>
                  <DailyBars values={analytics.dailyTokens.map(r => r.tokens)} />
                </div>

                {/* Two-column: Prompt intents + Model mix */}
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
                  <RankCard
                    title="Prompt intents · share of calls"
                    rows={analytics.promptIntents}
                    valueFormat={(n) => `${n}%`}
                    dataAttr="prompt-intents"
                  />
                  <RankCard
                    title="Model mix · share of tokens"
                    rows={analytics.modelMix}
                    valueFormat={(n) => `${n}%`}
                    dataAttr="model-mix"
                  />
                </div>

                {/* Two-column: Top prompts + Top users */}
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
                  <TopList
                    title={`Most-fired prompts · last ${analytics.windowDays} days`}
                    rows={analytics.topPrompts}
                    dataAttr="top-prompts"
                    emptyLabel="No prompt text recorded in this window."
                  />
                  <TopList
                    title={`Top users by cost · last ${analytics.windowDays} days`}
                    rows={analytics.topUsers}
                    dataAttr="top-users"
                    emptyLabel="No user activity in this window."
                  />
                </div>

                {/* Hourly heatmap */}
                <div className="rounded-lg border border-slate-200 bg-white p-4" data-chart="hourly-heatmap">
                  <div className="flex items-baseline justify-between">
                    <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                      Hour-of-day distribution · UTC
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      busiest hour {analytics.hourlyPeakLabel}
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
  const max = Math.max(...values, 1)
  const barW = 100 / values.length
  const gap = 0.35
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-2 h-24 w-full" aria-label="Daily token consumption bar chart">
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
            <title>{`Day ${i + 1}: ${v.toLocaleString()} tokens`}</title>
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
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4" data-top-list={dataAttr}>
      <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-[12px] text-slate-500" data-top-empty>{emptyLabel ?? 'No data.'}</p>
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
            title={`${String(h).padStart(2, '0')}:00 UTC · ${v}% of peak`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-400">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
      </div>
    </div>
  )
}
