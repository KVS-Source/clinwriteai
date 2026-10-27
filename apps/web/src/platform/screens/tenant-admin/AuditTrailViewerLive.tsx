// Audit trail viewer (live) — Arc 4.7 of docs/pivot-plan.md.
//
// Super-admin only. Paginated filter form over the real audit_events
// table with hash-chain verify button + CSV export via <a href> (the
// browser handles the download; cookie travels via credentials:'include').
//
// Filters are drafted in the form and only take effect on Apply, so the
// table, the page count and the CSV export always describe the same set.
// Initial filters can come from the URL (?entityId=…&action=…), which is
// how ProjectDashboard deep-links here.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SlidePanel } from '../../../components/ui/SlidePanel'
import { MODULE_KEY_TO_LABEL, type ModuleKey } from '../../../config/modules'
import {
  useAuditQuery, useAuditVerify, useAuditFacets, useAuditNewer, auditExportUrl, type AuditQuery,
} from '../../../hooks'
import { useQuery } from '@tanstack/react-query'
import { auditApi, projectsApi, describeApiError, AUDIT_EXPORT_ROW_CAP, type AuditEntry, type AuditSortKey } from '../../../api'

const PAGE_SIZE = 25
// Pause after the last keystroke before the search box applies itself.
const SEARCH_DEBOUNCE_MS = 400

type TimeZoneMode = 'local' | 'utc'

interface Filters {
  search: string    // free-text, matches across the visible columns
  actor: string
  action: string
  entityType: string
  entityId: string
  projectId: string   // from ?projectId= (a project's "Audit trail" button); no box in the form
  from: string      // YYYY-MM-DDTHH:mm from <input type="datetime-local">, in the chosen timezone
  to: string
}

const SEARCH_MIN_CHARS = 3

const EMPTY_FILTERS: Filters ={ search: '', actor: '', action: '', entityType: '', entityId: '', projectId: '', from: '', to: '' }

function filtersFromUrl(params: URLSearchParams): Filters {
  return {
    search:     params.get('q') ?? '',
    actor:      params.get('actor') ?? params.get('actorId') ?? '',
    action:     params.get('action') ?? '',
    entityType: params.get('entityType') ?? '',
    entityId:   params.get('entityId') ?? '',
    projectId:  params.get('projectId') ?? '',
    // A deep link to one entity (e.g. a project's "Audit trail" button) opens on its
    // whole history; otherwise the page opens on the one-month default, in local time.
    ...(params.get('entityId') || params.get('projectId') ? { from: '', to: '' } : defaultRange('local')),
  }
}

function sameFilters(a: Filters, b: Filters): boolean {
  return (Object.keys(a) as (keyof Filters)[]).every(k => a[k].trim() === b[k].trim())
}

// A picked date + time (to the minute) → the ISO instant, in the timezone the
// viewer has chosen. The end of the range covers that whole minute.
function rangeToIso(value: string, edge: 'start' | 'end', tz: TimeZoneMode): string | undefined {
  if (!value) return undefined
  const secs = edge === 'start' ? ':00.000' : ':59.999'
  return tz === 'utc'
    ? `${value}${secs}Z`
    : new Date(`${value}${secs}`).toISOString()  // no suffix → parsed as browser-local
}

// A Date → the YYYY-MM-DDTHH:mm string a datetime-local input expects, in the chosen timezone.
function toInputValue(d: Date, tz: TimeZoneMode): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return tz === 'utc'
    ? `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
    : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function toAuditQuery(f: Filters, tz: TimeZoneMode): Omit<AuditQuery, 'limit' | 'cursor' | 'order' | 'sortBy'> {
  const val = (s: string) => s.trim() || undefined
  return {
    // Free-text search only kicks in from SEARCH_MIN_CHARS characters.
    q:          f.search.trim().length >= SEARCH_MIN_CHARS ? f.search.trim() : undefined,
    actor:      val(f.actor),
    action:     val(f.action),
    entityType: val(f.entityType),
    entityId:   val(f.entityId),
    projectId:  val(f.projectId),
    fromDate:   rangeToIso(f.from, 'start', tz),
    toDate:     rangeToIso(f.to, 'end', tz),
  }
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatUTC(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${dd} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm}:${ss} UTC`
}

const localFormatter = new Intl.DateTimeFormat(undefined, {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false, timeZoneName: 'short',
})

function formatLocal(iso: string): string {
  return localFormatter.format(new Date(iso))
}

function formatWhen(iso: string, tz: TimeZoneMode): { primary: string; secondary: string } {
  return tz === 'utc'
    ? { primary: formatUTC(iso), secondary: formatLocal(iso) }
    : { primary: formatLocal(iso), secondary: formatUTC(iso) }
}

// Badge palette by action family. Destructive verbs win over namespace so
// e.g. 'tenant.archived' reads as a warning rather than a tenant event.
function badgePalette(action: string): { bg: string; fg: string } {
  const a = action.toLowerCase()
  if (/(delete|archive|revoke|suspend|purge|disable)/.test(a)) return { bg: '#FEF2F2', fg: '#B91C1C' }
  if (a.startsWith('tenant'))                                  return { bg: '#F0F7FA', fg: '#005F8E' }
  if (a.startsWith('membership'))                              return { bg: '#EFF6FF', fg: '#1D4ED8' }
  if (a.startsWith('sso'))                                     return { bg: '#F0FDF4', fg: '#166534' }
  if (a.startsWith('user'))                                    return { bg: '#FFFBEB', fg: '#B45309' }
  if (a.includes('signature'))                                 return { bg: '#F0F7FA', fg: '#005F8E' }
  if (a.startsWith('auth') || /(login|logout|session)/.test(a)) return { bg: '#EEF2FF', fg: '#4338CA' }
  if (a.startsWith('phi') || a.includes('accessed'))           return { bg: '#FDF2F8', fg: '#9D174D' }
  if (a.startsWith('document'))                                return { bg: '#F0FDFA', fg: '#0F766E' }
  if (a.startsWith('audit'))                                   return { bg: '#F5F3FF', fg: '#6D28D9' }
  if (a.startsWith('http.'))                                   return { bg: '#EEF2F7', fg: '#334155' }
  return { bg: '#F1F5F9', fg: '#475569' }
}

