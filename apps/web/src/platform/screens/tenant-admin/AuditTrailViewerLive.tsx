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

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SlidePanel } from '../../../components/ui/SlidePanel'
import { MODULE_KEY_TO_LABEL, type ModuleKey } from '../../../config/modules'
import {
  useAuditQuery, useAuditVerify, useAuditFacets, auditExportUrl, type AuditQuery,
} from '../../../hooks'
import { describeApiError, AUDIT_EXPORT_ROW_CAP, type AuditEntry, type AuditSortKey } from '../../../api'

const PAGE_SIZE = 100
// Pause after the last keystroke before the search box applies itself.
const SEARCH_DEBOUNCE_MS = 400

type TimeZoneMode = 'local' | 'utc'

interface Filters {
  search: string    // free-text, matches across the visible columns
  actor: string
  action: string
  entityType: string
  entityId: string
  fromDay: string   // YYYY-MM-DD from <input type="date">
  toDay: string
}

const EMPTY_FILTERS: Filters = { search: '', actor: '', action: '', entityType: '', entityId: '', fromDay: '', toDay: '' }

function filtersFromUrl(params: URLSearchParams): Filters {
  return {
    search:     params.get('q') ?? '',
    actor:      params.get('actor') ?? params.get('actorId') ?? '',
    action:     params.get('action') ?? '',
    entityType: params.get('entityType') ?? '',
    entityId:   params.get('entityId') ?? '',
    fromDay:    '',
    toDay:      '',
  }
}

function sameFilters(a: Filters, b: Filters): boolean {
  return (Object.keys(a) as (keyof Filters)[]).every(k => a[k].trim() === b[k].trim())
}

// A picked calendar day → the ISO instant at the start / end of that day,
// in the timezone the viewer has chosen.
function dayToIso(day: string, edge: 'start' | 'end', tz: TimeZoneMode): string | undefined {
  if (!day) return undefined
  const time = edge === 'start' ? 'T00:00:00.000' : 'T23:59:59.999'
  return tz === 'utc'
    ? `${day}${time}Z`
    : new Date(`${day}${time}`).toISOString()  // no suffix → parsed as browser-local
}

