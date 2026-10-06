// Audit trail viewer (live) — Arc 4.7 of docs/pivot-plan.md.
//
// Super-admin only. Paginated filter form over the real audit_events
// table with hash-chain verify button + CSV export via <a href> (the
// browser handles the download; cookie travels via credentials:'include').

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  useAuditQuery, useAuditVerify, auditExportUrl, type AuditQuery,
} from '../../../hooks'
import { describeApiError, type AuditEntry } from '../../../api'

function formatUTC(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hh}:${mm}:${ss} UTC`
}

function ActionBadge({ action }: { action: string }) {
  // Shape the badge by action namespace. Everything's bucketed by the
  // first dot or underscore segment so e.g. 'tenant.update' and
  // 'tenant.modules.update' land in the same palette.
  const kind = action.startsWith('tenant')     ? { bg: '#F0F7FA', fg: '#005F8E' }
             : action.startsWith('membership') ? { bg: '#EFF6FF', fg: '#1D4ED8' }
             : action.startsWith('sso')        ? { bg: '#F0FDF4', fg: '#166534' }
             : action.startsWith('user')       ? { bg: '#FFFBEB', fg: '#B45309' }
             : action.includes('signature')    ? { bg: '#F0F7FA', fg: '#005F8E' }
             : { bg: '#F1F5F9', fg: '#475569' }
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold"
      style={{ backgroundColor: kind.bg, color: kind.fg }}
    >{action}</span>
  )
}

function DetailRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <tr className="border-t border-slate-200" data-audit-row={entry.id}>
      <td className="px-4 py-3 font-mono text-[11px] text-slate-500 align-top">{entry.id}</td>
      <td className="px-4 py-3 font-mono text-[11px] text-slate-700 align-top">{formatUTC(entry.timestamp)}</td>
      <td className="px-4 py-3 align-top"><ActionBadge action={entry.action} /></td>
      <td className="px-4 py-3 text-slate-700 align-top">
        <p className="font-semibold">{entry.entityType}</p>
        <p className="font-mono text-[10px] text-slate-500">{entry.entityId}</p>
      </td>
      <td className="px-4 py-3 font-mono text-[11px] text-slate-500 align-top">{entry.actorId}</td>
      <td className="px-4 py-3 align-top">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="text-[11px] font-semibold text-slate-600 hover:underline"
        >{expanded ? 'Hide' : 'Show'} details</button>
        {expanded && (
          <pre className="mt-2 max-w-xl overflow-auto rounded-md bg-slate-50 p-2 text-[10px] text-slate-700">
            {JSON.stringify(entry.details, null, 2)}
          </pre>
        )}
      </td>
    </tr>
  )
}

export function AuditTrailViewerLive() {
  const [query, setQuery] = useState<AuditQuery>({ limit: 100 })
  const [draft, setDraft] = useState<AuditQuery>({ limit: 100 })
  const { data, isLoading, error, refetch } = useAuditQuery(query)
  const verify = useAuditVerify()
  const [verifyResult, setVerifyResult] = useState<{ intact: boolean; firstBreakAt: string | null } | null>(null)

  function applyFilter() { setQuery(draft) }
  function resetFilter() {
    const empty: AuditQuery = { limit: 100 }
    setDraft(empty); setQuery(empty)
  }

  const runVerify = useMutation({
    mutationFn: () => verify.mutateAsync({}),
    onSuccess: (r) => setVerifyResult({ intact: r.intact, firstBreakAt: r.firstBreakAt }),
  })

  return (
    <div className="bg-slate-50" data-screen="audit-trail-viewer-live">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Admin</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Audit Trail</span>
        </nav>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900">Audit trail</h1>
            <p className="mt-1 text-[12px] text-slate-500">
              Immutable hash-chained log. Filter + export for compliance evidence.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => runVerify.mutate()}
              disabled={runVerify.isPending}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              data-action="verify-chain"
            >
              {runVerify.isPending ? 'Verifying…' : 'Verify chain'}
            </button>
            <a
              href={auditExportUrl({
                actorId:    query.actorId,
                entityType: query.entityType,
                entityId:   query.entityId,
                action:     query.action,
                fromDate:   query.fromDate,
                toDate:     query.toDate,
              })}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-slate-700"
              data-action="export-csv"
            >Export CSV</a>
          </div>
        </div>

        {verifyResult && (
          <p
            className={`rounded-md p-3 text-[13px] ${verifyResult.intact ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}
            data-verify-result={verifyResult.intact ? 'ok' : 'fail'}
          >
            {verifyResult.intact
              ? '✓ Chain intact.'
              : `✗ Chain break detected first at id ${verifyResult.firstBreakAt}.`}
          </p>
        )}

        {/* Filter form */}
        <section className="rounded-lg border border-slate-200 bg-white p-4" data-section="filters">
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              Actor id
              <input className="rounded-md border border-slate-300 px-2 py-1.5 text-[12px]"
                value={draft.actorId ?? ''}
                onChange={e => setDraft({ ...draft, actorId: e.target.value || undefined })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              Entity type
              <input className="rounded-md border border-slate-300 px-2 py-1.5 text-[12px]"
                value={draft.entityType ?? ''}
                onChange={e => setDraft({ ...draft, entityType: e.target.value || undefined })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              Entity id
              <input className="rounded-md border border-slate-300 px-2 py-1.5 text-[12px]"
                value={draft.entityId ?? ''}
                onChange={e => setDraft({ ...draft, entityId: e.target.value || undefined })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              Action
              <input className="rounded-md border border-slate-300 px-2 py-1.5 text-[12px]"
                value={draft.action ?? ''}
                onChange={e => setDraft({ ...draft, action: e.target.value || undefined })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              From (ISO date-time)
              <input className="rounded-md border border-slate-300 px-2 py-1.5 text-[12px]"
                placeholder="2026-10-01T00:00:00Z"
                value={draft.fromDate ?? ''}
                onChange={e => setDraft({ ...draft, fromDate: e.target.value || undefined })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              To (ISO date-time)
              <input className="rounded-md border border-slate-300 px-2 py-1.5 text-[12px]"
                placeholder="2026-10-31T23:59:59Z"
                value={draft.toDate ?? ''}
                onChange={e => setDraft({ ...draft, toDate: e.target.value || undefined })} />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={resetFilter} className="rounded-md px-3 py-1.5 text-[12px] text-slate-600 hover:bg-slate-100">Reset</button>
            <button type="button" onClick={applyFilter} className="rounded-md bg-slate-800 px-3 py-1.5 text-[12px] font-semibold text-white" data-action="apply-filter">Apply</button>
            <button type="button" onClick={() => refetch()} className="rounded-md border border-slate-300 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50">Refresh</button>
          </div>
        </section>

        {/* Results */}
        {isLoading && <p className="text-[13px] text-slate-500">Loading…</p>}
        {error && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800">{describeApiError(error).message}</p>}

        {data && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-[13px]">
              <thead style={{ backgroundColor: '#F8FAFC' }}>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-2">ID</th>
                  <th className="px-4 py-2">When</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">Entity</th>
                  <th className="px-4 py-2">Actor</th>
                  <th className="px-4 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(row => <DetailRow key={row.id} entry={row} />)}
                {data.rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-[12px] text-slate-500">No audit entries match your filters.</td></tr>
                )}
              </tbody>
            </table>
            {data.hasMore && (
              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-[12px] text-slate-600">
                <span>{data.rows.length} rows · more available</span>
                <button
                  type="button"
                  onClick={() => setQuery({ ...query, cursor: data.nextCursor ?? undefined })}
                  className="rounded-md bg-slate-800 px-3 py-1 text-[11px] font-semibold text-white"
                >Load next page</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
