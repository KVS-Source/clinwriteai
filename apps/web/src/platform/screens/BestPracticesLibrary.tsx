import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { BestPractice, ModuleKey } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

type TabKey = 'all' | 'A' | 'B' | 'C' | 'D' | 'E' | 'platform'

const TAB_META: { key: TabKey; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'A',        label: 'Module A' },
  { key: 'B',        label: 'Module B' },
  { key: 'C',        label: 'Module C' },
  { key: 'D',        label: 'Module D' },
  { key: 'E',        label: 'Module E' },
  { key: 'platform', label: 'Platform-Wide' },
]

const MODULE_LABEL: Record<TabKey, string> = {
  all:      'All disciplines',
  A:        'Clinical Writing',
  B:        'Scientific Writing',
  C:        'Medical Writing',
  D:        'Regulatory Writing',
  E:        'Ideation & Publishing',
  platform: 'Platform',
}

// [Module]-[Category]-[Version]-[Date] naming convention
const NAMING_REGEX = /^(Module-[A-E]|Platform)-[A-Za-z0-9]+-v\d+(\.\d+)?-\d{4}(-\d{2})?$/

function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function BestPracticesLibrary() {
  const currentUser = usePlatformStore(s => s.currentUser)
  const canAuthor   = currentUser.role === 'super-admin'
  const qc = useQueryClient()

  const { data: items = [] } = useQuery<BestPractice[]>({
    queryKey: ['best-practices'],
    queryFn:  () => platformApi.listBestPractices(),
  })

  const [tab, setTab]       = useState<TabKey>('D')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [name,     setName]     = useState('')
  const [module_,  setModule]   = useState<ModuleKey>('D')
  const [category, setCategory] = useState('')
  const [guidance, setGuidance] = useState('')
  const [effFrom,  setEffFrom]  = useState('')
  const [validUntil, setValidUntil] = useState('')

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { all: items.length, A: 0, B: 0, C: 0, D: 0, E: 0, platform: 0 }
    items.forEach(i => {
      if (i.module === 'A' || i.module === 'B' || i.module === 'C' || i.module === 'D' || i.module === 'E') c[i.module]++
      else if (i.module === 'platform') c.platform++
    })
    return c
  }, [items])

  const filtered = useMemo(() => {
    if (tab === 'all') return items
    return items.filter(i => i.module === tab)
  }, [items, tab])

  const reviewDueCount = items.filter(i => i.reviewDue).length

  const nameValid = NAMING_REGEX.test(name)
  const canPublish = nameValid && !!category && !!guidance && !!effFrom && !!validUntil

  const publish = async () => {
    if (!canPublish) return
    await platformApi.createBestPractice({
      name, module: module_, category, guidance,
      effectiveFrom: effFrom, validUntil, version: 'v1.0',
      createdBy: currentUser.id, updatedAt: new Date().toISOString(),
    } as Partial<BestPractice>).catch(() => {})
    await qc.invalidateQueries({ queryKey: ['best-practices'] })
    setName(''); setCategory(''); setGuidance(''); setEffFrom(''); setValidUntil('')
    setDrawerOpen(false)
  }

  const heading = tab === 'all'
    ? `All best practices · ${filtered.length} items`
    : tab === 'platform'
      ? `Platform-wide best practices · ${filtered.length} items`
      : `Module ${tab} · ${MODULE_LABEL[tab]} Best Practices · ${filtered.length} items`

  return (
    <div className="bg-slate-50" data-screen="best-practices-library">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Platform</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Best Practices Library</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Best Practices Library</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>
              {currentUser.name} · {canAuthor ? 'Super Admin' : 'Read-only'}
            </p>
          </div>
          {canAuthor && (
            <button
              type="button" onClick={() => setDrawerOpen(true)}
              data-new-bp
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >+ New best practice →</button>
          )}
        </div>

        {/* Naming convention note — always visible per brief §22 */}
        <p
          className="rounded-md p-3 text-[12px]"
          style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
          data-naming-convention
        >
          Best practice items must follow the naming convention <code>[Module]-[Category]-[Version]-[Date]</code> — for example <code>Module-D-CTD-Authoring-v1.2-2026-01</code>
        </p>

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200" data-module-tabs>
          {TAB_META.map(t => {
            const active = tab === t.key
            return (
              <button
                key={t.key} type="button" onClick={() => setTab(t.key)}
                data-tab={t.key} data-active={active || undefined}
                className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold"
                style={{
                  color: active ? PLATFORM_ACCENT.primary : '#64748B',
                  borderBottom: active ? `2px solid ${PLATFORM_ACCENT.primary}` : '2px solid transparent',
                }}
              >
                {t.label}
                <span className="inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-mono font-semibold"
                  style={{ backgroundColor: active ? PLATFORM_ACCENT.primary : '#F1F5F9', color: active ? '#FFFFFF' : '#475569' }}
                  data-tab-count={t.key}
                >{counts[t.key]}</span>
              </button>
            )
          })}
        </div>

        {reviewDueCount > 0 && (
          <p
            className="inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}
            data-review-due-chip
          >⚠ {reviewDueCount} item{reviewDueCount === 1 ? '' : 's'} due for quarterly review</p>
        )}

        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500" data-heading>{heading}</p>

        <div className="grid gap-4" style={{ gridTemplateColumns: drawerOpen ? '1fr 360px' : '1fr' }}>

          <section className="flex flex-col gap-3" data-bp-cards>
            {filtered.length === 0 && <p className="text-[13px] text-slate-500">No best practices in this discipline yet.</p>}
            {filtered.map(bp => {
              const reviewDue = !!bp.reviewDue
              return (
                <article
                  key={bp.id}
                  className="rounded-lg border bg-white p-5"
                  style={{
                    borderColor: reviewDue ? '#FDE68A' : '#E2E8F0',
                    borderLeftWidth: reviewDue ? 4 : 1,
                    borderLeftColor: reviewDue ? '#D97706' : '#E2E8F0',
                  }}
                  data-bp-card={bp.id}
                  data-review-due={reviewDue || undefined}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{bp.category} · {bp.version}</p>
                      <p className="mt-1 text-[15px] font-bold text-slate-900">{bp.name}</p>
                    </div>
                    {reviewDue && (
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                        style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}
                        data-review-due-badge
                      >⚠ Review due · quarterly refresh</span>
                    )}
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-slate-500">Effective {formatDay(bp.effectiveFrom)} → Valid until {formatDay(bp.validUntil)}</p>
                  <p className="mt-3 text-[13px] text-slate-700">{bp.guidance}</p>
                  <p className="mt-3 font-mono text-[11px] text-slate-500">
                    Applicable doc types: {bp.applicableDocTypes.join(', ')}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    Framework references: {bp.frameworkRefs.join(', ')}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-400">Last updated {formatDay(bp.updatedAt)}</p>
                  {reviewDue && bp.reviewDueNote && (
                    <p className="mt-2 font-mono text-[11px]" style={{ color: '#B45309' }} data-review-due-note>{bp.reviewDueNote}</p>
                  )}
                </article>
              )
            })}
          </section>

          {drawerOpen && canAuthor && (
            <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-new-bp-drawer>
              <div className="flex items-start justify-between">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">New best practice</p>
                <button type="button" onClick={() => setDrawerOpen(false)} className="text-[12px] font-semibold text-slate-500 hover:underline">Close</button>
              </div>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Name (follows convention)</span>
                <input type="text" value={name} onChange={(e) => setName(e.currentTarget.value)}
                  placeholder="Module-D-Category-v1.0-2026-09"
                  data-input-name
                  className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
                {name && !nameValid && (
                  <p className="text-[11px] font-semibold" style={{ color: '#B45309' }} data-name-invalid>
                    Name must match [Module]-[Category]-[Version]-[Date] convention (e.g. Module-D-CTD-Authoring-v1.2-2026-01).
                  </p>
                )}
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Discipline</span>
                <select value={module_} onChange={(e) => setModule(e.currentTarget.value as ModuleKey)}
                  data-input-module
                  className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
                  {(['A','B','C','D','E','platform'] as ModuleKey[]).map(m => <option key={m} value={m}>{MODULE_LABEL[m as TabKey]}</option>)}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Category</span>
                <input type="text" value={category} onChange={(e) => setCategory(e.currentTarget.value)}
                  data-input-category
                  className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Guidance</span>
                <textarea rows={4} value={guidance} onChange={(e) => setGuidance(e.currentTarget.value)}
                  data-input-guidance
                  className="rounded-md border border-slate-300 p-2 text-[12px]" />
              </label>

              <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Effective from</span>
                  <input type="date" value={effFrom} onChange={(e) => setEffFrom(e.currentTarget.value)}
                    data-input-effective
                    className="h-9 rounded-md border border-slate-300 px-3 text-[12px]" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Valid until</span>
                  <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.currentTarget.value)}
                    data-input-valid-until
                    className="h-9 rounded-md border border-slate-300 px-3 text-[12px]" />
                </label>
              </div>

              <button
                type="button" onClick={publish} disabled={!canPublish}
                data-publish-bp
                className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: PLATFORM_ACCENT.primary }}
              >Publish best practice →</button>

              <p className="font-mono text-[11px] text-slate-500" data-publish-note>
                Published items are visible to every client account immediately. Superseding an item preserves the previous version in the audit trail.
              </p>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
