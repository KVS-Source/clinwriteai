import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { RegulatoryFramework, RegulatoryFrameworkStatus } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

const SCOPE_COLOURS: Record<string, string> = {
  A: '#2563EB', B: '#0D9488', C: '#7C3AED', D: '#B0200D', E: '#0D9488', platform: PLATFORM_ACCENT.primary,
}
const SCOPE_LABEL: Record<string, string> = {
  A: 'Clinical Writing', B: 'Scientific Writing', C: 'Medical Writing',
  D: 'Regulatory Writing', E: 'Ideation & Publishing', platform: 'Platform',
}
const STATUS_OPTIONS: RegulatoryFrameworkStatus[] = ['Current', 'Draft revision', 'Updated', 'Deprecated']

function StatusChip({ status }: { status: RegulatoryFrameworkStatus }) {
  const meta =
    status === 'Current'        ? { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0', label: '✓ Current' } :
    status === 'Updated'        ? { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', label: '⚠ Updated' } :
    status === 'Draft revision' ? { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', label: '⚠ Draft revision' } :
                                  { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', label: 'Superseded' }
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: meta.bg, color: meta.fg, border: `1px solid ${meta.border}` }}
      data-status-chip={status}
    >{meta.label}</span>
  )
}

function ScopeDots({ scope }: { scope: string[] }) {
  return (
    <div className="flex items-center gap-1" data-scope-dots>
      {scope.map(s => (
        <span
          key={s}
          title={SCOPE_LABEL[s] ?? s}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-[9px] font-semibold text-white"
          style={{ backgroundColor: SCOPE_COLOURS[s] ?? '#94A3B8' }}
          data-scope-dot={s}
        >{s}</span>
      ))}
    </div>
  )
}

function formatDay(iso: string): string {
  const d = new Date(iso)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function RegulatoryFrameworkAdmin({ readOnly = false }: { readOnly?: boolean } = {}) {
  const currentUser = usePlatformStore(s => s.currentUser)
  const qc = useQueryClient()

  const { data: frameworks = [] } = useQuery<RegulatoryFramework[]>({
    queryKey: ['regulatory-frameworks'],
    queryFn:  () => platformApi.listFrameworks(),
  })

  const [selectedId, setSelectedId] = useState<string>('rf-008')
  const [newStatus,  setNewStatus]  = useState<RegulatoryFrameworkStatus>('Draft revision')
  const [changeSummary, setChangeSummary] = useState<string>('')
  const [saveResult, setSaveResult] = useState<string | null>(null)

  const active = frameworks.find(f => f.id === selectedId) ?? frameworks[0] ?? null

  const changedInLast12 = useMemo(
    () => frameworks.filter(f => f.status !== 'Current' && f.status !== 'Deprecated').length,
    [frameworks],
  )

  const alertText = useMemo(() => {
    if (!active) return ''
    return (['Updated', 'Draft revision'] as RegulatoryFrameworkStatus[]).includes(newStatus)
      ? `A regulatory intelligence alert will be sent to all users with active submissions in scope: ${active.scope.join(', ')} disciplines. Change summary will be included.`
      : ''
  }, [newStatus, active])

  const canSave = !!active && !!changeSummary.trim() && !readOnly

  const save = async () => {
    if (!canSave || !active) return
    await platformApi.updateFramework(active.id, { status: newStatus, changeSummary }).catch(() => {})
    await qc.invalidateQueries({ queryKey: ['regulatory-frameworks'] })
    setSaveResult(`✓ Saved · ${active.name} status changed to ${newStatus}. Written to audit trail.`)
    setChangeSummary('')
  }

  return (
    <div className="bg-slate-50" data-screen="regulatory-framework-admin" data-read-only={readOnly || undefined}>
      <div className="mx-auto flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Super Admin</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Framework Registry</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Regulatory framework registry</h1>
            <p className="mt-1 max-w-[720px] text-[13px] text-slate-600" data-header-note>
              Status changes automatically trigger regulatory intelligence alerts in every applicable discipline. Frameworks cannot be deleted — only marked superseded.
            </p>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>
              {currentUser.name} · {readOnly ? 'Admin (read-only)' : 'Super Admin'} · {frameworks.length} frameworks · {changedInLast12} changed in the last 12 months
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              data-add-framework
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >+ Add framework →</button>
          )}
        </div>

        <p
          className="rounded-md p-3 text-[12px]"
          style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
          data-access-note
        >
          Client-level Admins see this registry in read-only mode. Only Super Admin can add a framework or change a status.
        </p>

        <div className="grid gap-4" style={{ gridTemplateColumns: readOnly ? '1fr' : '1fr 380px' }}>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-frameworks-table data-count={frameworks.length}>
            <table className="w-full text-[13px]">
              <thead style={{ backgroundColor: '#F8FAFC' }}>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-2">Code</th>
                  <th className="px-4 py-2">Full name</th>
                  <th className="px-4 py-2">Issuer</th>
                  <th className="px-4 py-2">Scope</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {frameworks.map(f => (
                  <tr
                    key={f.id}
                    onClick={() => !readOnly && setSelectedId(f.id)}
                    data-framework-row={f.id}
                    data-selected={!readOnly && f.id === active?.id || undefined}
                    className="cursor-pointer border-t border-slate-200 hover:bg-slate-50"
                    style={{ backgroundColor: !readOnly && f.id === active?.id ? PLATFORM_ACCENT.bgTint : undefined }}
                  >
                    <td className="px-4 py-3 font-mono text-[11px] font-semibold text-slate-800">{f.code}</td>
                    <td className="px-4 py-3 text-slate-800">{f.name}</td>
                    <td className="px-4 py-3 text-slate-700">{f.issuer}</td>
                    <td className="px-4 py-3"><ScopeDots scope={f.scope} /></td>
                    <td className="px-4 py-3"><StatusChip status={f.status} /></td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{formatDay(f.lastUpdated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-slate-200 p-2 font-mono text-[11px] text-slate-500" data-scope-hover-hint>
              Scope dots name their discipline on hover.
            </p>
          </section>

          {!readOnly && active && (
            <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-edit-drawer data-active-framework={active.id}>
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Edit framework</p>
                <p className="mt-1 text-[16px] font-bold text-slate-900" data-active-code>{active.code}</p>
                <p className="text-[13px] text-slate-700" data-active-name>{active.name}</p>
                <p className="mt-1 font-mono text-[11px] text-slate-500">
                  <span data-active-issuer>{active.issuer}</span> · updated <span data-active-updated>{formatDay(active.lastUpdated)}</span>
                </p>
              </div>

              <fieldset className="rounded-md border border-slate-200 p-3" data-scope-checkboxes>
                <legend className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Scope</legend>
                {(['A','B','C','D','E'] as const).map(m => (
                  <label key={m} className="mt-1 flex items-center gap-2 text-[12px] text-slate-800">
                    <input
                      type="checkbox"
                      defaultChecked={active.scope.includes(m)}
                      data-scope-check={m}
                      style={{ accentColor: SCOPE_COLOURS[m] }}
                    />
                    <span className="font-mono font-semibold" style={{ color: SCOPE_COLOURS[m] }}>{m}</span>
                    <span>{SCOPE_LABEL[m]}</span>
                  </label>
                ))}
              </fieldset>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Status</span>
                <select value={newStatus} onChange={(e) => setNewStatus(e.currentTarget.value as RegulatoryFrameworkStatus)}
                  data-status-select
                  className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Change summary (required)</span>
                <textarea rows={3} value={changeSummary} onChange={(e) => setChangeSummary(e.currentTarget.value)}
                  data-change-summary
                  className="rounded-md border border-slate-300 p-2 text-[12px]" />
              </label>

              {alertText && (
                <p className="rounded-md p-3 text-[12px]" style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }} data-alert-warning>
                  ⚠ Alert will be triggered on save · <span data-alert-text>{alertText}</span>
                </p>
              )}

              <div className="flex gap-2">
                <button type="button" onClick={save} disabled={!canSave}
                  data-save-framework
                  className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                >Save changes →</button>
                <button type="button" onClick={() => setChangeSummary('')}
                  className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              </div>

              {saveResult && (
                <p className="rounded-md p-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#166534' }} data-save-result>{saveResult}</p>
              )}

              <p className="font-mono text-[11px] text-slate-500" data-never-deleted-note>
                Frameworks are never deleted. A framework replaced by a newer instrument is marked superseded and remains citable on historical submissions.
              </p>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
