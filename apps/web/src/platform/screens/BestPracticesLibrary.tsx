import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { BestPractice, ModuleKey } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'
import { isPlatformAdmin } from '../../config/roles'

type TabKey = 'all' | 'A' | 'B' | 'C' | 'D' | 'E' | 'platform'

const TAB_META: { key: TabKey; labelKey: string }[] = [
  { key: 'all',      labelKey: 'page.best_practices_library.tab_all' },
  { key: 'A',        labelKey: 'page.best_practices_library.tab_a' },
  { key: 'B',        labelKey: 'page.best_practices_library.tab_b' },
  { key: 'C',        labelKey: 'page.best_practices_library.tab_c' },
  { key: 'D',        labelKey: 'page.best_practices_library.tab_d' },
  { key: 'E',        labelKey: 'page.best_practices_library.tab_e' },
  { key: 'platform', labelKey: 'page.best_practices_library.tab_platform' },
]

const MODULE_LABEL_KEYS: Record<TabKey, string> = {
  all:      'page.best_practices_library.module_all',
  A:        'page.best_practices_library.module_a',
  B:        'page.best_practices_library.module_b',
  C:        'page.best_practices_library.module_c',
  D:        'page.best_practices_library.module_d',
  E:        'page.best_practices_library.module_e',
  platform: 'page.best_practices_library.module_platform',
}

// [Module]-[Category]-[Version]-[Date] naming convention (FR-PM-016).
// Category may be multi-part (`CTD-Authoring`, `MHRA-OQ-D-008`); month, when present, is 01–12.
const FIELD_CLS = 'rounded-md border border-slate-300 bg-white px-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200'

