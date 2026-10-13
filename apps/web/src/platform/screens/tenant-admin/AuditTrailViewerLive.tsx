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

import { useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  useAuditQuery, useAuditVerify, useAuditFacets, auditExportUrl, type AuditQuery,
} from '../../../hooks'
import { describeApiError, AUDIT_EXPORT_ROW_CAP, type AuditEntry } from '../../../api'

const PAGE_SIZE = 100

type TimeZoneMode = 'local' | 'utc'

interface Filters {
  actor: string
  action: string
  entityType: string
  entityId: string
  fromDay: string   // YYYY-MM-DD from <input type="date">
  toDay: string
}

const EMPTY_FILTERS: Filters = { actor: '', action: '', entityType: '', entityId: '', fromDay: '', toDay: '' }

function filtersFromUrl(params: URLSearchParams): Filters {
  return {
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

function toAuditQuery(f: Filters, tz: TimeZoneMode): Omit<AuditQuery, 'limit' | 'cursor' | 'order'> {
  const val = (s: string) => s.trim() || undefined
  return {
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

function shortHash(hash: string): string {
  return hash ? `${hash.slice(0, 8)}…` : '—'
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

function ActorCell({ entry }: { entry: AuditEntry }) {
  if (entry.actorName || entry.actorEmail) {
    return (
      <div title={`${entry.actorEmail ?? ''}\n${entry.actorId}`}>
        <p className="font-semibold text-slate-700">{entry.actorName ?? entry.actorEmail}</p>
        {entry.actorName && entry.actorEmail && (
          <p className="text-[10px] text-slate-500">{entry.actorEmail}</p>
        )}
      </div>
    )
  }
  if (entry.actorId === 'anonymous') {
    return <p className="text-[11px] italic text-slate-500" title="anonymous">System / unauthenticated</p>
  }
  return <p className="font-mono text-[11px] text-slate-500">{entry.actorId}</p>
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked (insecure context / permissions) — no-op */ }
  }
  return (
    <button type="button" onClick={copy} className="ml-2 text-[10px] font-semibold text-slate-500 hover:underline">
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function detailValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

function DetailPanel({ entry }: { entry: AuditEntry }) {
  const [showRaw, setShowRaw] = useState(false)
  const pairs = Object.entries(entry.details ?? {})
  return (
    <div className="flex flex-col gap-3 rounded-md bg-slate-50 p-3 text-[11px] text-slate-700">
      {pairs.length > 0 ? (
        <table className="w-full max-w-3xl">
          <tbody>
            {pairs.map(([k, v]) => (
              <tr key={k}>
                <td className="w-40 py-0.5 pr-3 align-top font-semibold text-slate-500">{k}</td>
                <td className="break-all py-0.5 font-mono">{detailValue(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-slate-500">No details recorded.</p>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] text-slate-500">
        <span title={entry.rowHash}>Row hash: {shortHash(entry.rowHash)}<CopyButton value={entry.rowHash} /></span>
        <span title={entry.prevHash}>Prev hash: {shortHash(entry.prevHash)}</span>
        <span>Actor id: {entry.actorId}</span>
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

function AuditRow({ entry, tz }: { entry: AuditEntry; tz: TimeZoneMode }) {
  const [expanded, setExpanded] = useState(false)
  const when = formatWhen(entry.timestamp, tz)
  return (
    <>
      <tr className="border-t border-slate-200" data-audit-row={entry.id}>
        <td className="px-4 py-3 font-mono text-[11px] text-slate-500 align-top">{entry.id}</td>
        <td className="px-4 py-3 font-mono text-[11px] text-slate-700 align-top" title={when.secondary}>{when.primary}</td>
        <td className="px-4 py-3 align-top"><ActionBadge action={entry.action} /></td>
        <td className="px-4 py-3 text-slate-700 align-top">
          <p className="font-semibold">{entry.entityType}</p>
          <p className="break-all font-mono text-[10px] text-slate-500">{entry.entityId}</p>
        </td>
        <td className="px-4 py-3 align-top"><ActorCell entry={entry} /></td>
        <td className="px-4 py-3 font-mono text-[11px] text-slate-500 align-top">{entry.ipAddress ?? '—'}</td>
        <td className="px-4 py-3 align-top">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="text-[11px] font-semibold text-slate-600 hover:underline"
            aria-expanded={expanded}
          >{expanded ? 'Hide' : 'Show'} details</button>
        </td>
      </tr>
      {expanded && (
        <tr data-audit-detail={entry.id}>
          <td colSpan={7} className="px-4 pb-3"><DetailPanel entry={entry} /></td>
        </tr>
      )}
    </>
  )
}

const inputClass = 'rounded-md border border-slate-300 px-2 py-1.5 text-[12px]'
const labelClass = 'flex flex-col gap-1 text-[11px] text-slate-500'

export function AuditTrailViewerLive() {
  const [searchParams] = useSearchParams()
  const initialFilters = useMemo(() => filtersFromUrl(searchParams), [searchParams])

  const [draft, setDraft] = useState<Filters>(initialFilters)
  const [applied, setApplied] = useState<Filters>(initialFilters)
  const [order, setOrder] = useState<'desc' | 'asc'>('desc')
  const [tz, setTz] = useState<TimeZoneMode>('local')
  // Cursor for each visited page; index 0 (page 1) has no cursor.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const pageIndex = cursors.length - 1

  const baseQuery = useMemo(() => ({ ...toAuditQuery(applied, tz), order }), [applied, tz, order])
  const query: AuditQuery = { ...baseQuery, limit: PAGE_SIZE, cursor: cursors[pageIndex] }
  const { data, isLoading, isFetching, error, refetch } = useAuditQuery(query)
  const facets = useAuditFacets()

  const verify = useAuditVerify()
  const [verifyFromId, setVerifyFromId] = useState('')
  const [verifyToId, setVerifyToId] = useState('')

  const dirty = !sameFilters(draft, applied)
  const dateRangeInvalid = draft.fromDay !== '' && draft.toDay !== '' && draft.fromDay > draft.toDay

  // Any change to what's on screen makes an earlier verify result stale.
  function resetView() {
    setCursors([undefined])
    verify.reset()
  }

  function applyFilter(e?: FormEvent) {
    e?.preventDefault()
    if (dateRangeInvalid) return
    setApplied(draft)
    resetView()
  }
  function resetFilter() {
    setDraft(EMPTY_FILTERS)
    setApplied(EMPTY_FILTERS)
    resetView()
  }
  function refresh() {
    verify.reset()
    void refetch()
  }
  function changeOrder(next: 'desc' | 'asc') {
    setOrder(next)
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
          <p
            className={`rounded-md p-3 text-[13px] ${verify.data.intact ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}
            data-verify-result={verify.data.intact ? 'ok' : 'fail'}
          >
            {verify.data.intact
              ? '✓ Chain intact'
              : `✗ Chain break detected first at id ${verify.data.firstBreakAt}`}
            {(verify.data.checkedRange.from || verify.data.checkedRange.to) &&
              ` (ids ${verify.data.checkedRange.from ?? 'start'}–${verify.data.checkedRange.to ?? 'latest'})`}
            {` · verified ${formatWhen(verify.data.verifiedAt, tz).primary}`}
          </p>
        )}
        {verify.error && (
          <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800" data-verify-result="error">
            Verify failed: {describeApiError(verify.error).message}
          </p>
        )}

        {/* Filter form */}
        <form onSubmit={applyFilter} className="rounded-lg border border-slate-200 bg-white p-4" data-section="filters">
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <label className={labelClass}>
              Actor (name, email or id)
              <input className={inputClass} value={draft.actor}
                onChange={e => setDraft({ ...draft, actor: e.target.value })} />
            </label>
            <label className={labelClass}>
              Action (contains)
              <input className={inputClass} list="audit-actions" value={draft.action}
                onChange={e => setDraft({ ...draft, action: e.target.value })} />
              <datalist id="audit-actions">
                {facets.data?.actions.map(a => <option key={a} value={a} />)}
              </datalist>
            </label>
            <label className={labelClass}>
              Entity type (contains)
              <input className={inputClass} list="audit-entity-types" value={draft.entityType}
                onChange={e => setDraft({ ...draft, entityType: e.target.value })} />
              <datalist id="audit-entity-types">
                {facets.data?.entityTypes.map(t => <option key={t} value={t} />)}
              </datalist>
            </label>
            <label className={labelClass}>
              Entity id (exact)
              <input className={inputClass} value={draft.entityId}
                onChange={e => setDraft({ ...draft, entityId: e.target.value })} />
            </label>
            <label className={labelClass}>
              From date
              <input type="date" className={inputClass} value={draft.fromDay}
                onChange={e => setDraft({ ...draft, fromDay: e.target.value })} />
            </label>
            <label className={labelClass}>
              To date
              <input type="date" className={inputClass} value={draft.toDay}
                onChange={e => setDraft({ ...draft, toDay: e.target.value })} />
            </label>
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
                <select className={inputClass} value={order} onChange={e => changeOrder(e.target.value as 'desc' | 'asc')}>
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
              </label>
              {dateRangeInvalid && <span className="text-red-700">From date is after To date.</span>}
              {dirty && !dateRangeInvalid && <span className="text-amber-700">Filters changed — click Apply.</span>}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={resetFilter} className="rounded-md px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-100">Reset</button>
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
                  <th className="px-4 py-2">ID</th>
                  <th className="px-4 py-2">When</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">Entity</th>
                  <th className="px-4 py-2">Actor</th>
                  <th className="px-4 py-2">IP</th>
                  <th className="px-4 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(row => <AuditRow key={row.id} entry={row} tz={tz} />)}
                {data.rows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-[12px] text-slate-500">No audit entries match your filters.</td></tr>
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
    </div>
  )
}
