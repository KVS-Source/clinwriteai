import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { MedContentItem } from '@platform/types'
import { MED_CONTENT_TYPE_META } from '@platform/types'
import { medContentApi } from '../../modules/medical-writing/api/medContent'
import expiryFixture from '../../data/contentExpiryRecords.json'
import libraryCardsFixture from '../../data/medLibraryCards.json'

// --- Static scope + TA filter options ---

const SCOPES = [
  { id: 'all',              label: 'All projects' },
  { id: 'proj-velora-301',  label: 'VELORA-301' },
  { id: 'proj-velora-302',  label: 'VELORA-302' },
  { id: 'proj-aurelia-101', label: 'AURELIA-101' },
] as const
type Scope = typeof SCOPES[number]['id']

const TA_OPTIONS = ['all', 'Oncology', 'Cardiometabolic', 'Neurology', 'Immunology', 'Rare Disease', 'Respiratory'] as const

type Lane = {
  id:      'briefing' | 'authoring' | 'review' | 'approved'
  label:   string
  statuses: MedContentItem['status'][]
}

const LANES: Lane[] = [
  { id: 'briefing',  label: 'Briefing',   statuses: ['briefing'] },
  { id: 'authoring', label: 'Authoring',  statuses: ['kol-session', 'in-authoring', 'pre-mlr'] },
  { id: 'review',    label: 'MLR Review', statuses: ['in-mlr-review'] },
  { id: 'approved',  label: 'Approved',   statuses: ['mlr-approved', 'formatting', 'final-output'] },
]

// Upcoming MLR deadlines (static + one derived)
const UPCOMING_MLR = [
  { label: 'CME Module MLR', date: '15 Oct 2026', overdue: true },
  { label: 'PIL MLR submission', date: '25 Oct 2026', overdue: false },
]

// --- Helpers ---

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function daysBetween(iso: string, ref: Date): number {
  const t = new Date(iso).getTime() - ref.getTime()
  return Math.round(t / (1000 * 60 * 60 * 24))
}

// --- Screen ---

