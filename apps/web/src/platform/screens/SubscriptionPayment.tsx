import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { Subscription, RateCard, PlatformConfig } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'
import { formatNumber } from '../../utils/formatNumber'

// Midnight UTC today: card validity and renewal are calendar days (this used to be pinned to 9 Sep 2026).
function startOfTodayUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

// "Nov 2026" for a 'YYYY-MM' billing period, in the UI language (the column used to say "Sept").
function billingPeriodName(month: string | undefined, lang: string): string {
  const d = month && /^\d{4}-\d{2}$/.test(month) ? new Date(`${month}-01T00:00:00Z`) : new Date()
  return new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
}

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
  const { t } = useTranslation()
  const meta = status === 'paid'    ? { bg: '#F0FDF4', fg: '#166534', label: `✓ ${t('page.subscription_payment.status_paid')}` }
             : status === 'pending' ? { bg: '#FFFBEB', fg: '#B45309', label: `○ ${t('page.subscription_payment.status_pending')}` }
             : status === 'failed'  ? { bg: '#FEF2F2', fg: '#B0200D', label: `⊘ ${t('page.subscription_payment.status_failed')}` }
             :                        { bg: '#F1F5F9', fg: '#475569', label: status }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: meta.bg, color: meta.fg }}
      data-invoice-status={status}
    >{meta.label}</span>
  )
}