const NAMING_REGEX = /^(Module-([A-E])|Platform)-([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)-v(\d+(?:\.\d+)?)-(\d{4})(?:-(0[1-9]|1[0-2]))?$/

function parseName(name: string): { module: ModuleKey; version: string } | null {
  const m = NAMING_REGEX.exec(name)
  if (!m) return null
  return { module: (m[2] as ModuleKey | undefined) ?? 'platform', version: `v${m[4]}` }
}

function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function BestPracticesLibrary() {
  const { t } = useTranslation()
  const currentUser = usePlatformStore(s => s.currentUser)
  const canAuthor   = isPlatformAdmin(currentUser)
  const qc = useQueryClient()

  const { data: items = [], isLoading, isError, refetch } = useQuery<BestPractice[]>({
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
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)

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

  const parsedName = parseName(name)
  const nameValid = parsedName !== null
  // The [Module] part of the name must be the discipline the item is filed under.
  const moduleMatches = parsedName !== null && parsedName.module === module_
  // Both are yyyy-mm-dd from <input type="date">, so string order is date order.
  const datesInOrder = !effFrom || !validUntil || validUntil >= effFrom
  const canPublish = nameValid && moduleMatches && !!category.trim() && !!guidance.trim() && !!effFrom && !!validUntil && datesInOrder

  const publish = async () => {
    if (!canPublish || publishing) return
    setPublishError(null)
    setPublishing(true)
    try {
      await platformApi.createBestPractice({
        name, module: module_, category: category.trim(), guidance: guidance.trim(),
        effectiveFrom: effFrom, validUntil, version: parsedName!.version,
        createdBy: currentUser.id, updatedAt: new Date().toISOString(),
      } as Partial<BestPractice>)
    } catch {
      // Keep the drawer open and the form filled in so nothing typed is lost.
      setPublishError(t('page.best_practices_library.publish_error'))
      return
    } finally {
      setPublishing(false)
    }
    await qc.invalidateQueries({ queryKey: ['best-practices'] })
    setName(''); setCategory(''); setGuidance(''); setEffFrom(''); setValidUntil('')
    setDrawerOpen(false)
  }

  const heading = tab === 'all'
    ? t('page.best_practices_library.heading_all', { count: filtered.length })
    : tab === 'platform'
      ? t('page.best_practices_library.heading_platform', { count: filtered.length })
      : t('page.best_practices_library.heading_module', { module: t(MODULE_LABEL_KEYS[tab]), count: filtered.length })

  return (
    <div className="bg-slate-50" data-screen="best-practices-library">
      <div className="flex flex-col gap-4 px-4 pb-12 pt-5 sm:px-8" style={{ maxWidth: 1440 }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.best_practices_library.crumb_platform')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.best_practices_library.crumb_best_practices')}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.best_practices_library.title')}</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>
              {t('page.best_practices_library.user_byline', { name: currentUser.name, role: canAuthor ? t('page.best_practices_library.role_super_admin') : t('page.best_practices_library.role_read_only') })}
            </p>
          </div>
          {canAuthor && (
            <button
              type="button" onClick={() => setDrawerOpen(true)}
              data-new-bp
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >{t('page.best_practices_library.new_bp')}</button>
          )}
        </div>

        {/* Naming convention note — always visible per brief §22 */}
        <p
          className="rounded-md p-3 text-[12px]"
          style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
          data-naming-convention
        >
          {t('page.best_practices_library.naming_convention_prefix')} <code>[Module]-[Category]-[Version]-[Date]</code> {t('page.best_practices_library.naming_convention_example_prefix')} <code>Module-D-CTD-Authoring-v1.2-2026-01</code>
        </p>

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200" role="tablist" aria-label={t('page.best_practices_library.tablist_label')} data-module-tabs>
          {TAB_META.map(ty => {
            const active = tab === ty.key
            return (
              <button
                key={ty.key} type="button" role="tab" aria-selected={active} onClick={() => setTab(ty.key)}
                data-tab={ty.key} data-active={active || undefined}
                className="flex items-center gap-2 px-3 py-2 text-[13px] font-semibold"
                style={{
                  color: active ? PLATFORM_ACCENT.primary : '#64748B',
                  borderBottom: active ? `2px solid ${PLATFORM_ACCENT.primary}` : '2px solid transparent',
                }}
              >
                {t(ty.labelKey)}
                <span className="inline-flex h-5 items-center rounded-full px-1.5 text-[10px] font-mono font-semibold"
                  style={{ backgroundColor: active ? PLATFORM_ACCENT.primary : '#F1F5F9', color: active ? '#FFFFFF' : '#475569' }}
                  data-tab-count={ty.key}
                >{counts[ty.key]}<span className="sr-only"> {counts[ty.key] === 1 ? t('page.best_practices_library.item_singular') : t('page.best_practices_library.item_plural')}</span></span>
              </button>
            )
          })}
        </div>

        {reviewDueCount > 0 && (
          <p
            className="inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}
            data-review-due-chip
          >{t('page.best_practices_library.review_due_count', { count: reviewDueCount })}</p>
        )}

        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500" data-heading>{heading}</p>

        <div className={`grid gap-4 ${drawerOpen ? 'grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-1'}`}>

          <section className="flex min-w-0 flex-col gap-3" role="tabpanel" aria-label={t(MODULE_LABEL_KEYS[tab])} data-bp-cards>
            {isLoading && <p className="text-[13px] text-slate-500" data-state="loading">{t('page.best_practices_library.loading')}</p>}
            {isError && (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800" role="alert" data-state="error">
                {t('page.best_practices_library.load_error')}{' '}
                <button type="button" onClick={() => refetch()} className="font-semibold underline">{t('page.best_practices_library.retry')}</button>
              </p>
            )}
            {!isLoading && !isError && filtered.length === 0 && (
              <p className="text-[13px] text-slate-500" data-state="empty">
                {tab === 'all' ? t('page.best_practices_library.empty_all') : t('page.best_practices_library.empty_module', { module: t(MODULE_LABEL_KEYS[tab]) })}
              </p>
            )}
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
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500 [overflow-wrap:anywhere]">{bp.category} · {bp.version}</p>
                      <p className="mt-1 text-[15px] font-bold text-slate-900 [overflow-wrap:anywhere]">{bp.name}</p>
                    </div>
                    {reviewDue && (
                      <span
                        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                        style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}
                        data-review-due-badge
                      >{t('page.best_practices_library.review_due_badge')}</span>
                    )}
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-slate-500">
                    {t('page.best_practices_library.effective_prefix', { date: formatDay(bp.effectiveFrom) })} → {bp.validUntil ? t('page.best_practices_library.valid_until', { date: formatDay(bp.validUntil) }) : t('page.best_practices_library.no_end_date')}
                  </p>
                  <p className="mt-3 text-[13px] text-slate-700 [overflow-wrap:anywhere]">{bp.guidance}</p>
                  {(bp.applicableDocTypes?.length ?? 0) > 0 && (
                    <p className="mt-3 font-mono text-[11px] text-slate-500">
                      {t('page.best_practices_library.applicable_doc_types')} {bp.applicableDocTypes.join(', ')}
                    </p>
                  )}
                  {(bp.frameworkRefs?.length ?? 0) > 0 && (
                    <p className="mt-1 font-mono text-[11px] text-slate-500">
                      {t('page.best_practices_library.framework_references')} {bp.frameworkRefs.join(', ')}
                    </p>
                  )}
                  <p className="mt-1 font-mono text-[11px] text-slate-500">{t('page.best_practices_library.last_updated', { date: formatDay(bp.updatedAt) })}</p>
                  {reviewDue && bp.reviewDueNote && (
                    <p className="mt-2 text-[12px] text-slate-600" data-review-due-note>{bp.reviewDueNote}</p>
                  )}
                </article>
              )
            })}
          </section>

          {drawerOpen && canAuthor && (
            <aside aria-label={t('page.best_practices_library.drawer_aria')} className="flex min-w-0 flex-col gap-3 self-start rounded-lg border border-slate-200 bg-white p-4 sm:p-5" data-new-bp-drawer>
              <div className="flex items-start justify-between">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.best_practices_library.drawer_eyebrow')}</p>
                <button type="button" onClick={() => setDrawerOpen(false)} aria-label={t('page.best_practices_library.close_drawer_aria')}
                  className="h-7 rounded-md border border-slate-300 bg-white px-2.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">{t('page.best_practices_library.close_button')}</button>
              </div>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.best_practices_library.field_name')}</span>
                <input type="text" value={name} onChange={(e) => setName(e.currentTarget.value)}
                  placeholder="Module-D-Category-v1.0-2026-09"
                  data-input-name
                  className={`h-9 ${FIELD_CLS}`} />
                {name && !nameValid && (
                  <p className="text-[11px] font-semibold text-red-700" role="alert" data-name-invalid>
                    {t('page.best_practices_library.name_invalid')}
                  </p>
                )}
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.best_practices_library.field_discipline')}</span>
                <select value={module_} onChange={(e) => setModule(e.currentTarget.value as ModuleKey)}
                  data-input-module
                  className={`h-9 ${FIELD_CLS}`}>
                  {(['A','B','C','D','E','platform'] as ModuleKey[]).map(m => <option key={m} value={m}>{t(MODULE_LABEL_KEYS[m as TabKey])}</option>)}
                </select>
                {nameValid && !moduleMatches && (
                  <p className="text-[11px] font-semibold text-red-700" role="alert" data-module-mismatch>
                    {t('page.best_practices_library.module_mismatch', { prefix: name.startsWith('Platform') ? 'Platform' : name.slice(0, 8), discipline: t(MODULE_LABEL_KEYS[module_ as TabKey]) })}
                  </p>
                )}
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.best_practices_library.field_category')}</span>
                <input type="text" value={category} onChange={(e) => setCategory(e.currentTarget.value)}
                  data-input-category
                  className={`h-9 ${FIELD_CLS}`} />
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.best_practices_library.field_guidance')}</span>
                <textarea rows={4} value={guidance} onChange={(e) => setGuidance(e.currentTarget.value)}
                  data-input-guidance
                  className={`resize-y py-2 ${FIELD_CLS}`} />
              </label>

              <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.best_practices_library.field_effective_from')}</span>
                  <input type="date" value={effFrom} onChange={(e) => setEffFrom(e.currentTarget.value)}
                    data-input-effective
                    className={`h-9 ${FIELD_CLS}`} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.best_practices_library.field_valid_until')}</span>
                  <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.currentTarget.value)}
                    min={effFrom || undefined}
                    data-input-valid-until
                    className={`h-9 ${FIELD_CLS}`} />
                </label>
              </div>
              {!datesInOrder && (
                <p className="text-[11px] font-semibold text-red-700" role="alert" data-dates-invalid>
                  {t('page.best_practices_library.dates_invalid')}
                </p>
              )}

              <button
                type="button" onClick={publish} disabled={!canPublish || publishing}
                data-publish-bp
                className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: PLATFORM_ACCENT.primary }}
              >{publishing ? t('page.best_practices_library.publishing') : t('page.best_practices_library.publish')}</button>

              {publishError && (
                <p className="text-[11px] font-semibold text-red-700" role="alert" data-publish-error>{publishError}</p>
              )}

              <p className="font-mono text-[11px] text-slate-500" data-publish-note>
                {t('page.best_practices_library.publish_note')}
              </p>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