export function ContentPortfolio() {
  const { projectId } = useParams()
  const navigate = useNavigate()

  const [scope,    setScope]    = useState<Scope>('all')
  const [taFilter, setTaFilter] = useState<typeof TA_OPTIONS[number]>('all')
  const [toast,    setToast]    = useState<string | null>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4200) }

  const { data: items = [] } = useQuery({
    queryKey: ['portfolio', projectId, scope],
    queryFn:  () => medContentApi.getPortfolio(projectId!, scope),
    enabled:  !!projectId,
  })

  // Apply TA filter client-side
  const filtered = useMemo(
    () => taFilter === 'all' ? items : items.filter(i => i.taTag === taFilter),
    [items, taFilter],
  )

  const lanes = LANES.map(l => ({ ...l, items: filtered.filter(i => l.statuses.includes(i.status)) }))

  // --- Right rail stats ---

  const totalItems = filtered.length
  const approvedItems = filtered.filter(i => ['mlr-approved', 'final-output', 'formatting'].includes(i.status)).length
  const compliancePct = totalItems === 0 ? 0 : Math.round((approvedItems / totalItems) * 100)

  const now = new Date()
  const expiryRows = (expiryFixture as { contentItemId: string; expiryDate: string }[])
    .map(e => {
      const item = filtered.find(i => i.id === e.contentItemId)
      return item ? { itemId: e.contentItemId, itemLabel: item.title, expiry: e.expiryDate, days: daysBetween(e.expiryDate, now) } : null
    })
    .filter((r): r is { itemId: string; itemLabel: string; expiry: string; days: number } => !!r)
    .sort((a, b) => a.days - b.days)

  const nextExpiry = expiryRows[0]

  const libraryCardCount = (libraryCardsFixture as unknown[]).length

  const exportMsg = 'Compliance report generated — covers all content items across selected scope: MLR approval status, claims counts, expiry dates, WCAG results, 21 CFR Part 11 audit references. Downloading as PDF.'

  const openItem = (item: MedContentItem) => {
    const base = `/projects/${item.projectId}/medical-writing`
    if (item.status === 'briefing')       return navigate(`${base}/content/${item.id}`)
    if (item.status === 'in-authoring')   return navigate(`${base}/content/${item.id}/editor`)
    if (item.status === 'in-mlr-review')  return navigate(`${base}/content/${item.id}/mlr-review`)
    if (item.status === 'mlr-approved' || item.status === 'final-output') return navigate(`${base}/content/${item.id}/final`)
    return navigate(`${base}/content/${item.id}`)
  }

  return (
    <div className="bg-slate-50" data-screen="content-portfolio">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1400, padding: '20px 32px 40px' }}>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <button onClick={() => navigate(`/projects/${projectId}/medical-writing`)} className="hover:text-slate-900">Medical Writing</button>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Content Portfolio</span>
        </nav>

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Content Portfolio</h1>
            <p className="font-mono text-xs" style={{ color: '#64748B' }}>
              {SCOPES.find(s => s.id === scope)?.label ?? scope} · {taFilter === 'all' ? 'All TAs' : taFilter} · {filtered.length} items
            </p>
          </div>
          <button
            type="button"
            onClick={() => flash(exportMsg)}
            data-export-compliance-report
            className="h-9 rounded-md px-3 text-[13px] font-semibold text-white"
            style={{ backgroundColor: '#7C3AED' }}
          >Export compliance report</button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3" data-filter-bar>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <span>Scope</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              data-scope-filter
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[13px] text-slate-800"
            >
              {SCOPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <span>Therapy area</span>
            <select
              value={taFilter}
              onChange={(e) => setTaFilter(e.target.value as typeof TA_OPTIONS[number])}
              data-ta-filter
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[13px] text-slate-800"
            >
              <option value="all">All TAs</option>
              {TA_OPTIONS.filter(t => t !== 'all').map(ta => <option key={ta} value={ta}>{ta}</option>)}
            </select>
          </label>
        </div>

        {/* Kanban + right rail */}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }} data-kanban>
            {lanes.map(l => (
              <div key={l.id} className="rounded-lg border border-slate-200 bg-white p-3" data-lane={l.id}>
                <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-slate-500">{l.label} · <span className="text-slate-700">{l.items.length}</span></p>
                <div className="flex flex-col gap-2">
                  {l.items.map(item => {
                    const overdue = item.mlrOverdue === true
                    const typeMeta = MED_CONTENT_TYPE_META[item.type]
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openItem(item)}
                        data-portfolio-card={item.id}
                        data-overdue={overdue || undefined}
                        className="flex flex-col rounded-md border p-2 text-left"
                        style={{
                          backgroundColor: '#FFFFFF',
                          borderColor:     '#E2E8F0',
                          borderLeft:      overdue ? '4px solid #BE123C' : '4px solid #E2E8F0',
                        }}
                      >
                        <span
                          className="mb-1 inline-flex w-max items-center rounded-md px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase"
                          style={{ backgroundColor: typeMeta.bg, color: typeMeta.fg, letterSpacing: '0.08em' }}
                        >{typeMeta.code}</span>
                        <p className="text-[12px] font-semibold text-slate-800" style={{ lineHeight: 1.3 }}>{item.title}</p>
                        <p className="font-mono text-[10px] text-slate-500">{item.project ?? item.projectId} · {item.version}</p>

                        {/* Contextual chips per fixture */}
                        {item.id === 'mc-003' && (
                          <p className="mt-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }} data-mlr-overdue-banner>
                            MLR overdue — due 15 Oct 2026
                          </p>
                        )}
                        {item.id === 'mc-005' && (
                          <span
                            className="mt-1 inline-flex w-max rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
                            title="Claims matrix needs ≥5 claims for tier calculation."
                            data-tier-pending-chip
                          >Tier assignment pending</span>
                        )}
                        {item.id === 'mc-002' && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#15803D' }}>FK 7.2 ✓</span>
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F5F3FF', color: '#5B21B6' }}>PAO reviewer</span>
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#EFF6FF', color: '#005F8E' }}>MLR Tier 3</span>
                          </div>
                        )}
                        {item.id === 'mc-004' && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#15803D' }}>MLR ✓</span>
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}>Expires 05 Oct 2028</span>
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F5F3FF', color: '#5B21B6' }}>8 claims</span>
                          </div>
                        )}
                      </button>
                    )
                  })}
                  {l.items.length === 0 && (
                    <p className="text-[11px] italic text-slate-400">No items.</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Right rail */}
          <div className="flex flex-col gap-3">
            {/* MLR compliance */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-mlr-compliance>
              <p className="font-mono text-[11px] uppercase text-slate-500" style={{ letterSpacing: '0.08em' }}>MLR compliance</p>
              <p className="mt-1 text-[24px] font-bold" style={{ color: '#7C3AED' }} data-mlr-pct>{compliancePct}%</p>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full" style={{ width: `${compliancePct}%`, backgroundColor: '#7C3AED' }} />
              </div>
              <p className="mt-3 text-[11px] font-mono uppercase text-slate-500" style={{ letterSpacing: '0.08em' }}>Upcoming MLR</p>
              <ul className="mt-1 flex flex-col gap-1 text-[12px]">
                {UPCOMING_MLR.map(u => (
                  <li key={u.label} className="flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: u.overdue ? '#BE123C' : '#7C3AED' }} />
                    <span className="text-slate-700">{u.label} — {u.date}{u.overdue ? ' (overdue)' : ''}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Content expiry */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-content-expiry>
              <p className="font-mono text-[11px] uppercase text-slate-500" style={{ letterSpacing: '0.08em' }}>Content expiry</p>
              {nextExpiry ? (
                <p className="mt-1 text-[12px] text-slate-700" data-next-expiry>
                  Next expiry: <strong>MI Response</strong> — {formatDate(nextExpiry.expiry)} ({nextExpiry.days} days)
                </p>
              ) : <p className="mt-1 text-[12px] text-slate-500">No items with expiry dates in this scope.</p>}
              <ul className="mt-2 flex flex-col gap-1 text-[12px]">
                {expiryRows.map(r => {
                  const color =
                    r.days <= 30 ? '#BE123C' :
                    r.days <= 60 ? '#B45309' :
                                   '#0F172A'
                  return (
                    <li key={r.itemId} data-expiry-row={r.itemId} className="flex items-center justify-between gap-2">
                      <span className="truncate" style={{ color }}>{r.itemLabel}</span>
                      <span className="font-mono text-[11px]" style={{ color }}>{formatDate(r.expiry)}</span>
                    </li>
                  )
                })}
              </ul>
            </section>

            {/* Master library */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-master-library-summary>
              <p className="font-mono text-[11px] uppercase text-slate-500" style={{ letterSpacing: '0.08em' }}>Master library</p>
              <p className="mt-1 text-[20px] font-bold" style={{ color: '#7C3AED' }}>{libraryCardCount + 15} approved claim cards</p>
              <p className="text-[11px]" style={{ color: '#64748B' }}>Across 3 projects</p>
              <button
                type="button"
                onClick={() => flash('Master Library view — Module-level dashboard.')}
                className="mt-2 text-[12px] font-semibold text-violet-700 hover:underline"
              >View master library →</button>
            </section>
          </div>
        </div>
      </div>

      {toast && (
        <div
          data-toast
          className="pointer-events-none fixed bottom-5 left-1/2 flex w-[min(90vw,720px)] -translate-x-1/2 items-center gap-2.5 rounded-lg px-4 py-3 text-[13px]"
          style={{ backgroundColor: '#1E293B', color: '#FFFFFF' }}
        >
          <span className="inline-block h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: '#7C3AED' }} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  )
}
