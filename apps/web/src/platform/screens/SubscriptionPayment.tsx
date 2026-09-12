import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Subscription, RateCard, PlatformConfig } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

const TODAY = new Date('2026-09-09T00:00:00Z')

const STEPS = [100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000]

function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
function formatUSD(amount: number, decimals = 0): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

function InvoiceStatus({ status }: { status: string }) {
  const meta = status === 'paid'    ? { bg: '#F0FDF4', fg: '#166534', label: '✓ Paid' }
             : status === 'pending' ? { bg: '#FFFBEB', fg: '#B45309', label: '○ Pending' }
             : status === 'failed'  ? { bg: '#FEF2F2', fg: '#B0200D', label: '⊘ Failed' }
             :                        { bg: '#F1F5F9', fg: '#475569', label: status }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: meta.bg, color: meta.fg }}
      data-invoice-status={status}
    >{meta.label}</span>
  )
}

export function SubscriptionPayment() {
  const currentUser = usePlatformStore(s => s.currentUser)
  const [searchParams] = useSearchParams()
  const prefill = Number(searchParams.get('prefill') ?? '0')

  const { data: sub }    = useQuery<Subscription>({ queryKey: ['services-dashboard'], queryFn: () => platformApi.getServicesDashboard() })
  const { data: cards = [] } = useQuery<RateCard[]>({ queryKey: ['rate-cards'],       queryFn: () => platformApi.listRateCards() })
  const { data: cfg }    = useQuery<PlatformConfig>({ queryKey: ['platform-config'],  queryFn: () => platformApi.getConfig() })

  const activeCard = cards.find(c => c.status === 'active')
  const isExpired  = activeCard ? new Date(activeCard.validUntil) < TODAY : false

  // Initial step: prefill from query (if present, pick closest step) else default 500K
  const initialStep = useMemo(() => {
    if (!prefill) return 2 // 500K
    const closest = STEPS.reduce((best, s, i) => Math.abs(s - prefill) < Math.abs(STEPS[best] - prefill) ? i : best, 0)
    return closest
  }, [prefill])
  const [stepIdx, setStepIdx] = useState(initialStep)
  const qty = STEPS[stepIdx]
  const qtyLabel = qty >= 1_000_000 ? `${qty / 1_000_000}M tokens` : `${qty / 1000}K tokens`

  const baseRate = activeCard?.rates.find(r => r.serviceType === 'AI Tokens (base)')?.rate ?? 0.005
  const priceValue = (qty / 1000) * baseRate

  const gateways = (cfg?.paymentGateways ?? []).filter(g => g.status === 'active')
  const [gateway, setGateway] = useState<string>(gateways[0]?.id ?? 'stripe')

  const dec = () => setStepIdx(Math.max(0, stepIdx - 1))
  const inc = () => setStepIdx(Math.min(STEPS.length - 1, stepIdx + 1))

  if (!sub) return <div className="p-8 text-center text-sm text-slate-500" data-screen="subscription-payment">Loading…</div>

  const usedPct = Math.round((sub.currentPeriod.tokensConsumed / sub.contractedTokensPerMonth) * 100)

  return (
    <div className="bg-slate-50" data-screen="subscription-payment">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Platform</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Subscription</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Subscription &amp; Payment</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>{currentUser.name} · Admin</p>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 380px' }}>

          {/* LEFT — current plan */}
          <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5" data-current-plan>
            <div>
              <p className="text-[13px] text-slate-600" data-scope-blurb>Plan, allowance and billing for GenBioCa Sciences.</p>
              <p className="mt-2 text-[16px] font-bold text-slate-900" data-plan-name>
                <strong>{sub.planName}</strong> · GenBioCa Sciences · renews {formatDay(sub.renewalDate)} · <span style={{ color: '#166534' }}>✓ Active</span>
              </p>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200" data-scope-table>
              <table className="w-full text-[13px]">
                <thead style={{ backgroundColor: '#F8FAFC' }}>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                    <th className="px-4 py-2">Scope</th>
                    <th className="px-4 py-2 text-right">Included</th>
                    <th className="px-4 py-2 text-right">Used (Sept)</th>
                    <th className="px-4 py-2 text-right">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-200" data-scope-row="all">
                    <td className="px-4 py-3 font-semibold text-slate-900">All disciplines</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800" data-scope-included>{sub.contractedTokensPerMonth.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800" data-scope-used>{sub.currentPeriod.tokensConsumed.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800" data-scope-remaining>{sub.currentPeriod.tokensRemaining.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
              <p className="border-t border-slate-200 p-2 font-mono text-[11px] text-slate-500" data-usage-note>
                {usedPct}% of the monthly allowance used · 22 days remaining
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 p-4" data-next-invoice>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Next invoice</p>
              <p className="mt-1 text-[15px] font-semibold text-slate-900">
                {formatUSD(sub.monthlyFee)} · {formatDay(sub.renewalDate)} · Auto-charge to {sub.paymentMethod.brand} ···· {sub.paymentMethod.last4}
              </p>
              <button type="button" className="mt-2 text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-update-payment>Update payment method →</button>
            </div>

            <div data-invoice-history>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Invoice history</p>
              <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-[13px]">
                  <thead style={{ backgroundColor: '#F8FAFC' }}>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Services</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2 text-right">Download</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub.invoices.map(inv => (
                      <tr key={inv.id} className="border-t border-slate-200" data-invoice-row={inv.id}>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{formatDay(inv.date)}</td>
                        <td className="px-4 py-3 text-slate-700">{inv.services}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-800">{formatUSD(inv.amount)}</td>
                        <td className="px-4 py-3"><InvoiceStatus status={inv.status} /></td>
                        <td className="px-4 py-3 text-right">
                          <a href={inv.pdfUrl} className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-download-pdf={inv.id}>Download PDF</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="rounded-md p-3 text-[12px]" style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }} data-invoice-immutability>
              Invoices are immutable once issued. Corrections are made by credit note, never by amending the original.
            </p>
          </section>

          {/* RIGHT — top-up */}
          <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-topup-panel>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Purchase additional tokens</p>
            <p className="text-[12px] text-slate-600">Top-up tokens are added immediately and do not expire at renewal.</p>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Service</span>
              <select data-service-select className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
                <option>All disciplines (combined)</option>
              </select>
            </label>

            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Quantity</p>
              <div className="mt-1 flex items-center gap-3" data-qty-stepper>
                <button type="button" onClick={dec} disabled={stepIdx === 0} data-qty-dec
                  className="h-9 w-9 rounded-md border border-slate-300 bg-white text-[16px] font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">−</button>
                <span className="min-w-[120px] text-center text-[14px] font-semibold text-slate-900" data-qty-label>{qtyLabel}</span>
                <button type="button" onClick={inc} disabled={stepIdx === STEPS.length - 1} data-qty-inc
                  className="h-9 w-9 rounded-md border border-slate-300 bg-white text-[16px] font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">+</button>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 p-3" data-price>
              <p className="text-[13px] font-semibold text-slate-900">Price: <span data-price-value>{formatUSD(priceValue, priceValue < 100 ? 2 : 0)}</span></p>
              <p className="mt-1 font-mono text-[11px] text-slate-500" data-rate-source>
                Rate card {activeCard?.version ?? '—'} · ${baseRate.toFixed(3)} per 1K tokens
              </p>
            </div>

            <div data-gateway-select>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Payment gateway</p>
              <div className="mt-1 flex flex-col gap-1">
                {gateways.map(g => (
                  <label key={g.id} className="flex items-center gap-2 text-[12px] text-slate-800">
                    <input type="radio" name="gw" checked={gateway === g.id} onChange={() => setGateway(g.id)}
                      data-gateway={g.id} style={{ accentColor: PLATFORM_ACCENT.primary }} />
                    {g.label}
                  </label>
                ))}
              </div>
            </div>

            {isExpired && (
              <p className="rounded-md p-2 text-[12px]" style={{ backgroundColor: '#FEF2F2', color: '#7F1D1D' }} data-rate-card-expired>
                A new rate card must be published before purchases can resume.
              </p>
            )}

            <button
              type="button" disabled={isExpired}
              data-proceed-payment
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >Proceed to payment →</button>

            <p className="font-mono text-[11px] text-slate-500" data-no-card-storage-note>
              Payment is processed securely via the selected gateway. No card details are stored on this platform.
            </p>
          </aside>
        </div>
      </div>
    </div>
  )
}