function toAuditQuery(f: Filters, tz: TimeZoneMode): Omit<AuditQuery, 'limit' | 'cursor' | 'order' | 'sortBy'> {
  const val = (s: string) => s.trim() || undefined
  return {
    q:          val(f.search),
    actor:      val(f.actor),
    action:     val(f.action),
    entityType: val(f.entityType),
    entityId:   val(f.entityId),
    fromDate:   dayToIso(f.fromDay, 'start', tz),
    toDate:     dayToIso(f.toDay, 'end', tz),
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
const labelClass = 'flex flex-col gap-1 text-[11px] text-slate-500'

// A dropdown showing its "All…" / "Select…" placeholder reads grey, like an empty input.
const selectTone = (isPlaceholder: boolean) => (isPlaceholder ? 'text-slate-500' : 'text-slate-900')

// Date input that shows a text placeholder ("From date") while empty, instead of dd-mm-yyyy.
// The native input is still there (calendar picker, keyboard entry); its own text is hidden
// until a date is chosen or the field is focused.
function DateField({ value, onChange, placeholder, className = '' }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  const [focused, setFocused] = useState(false)
  const showPlaceholder = value === '' && !focused
  return (
    <div className={`relative ${className}`}>
      <input
        type="date"
        aria-label={placeholder}
        className={`${inputClass} w-full`}
        style={showPlaceholder ? { color: 'transparent' } : undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {showPlaceholder && (
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-slate-500">{placeholder}</span>
      )}
    </div>
  )
}

export function AuditTrailViewerLive() {
  const [searchParams] = useSearchParams()
  const initialFilters = useMemo(() => filtersFromUrl(searchParams), [searchParams])

  const [draft, setDraft] = useState<Filters>(initialFilters)
  const [applied, setApplied] = useState<Filters>(initialFilters)
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

  const verify = useAuditVerify()
  const [verifyFromId, setVerifyFromId] = useState('')
  const [verifyToId, setVerifyToId] = useState('')

  const dirty = !sameFilters(draft, applied)
  // Reset is only offered while some filter (typed or applied) is in effect.
  const filtersActive = !sameFilters(draft, EMPTY_FILTERS) || !sameFilters(applied, EMPTY_FILTERS)
  const dateRangeInvalid = draft.fromDay !== '' && draft.toDay !== '' && draft.fromDay > draft.toDay

  // Any change to what's on screen makes an earlier verify result stale.
  function resetView() {
    setCursors([undefined])
    verify.reset()
  }

  // Search applies itself once typing pauses (debounced); the other filter
  // fields still wait for Apply. Only the search term is taken from the draft,
  // so half-typed actor/date fields aren't applied behind the user's back.
  const draftSearch = draft.search
  const appliedSearch = applied.search
  useEffect(() => {
    if (draftSearch.trim() === appliedSearch.trim()) return
    const timer = setTimeout(() => {
      setApplied(a => ({ ...a, search: draftSearch }))
      setCursors([undefined])
      verify.reset()
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // verify.reset is stable for the life of the mutation, so it isn't a dependency.
  }, [draftSearch, appliedSearch])

  function applyFilter(e?: FormEvent) {
    e?.preventDefault()
    if (dateRangeInvalid) return
    setApplied(draft)
    resetView()
  }
  function resetFilter() {
    setDraft(EMPTY_FILTERS)
    setApplied(EMPTY_FILTERS)
    setSortBy('id')
    setOrder('desc')
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
  function refresh() {
    verify.reset()
    void refetch()
  }
  function changeOrder(next: 'desc' | 'asc') {
    setOrder(next)
    setSortBy('id')
    resetView()
  }
  function changeTz(next: TimeZoneMode) {
    setTz(next)
    resetView()
  }
  function runVerify() {
    verify.mutate({ fromId: verifyFromId.trim() || undefined, toId: verifyToId.trim() || undefined })
  }

  const verifyRangeInvalid = [verifyFromId, verifyToId].some(v => v.trim() !== '' && !/^\d+$/.test(v.trim()))

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
            <p className="mt-1 text-[12px] text-slate-500">
              Immutable hash-chained log. Filter + export for compliance evidence.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={runVerify}
                disabled={verify.isPending || verifyRangeInvalid}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                data-action="verify-chain"
              >
                {verify.isPending ? 'Verifying…' : (verifyFromId || verifyToId) ? 'Verify range' : 'Verify chain'}
              </button>
              {dirty ? (
                <button
                  type="button"
                  disabled
                  title="Apply your filter changes first so the export matches the table"
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
                ? 'Apply filters first to export them.'
                : `Exports up to ${AUDIT_EXPORT_ROW_CAP.toLocaleString()} rows, in table order.`}
            </p>
          </div>
        </div>

        {/* Immutability notice — sPM15 spec text; always rendered, never behind a toggle. */}
        <p
          role="note"
          className="flex items-start gap-2 rounded-md border px-3 py-2 text-[12px]"
          style={{ backgroundColor: '#F0F7FA', borderColor: '#BFDBFE', color: '#005F8E' }}
          data-section="immutability-notice"
        >
          <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="mt-0.5 flex-none">
            <rect x="3" y="7" width="10" height="7" rx="1.5" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
          </svg>
          <span>
            This audit trail is immutable. Entries cannot be edited, deleted, or reordered. Every entry was
            written at the time of the action it describes. Compliant with 21 CFR Part 11.
          </span>
        </p>

        {/* Verify range (optional) */}
        <section className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3" data-section="verify-range">
          <label className={labelClass}>
            Verify from id (optional)
            <input className={`${inputClass} w-40`} inputMode="numeric" placeholder="e.g. 1"
              value={verifyFromId} onChange={e => { setVerifyFromId(e.target.value); verify.reset() }} />
          </label>
          <label className={labelClass}>
            Verify to id (optional)
            <input className={`${inputClass} w-40`} inputMode="numeric" placeholder="latest"
              value={verifyToId} onChange={e => { setVerifyToId(e.target.value); verify.reset() }} />
          </label>
          <p className="pb-2 text-[11px] text-slate-500">
            {verifyRangeInvalid ? <span className="text-red-700">Ids must be whole numbers.</span> : 'Leave both empty to verify the whole chain.'}
          </p>
        </section>

        {verify.data && (
          <div
            className={`rounded-md p-3 text-[13px] ${verify.data.intact ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}
            data-verify-result={verify.data.intact ? 'ok' : 'fail'}
          >
            <p>
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
        <form onSubmit={applyFilter} className="rounded-lg border border-slate-200 bg-white p-4" data-section="filters">
          {/* Fields carry their own placeholder text (no labels above them); aria-labels keep them named for screen readers. */}
          {/* One wrapping row: the search box takes the space the fixed-width filters leave over
              (and drops to its own line on a narrow screen). */}
          <div className="flex flex-wrap items-center gap-2" data-section="quick-filters">
            <input
              type="search"
              aria-label="Search"
              className={`${inputClass} min-w-[200px] flex-1 basis-[220px]`}
              placeholder="Search actor, action, entity…"
              value={draft.search}
              onChange={e => setDraft({ ...draft, search: e.target.value })}
              data-field="search"
            />
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
            <input aria-label="Entity id (exact match)" placeholder="Entity id (exact)" className={`${inputClass} w-32`} value={draft.entityId}
              onChange={e => setDraft({ ...draft, entityId: e.target.value })} />
            <DateField className="w-32" placeholder="From date" value={draft.fromDay}
              onChange={v => setDraft({ ...draft, fromDay: v })} />
            <DateField className="w-32" placeholder="To date" value={draft.toDay}
              onChange={v => setDraft({ ...draft, toDay: v })} />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
              <label className="flex items-center gap-1">
                Times in
                <select className={inputClass} value={tz} onChange={e => changeTz(e.target.value as TimeZoneMode)}>
                  <option value="local">Local ({Intl.DateTimeFormat().resolvedOptions().timeZone})</option>
                  <option value="utc">UTC</option>
                </select>
              </label>
              <label className="flex items-center gap-1">
                Order
                <select className={inputClass} value={sortBy === 'id' ? order : 'custom'} onChange={e => changeOrder(e.target.value as 'desc' | 'asc')}>
                  {sortBy !== 'id' && <option value="custom" disabled>By column ({sortBy}, {order === 'asc' ? 'asc' : 'desc'})</option>}
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </label>
              {dateRangeInvalid && <span className="text-red-700">From date is after To date.</span>}
              {dirty && !dateRangeInvalid && <span className="text-amber-700">Filters changed — click Apply.</span>}
            </div>
            <div className="flex gap-2">
              {filtersActive && (
                <button type="button" onClick={resetFilter} className="rounded-md px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-100" data-action="reset-filters">Reset</button>
              )}
              <button type="submit" disabled={dateRangeInvalid} className="rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50" data-action="apply-filter">Apply</button>
              <button type="button" onClick={refresh} className="rounded-md border border-slate-300 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50">
                {isFetching && !isLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
        </form>

        {/* Results */}
        {isLoading && <p className="text-[13px] text-slate-500">Loading…</p>}
        {error && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800">{describeApiError(error).message}</p>}

        {data && (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
