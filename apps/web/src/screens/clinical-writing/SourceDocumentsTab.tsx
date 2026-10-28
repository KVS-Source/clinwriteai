// Source Documents tab — every file uploaded through "Upload source document"
// for this project, in an evidence-library style list: counters, state filter,
// search, sortable columns, paging and a download action per file.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  documentsApi,
  type SourceDocSort,
  type SourceDocState,
  type SourceDocument,
} from '../../api/documents'
import { ApiError } from '../../api/client'
import { sourceCategoryLabel } from '../../utils/sourceCategories'
import { SourceDetailPanel } from './SourceDetailPanel'

const PAGE_SIZES = [10, 25, 50, 100] as const
type SortKey = SourceDocSort

const STATE_STYLE: Record<SourceDocState, { label: string; bg: string; fg: string; hint: string }> = {
  saved:    { label: 'Saved',    bg: '#F0FDF4', fg: '#166534', hint: 'Saved to the project source library' },
  rejected: { label: 'Rejected', bg: '#FEF2F2', fg: '#B91C1C', hint: 'Rejected' },
}

const SCAN_STYLE: Record<string, { label: string; fg: string }> = {
  passed:  { label: 'Passed',  fg: '#166534' },
  pending: { label: 'Pending', fg: '#B45309' },
  failed:  { label: 'Failed',  fg: '#B91C1C' },
}