export function SubscriptionPayment() {
  const { t, i18n } = useTranslation()
  const currentUser = usePlatformStore(s => s.currentUser)
  const [searchParams] = useSearchParams()
  const prefill = Number(searchParams.get('prefill') ?? '0')

  const { data: sub }    = useQuery<Subscription>({ queryKey: ['services-dashboard'], queryFn: () => platformApi.getServicesDashboard() })
  const { data: cards = [] } = useQuery<RateCard[]>({ queryKey: ['rate-cards'],       queryFn: () => platformApi.listRateCards() })
  const { data: cfg }    = useQuery<PlatformConfig>({ queryKey: ['platform-config'],  queryFn: () => platformApi.getConfig() })

  const activeCard = cards.find(c => c.status === 'active')
  const today      = useMemo(() => startOfTodayUTC(), [])
  const isExpired  = activeCard ? new Date(activeCard.validUntil) < today : false

  // Initial step: prefill from query (if present, pick closest step) else default 500K
  const initialStep = useMemo(() => {
    if (!prefill) return 2 // 500K
    const closest = STEPS.reduce((best, s, i) => Math.abs(s - prefill) < Math.abs(STEPS[best] - prefill) ? i : best, 0)
    return closest
  }, [prefill])
  const [stepIdx, setStepIdx] = useState(initialStep)
  const qty = STEPS[stepIdx]
  const qtyLabel = qty >= 1_000_000
    ? t('page.subscription_payment.qty_millions', { count: qty / 1_000_000 })
    : t('page.subscription_payment.qty_thousands', { count: qty / 1000 })

  const baseRate = activeCard?.rates.find(r => r.serviceType === 'AI Tokens (base)')?.rate ?? 0.005
  const priceValue = (qty / 1000) * baseRate

  const gateways = (cfg?.paymentGateways ?? []).filter(g => g.status === 'active')
  const [gateway, setGateway] = useState<string>(gateways[0]?.id ?? 'stripe')

  // No gateway is integrated yet: this records a pending top-up request.
  const topUp = useMutation({
    mutationFn: () => platformApi.requestTopUp({
      tokens: qty,
      amountUsd: Number(priceValue.toFixed(2)),
      gateway: gateways.some(g => g.id === gateway) ? gateway : null,
    }),
  })

  const dec = () => setStepIdx(Math.max(0, stepIdx - 1))
  const inc = () => setStepIdx(Math.min(STEPS.length - 1, stepIdx + 1))

  if (!sub) return <div className="p-8 text-center text-sm text-slate-500" data-screen="subscription-payment">{t('status.loading')}</div>

  const client = sub.clientName ?? t('page.subscription_payment.all_tenants')
  const usedPct = sub.contractedTokensPerMonth ? Math.round((sub.currentPeriod.tokensConsumed / sub.contractedTokensPerMonth) * 100) : null
  const periodName = billingPeriodName(sub.currentPeriod.month, i18n.language)
  // Whole days from today to the renewal date (was a fixed 22).
  const daysToRenewal = sub.renewalDate ? Math.max(0, Math.round((new Date(sub.renewalDate).getTime() - today.getTime()) / 86_400_000)) : null

  return (
    <div className="bg-slate-50" data-screen="subscription-payment">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.subscription_payment.crumb_platform')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.subscription_payment.crumb_subscription')}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.subscription_payment.title')}</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>{t('page.subscription_payment.user_admin_byline', { name: currentUser.name })}</p>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 380px' }}>

          {/* LEFT — current plan */}
          <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5" data-current-plan>
            <div>
              <p className="text-[13px] text-slate-600" data-scope-blurb>{t('page.subscription_payment.plan_blurb', { client })}</p>
              <p className="mt-2 text-[16px] font-bold text-slate-900" data-plan-name>
                {sub.hasSubscription ? (
                  <>
                    <strong>{sub.planName}</strong>
                    {sub.renewalDate && <>{' · '}{t('page.subscription_payment.plan_meta_renews', { client, date: formatDay(sub.renewalDate) })}</>}
                    {' · '}<span style={{ color: '#166534' }}>{t('page.subscription_payment.plan_active_marker')}</span>
                  </>
                ) : (
                  <span data-no-plan>{t('page.subscription_payment.plan_none')}</span>
                )}
              </p>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200" data-scope-table>
              <table className="w-full text-[13px]">
                <thead style={{ backgroundColor: '#F8FAFC' }}>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                    <th className="px-4 py-2">{t('page.subscription_payment.col_scope')}</th>
                    <th className="px-4 py-2 text-right">{t('page.subscription_payment.col_included')}</th>
                    <th className="px-4 py-2 text-right">{t('page.subscription_payment.col_used', { period: periodName })}</th>
                    <th className="px-4 py-2 text-right">{t('page.subscription_payment.col_remaining')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-200" data-scope-row="all">
                    <td className="px-4 py-3 font-semibold text-slate-900">{t('page.subscription_payment.scope_all')}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800" data-scope-included>{sub.contractedTokensPerMonth != null ? formatNumber(sub.contractedTokensPerMonth) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800" data-scope-used>{formatNumber(sub.currentPeriod.tokensConsumed)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800" data-scope-remaining>{sub.currentPeriod.tokensRemaining != null ? formatNumber(sub.currentPeriod.tokensRemaining) : '—'}</td>
                  </tr>
                </tbody>
              </table>
              {usedPct != null && daysToRenewal != null && (
                <p className="border-t border-slate-200 p-2 font-mono text-[11px] text-slate-500" data-usage-note>
                  {t('page.subscription_payment.usage_note', { pct: usedPct, days: daysToRenewal })}
                </p>
              )}
            </div>

            {/* Only with a connected gateway and a real payment method: without them nothing can be auto-charged. */}
            {gateways.length > 0 && sub.paymentMethod && (
            <div className="rounded-lg border border-slate-200 p-4" data-next-invoice>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.subscription_payment.next_invoice_eyebrow')}</p>
              {sub.monthlyFee != null && sub.renewalDate && sub.paymentMethod ? (
                <p className="mt-1 text-[15px] font-semibold text-slate-900">
                  {t('page.subscription_payment.next_invoice_line', {
                    amount: formatUSD(sub.monthlyFee),
                    date: formatDay(sub.renewalDate),
                    brand: sub.paymentMethod.brand,
                    last4: sub.paymentMethod.last4,
                  })}
                </p>
              ) : (
                <p className="mt-1 text-[13px] text-slate-600" data-no-invoice>{t('page.subscription_payment.next_invoice_none')}</p>
              )}
              {sub.paymentMethod && <button type="button" className="mt-2 text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-update-payment>{t('page.subscription_payment.update_payment_method')}</button>}
            </div>
            )}

            <div data-invoice-history>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.subscription_payment.invoice_history_eyebrow')}</p>
              <div className="mt-2 overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-[13px]">
                  <thead style={{ backgroundColor: '#F8FAFC' }}>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                      <th className="px-4 py-2">{t('page.subscription_payment.col_date')}</th>
                      <th className="px-4 py-2">{t('page.subscription_payment.col_services')}</th>
                      <th className="px-4 py-2 text-right">{t('page.subscription_payment.col_amount')}</th>
                      <th className="px-4 py-2">{t('page.subscription_payment.col_status')}</th>
                      <th className="px-4 py-2 text-right">{t('page.subscription_payment.col_download')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub.invoices.length === 0 && (
                      <tr className="border-t border-slate-200" data-no-invoices>
                        <td colSpan={5} className="px-4 py-6 text-center text-[13px] text-slate-500" data-invoices-empty>
                          {t('page.subscription_payment.invoices_none')}
                        </td>
                      </tr>
                    )}
                    {sub.invoices.map(inv => (
                      <tr key={inv.id} className="border-t border-slate-200" data-invoice-row={inv.id}>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{formatDay(inv.date)}</td>
                        <td className="px-4 py-3 text-slate-700">{inv.services}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-800">{formatUSD(inv.amount)}</td>
                        <td className="px-4 py-3"><InvoiceStatus status={inv.status} /></td>
                        <td className="px-4 py-3 text-right">
                          <a href={inv.pdfUrl} className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-download-pdf={inv.id}>{t('page.subscription_payment.download_pdf')}</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="rounded-md p-3 text-[12px]" style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }} data-invoice-immutability>
              {t('page.subscription_payment.invoice_immutability')}
            </p>
          </section>

          {/* RIGHT — top-up */}
          <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-topup-panel>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.subscription_payment.topup_eyebrow')}</p>
            {gateways.length > 0 && <p className="text-[12px] text-slate-600">{t('page.subscription_payment.topup_blurb')}</p>}

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.subscription_payment.service_label')}</span>
              <select data-service-select className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
                <option>{t('page.subscription_payment.service_option_all')}</option>
              </select>
            </label>

            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.subscription_payment.quantity_label')}</p>
              <div className="mt-1 flex items-center gap-3" data-qty-stepper>
                <button type="button" onClick={dec} disabled={stepIdx === 0} data-qty-dec
                  aria-label={t('page.subscription_payment.decrement_quantity')}
                  className="h-9 w-9 rounded-md border border-slate-300 bg-white text-[16px] font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">−</button>
                <span className="min-w-[120px] text-center text-[14px] font-semibold text-slate-900" data-qty-label>{qtyLabel}</span>
                <button type="button" onClick={inc} disabled={stepIdx === STEPS.length - 1} data-qty-inc
                  aria-label={t('page.subscription_payment.increment_quantity')}
                  className="h-9 w-9 rounded-md border border-slate-300 bg-white text-[16px] font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">+</button>
              </div>
            </div>

            <div className="rounded-md border border-slate-200 p-3" data-price>
              <p className="text-[13px] font-semibold text-slate-900">{t('page.subscription_payment.price_label')} <span data-price-value>{formatUSD(priceValue, priceValue < 100 ? 2 : 0)}</span></p>
              <p className="mt-1 font-mono text-[11px] text-slate-500" data-rate-source>
                {t('page.subscription_payment.rate_source', { version: activeCard?.version ?? '—', rate: baseRate.toFixed(3) })}
              </p>
            </div>

            <div data-gateway-select>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.subscription_payment.payment_gateway_label')}</p>
              <div className="mt-1 flex flex-col gap-1">
                {gateways.length === 0 && (
                  <p className="text-[12px] text-slate-500" data-no-gateway>
                    {t('page.subscription_payment.no_gateway')}
                  </p>
                )}
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
                {t('page.subscription_payment.rate_card_expired')}
              </p>
            )}

            <button
              type="button" disabled={isExpired || topUp.isPending || !sub.hasSubscription}
              onClick={() => topUp.mutate()}
              data-proceed-payment
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >{topUp.isPending ? t('page.subscription_payment.submitting') : gateways.length > 0 ? t('page.subscription_payment.proceed_to_payment') : t('page.subscription_payment.request_topup')}</button>

            {!sub.hasSubscription && (
              <p className="rounded-md bg-amber-50 p-2 text-[12px] text-amber-900" data-topup-needs-plan>{t('page.subscription_payment.topup_needs_plan')}</p>
            )}

            {topUp.isSuccess && (
              <p className="rounded-md p-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-topup-success>
                {t('page.subscription_payment.topup_success', { qty: qtyLabel, amount: priceValue.toFixed(2), ref: topUp.data.requestId })}
              </p>
            )}
            {topUp.isError && (
              <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" data-topup-error>
                {t('page.subscription_payment.topup_error')}
              </p>
            )}

            {gateways.length > 0 && (
              <p className="font-mono text-[11px] text-slate-500" data-no-card-storage-note>
                {t('page.subscription_payment.no_card_storage_note')}
              </p>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