function ActionBadge({ action }: { action: string }) {
  const kind = badgePalette(action)
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold"
      style={{ backgroundColor: kind.bg, color: kind.fg }}
    >{action}</span>
  )
}

// Event categories: each is a group of related actions, matched on the Action
// column with a "contains" match (e.g. "user." covers user.suspend, user.invite…).
const QUICK_FILTERS: { label: string; action: string }[] = [
  { label: 'PHI access', action: 'phi' },
  { label: 'Sign-in', action: 'auth' },
  { label: 'Users', action: 'user.' },
  { label: 'Signatures', action: 'signature' },
  { label: 'Documents', action: 'document' },
  { label: 'HTTP writes', action: 'http.' },
  { label: 'Audit access', action: 'audit.' },
  { label: 'Document viewing', action: 'document_presence' },
  { label: 'Security probes', action: 'security.' },
]

// Dropdown options from the server's distinct values, plus the current value
// when it isn't one of them (e.g. a quick-filter prefix like "phi" or a
// ?action= deep link) so the select never shows a value it can't display.
function withCurrent(values: string[] | undefined, current: string): string[] {
  const list = values ?? []
  return current && !list.includes(current) ? [current, ...list] : list
}

const SORT_COLUMNS: { key: AuditSortKey; label: string }[] = [
  { key: 'id',        label: 'ID' },
  { key: 'timestamp', label: 'When' },
  { key: 'action',    label: 'Action' },
  { key: 'entity',    label: 'Entity' },
  { key: 'actor',     label: 'Actor' },
]