function formatUploaded(iso: string): string {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${date}, ${time}`
}

function SortIcon({ state }: { state: 'asc' | 'desc' | null }) {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden="true" className="flex-none">
      <path d="M5 1 2 4.5h6L5 1Z" fill={state === 'asc' ? '#1E293B' : '#CBD5E1'} />
      <path d="M5 11 2 7.5h6L5 11Z" fill={state === 'desc' ? '#1E293B' : '#CBD5E1'} />
    </svg>
  )
}

function Pill({ bg, fg, children, title }: { bg: string; fg: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: bg, color: fg }}>
      {children}
    </span>
  )
}

interface Props {
  projectId: string
  onUpload: () => void
  /** Open New Document with this source preselected */
}

export function SourceDocumentsTab({ projectId, onUpload }: Props) {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')                     // debounced value actually sent
  const [state, setState] = useState<SourceDocState | 'all'>('all')
  const [sort, setSort] = useState<SourceDocSort>('uploaded')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(50)
  // Download feedback. A row can exist whose stored file is gone (e.g. uploaded from
  // another environment); we find out on click and say so instead of saving an error file.
  const [busyId, setBusyId] = useState<string | null>(null)
  const [missingIds, setMissingIds] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  // The row whose detail panel is open. Kept as the row itself so the panel survives a
  // filter / page change that drops the row from the current list.
  const [selected, setSelected] = useState<SourceDocument | null>(null)

  const handleDownload = async (r: SourceDocument) => {
    setBusyId(r.id)
    setNotice(null)
    try {
      const { blob, filename } = await documentsApi.downloadSource(projectId, r.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename ?? r.fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { error?: string; message?: string } | null) : null
      if (body?.error === 'file_missing') {
        setMissingIds(prev => new Set(prev).add(r.id))
        setNotice(`"${r.fileName}" is listed here but its file is no longer in storage. Upload it again to restore it.`)
      } else if (body?.error === 'storage_unavailable') {
        setNotice(body.message ?? 'The file storage could not be reached. Please try again shortly.')
      } else if (body?.error === 'quarantined') {
        setNotice(body.message ?? `"${r.fileName}" failed the virus scan and cannot be downloaded.`)
      } else if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setNotice('You do not have permission to download this file.')
      } else {
        setNotice(`Could not download "${r.fileName}". Please try again.`)
      }
    } finally {
      setBusyId(null)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1) }, 250)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['source-documents', projectId, { q, state, sort, dir, page, pageSize }],
    queryFn: () => documentsApi.listSources(projectId, { q, state, sort, dir, page, pageSize }),
    placeholderData: keepPreviousData,
  })

  const items = data?.items ?? []
  const selectedRow = selected ? (items.find(i => i.id === selected.id) ?? selected) : null
  const total = data?.total ?? 0
  const summary = data?.summary ?? { files: 0, saved: 0, rejected: 0 }
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const filtersDirty = q !== '' || state !== 'all'

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSort(key); setDir(key === 'uploaded' || key === 'size' ? 'desc' : 'asc') }
    setPage(1)
  }
  const clearFilters = () => { setSearch(''); setQ(''); setState('all'); setPage(1) }

  // A render helper (not a nested component) so headers don't remount on every render.
  const th = (label: string, k?: SortKey, className = '') => (
    <th
      key={label || 'actions'}
      scope="col"
      aria-sort={k && sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500 ${className}`}
    >
      {k ? (
        <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1.5 uppercase tracking-widest hover:text-slate-800" data-sort={k}>
          {label}<SortIcon state={sort === k ? dir : null} />
        </button>
      ) : label}
    </th>
  )

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4" data-screen="source-documents">
      {/* Header — the file count is already on the tab label and the pager */}
      <div>
        <h2 className="text-[18px] font-bold text-slate-900">Source documents</h2>
        <p className="mt-1 max-w-[640px] text-[13px] text-slate-500">
          Evidence for this project — protocols, SAPs, TLF outputs, lab exports and files from other systems.
          <span className="text-slate-400"> Pick them under "Based on source documents" when you create a document.</span>
        </p>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900" role="alert" data-download-notice>
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="flex-none font-semibold underline" aria-label="Dismiss">Dismiss</button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-3.5">
          <select
            value={state}
            onChange={e => { setState(e.currentTarget.value as SourceDocState | 'all'); setPage(1) }}
            aria-label="Filter by state"
            data-filter="state"
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-[13px] text-slate-900"
          >
            <option value="all">All states</option>
            <option value="saved">Saved</option>
            <option value="rejected">Rejected</option>
          </select>
          <div className="flex min-w-[240px] max-w-[460px] flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#94A3B8" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" strokeLinecap="round" /></svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.currentTarget.value)}
              placeholder="Search title, category…"
              aria-label="Search source documents"
              data-filter="search"
              className="w-full border-none bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="flex-1" />
          {filtersDirty && (
            <button type="button" onClick={clearFilters} className="text-[12px] font-semibold text-slate-600 hover:text-slate-900" data-action="clear-filters">
              ✕ Clear filters
            </button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[13px]" style={{ opacity: isFetching && !isLoading ? 0.7 : 1 }}>
            <thead style={{ backgroundColor: '#F8FAFC' }}>
              <tr className="border-b border-slate-200">
                {th('Title', 'title')}
                {th('Category', 'category')}
                {th('State', 'state')}
                {th('Scan', 'scan')}
                {th('Used in', 'usedIn')}
                {th('Uploaded', 'uploaded')}
                {th('Quick actions', undefined, 'w-[1%] whitespace-nowrap text-right')}
              </tr>
            </thead>
            <tbody>
              {items.map(r => (
                <Row
                  key={r.id}
                  r={r}
                  busy={busyId === r.id}
                  missing={missingIds.has(r.id)}
                  onDownload={() => void handleDownload(r)}
                  onOpenDoc={id => navigate(`/projects/${projectId}/clinical-writing/documents/${id}`)}
                  selected={selectedRow?.id === r.id}
                  onSelect={() => setSelected(cur => (cur?.id === r.id ? null : r))}
                />
              ))}
              {isLoading && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-[13px] text-slate-400">Loading source documents…</td></tr>
              )}
              {isError && !isLoading && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-[13px] text-red-700" role="alert">
                  Could not load source documents.{' '}
                  <button type="button" onClick={() => void refetch()} className="font-semibold underline">Retry</button>
                </td></tr>
              )}
              {!isLoading && !isError && items.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-12 text-center" data-empty>
                  {summary.files === 0 ? (
                    <>
                      <p className="text-[14px] font-semibold text-slate-900">No source documents yet</p>
                      <p className="mt-1 text-[13px] text-slate-500">Upload a protocol, SAP, listing or export and it will be kept here for the whole project.</p>
                      <button type="button" onClick={onUpload} className="mt-3 rounded-md bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700">Upload source document</button>
                    </>
                  ) : (
                    <>
                      <p className="text-[14px] font-semibold text-slate-900">No source documents match these filters</p>
                      <button type="button" onClick={clearFilters} className="mt-2 text-[13px] font-semibold text-blue-600 hover:text-blue-700">Clear filters</button>
                    </>
                  )}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pager */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.currentTarget.value)); setPage(1) }}
            aria-label="Rows per page"
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700"
          >
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <div className="flex items-center gap-3 text-[12px] text-slate-500">
            <span data-pager-status>Page {Math.min(page, pageCount)} of {pageCount} · {total} {total === 1 ? 'file' : 'files'}</span>
            <button type="button" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}
              className="rounded-md border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
            <button type="button" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)}
              className="rounded-md border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>

      <SourceDetailPanel
        projectId={projectId}
        source={selectedRow}
        onClose={() => setSelected(null)}
        onOpenDoc={id => navigate(`/projects/${projectId}/clinical-writing/documents/${id}`)}
      />
    </div>
  )
}

