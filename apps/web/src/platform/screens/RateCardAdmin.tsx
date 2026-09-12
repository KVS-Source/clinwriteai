import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RateCard } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

const TODAY = new Date('2026-09-09T00:00:00Z')

function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}
function formatMoney(amount: number, currency: string): string {
  // Platform currency is USD (PM00 rule 6). Other codes prefix with the ISO symbol.
  const sign = currency === 'USD' ? '$' : `${currency} `
  return `${sign}${amount.toLocaleString('en-US', { minimumFractionDigits: amount < 1 ? 3 : 2 })}`
}

function StatusChip({ status }: { status: 'active' | 'archived' | 'draft' }) {
  if (status === 'active')
    return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary, border: `1px solid ${PLATFORM_ACCENT.borderMedium}` }} data-status-chip="active">✓ Active</span>
  if (status === 'archived')
    return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #CBD5E1' }} data-status-chip="archived">🔒 Archived</span>
  return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }} data-status-chip="draft">○ Draft</span>
}

export function RateCardAdmin() {
  const currentUser = usePlatformStore(s => s.currentUser)

  const { data: ratecards = [] } = useQuery<RateCard[]>({
    queryKey: ['rate-cards'],
    queryFn:  () => platformApi.listRateCards(),
  })

  const activeCard = ratecards.find(r => r.status === 'active') ?? ratecards[0]
  const [selectedId, setSelectedId] = useState<string>(activeCard?.id ?? '')

  const active = ratecards.find(r => r.id === selectedId) ?? activeCard

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [effFrom, setEffFrom] = useState('')

  const backdatingError = effFrom && new Date(effFrom) < TODAY ? 'Effective date cannot be in the past. Please select a current or future date.' : ''

  const daysToExpiry = active ? daysBetween(TODAY, new Date(active.validUntil)) : 0
  const isExpired = active ? new Date(active.validUntil) < TODAY : false

  return (
    <div className="bg-slate-50" data-screen="rate-card-admin">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Super Admin</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Rate Card</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Rate Card Admin</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>{currentUser.name} · Super Admin</p>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '280px 1fr' }}>

          {/* LEFT — version history */}
          <aside className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4" data-version-history>
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Rate card versions</p>
              <button type="button" onClick={() => setDrawerOpen(true)} data-new-ratecard
                className="text-[11px] font-semibold hover:underline"
                style={{ color: PLATFORM_ACCENT.primary }}>+ New rate card →</button>
            </div>
            <div className="flex flex-col divide-y divide-slate-200">
              {ratecards.map(v => {
                const isSelected = v.id === active?.id
                return (
                  <button
                    key={v.id} type="button" onClick={() => setSelectedId(v.id)}
                    data-version-row={v.id}
                    data-version-status={v.status}
                    data-selected={isSelected || undefined}
                    className="flex flex-col items-start gap-1 px-2 py-2 text-left hover:bg-slate-50"
                    style={{ backgroundColor: isSelected ? PLATFORM_ACCENT.bgTint : undefined }}
                  >
                    <div className="flex w-full items-center justify-between">
                      <p className="text-[13px] font-semibold text-slate-900">{v.label}</p>
                      <StatusChip status={v.status} />
                    </div>
                    <p className="font-mono text-[10px] text-slate-500">
                      {formatDay(v.effectiveFrom)}{v.archivedAt ? ` → ${formatDay(v.validUntil)}` : ''}
                    </p>
                    <p className="font-mono text-[10px] text-slate-500">{v.createdByName}</p>
                  </button>
                )
              })}
            </div>
            <p className="mt-2 rounded-md p-2 text-[11px]" style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }} data-backdating-note>
              Archived rate cards are read-only. Rate cards cannot be backdated.
            </p>
          </aside>

          {/* RIGHT — detail */}
          {active && (
            <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5" data-rate-card-detail data-active-version={active.version}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Rate card detail</p>
                  <p className="mt-1 text-[16px] font-bold text-slate-900" data-heading>
                    Rate Card {active.version} · {active.currency} · exclusive of sales tax
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500" data-validity>
                    Effective {formatDay(active.effectiveFrom)} · Valid until {formatDay(active.validUntil)}
                  </p>
                </div>
                {active.status === 'active'
                  ? <button type="button" data-edit-ratecard className="h-9 rounded-md border px-3 text-[13px] font-semibold" style={{ borderColor: PLATFORM_ACCENT.primary, color: PLATFORM_ACCENT.primary }}>Edit rate card →</button>
                  : <button type="button" disabled data-edit-ratecard-locked className="h-9 rounded-md border border-slate-300 bg-slate-50 px-3 text-[13px] font-semibold text-slate-500 opacity-60">🔒 Locked</button>}
              </div>

              {active.status === 'active' && !isExpired && (
                <div className="rounded-lg border p-3" style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }} data-expiry-warning>
                  <p className="text-[12px] font-semibold" style={{ color: '#B45309' }}>
                    ⚠ Expires in {daysToExpiry} days · Super Admin receives a reminder 7 days before expiry. <strong>An expired rate card blocks new purchases until a successor is published.</strong>
                  </p>
                </div>
              )}

              {active.status === 'archived' && (
                <div className="rounded-lg border p-3" style={{ backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' }} data-archived-note>
                  <p className="text-[12px] font-semibold text-slate-700">🔒 Archived — read-only · This version governed transactions in its effective window. Its rates remain citable on historical invoices and cannot be edited.</p>
                </div>
              )}

              {active.isDisruptionRateCard && (
                <p className="rounded-md p-3 text-[12px]" style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }} data-disruption-note>
                  This is the AURORA Disruption Rate Card (PRD §10.2) — the platform default. Super Admin may replace it with a custom rate card. The Disruption Rate Card represents market disruption pricing versus standard consultancy rates.
                </p>
              )}

              <div className="overflow-hidden rounded-lg border border-slate-200" data-rates-table>
                <table className="w-full text-[13px]">
                  <thead style={{ backgroundColor: '#F8FAFC' }}>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                      <th className="px-4 py-2">Module</th>
                      <th className="px-4 py-2">Service</th>
                      <th className="px-4 py-2">Unit</th>
                      <th className="px-4 py-2 text-right">Rate ({active.currency})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.rates.map((r, i) => (
                      <tr key={i} className="border-t border-slate-200" data-rate-row={i}>
                        <td className="px-4 py-3 font-semibold text-slate-900">{r.module}</td>
                        <td className="px-4 py-3 text-slate-700">{r.serviceType}</td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{r.unit}</td>
                        <td className="px-4 py-3 text-right font-mono text-slate-800">{formatMoney(r.rate, active.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-slate-200 p-2 font-mono text-[11px] text-slate-500" data-rate-count>
                  {active.rates.length} rate lines · {active.currency} · exclusive of sales tax
                </p>
              </div>
            </section>
          )}
        </div>

        {/* New rate card drawer */}
        {drawerOpen && (
          <div className="rounded-lg border border-slate-200 bg-white p-5" data-new-drawer>
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">New rate card</p>
              <button type="button" onClick={() => setDrawerOpen(false)} className="text-[12px] font-semibold text-slate-500 hover:underline">Close</button>
            </div>
            <label className="mt-3 flex flex-col gap-1">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Effective from (must be today or later)</span>
              <input type="date" value={effFrom} onChange={(e) => setEffFrom(e.currentTarget.value)}
                data-new-effective
                className="h-9 w-fit rounded-md border border-slate-300 px-3 text-[13px]" />
              {backdatingError && <p className="text-[11px] font-semibold" style={{ color: '#B0200D' }} data-backdating-error>{backdatingError}</p>}
            </label>
          </div>
        )}
      </div>
    </div>
  )
}
