// TLF Cross-Reference panel — Module A reference tooling (FR-A-028).
//
// Reads the project's current TLF package via GET /documents/:id/tlf and
// renders its Tables / Listings / Figures grouped by type. Items that cite
// the editor's active section are highlighted. Footer shows the package
// version + validator from the API.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { documentsApi } from '../api/documents'

interface Props {
  documentId: string
  /** The sectionId currently open in the editor; used to highlight citing items. */
  activeSectionId?: string | null
  /** Human-readable section label (e.g. "§11.4 Primary efficacy") for the empty-state hint. */
  activeSectionLabel?: string
}

type TlfResponse = Awaited<ReturnType<typeof documentsApi.getTLF>>
type TlfItem = TlfResponse['items'][number]

type Filter = 'all' | 'T' | 'L' | 'F'

const TYPE_LABEL: Record<'T' | 'L' | 'F', string> = {
  T: 'Table',
  L: 'Listing',
  F: 'Figure',
}

const TYPE_COLOUR: Record<'T' | 'L' | 'F', { bg: string; fg: string }> = {
  T: { bg: '#DBEAFE', fg: '#1D4ED8' },  // blue — Tables
  L: { bg: '#DCFCE7', fg: '#15803D' },  // green — Listings
  F: { bg: '#FEF3C7', fg: '#B45309' },  // amber — Figures
}

// Match a sectionRef string (e.g. "§11.4", "§11.4.1", "11.4") against the
// editor's active sectionId (e.g. "s11_4"). We canonicalise both to a
// hyphen/underscore-free digit sequence so "§11.4" matches "s11_4".
function canonicalRef(s: string): string {
  return s.replace(/[§_.\s-]/g, '').toLowerCase()
}

function citesActive(item: TlfItem, activeSectionId: string | null | undefined): boolean {
  if (!activeSectionId) return false
  const activeKey = canonicalRef(activeSectionId)
  return item.linkedSections.some(ref => canonicalRef(ref).startsWith(activeKey) || activeKey.startsWith(canonicalRef(ref)))
}

export function TlfPanel({ documentId, activeSectionId, activeSectionLabel }: Props) {
  const [filter, setFilter] = useState<Filter>('all')

  const q = useQuery({
    queryKey: ['tlf', documentId],
    queryFn:  () => documentsApi.getTLF(documentId),
  })

  const filtered = useMemo(() => {
    const items = q.data?.items ?? []
    return filter === 'all' ? items : items.filter(it => it.type === filter)
  }, [q.data, filter])

  // Partition into "cites the active section" vs the rest so highlighted
  // items float to the top of the list.
  const { citing, others } = useMemo(() => {
    const citing: TlfItem[] = []
    const others: TlfItem[] = []
    for (const it of filtered) {
      if (citesActive(it, activeSectionId)) citing.push(it)
      else others.push(it)
    }
    return { citing, others }
  }, [filtered, activeSectionId])

  // Per-type counts for the filter chips.
  const counts = useMemo(() => {
    const all = q.data?.items ?? []
    return {
      all: all.length,
      T:   all.filter(i => i.type === 'T').length,
      L:   all.filter(i => i.type === 'L').length,
      F:   all.filter(i => i.type === 'F').length,
    }
  }, [q.data])

  return (
    <div className="flex h-full flex-col overflow-hidden" data-panel="tlf">
      {/* Header + filter chips */}
      <div className="flex-none border-b border-slate-200 bg-white px-4 py-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          TLF Cross-Reference
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          Tables, Listings and Figures from the project's current package.
          Items citing {activeSectionLabel ?? 'the active section'} float to the top.
        </p>
        <div className="mt-2 flex gap-1.5">
          {([['all', 'All', counts.all], ['T', 'Tables', counts.T], ['L', 'Listings', counts.L], ['F', 'Figures', counts.F]] as const).map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key as Filter)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${filter === key ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              data-filter={key}
            >
              {label} ({n})
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {q.isLoading && (
          <p className="px-4 py-6 text-[12px] text-slate-400">Loading TLF package…</p>
        )}
        {q.isError && isNoPackage(q.error) && (
          <div className="px-4 py-6 text-[12px] text-slate-500" data-empty="no-package">
            <p className="font-semibold text-slate-700">This project has no current TLF package.</p>
            <p className="mt-1">Ask an Admin to upload or validate one before cross-referencing.</p>
          </div>
        )}
        {q.isError && !isNoPackage(q.error) && (
          <p className="px-4 py-6 text-[12px] text-red-700" role="alert">Could not load the TLF package.</p>
        )}
        {q.data && q.data.items.length === 0 && (
          <p className="px-4 py-6 text-[12px] text-slate-500">The current package has no items yet.</p>
        )}
        {q.data && q.data.items.length > 0 && filtered.length === 0 && (
          <p className="px-4 py-6 text-[12px] text-slate-500">No items of this type.</p>
        )}

        {citing.length > 0 && (
          <section data-section="citing-active">
            <p className="px-4 pt-4 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-blue-700">
              Cites this section ({citing.length})
            </p>
            {citing.map(it => <TlfItemRow key={it.id} item={it} highlight />)}
          </section>
        )}
        {others.length > 0 && (
          <section data-section="other">
            {citing.length > 0 && (
              <p className="px-4 pt-4 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                All other items
              </p>
            )}
            {others.map(it => <TlfItemRow key={it.id} item={it} />)}
          </section>
        )}
      </div>

      {/* Footer — package metadata */}
      {q.data && (
        <div className="flex-none border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-[11px] text-slate-500" data-tlf-footer>
          <p>
            <span className="font-semibold text-slate-700">Package</span> v{q.data.package.version}
            <span className="mx-1.5">·</span>
            Validated by {q.data.package.validatedBy}
            <span className="mx-1.5">·</span>
            {new Date(q.data.package.validatedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>
        </div>
      )}
    </div>
  )
}

function TlfItemRow({ item, highlight }: { item: TlfItem; highlight?: boolean }) {
  const colour = TYPE_COLOUR[item.type]
  return (
    <div
      className={`flex items-start gap-3 border-b border-slate-100 px-4 py-2.5 ${highlight ? 'bg-blue-50/60' : ''}`}
      data-tlf-item={item.id}
      data-highlight={highlight ? 'true' : 'false'}
    >
      <span
        className="mt-0.5 inline-flex min-w-[22px] flex-none items-center justify-center rounded px-1.5 py-px font-mono text-[10px] font-bold"
        style={{ backgroundColor: colour.bg, color: colour.fg }}
        title={TYPE_LABEL[item.type]}
      >
        {item.type}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-slate-900">{item.id}</p>
        <p className="truncate text-[12px] text-slate-700" title={item.title}>{item.title}</p>
        {item.linkedSections.length > 0 && (
          <p className="mt-0.5 text-[11px] text-slate-500">
            Cited in {item.linkedSections.map(normaliseSectionRef).join(', ')}
            {item.referenceCount > item.linkedSections.length && (
              <span className="ml-1 text-slate-400"> · {item.referenceCount} total references</span>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

function normaliseSectionRef(ref: string): string {
  return ref.startsWith('§') ? ref : `§${ref}`
}

function isNoPackage(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const anyErr = err as { status?: number; body?: { error?: string } }
  return anyErr.status === 404 && anyErr.body?.error === 'no_current_package'
}