// The "⋯" menu. Rendered with fixed positioning because the table scrolls horizontally
// (overflow-x clips an absolutely positioned menu on the last rows).
function RowMenu({ label, canDownload, downloadHint, busy, onDownload }: {
  label: string
  canDownload: boolean
  downloadHint?: string
  busy: boolean
  onDownload: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  const place = () => {
    const b = btn.current?.getBoundingClientRect()
    if (!b) return
    const h = menu.current?.offsetHeight ?? 190
    const below = b.bottom + 4
    setPos({
      top: below + h > window.innerHeight ? Math.max(8, b.top - h - 4) : below,   // flip up near the bottom
      right: Math.max(8, window.innerWidth - b.right),
    })
  }
  useLayoutEffect(() => { if (open) place() }, [open])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const outside = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.document.addEventListener('mousedown', outside)
    window.document.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.document.removeEventListener('mousedown', outside)
      window.document.removeEventListener('keydown', esc)
    }
  }, [open])

  const item = (text: React.ReactNode, o: { onClick?: () => void; disabled?: boolean; danger?: boolean; title?: string; action?: string }) => (
    <button
      type="button"
      role="menuitem"
      disabled={o.disabled}
      title={o.title}
      data-action={o.action}
      onClick={() => { setOpen(false); o.onClick?.() }}
      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] ${
        o.disabled ? 'cursor-not-allowed text-slate-400' : o.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      {text}
    </button>
  )
  const soon = <span className="ml-1 text-[9px] uppercase text-slate-400">soon</span>

  return (
    <div className="relative">
      <button
        ref={btn}
        type="button"
        aria-label={`More actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex gap-[2.5px] rounded-md p-1.5 transition-colors hover:bg-slate-100"
        data-action="more"
      >
        <span className="h-[3px] w-[3px] rounded-full" style={{ backgroundColor: '#64748B' }} />
        <span className="h-[3px] w-[3px] rounded-full" style={{ backgroundColor: '#64748B' }} />
        <span className="h-[3px] w-[3px] rounded-full" style={{ backgroundColor: '#64748B' }} />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          data-row-menu
          className="fixed z-50 w-56 rounded-md border border-slate-200 bg-white py-1 text-left shadow-lg"
          style={{ top: pos?.top ?? -9999, right: pos?.right ?? 0, visibility: pos ? 'visible' : 'hidden' }}
        >
          {item(busy ? 'Downloading…' : 'Download', { onClick: onDownload, disabled: !canDownload, title: downloadHint, action: 'download' })}
          <div className="my-1 border-t border-slate-100" />
          {item(<>Archive {soon}</>, { disabled: true, title: 'Archive endpoint pending (Phase 2).' })}
          {item(<>Delete {soon}</>, { disabled: true, danger: true, title: 'Delete endpoint pending (Phase 2); admin-only.' })}
        </div>
      )}
    </div>
  )
}

function Row({ r, busy, missing, selected, onSelect, onDownload, onOpenDoc }: { r: SourceDocument; busy: boolean; missing: boolean; selected: boolean; onSelect: () => void; onDownload: () => void; onOpenDoc: (documentId: string) => void }) {
  const st = STATE_STYLE[r.state]
  const scan = SCAN_STYLE[r.virusScanStatus] ?? { label: r.virusScanStatus, fg: '#475569' }
  const blocked = r.virusScanStatus === 'failed'
  const who = r.uploadedBy.name ?? r.uploadedBy.email ?? r.uploadedBy.id
  return (
    <tr
      onClick={onSelect}
      data-panel-trigger
      aria-selected={selected}
      className={`cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50/60 ${selected ? 'bg-blue-50/50' : ''}`}
      data-source-row={r.id}
    >
      <td className="max-w-[300px] px-4 py-3 align-top">
        <p className="truncate font-semibold text-slate-900" title={r.title}>{r.title}</p>
        {r.origin && <p className="mt-0.5 truncate text-[11px] text-slate-500" title={r.origin}>{r.origin}</p>}
      </td>
      <td className="px-4 py-3 align-top">
        <span className="text-slate-700">{sourceCategoryLabel(r.category)}</span>
        {r.categorySource === 'detected' && (
          <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400" title="Guessed from the file name">auto</span>
        )}
      </td>
      <td className="px-4 py-3 align-top"><Pill bg={st.bg} fg={st.fg} title={st.hint}>{st.label}</Pill></td>
      <td className="px-4 py-3 align-top"><span className="text-[12px] font-semibold" style={{ color: scan.fg }}>{scan.label}</span></td>
      <td className="max-w-[220px] px-4 py-3 align-top" data-used-in>
        {r.usedIn.length === 0 ? <span className="text-slate-400">—</span> : (
          <div className="flex flex-col gap-0.5">
            {r.usedIn.slice(0, 2).map(d => (
              <button key={d.id} type="button" onClick={e => { e.stopPropagation(); onOpenDoc(d.id) }} className="truncate text-left text-[13px] font-semibold text-blue-600 hover:text-blue-700 hover:underline" title={d.title}>
                {d.title}
              </button>
            ))}
            {r.usedIn.length > 2 && <span className="text-[11px] text-slate-500">+{r.usedIn.length - 2} more</span>}
          </div>
        )}
      </td>
      <td className="px-4 py-3 align-top whitespace-nowrap">
        <p className="text-slate-900">{formatUploaded(r.uploadedAt)}</p>
        <p className="mt-0.5 max-w-[200px] truncate text-[11px] text-slate-500" title={r.uploadedBy.email ?? undefined}>{who}</p>
      </td>
      {/* Quick actions — "Open" + "⋯" menu */}
      <td className="px-4 py-3 align-top">
        <div className="flex items-center justify-end gap-2" data-quick-actions onClick={e => e.stopPropagation()}>
          {blocked && <span className="text-[11px] font-semibold text-red-700" title="Failed the virus scan">Blocked</span>}
          {!blocked && missing && <span className="text-[11px] font-semibold text-amber-700" title="The stored file could not be found">File missing</span>}
          <button
            type="button"
            onClick={onSelect}
            title="Open the details panel for this source"
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-900 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-white"
            data-action="open-source-row"
          >
            Open
          </button>
          <RowMenu
            label={r.fileName}
            canDownload={!blocked && !missing && !busy}
            downloadHint={blocked ? 'Failed the virus scan — cannot be downloaded.' : missing ? 'The stored file could not be found.' : undefined}
            busy={busy}
            onDownload={onDownload}
          />
        </div>
      </td>
    </tr>
  )
}
