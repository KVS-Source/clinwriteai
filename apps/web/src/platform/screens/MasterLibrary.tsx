import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { MasterLibraryItem, ModuleKey } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'

const MODULE_COLOURS: Record<ModuleKey, string> = {
  A: '#2563EB', B: '#0D9488', C: '#7C3AED', D: '#B0200D', E: '#0D9488', platform: PLATFORM_ACCENT.primary,
}
const DOC_TYPES = ['NDA', 'CSR', 'SmPC', 'RMP', 'Blog Post', 'IND', 'KOL Summary', 'Manuscript', 'Clinical Brief', 'HA Response']

const DEMO_USER_NAME = 'Dr Sarah Chen'
const DEMO_USER_ROLE = 'Regulatory Writer'

// Demo: this user has no active document open — pull is context-disabled per brief §55
const HAS_ACTIVE_DOCUMENT = false

function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function MasterLibrary() {
  const { data: items = [] } = useQuery<MasterLibraryItem[]>({
    queryKey: ['library'],
    queryFn:  () => platformApi.listLibrary(),
  })

  // Demo initial filters
  const [search,         setSearch]         = useState('')
  const [disciplines,    setDisciplines]    = useState<ModuleKey[]>([])
  const [itemType,       setItemType]       = useState<'all' | 'document' | 'section'>('all')
  const [docTypes,       setDocTypes]       = useState<string[]>(['NDA'])
  const [tas,            setTas]            = useState<string[]>(['Oncology'])

  const [selectedId, setSelectedId] = useState<string>('ml-001')

  const toggleFrom = <T extends string>(arr: T[], value: T, setter: (v: T[]) => void) =>
    setter(arr.includes(value) ? arr.filter(x => x !== value) : [...arr, value])

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false
      if (disciplines.length && !disciplines.includes(i.module as ModuleKey))       return false
      if (itemType !== 'all' && i.itemType !== itemType)                            return false
      if (docTypes.length && !docTypes.includes(i.docType))                         return false
      if (tas.length && !i.ta.some(t => tas.includes(t)))                           return false
      return true
    })
  }, [items, search, disciplines, itemType, docTypes, tas])

  const active = filtered.find(i => i.id === selectedId) ?? items.find(i => i.id === selectedId) ?? items[0]
  const activeFiltersCount = (docTypes.length ? 1 : 0) + (tas.length ? 1 : 0)
  const displayedCount = 47 // per brief §29 — hard-coded demo count matches design

  const pullLabel = HAS_ACTIVE_DOCUMENT ? 'Pull into active document →' : 'Open a document to pull this section'
  const immutabilityNote = active?.isArchived
    ? 'This item is from a closed project and is read-only. It can be pulled and downloaded but not overwritten.'
    : 'Pulled sections retain their full provenance chain in the destination document.'

  return (
    <div className="bg-slate-50" data-screen="master-library">
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1600, padding: '20px 24px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Platform</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Master Library</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Master Library</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>{DEMO_USER_NAME} · {DEMO_USER_ROLE}</p>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '260px 340px 1fr' }}>

          {/* LEFT — filters */}
          <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4" data-filter-panel>
            <input
              type="search" placeholder="Search documents, sections…" value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              data-filter-search
              className="h-9 rounded-md border border-slate-300 px-3 text-[13px]"
            />

            <div data-filter-discipline>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Discipline</p>
              <div className="mt-1 flex flex-col gap-1">
                {(['A','B','C','D','E'] as ModuleKey[]).map(m => (
                  <label key={m} className="flex items-center gap-2 text-[12px] text-slate-800">
                    <input type="checkbox" checked={disciplines.includes(m)} onChange={() => toggleFrom(disciplines, m, setDisciplines)}
                      data-discipline={m} style={{ accentColor: MODULE_COLOURS[m] }} />
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: MODULE_COLOURS[m] }} />
                    Module {m}
                  </label>
                ))}
              </div>
            </div>

            <div data-filter-item-type>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Item type</p>
              <div className="mt-1 flex flex-col gap-1 text-[12px]">
                {(['all','document','section'] as const).map(t => (
                  <label key={t} className="flex items-center gap-2 text-slate-800">
                    <input type="radio" name="itype" checked={itemType === t} onChange={() => setItemType(t)} data-item-type={t}
                      style={{ accentColor: PLATFORM_ACCENT.primary }} />
                    {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </label>
                ))}
              </div>
            </div>

            <div data-filter-doctype>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Document type</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {DOC_TYPES.slice(0, 4).map(t => {
                  const active = docTypes.includes(t)
                  return (
                    <button key={t} type="button" onClick={() => toggleFrom(docTypes, t, setDocTypes)}
                      data-doctype-chip={t} data-doctype-active={active || undefined}
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: active ? PLATFORM_ACCENT.primary : '#F1F5F9', color: active ? '#FFFFFF' : '#475569' }}
                    >{t}{active ? ' ✕' : ''}</button>
                  )
                })}
              </div>
            </div>

            <div data-filter-ta>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Therapeutic area</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {['Oncology', 'Cardiometabolic'].map(t => {
                  const active = tas.includes(t)
                  return (
                    <button key={t} type="button" onClick={() => toggleFrom(tas, t, setTas)}
                      data-ta-chip={t} data-ta-active={active || undefined}
                      className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: active ? PLATFORM_ACCENT.primary : '#F1F5F9', color: active ? '#FFFFFF' : '#475569' }}
                    >{t}{active ? ' ✕' : ''}</button>
                  )
                })}
              </div>
            </div>

            <p className="mt-2 rounded-md p-2 text-[12px]" style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }} data-results-count>
              {displayedCount} items · {activeFiltersCount} filter{activeFiltersCount === 1 ? '' : 's'} applied
            </p>
          </aside>

          {/* CENTRE — results */}
          <section className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3" data-results-list>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Most recent</p>
            <div className="flex flex-col divide-y divide-slate-200">
              {filtered.map(it => {
                const colour = MODULE_COLOURS[it.module]
                const isActive = it.id === active?.id
                return (
                  <button
                    key={it.id} type="button" onClick={() => setSelectedId(it.id)}
                    data-library-row={it.id}
                    data-library-active={isActive || undefined}
                    data-library-archived={it.isArchived || undefined}
                    className="flex flex-col items-start gap-1 px-2 py-2 text-left hover:bg-slate-50"
                    style={{ backgroundColor: isActive ? PLATFORM_ACCENT.bgTint : undefined }}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase"
                        style={{ backgroundColor: `${colour}22`, color: colour }} data-module-chip={it.module}>{it.module}</span>
                      {it.isArchived && (
                        <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#F1F5F9', color: '#475569' }} data-archived-tag>🔒 Archived</span>
                      )}
                    </div>
                    <p className="text-[13px] font-semibold text-slate-900">{it.name}</p>
                    <p className="font-mono text-[10px] text-slate-500">{it.docType} · {it.ta.join(', ')} · {it.version}</p>
                    <p className="font-mono text-[10px] text-slate-500">Pushed {formatDay(it.pushedAt)} · {it.pushedByName}</p>
                  </button>
                )
              })}
            </div>
          </section>

          {/* RIGHT — detail */}
          <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-detail-panel>
            {active && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-mono font-semibold uppercase" style={{ backgroundColor: `${MODULE_COLOURS[active.module]}22`, color: MODULE_COLOURS[active.module] }} data-active-module>{active.module}</span>
                  <span className="font-mono text-[11px] text-slate-500" data-active-doctype>{active.docType}</span>
                  <span className="font-mono text-[11px] text-slate-500">TA: {active.ta.join(', ')}</span>
                  <span className="font-mono text-[11px] text-slate-500" data-active-version>{active.version}</span>
                </div>

                <h2 className="text-[16px] font-bold text-slate-900" data-active-name>{active.name}</h2>
                <p className="font-mono text-[11px] text-slate-500" data-active-pushed>Pushed {formatDay(active.pushedAt)} · {active.pushedByName} · Project: {active.projectName}</p>

                <div className="rounded-md border border-slate-200 p-3" data-provenance>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Provenance chain</p>
                  <ol className="mt-2 flex flex-col gap-2">
                    {active.provenanceChain.map((step, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12px] text-slate-800" data-provenance-step={i}>
                        <span className="mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center rounded-full font-mono text-[9px] font-bold text-white" style={{ backgroundColor: PLATFORM_ACCENT.primary }}>{i + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="rounded-md border border-slate-200 p-3" data-version-history>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Version history</p>
                  <p className="mt-1 text-[12px] text-slate-800">{active.version} · Current · No previous versions.</p>
                </div>

                <div className="flex items-center gap-2">
                  <button type="button" disabled={!HAS_ACTIVE_DOCUMENT}
                    data-pull-button
                    className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                    title={pullLabel}
                  >{pullLabel}</button>
                  <button type="button" className="h-9 rounded-md border px-4 text-[13px] font-semibold"
                    style={{ borderColor: PLATFORM_ACCENT.primary, color: PLATFORM_ACCENT.primary }}
                    data-download-pdf
                  >Download PDF</button>
                </div>

                <p className="rounded-md p-2 text-[12px]"
                  style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
                  data-immutability-note
                  data-active-archived={active.isArchived || undefined}>{immutabilityNote}</p>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