function SortHeader({ col, sortBy, order, onSort }: {
  col: { key: AuditSortKey; label: string }
  sortBy: AuditSortKey
  order: 'asc' | 'desc'
  onSort: (key: AuditSortKey) => void
}) {
  const active = sortBy === col.key
  return (
    <th className="px-4 py-2" aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(col.key)}
        className="inline-flex items-center gap-1 font-semibold uppercase tracking-widest hover:text-slate-800"
        data-sort-column={col.key}
        title={`Sort by ${col.label.toLowerCase()}`}
      >
        {col.label}
        <span aria-hidden className={active ? 'text-slate-800' : 'text-slate-300'}>
          {active ? (order === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}

function ActorCell({ entry }: { entry: AuditEntry }) {
  const role = entry.actorRole
    ? (
      <p
        className="text-[10px] uppercase tracking-wide text-slate-500"
        title={entry.actorRoleRecorded ? 'Role recorded at the time of the event' : "User's current role (not recorded on this older entry)"}
      >{entry.actorRole}{entry.actorRoleRecorded ? '' : ' *'}</p>
    )
    : null
  if (entry.actorName || entry.actorEmail) {
    return (
      <div title={`${entry.actorEmail ?? ''}\n${entry.actorId}`}>
        <p className="font-semibold text-slate-700">{entry.actorName ?? entry.actorEmail}</p>
        {entry.actorName && entry.actorEmail && (
          <p className="text-[10px] text-slate-500">{entry.actorEmail}</p>
        )}
        {role}
      </div>
    )
  }
  if (entry.actorId === 'anonymous') {
    return <p className="text-[11px] italic text-slate-500" title="anonymous">System / unauthenticated</p>
  }
  return <p className="font-mono text-[11px] text-slate-500">{entry.actorId}</p>
}

function detailValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

function DetailPanel({ entry, tz }: { entry: AuditEntry; tz: TimeZoneMode }) {
  const [showRaw, setShowRaw] = useState(false)
  const pairs = Object.entries(entry.details ?? {})
  const when = formatWhen(entry.timestamp, tz)
  // FR-A-061 fields, always shown so a missing value reads as "not recorded".
  const identity: [string, string][] = [
    ['When', when.secondary ? `${when.primary} (${when.secondary})` : when.primary],
    ['Action', entry.action],
    ['Entity type', entry.entityType],
    ['Entity id', entry.entityId],
    ['Actor', entry.actorName ? `${entry.actorName}${entry.actorEmail ? ` <${entry.actorEmail}>` : ''}` : (entry.actorEmail ?? entry.actorId)],
    ['IP address', entry.ipAddress ?? '—'],
    ['Actor role', entry.actorRole ? `${entry.actorRole}${entry.actorRoleRecorded ? '' : ' (current role — not recorded on this entry)'}` : 'not recorded'],
    ['Session id', entry.sessionId ?? 'not recorded'],
    ['Old value', entry.oldValue === null || entry.oldValue === undefined ? '—' : detailValue(entry.oldValue)],
    ['New value', entry.newValue === null || entry.newValue === undefined ? '—' : detailValue(entry.newValue)],
  ]
  return (
    <div className="flex flex-col gap-3 rounded-md bg-slate-50 p-3 text-[11px] text-slate-700">
      <table className="w-full max-w-3xl" data-section="identity">
        <tbody>
          {identity.map(([k, v]) => (
            <tr key={k}>
              <td className="w-40 py-0.5 pr-3 align-top font-semibold text-slate-500">{k}</td>
              <td className="break-all py-0.5 font-mono">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pairs.length > 0 ? (
        <table className="w-full max-w-3xl">
          <tbody>
            {pairs.map(([k, v]) => (
              <tr key={k}>
                <td className="w-40 py-0.5 pr-3 align-top font-semibold text-slate-500">{k}</td>
                <td className="break-all py-0.5 font-mono">
                  {k === 'module' && typeof v === 'string' && v in MODULE_KEY_TO_LABEL
                    ? MODULE_KEY_TO_LABEL[v as ModuleKey]
                    : detailValue(v)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-slate-500">No details recorded.</p>
      )}
      <div className="rounded-md border border-slate-200 bg-white p-3" data-section="chain-context">
        <p className="mb-2 text-[12px] font-bold text-slate-800">Chain context (Part 11)</p>
        <dl className="flex flex-col gap-2">
          {([
            ['Entry hash', entry.rowHash],
            ['Prev hash', entry.prevHash],
            ['Actor id', entry.actorId],
          ] as const).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{k}</dt>
              <dd className="break-all font-mono text-[11px] text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <button type="button" onClick={() => setShowRaw(v => !v)} className="text-[10px] font-semibold text-slate-600 hover:underline">
          {showRaw ? 'Hide' : 'View'} raw JSON
        </button>
        {showRaw && (
          <pre className="mt-2 max-w-3xl overflow-auto rounded-md bg-white p-2 text-[10px]">
            {JSON.stringify(entry, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

function AuditRow({ entry, tz, selected, onSelect }: {
  entry: AuditEntry; tz: TimeZoneMode; selected: boolean; onSelect: (e: AuditEntry) => void
}) {
  const when = formatWhen(entry.timestamp, tz)
  return (
    <>
      <tr
        className={`cursor-pointer border-t border-slate-200 hover:bg-slate-50 ${selected ? 'bg-slate-100' : ''}`}
        data-audit-row={entry.id}
        data-panel-trigger
        tabIndex={0}
        aria-selected={selected}
        title="Click to view details"
        onClick={() => onSelect(entry)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(entry) } }}
      >
        <td className="px-4 py-3 font-mono text-[11px] text-slate-500 align-top">{entry.id}</td>
        <td className="px-4 py-3 font-mono text-[11px] text-slate-700 align-top" title={`${tz === 'utc' ? 'Local time' : 'UTC'}: ${when.secondary}`}>{when.primary}</td>
        <td className="px-4 py-3 align-top"><ActionBadge action={entry.action} /></td>
        <td className="px-4 py-3 text-slate-700 align-top">
          <p className="font-semibold">{entry.entityType}</p>
          <p className="break-all font-mono text-[10px] text-slate-500">{entry.entityId}</p>
        </td>
        <td className="px-4 py-3 align-top"><ActorCell entry={entry} /></td>
      </tr>
    </>
  )
}

const inputClass = 'rounded-md border border-slate-300 px-2 py-1.5 text-[12px]'

// A dropdown showing its "All…" / "Select…" placeholder reads grey, like an empty input.
const selectTone = (isPlaceholder: boolean) => (isPlaceholder ? 'text-slate-500' : 'text-slate-900')

// '2026-10-27T09:05' → '27 Oct 09:05'
function shortWhen(value: string): string {
  const [day, time] = value.split('T')
  const [, m, d] = (day ?? '').split('-').map(Number)
  return m && d ? `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${time ?? ''}`.trim() : value
}

type RangePreset = { label: string; ms?: number; today?: true; months?: number }

const RANGE_PRESETS: RangePreset[] = [
  { label: 'Last hour',     ms: 60 * 60 * 1000 },
  { label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: 'Today',         today: true },
  { label: 'Last 7 days',   ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'Last month',    months: 1 },
]

type VerifyScope = 'all' | 'filters' | 'page' | 'custom'

const VERIFY_OK_DISMISS_MS    = 4_000   // clean pass
const VERIFY_ISSUE_DISMISS_MS = 10_000  // break, error, known exceptions, "nothing to verify"

// "Verify ▾" — picks which chain segment to re-hash: the whole chain, the span covering
// the entries that match the current filters, the entries on this page, or a custom id range.
function VerifyMenu({ busy, filtersReady, pageHasRows, onVerify }: {
  busy: boolean; filtersReady: boolean; pageHasRows: boolean
  onVerify: (scope: VerifyScope, custom?: { fromId: string; toId: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const idsInvalid = [fromId, toId].some(v => v.trim() !== '' && !/^\d+$/.test(v.trim()))
  const customReady = (fromId.trim() !== '' || toId.trim() !== '') && !idsInvalid
  const pick = (scope: VerifyScope, custom?: { fromId: string; toId: string }) => { setOpen(false); onVerify(scope, custom) }

  const item = 'flex w-full flex-col items-start rounded-md px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        data-action="verify-chain"
      >
        {busy ? 'Verifying…' : 'Verify chain'}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M3 4.5l3 3 3-3" /></svg>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-[300px] rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
          <button type="button" role="menuitem" className={item} onClick={() => pick('all')} data-verify-scope="all">
            <span className="text-[12px] font-semibold text-slate-900">Whole chain</span>
            <span className="text-[11px] text-slate-500">Every entry, first to latest.</span>
          </button>
          <button type="button" role="menuitem" className={item} disabled={!filtersReady} onClick={() => pick('filters')} data-verify-scope="filters"
            title={filtersReady ? undefined : 'The filters are still updating'}>
            <span className="text-[12px] font-semibold text-slate-900">Entries matching the filters</span>
            <span className="text-[11px] text-slate-500">From the first to the last matching entry (date range, search…).</span>
          </button>
          <button type="button" role="menuitem" className={item} disabled={!pageHasRows} onClick={() => pick('page')} data-verify-scope="page">
            <span className="text-[12px] font-semibold text-slate-900">Entries on this page</span>
            <span className="text-[11px] text-slate-500">The rows currently shown in the table.</span>
          </button>

          <div className="mt-1 border-t border-slate-200 px-3 pb-2 pt-2.5" data-verify-scope="custom">
            <p className="text-[12px] font-semibold text-slate-900">Custom ID range</p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <input className={`${inputClass} w-full min-w-0`} inputMode="numeric" placeholder="From id" aria-label="From id"
                value={fromId} onChange={e => setFromId(e.target.value)} />
              <span className="text-[11px] text-slate-400">–</span>
              <input className={`${inputClass} w-full min-w-0`} inputMode="numeric" placeholder="To id" aria-label="To id"
                value={toId} onChange={e => setToId(e.target.value)} />
              <button type="button" disabled={!customReady}
                onClick={() => {
                  // Clear the boxes once the range is handed off, so the menu reopens empty.
                  pick('custom', { fromId: fromId.trim(), toId: toId.trim() })
                  setFromId('')
                  setToId('')
                }}
                className="flex-none rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40">Verify</button>
            </div>
            <p className="mt-1 text-[10px] text-slate-500">
              {idsInvalid ? <span className="text-red-700">Ids must be whole numbers.</span> : 'Leave one side empty for "from the start" / "to the latest".'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// Default range: the start of the same day last month → the end of today, so the
// page opens on one month of history and entries arriving later today still show.
function defaultRange(tz: TimeZoneMode): { from: string; to: string } {
  const now = new Date()
  const start = new Date(now)
  if (tz === 'utc') start.setUTCMonth(start.getUTCMonth() - 1)
  else start.setMonth(start.getMonth() - 1)
  return { from: `${toInputValue(start, tz).slice(0, 10)}T00:00`, to: `${toInputValue(now, tz).slice(0, 10)}T23:59` }
}

// The from/to a preset means right now, in the chosen timezone.
function presetRange(p: RangePreset, tz: TimeZoneMode): { from: string; to: string } {
  const now = new Date()
  const to = toInputValue(now, tz)
  if (p.today) return { from: `${to.slice(0, 10)}T00:00`, to }
  if (p.months) {
    const start = new Date(now)
    if (tz === 'utc') start.setUTCMonth(start.getUTCMonth() - p.months)
    else start.setMonth(start.getMonth() - p.months)
    return { from: toInputValue(start, tz), to }
  }
  return { from: toInputValue(new Date(now.getTime() - p.ms!), tz), to }
}

// One "Date & time" filter: a button showing the current range that opens a popover
// with From / To (date + time, to the minute), quick presets and Clear. Values are in
// the "Times in" timezone the viewer picked.
function DateTimeRangeFilter({ from, to, tz, invalid, onChange, onTzChange }: {
  from: string; to: string; tz: TimeZoneMode; invalid: boolean
  onChange: (range: { from: string; to: string }) => void
  onTzChange: (tz: TimeZoneMode) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const label =
    from && to ? `${shortWhen(from)} → ${shortWhen(to)}` :
    from       ? `From ${shortWhen(from)}` :
    to         ? `Until ${shortWhen(to)}` :
                 'Date & time range'

  // Which preset produced the current range. It stays highlighted only while the
  // range is untouched — editing From/To, clearing or Reset un-highlights it.
  const [picked, setPicked] = useState<{ label: string; from: string; to: string } | null>(null)
  const activePreset = picked && picked.from === from && picked.to === to ? picked.label : null

  const applyPreset = (p: RangePreset) => {
    const range = presetRange(p, tz)
    setPicked({ label: p.label, ...range })
    onChange(range)
    setOpen(false)
  }

  const fieldLabel = 'flex flex-col gap-1 text-[11px] font-semibold text-slate-600'

  return (
    <div ref={ref} className="relative" data-field="date-range">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${inputClass} flex min-w-[220px] items-center justify-between gap-2 bg-white text-left ${from || to ? 'text-slate-900' : 'text-slate-500'} ${invalid ? 'border-red-400' : ''}`}
      >
        <span className="truncate">{label}</span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-none text-slate-500" aria-hidden>
          <rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
        </svg>
      </button>

      {open && (
        <div role="dialog" aria-label="Date and time range" className="absolute right-0 z-20 mt-1 w-[320px] rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
          <div className="flex flex-wrap gap-1.5">
            {RANGE_PRESETS.map(p => {
              const active = activePreset === p.label
              return (
                <button key={p.label} type="button" onClick={() => applyPreset(p)}
                  aria-pressed={active}
                  data-preset={p.label}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    active
                      ? 'border-slate-800 bg-slate-800 font-semibold text-white'
                      : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >{p.label}</button>
              )
            })}
          </div>

          <div className="mt-3 flex flex-col gap-3">
            <label className={fieldLabel}>
              From
              <input type="datetime-local" className={`${inputClass} w-full`} value={from} max={to || undefined}
                onChange={e => onChange({ from: e.target.value, to })} data-field="from" />
            </label>
            <label className={fieldLabel}>
              To
              <input type="datetime-local" className={`${inputClass} w-full`} value={to} min={from || undefined}
                onChange={e => onChange({ from, to: e.target.value })} data-field="to" />
            </label>
          </div>

          {invalid && <p className="mt-2 text-[11px] text-red-700">"From" is after "To".</p>}
          {/* Which timezone the From / To above (and the table's times) are in. Switching keeps
              the range pointing at the same moments. */}
          <label className="mt-3 flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600">
            Times in
            <select className={`${inputClass} w-[200px] font-normal text-slate-900`} value={tz}
              onChange={e => onTzChange(e.target.value as TimeZoneMode)} data-field="timezone">
              <option value="local">Local ({Intl.DateTimeFormat().resolvedOptions().timeZone})</option>
              <option value="utc">UTC</option>
            </select>
          </label>
          <p className="mt-1.5 font-mono text-[10px] text-slate-500">"To" includes that whole minute.</p>

          <div className="mt-3 flex justify-between border-t border-slate-200 pt-3">
            <button type="button" onClick={() => onChange({ from: '', to: '' })} disabled={!from && !to}
              className="rounded-md px-2 py-1 text-[12px] text-slate-600 hover:bg-slate-100 disabled:opacity-40">Clear</button>
            <button type="button" onClick={() => setOpen(false)}
              className="rounded-md bg-slate-800 px-3 py-1 text-[12px] font-semibold text-white">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function AuditTrailViewerLive() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialFilters = useMemo(() => filtersFromUrl(searchParams), [searchParams])

  const [draft, setDraft] = useState<Filters>(initialFilters)
  const [applied, setApplied] = useState<Filters>(initialFilters)

  // Scope from a deep link: ?projectId= (whole project) or ?entityId= (one record).
  // Name the chip when the scoped id is a project; anything else shows as "Entity".
  const scopedProjectId = applied.projectId.trim()
  const scopedEntityId = scopedProjectId || applied.entityId.trim()
  const scopedProject = useQuery({
    queryKey: ['projects', scopedEntityId],
    queryFn:  () => projectsApi.get(scopedEntityId),
    enabled:  !!scopedEntityId,
    retry:    false,
    staleTime: 60_000,
  })
  const [order, setOrder] = useState<'desc' | 'asc'>('desc')
  const [sortBy, setSortBy] = useState<AuditSortKey>('id')
  const [tz, setTz] = useState<TimeZoneMode>('local')
  // Cursor for each visited page; index 0 (page 1) has no cursor.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const pageIndex = cursors.length - 1
  // Row whose details are open in the right-hand panel.
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null)

  const baseQuery = useMemo(() => ({ ...toAuditQuery(applied, tz), sortBy, order }), [applied, tz, sortBy, order])
  const query: AuditQuery = { ...baseQuery, limit: PAGE_SIZE, cursor: cursors[pageIndex] }
  const { data, isLoading, isFetching, error, refetch } = useAuditQuery(query)
  const facets = useAuditFacets()

  // Keeping the table current. While the page shows the newest entries (page 1, newest first)
  // it asks a cheap question every few seconds — "anything newer than the top row?" — and only
  // re-fetches the table when the answer is yes. If the user is reading (a row's panel is open,
  // the table is scrolled off the top, or a filter is being edited) the table is left alone and
  // a "N new entries" bar offers the refresh instead.
  const canFollow = pageIndex === 0 && sortBy === 'id' && order === 'desc' && !!data
  const newestShownId = data ? (data.rows[0]?.id ?? '0') : null
  const newerFilters = useMemo(() => toAuditQuery(applied, tz), [applied, tz])
  const newer = useAuditNewer(newerFilters, newestShownId, canFollow)
  const newCount = newer.data?.count ?? 0
  const tableRef = useRef<HTMLDivElement>(null)
  const [heldBack, setHeldBack] = useState(false)

  const verify = useAuditVerify()
  const [verifyScopeLabel, setVerifyScopeLabel] = useState('Whole chain')
  const [verifyNote, setVerifyNote] = useState<string | null>(null)
  const [lookingUp, setLookingUp] = useState(false)

  const dirty = !sameFilters(draft, applied)
  // Reset is only offered while some filter (typed or applied) is in effect.
  // "Default" = no filters except the one-month default range (in the current timezone).
  const defaultFilters = useMemo<Filters>(() => ({ ...EMPTY_FILTERS, ...defaultRange(tz) }), [tz])
  const filtersActive = !sameFilters(draft, defaultFilters) || !sameFilters(applied, defaultFilters)
  const dateRangeInvalid = draft.from !== '' && draft.to !== '' && draft.from > draft.to

  // Any change to what's on screen makes an earlier verify result stale.
  function resetView() {
    setCursors([undefined])
    verify.reset()
  }

  // Filters apply as soon as they change: dropdowns and dates right away, the text boxes
  // (search, entity id) once typing pauses. A From date after the To date is held back
  // until it's fixed. Enter in a text box applies immediately.
  const typing = draft.search.trim() !== applied.search.trim() || draft.entityId.trim() !== applied.entityId.trim()
  useEffect(() => {
    if (!dirty || dateRangeInvalid) return
    const timer = setTimeout(() => {
      setApplied(draft)
      setCursors([undefined])
      verify.reset()
    }, typing ? SEARCH_DEBOUNCE_MS : 0)
    return () => clearTimeout(timer)
    // verify.reset is stable for the life of the mutation, so it isn't a dependency.
  }, [draft, applied, dirty, dateRangeInvalid, typing])

  // New entries were reported: refresh the table now if that is safe, otherwise hold back.
  useEffect(() => {
    if (newCount === 0) { setHeldBack(false); return }
    const scrolledAway = (tableRef.current?.getBoundingClientRect().top ?? 0) < -40
    if (selectedEntry || scrolledAway || dirty) { setHeldBack(true); return }
    setHeldBack(false)
    void refetch()
    // Runs when a new answer arrives (count or the row it was measured from changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newCount, newestShownId])

  function showNewEntries() {
    setHeldBack(false)
    void refetch()
    tableRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  function applyFilter(e?: FormEvent) {
    e?.preventDefault()
    if (dateRangeInvalid) return
    setApplied(draft)
    resetView()
  }
  // Drop ?entityId= / ?projectId= from the address too, so a reload doesn't bring the scope back.
  function dropEntityParam() {
    if (!searchParams.has('entityId') && !searchParams.has('projectId')) return
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.delete('entityId')
      next.delete('projectId')
      return next
    }, { replace: true })
  }
  function resetFilter() {
    const defaults = { ...EMPTY_FILTERS, ...defaultRange(tz) }
    setDraft(defaults)
    setApplied(defaults)
    setSortBy('id')
    setOrder('desc')
    dropEntityParam()
    resetView()
  }
  // Removing the entity chip shows the whole trail, back on the one-month default range
  // (the deep link had opened it with no range so the entity's full history showed).
  function clearEntityScope() {
    const range = defaultRange(tz)
    setDraft(d => ({ ...d, entityId: '', projectId: '', ...range }))
    setApplied(a => ({ ...a, entityId: '', projectId: '', ...range }))
    dropEntityParam()
    resetView()
  }
  function quickFilter(action: string) {
    const next = { ...applied, action: applied.action === action ? '' : action }
    setDraft(next)
    setApplied(next)
    resetView()
  }
  function sortColumn(key: AuditSortKey) {
    if (key === sortBy) setOrder(o => (o === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(key); setOrder(key === 'id' || key === 'timestamp' ? 'desc' : 'asc') }
    resetView()
  }
  function changeTz(next: TimeZoneMode) {
    // Keep the chosen range pointing at the same instants, re-expressed in the new timezone.
    const convert = (v: string) => (v ? toInputValue(new Date(rangeToIso(v, 'start', tz)!), next) : '')
    const reTz = (f: Filters): Filters => ({ ...f, from: convert(f.from), to: convert(f.to) })
    setDraft(reTz)
    setApplied(reTz)
    setTz(next)
    resetView()
  }
  // Verify a chain segment. `scopeLabel` names what was checked in the result message.
  function runVerify(scope: VerifyScope, custom?: { fromId: string; toId: string }) {
    setVerifyNote(null)
    if (scope === 'all') {
      setVerifyScopeLabel('Whole chain')
      verify.mutate({})
    } else if (scope === 'page') {
      const ids = (data?.rows ?? []).map(r => BigInt(r.id))
      if (ids.length === 0) { setVerifyNote('There are no entries on this page to verify.'); return }
      const min = ids.reduce((a, b) => (b < a ? b : a))
      const max = ids.reduce((a, b) => (b > a ? b : a))
      setVerifyScopeLabel('Entries on this page')
      verify.mutate({ fromId: String(min), toId: String(max) })
    } else if (scope === 'filters') {
      // The first and last matching entry bound the chain segment to check.
      setLookingUp(true)
      Promise.all([
        auditApi.query({ ...newerFilters, sortBy: 'id', order: 'asc',  limit: 1 }),
        auditApi.query({ ...newerFilters, sortBy: 'id', order: 'desc', limit: 1 }),
      ]).then(([first, last]) => {
        const fromId = first.rows[0]?.id
        const toId = last.rows[0]?.id
        if (!fromId || !toId) { setVerifyNote('No entries match the current filters — nothing to verify.'); return }
        setVerifyScopeLabel('Entries matching the filters')
        verify.mutate({ fromId, toId })
      }).catch(e => setVerifyNote(`Couldn't look up the filtered range: ${describeApiError(e).message}`))
        .finally(() => setLookingUp(false))
    } else if (custom) {
      setVerifyScopeLabel('Custom ID range')
      verify.mutate({ fromId: custom.fromId || undefined, toId: custom.toId || undefined })
    }
  }

  // A clean pass fades out after 4 s. Failures, errors and passes with known
  // exceptions are compliance evidence, so they stay longer (10 s) to be read.
  useEffect(() => {
    if (!verify.data && !verify.error) return
    const clean = !!verify.data?.intact && verify.data.exceptions.length === 0
    const timer = setTimeout(() => verify.reset(), clean ? VERIFY_OK_DISMISS_MS : VERIFY_ISSUE_DISMISS_MS)
    return () => clearTimeout(timer)
    // verify.reset is stable for the life of the mutation.
  }, [verify.data, verify.error])

  useEffect(() => {
    if (!verifyNote) return
    const timer = setTimeout(() => setVerifyNote(null), VERIFY_ISSUE_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [verifyNote])

  const firstRow = pageIndex * PAGE_SIZE + 1
  const lastRow = pageIndex * PAGE_SIZE + (data?.rows.length ?? 0)
  const totalLabel = data ? `${data.total.toLocaleString()}${data.totalCapped ? '+' : ''}` : ''
  const exportOverCap = data ? (data.totalCapped || data.total > AUDIT_EXPORT_ROW_CAP) : false

  return (
    <div className="bg-slate-50" data-screen="audit-trail-viewer-live">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Admin</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Audit Trail</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900">Audit trail</h1>
            {/* Subtitle doubles as the sPM15 immutability notice — always rendered, never behind a toggle. */}
            <p role="note" className="mt-1 flex items-start gap-1.5 text-[12px] text-slate-500" data-section="immutability-notice">
              <svg aria-hidden width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="mt-0.5 flex-none">
                <rect x="3" y="7" width="10" height="7" rx="1.5" />
                <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
              </svg>
              <span>
                Immutable, hash-chained record written at the time of each action — entries can't be edited,
                deleted or reordered (21 CFR Part 11). Filter and export it as compliance evidence.
              </span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <VerifyMenu
                busy={verify.isPending || lookingUp}
                filtersReady={!dirty}
                pageHasRows={(data?.rows.length ?? 0) > 0}
                onVerify={runVerify}
              />
              {dirty ? (
                <button
                  type="button"
                  disabled
                  title={dateRangeInvalid ? 'Fix the date range first' : 'The filters are still updating'}
                  className="cursor-not-allowed rounded-md bg-slate-400 px-3 py-1.5 text-[12px] font-semibold text-white"
                  data-action="export-csv"
                >Export CSV</button>
              ) : (
                <a
                  href={auditExportUrl(baseQuery)}
                  className="rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-slate-700"
                  data-action="export-csv"
                >Export CSV</a>
              )}
            </div>
            <p className="text-[10px] text-slate-500">
              {dirty
                ? (dateRangeInvalid ? 'Fix the date range to export.' : 'Updating filters…')
                : `Exports up to ${AUDIT_EXPORT_ROW_CAP.toLocaleString()} rows, in table order.`}
            </p>
          </div>
        </div>

        {verifyNote && (
          <p className="rounded-md bg-amber-50 p-3 text-[13px] text-amber-900" data-verify-result="note">{verifyNote}</p>
        )}
        {verify.data && (
          <div
            className={`rounded-md p-3 text-[13px] ${verify.data.intact ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}
            data-verify-result={verify.data.intact ? 'ok' : 'fail'}
          >
            <p>
              <span className="font-semibold">{verifyScopeLabel}: </span>
              {verify.data.intact
                ? '✓ Chain intact'
                : `✗ Chain break detected first at id ${verify.data.firstBreakAt}`}
              {(verify.data.checkedRange.from || verify.data.checkedRange.to) &&
                ` (ids ${verify.data.checkedRange.from ?? 'start'}–${verify.data.checkedRange.to ?? 'latest'})`}
              {` · verified ${formatWhen(verify.data.verifiedAt, tz).primary}`}
              {verify.data.exceptions.length > 0 && (
                <span
                  className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                  title={verify.data.exceptions.map(e => `Entry #${e.id}: ${e.summary ?? e.reason}`).join('\n')}
                  data-known-exceptions={verify.data.exceptions.length}
                >
                  Known exceptions ({verify.data.exceptions.length})
                </span>
              )}
            </p>
            {verify.data.exceptions.length > 0 && (
              <div className="mt-2 space-y-2 text-[12px] text-amber-900">
                <p className="font-semibold">
                  Known exceptions: {verify.data.exceptions.length === 1 ? 'one entry' : `${verify.data.exceptions.length} entries`} in
                  this range could not be re-checked because of a past, fixed software defect. They are listed so nothing is hidden.
                </p>
                <ul className="space-y-2">
                  {verify.data.exceptions.map(e => (
                    <li key={e.id}>
                      <span className="font-semibold">Entry #{e.id}</span> — {e.summary ?? e.reason}
                      <details className="mt-1 text-[11px] text-slate-600">
                        <summary className="cursor-pointer select-none">Technical details (for support and auditors)</summary>
                        <p className="mt-1">{e.reason}</p>
                        <p className="mt-1">
                          Fixed in <span className="font-mono">{e.fixedInCommit}</span> · Incident record: <span className="font-mono">{e.incidentDoc}</span>
                        </p>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {verify.error && (
          <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800" data-verify-result="error">
            Verify failed: {describeApiError(verify.error).message}
          </p>
        )}

        {/* Filter form */}
        <form
          onSubmit={applyFilter}
          // With no submit button the browser won't submit on Enter, so apply it here.
          onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') applyFilter(e) }}
          className="rounded-lg border border-slate-200 bg-white p-4"
          data-section="filters"
        >
          {/* Scope from a deep link: ?projectId=… (a project's "Audit trail" button — everything
              in the project) or ?entityId=… (one record). No box in the form; this chip shows the
              scope and removes it. */}
          {scopedEntityId && (
            <div className="mb-3 flex items-center gap-2" data-section="entity-scope">
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 py-0.5 pl-3 pr-1 text-[12px] text-slate-800"
                data-entity-chip={scopedEntityId}
              >
                {scopedProject.data
                  ? <><span className="font-semibold">Project: {scopedProject.data.name}</span><span className="font-mono text-[10px] text-slate-500">{scopedEntityId}</span></>
                  : <><span className="font-semibold">{scopedProjectId ? 'Project:' : 'Entity:'}</span><span className="font-mono text-[11px]">{scopedEntityId}</span></>}
                <button
                  type="button"
                  onClick={clearEntityScope}
                  aria-label="Remove entity filter"
                  title="Show the whole audit trail"
                  className="flex h-5 w-5 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                >
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M3 3l6 6M9 3l-6 6" /></svg>
                </button>
              </span>
              <span className="text-[11px] text-slate-500">
                {scopedProjectId
                  ? "Showing everything in this project — the project record, its documents and its uploads."
                  : `Showing entries recorded against this ${scopedProject.data ? 'project' : 'entity'} only.`}
              </span>
            </div>
          )}
          {/* Fields carry their own placeholder text (no labels above them); aria-labels keep them named for screen readers. */}
          {/* One wrapping row: the search box takes the space the fixed-width filters leave over
              (and drops to its own line on a narrow screen). */}
          <div className="flex flex-wrap items-center gap-2" data-section="quick-filters">
            <div className="relative min-w-[200px] flex-1 basis-[220px]">
              <input
                type="search"
                aria-label="Search"
                aria-describedby="audit-search-hint"
                className={`${inputClass} w-full`}
                placeholder="Search actor, action, entity…"
                value={draft.search}
                onChange={e => setDraft({ ...draft, search: e.target.value })}
                data-field="search"
              />
              {draft.search.trim().length > 0 && draft.search.trim().length < SEARCH_MIN_CHARS && (
                <span id="audit-search-hint" className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
                  {SEARCH_MIN_CHARS - draft.search.trim().length} more…
                </span>
              )}
            </div>
            <select
              aria-label="Event category"
              className={`${inputClass} w-44 ${selectTone(applied.action.trim() === '' || !QUICK_FILTERS.some(f => f.action === applied.action.trim()))}`}
              value={QUICK_FILTERS.some(f => f.action === applied.action.trim()) ? applied.action.trim() : ''}
              onChange={e => quickFilter(e.target.value)}
              data-field="quick-filter"
            >
              <option value="">Select event category…</option>
              {QUICK_FILTERS.map(f => <option key={f.action} value={f.action}>{f.label}</option>)}
            </select>
            {/* No Actor box: the Search field already matches actor name, email and id.
                `actor` stays in the filter state for ?actor= deep links. */}
            <select aria-label="Action" className={`${inputClass} w-36 ${selectTone(draft.action === '')}`} value={draft.action} data-field="action"
              onChange={e => setDraft({ ...draft, action: e.target.value })}>
              <option value="">All actions</option>
              {withCurrent(facets.data?.actions, draft.action).map(a => (
                <option key={a} value={a}>{facets.data?.actions.includes(a) ? a : `${a} (group)`}</option>
              ))}
            </select>
            <select aria-label="Entity type" className={`${inputClass} w-36 ${selectTone(draft.entityType === '')}`} value={draft.entityType} data-field="entity-type"
              onChange={e => setDraft({ ...draft, entityType: e.target.value })}>
              <option value="">All entity types</option>
              {withCurrent(facets.data?.entityTypes, draft.entityType).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <DateTimeRangeFilter from={draft.from} to={draft.to} tz={tz} invalid={dateRangeInvalid}
              onChange={r => setDraft({ ...draft, ...r })} onTzChange={changeTz} />
            <button
              type="button"
              onClick={resetFilter}
              disabled={!filtersActive}
              title={filtersActive ? 'Reset filters to default' : 'Filters are at their defaults'}
              aria-label="Reset filters"
              className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white"
              data-action="reset-filters"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
                <path d="M2.5 2.5v2.8h2.8" />
              </svg>
            </button>
          </div>
          {dateRangeInvalid && (
            <p className="mt-3 text-[11px] text-red-700">The range's "From" is after its "To".</p>
          )}
        </form>

        {/* Results */}
        {isLoading && <p className="text-[13px] text-slate-500">Loading…</p>}
        {error && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800">{describeApiError(error).message}</p>}

        {canFollow && heldBack && newCount > 0 && (
          <button
            type="button"
            onClick={showNewEntries}
            className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-left text-[12px] font-semibold text-blue-800 hover:bg-blue-100"
            data-action="show-new-entries"
          >
            {newCount}{newer.data?.capped ? '+' : ''} new {newCount === 1 && !newer.data?.capped ? 'entry' : 'entries'} — click to show
          </button>
        )}

        {data && (
          <div ref={tableRef} className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[12px] text-slate-600">
              <span>
                {data.rows.length > 0
                  ? `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${totalLabel}`
                  : `0 of ${totalLabel}`}
                {exportOverCap && !dirty && (
                  <span className="ml-2 text-amber-700">
                    · more than {AUDIT_EXPORT_ROW_CAP.toLocaleString()} matches; narrow the filters to export everything
                  </span>
                )}
              </span>
              <span className="text-[11px] text-slate-500">Page {pageIndex + 1}</span>
            </div>
            <table className="w-full text-[13px]">
              <thead style={{ backgroundColor: '#F8FAFC' }}>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  {SORT_COLUMNS.map(col => (
                    <SortHeader key={col.key} col={col} sortBy={sortBy} order={order} onSort={sortColumn} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map(row => (
                  <AuditRow key={row.id} entry={row} tz={tz} selected={selectedEntry?.id === row.id} onSelect={setSelectedEntry} />
                ))}
                {data.rows.length === 0 && (
                  <tr><td colSpan={5}className="px-4 py-6 text-center text-[12px] text-slate-500">No audit entries match your filters.</td></tr>
                )}
              </tbody>
            </table>
            {(pageIndex > 0 || data.hasMore) && (
              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-[12px] text-slate-600">
                <button
                  type="button"
                  onClick={() => setCursors(c => c.slice(0, -1))}
                  disabled={pageIndex === 0 || isFetching}
                  className="rounded-md border border-slate-300 px-3 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-40"
                >← Previous</button>
                <span>Page {pageIndex + 1}</span>
                <button
                  type="button"
                  onClick={() => data.nextCursor && setCursors(c => [...c, data.nextCursor ?? undefined])}
                  disabled={!data.hasMore || isFetching}
                  className="rounded-md bg-slate-800 px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
                >Next →</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row details — right-hand panel. Esc, the X, or a click outside closes it. */}
      <SlidePanel
        open={selectedEntry !== null}
        onClose={() => setSelectedEntry(null)}
        title={selectedEntry ? `Audit entry #${selectedEntry.id}` : 'Audit entry'}
        subtitle={selectedEntry?.action}
        storageKey="clinwrite.auditPanelWidth"
        defaultWidth={520}
        maxWidth={1100}
        closeOnOutsideClick
      >
        {selectedEntry && <div className="p-5"><DetailPanel entry={selectedEntry} tz={tz} /></div>}
      </SlidePanel>
    </div>
  )
}
