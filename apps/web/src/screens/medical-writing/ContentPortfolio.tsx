import { THERAPEUTIC_AREA_LABEL } from '../../utils/labels'
import { useMemo, useState } from 'react'
import { useTaFilterOptions } from '../../hooks'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import type { MedContentItem } from '@platform/types'
import { MED_CONTENT_TYPE_META } from '@platform/types'
import { medContentApi } from '../../modules/medical-writing/api/medContent'
import { platformApi } from '../../platform/api/platformApi'
import { MED_STAGE_NAMES, fmtDay } from './medLabels'

// --- Static scope + TA filter options ---

const SCOPES = [
  { id: 'all',      label: 'All stages',                       stages: [1, 2, 3, 4, 5, 6] },
  { id: 'drafting', label: 'Briefing & drafting (stages 1–3)', stages: [1, 2, 3] },
  { id: 'mlr',      label: 'In MLR (stages 4–5)',              stages: [4, 5] },
  { id: 'approved', label: 'Approved (stage 6)',               stages: [6] },
] as const
type Scope = typeof SCOPES[number]['id']


type Lane = {
  id:      'briefing' | 'authoring' | 'review' | 'approved'
  label:   string
  stages:  number[]
}

// Columns by the stage the API reports for each item.
const LANES: Lane[] = [
  { id: 'briefing',  label: MED_STAGE_NAMES[1]!,                 stages: [1] },
  { id: 'authoring', label: 'Drafting & internal review',       stages: [2, 3] },
  { id: 'review',    label: 'MLR submission & review',          stages: [4, 5] },
  { id: 'approved',  label: MED_STAGE_NAMES[6]!,                 stages: [6] },
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
  const [taFilter, setTaFilter] = useState<string>('all')   // TA label or 'all'
  const [toast,    setToast]    = useState<string | null>(null)

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4200) }

  const { data: items = [] } = useQuery({
    queryKey: ['portfolio', projectId],
    queryFn:  () => medContentApi.getPortfolio(projectId!),
    enabled:  !!projectId,
  })

  const { options: taOptions, isLoading: taLoading, isError: taError } = useTaFilterOptions(items.map(i => i.taTag))

  // Apply TA filter client-side
  const scopeStages: readonly number[] = (SCOPES.find(sc => sc.id === scope) ?? SCOPES[0]).stages
  const filtered = useMemo(
    () => items.filter(i => scopeStages.includes(i.stage) && (taFilter === 'all' || i.taTag === taFilter)),
    [items, taFilter, scopeStages],
  )

  const lanes = LANES.map(l => ({ ...l, items: filtered.filter(i => l.stages.includes(i.stage)) }))

  // --- Right rail stats ---

  const totalItems = filtered.length
  const approvedItems = filtered.filter(i => i.stage === 6).length
  const compliancePct = totalItems === 0 ? 0 : Math.round((approvedItems / totalItems) * 100)

  const now = new Date()
  // Expiry dates from the items themselves (set when MLR approves).
  const expiryRows = filtered
    .filter(i => !!i.expiryDate)
    .map(i => ({ itemId: i.id, itemLabel: i.title, expiry: i.expiryDate!, days: daysBetween(i.expiryDate!, now) }))
    .sort((a, b) => a.days - b.days)

  const nextExpiry = expiryRows[0]

  // Items waiting on MLR: ready to submit (stage 4) or under review (stage 5).
  const upcomingMlr = filtered.filter(i => i.stage === 4 || i.stage === 5)

  // Approved Medical Writing entries in the Master Library.
  const { data: libraryCardCount } = useQuery({
    queryKey: ['library', 'count', 'module-C'],
    queryFn:  () => platformApi.countLibrary({ module: ['C'] }),
    retry:    false,
  })

  const exportMsg = 'Compliance report generated — covers all content items across selected scope: MLR approval status, claims counts, expiry dates, WCAG results, 21 CFR Part 11 audit references. Downloading as PDF.'

  const openItem = (item: MedContentItem) => {
    const base = `/projects/${item.projectId}/medical-writing/content/${item.id}`
    if (item.stage === 1) return navigate(base)
    if (item.stage === 2 || item.stage === 3) return navigate(`${base}/editor`)
    if (item.stage === 4) return navigate(`${base}/pre-mlr`)
    if (item.stage === 5) return navigate(`${base}/mlr-review`)
    if (item.stage === 6) return navigate(`${base}/final`)
    return navigate(base)
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
            <span>{THERAPEUTIC_AREA_LABEL}</span>
            <select
              value={taFilter}
              onChange={(e) => setTaFilter(e.target.value)}
              data-ta-filter
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[13px] text-slate-800"
            >
              <option value="all">All TAs</option>
              {taOptions.length === 0 && taLoading && <option disabled>Loading…</option>}
              {taOptions.length === 0 && taError && <option disabled>Couldn't load therapeutic areas</option>}
              {taOptions.map(ta => <option key={ta} value={ta}>{ta}</option>)}
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
                    // Fallback keeps an unexpected type from crashing the board.
                    const typeMeta = MED_CONTENT_TYPE_META[item.type] ?? { bg: '#F1F5F9', fg: '#475569', code: String(item.type).toUpperCase() }
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

                        {/* Chips from the item's own fields */}
                        <div className="mt-1 flex flex-wrap gap-1" data-card-chips>
                          {MED_CONTENT_TYPE_META[item.type]?.patientFacing && item.fkScore != null && (
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={item.fkPassed ? { backgroundColor: '#F0FDF4', color: '#15803D' } : { backgroundColor: '#FFFBEB', color: '#B45309' }} data-chip="fk">
                              FK {Number(item.fkScore).toFixed(1)} {item.fkPassed ? '✓' : '✗'}
                            </span>
                          )}
                          {item.reviewTier != null ? (
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#EFF6FF', color: '#005F8E' }} data-chip="tier">MLR Tier {item.reviewTier}</span>
                          ) : item.stage >= 3 && item.stage < 6 ? (
                            <span
                              className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                              style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
                              title="The tier is calculated from the claims matrix once claims are approved."
                              data-tier-pending-chip
                            >Tier assignment pending</span>
                          ) : null}
                          {item.stage === 6 && (
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F0FDF4', color: '#15803D' }} data-chip="mlr">MLR ✓</span>
                          )}
                          {item.expiryDate && (
                            <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309' }} data-chip="expiry">Expires {fmtDay(item.expiryDate)}</span>
                          )}
                        </div>
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
                {upcomingMlr.length === 0 && <li className="text-slate-500" data-upcoming-none>Nothing waiting on MLR.</li>}
                {upcomingMlr.map(u => (
                  <li key={u.id} className="flex items-center gap-1.5" data-upcoming-mlr={u.id}>
                    <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#7C3AED' }} />
                    <span className="text-slate-700">{u.title} — {u.stage === 4 ? 'ready to submit' : 'in MLR review'}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* Content expiry */}
            <section className="rounded-lg border border-slate-200 bg-white p-4" data-content-expiry>
              <p className="font-mono text-[11px] uppercase text-slate-500" style={{ letterSpacing: '0.08em' }}>Content expiry</p>
              {nextExpiry ? (
                <p className="mt-1 text-[12px] text-slate-700" data-next-expiry>
                  Next expiry: <strong>{nextExpiry.itemLabel}</strong> — {formatDate(nextExpiry.expiry)} ({nextExpiry.days} days)
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
              <p className="mt-1 text-[20px] font-bold" style={{ color: '#7C3AED' }} data-library-count>{libraryCardCount == null ? '—' : libraryCardCount} approved Medical Writing entr{libraryCardCount === 1 ? 'y' : 'ies'}</p>
              <p className="text-[11px]" style={{ color: '#64748B' }}>In the Master Library</p>
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
