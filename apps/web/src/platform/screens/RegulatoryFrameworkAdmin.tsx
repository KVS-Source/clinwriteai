import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { RegulatoryFramework, RegulatoryFrameworkStatus } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { ApiError } from '../../api/client'
import { SlidePanel } from '../../components/ui'
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
  if (scope.length === 0) return <span className="font-mono text-[11px] text-slate-400" title="Scope isn't stored by the registry yet">—</span>
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

const CATEGORY_OPTIONS = ['clinical', 'regulatory', 'safety', 'quality', 'compliance', 'publication'] as const

// "+ Add framework" form — fields match POST /admin/frameworks (Super Admin only, audited).
function AddFrameworkPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [code, setCode]               = useState('')
  const [fullName, setFullName]       = useState('')
  const [issuer, setIssuer]           = useState('')
  const [version, setVersion]         = useState('')
  const [category, setCategory]       = useState<string>('regulatory')
  const [effectiveDate, setEffective] = useState('')
  const [sourceUrl, setSourceUrl]     = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)

  const urlValid = !sourceUrl.trim() || /^https?:\/\/\S+$/i.test(sourceUrl.trim())
  const canSave = !!code.trim() && !!issuer.trim() && !!version.trim() && !!effectiveDate && urlValid && !saving

  const reset = () => {
    setCode(''); setFullName(''); setIssuer(''); setVersion(''); setCategory('regulatory')
    setEffective(''); setSourceUrl(''); setError(null)
  }

  const submit = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await platformApi.createFramework({
        name:          code.trim(),
        version:       version.trim(),
        jurisdiction:  issuer.trim(),
        category,
        effectiveDate: new Date(`${effectiveDate}T00:00:00Z`).toISOString(),
        ...(fullName.trim()  && { description: fullName.trim() }),
        ...(sourceUrl.trim() && { sourceUrl: sourceUrl.trim() }),
      })
      await qc.invalidateQueries({ queryKey: ['regulatory-frameworks'] })
      reset()
      onClose()
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 409 ? `A framework with code "${code.trim()}" already exists.` :
        e instanceof ApiError && e.status === 403 ? 'Only Super Admin can add a framework.' :
        'Could not add the framework. Your entries are kept — please try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  const field = 'h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-[13px] focus:border-slate-500 focus:outline-none'
  const label = 'font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500'

  return (
    <SlidePanel open={open} onClose={onClose} title="Add framework" subtitle="Registered frameworks are visible to every client account." defaultWidth={480}>
      <div className="flex flex-col gap-4 px-5 py-5" data-add-framework-form>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>Code *</span>
          <input value={code} onChange={e => setCode(e.currentTarget.value)} placeholder="ICH E3" className={field} data-input-code />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>Full name</span>
          <input value={fullName} onChange={e => setFullName(e.currentTarget.value)} placeholder="Structure and Content of Clinical Study Reports" className={field} data-input-name />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>Issuer *</span>
            <input value={issuer} onChange={e => setIssuer(e.currentTarget.value)} placeholder="ICH" className={field} data-input-issuer />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>Version *</span>
            <input value={version} onChange={e => setVersion(e.currentTarget.value)} placeholder="R1 2016" className={field} data-input-version />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>Category *</span>
            <select value={category} onChange={e => setCategory(e.currentTarget.value)} className={field} data-input-category>
              {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c[0]!.toUpperCase() + c.slice(1)}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>Effective date *</span>
            <input type="date" value={effectiveDate} onChange={e => setEffective(e.currentTarget.value)} className={field} data-input-effective />
          </label>
        </div>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>Source URL</span>
          <input value={sourceUrl} onChange={e => setSourceUrl(e.currentTarget.value)} placeholder="https://database.ich.org/…" className={field} data-input-source-url />
          {!urlValid && <span className="text-[11px] font-semibold" style={{ color: '#B45309' }}>Enter a full link starting with http:// or https://</span>}
        </label>

        {error && <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" role="alert" data-add-framework-error>{error}</p>}

        <div className="mt-2 flex gap-2 border-t border-slate-200 pt-4">
          <button type="button" onClick={submit} disabled={!canSave}
            data-submit-framework
            className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: PLATFORM_ACCENT.primary }}
          >{saving ? 'Adding…' : 'Add framework →'}</button>
          <button type="button" onClick={onClose}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
        </div>
        <p className="font-mono text-[11px] text-slate-500">
          Recorded in the audit trail. Frameworks are never deleted — only marked superseded.
        </p>
      </div>
    </SlidePanel>
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

  const [selectedId, setSelectedId] = useState<string>('')
  const [newStatus,  setNewStatus]  = useState<RegulatoryFrameworkStatus>('Current')
  const [saving,     setSaving]     = useState(false)
  const [saveResult, setSaveResult] = useState<string | null>(null)
  const [saveError,  setSaveError]  = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const active = frameworks.find(f => f.id === selectedId) ?? frameworks[0] ?? null

  const selectFramework = (id: string) => {
    setSelectedId(id)
    setNewStatus('Current')
    setSaveResult(null)
    setSaveError(null)
  }

  const changedInLast12 = useMemo(
    () => frameworks.filter(f => f.status !== 'Current' && f.status !== 'Deprecated').length,
    [frameworks],
  )

  // The only status change the registry stores today is "superseded"
  // (POST /admin/frameworks/:id/retire). It is one-way — there is no un-retire.
  const alreadySuperseded = active?.status === 'Deprecated'
  const canSave = !!active && !readOnly && !alreadySuperseded && newStatus === 'Deprecated' && !saving

  const save = async () => {
    if (!canSave || !active) return
    if (!window.confirm(`Mark ${active.code} as superseded? This can't be undone — it stays citable on historical submissions.`)) return
    setSaving(true)
    setSaveError(null)
    setSaveResult(null)
    try {
      await platformApi.retireFramework(active.id)
      await qc.invalidateQueries({ queryKey: ['regulatory-frameworks'] })
      setSaveResult(`✓ ${active.code} marked superseded. Written to audit trail.`)
      setNewStatus('Current')
    } catch (e) {
      setSaveError(
        e instanceof ApiError && e.status === 403 ? 'Only Super Admin can change a framework status.' :
        e instanceof ApiError && e.status === 409 ? `${active.code} is already superseded.` :
        'Could not save the change. Nothing was updated — please try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-slate-50" data-screen="regulatory-framework-admin" data-read-only={readOnly || undefined}>
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

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
              onClick={() => setAddOpen(true)}
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >+ Add framework →</button>
          )}
        </div>
        {!readOnly && <AddFrameworkPanel open={addOpen} onClose={() => setAddOpen(false)} />}

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
                    onClick={() => !readOnly && selectFramework(f.id)}
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

              <fieldset className="rounded-md border border-slate-200 p-3" data-scope-checkboxes disabled>
                <legend className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Scope</legend>
                {(['A','B','C','D','E'] as const).map(m => (
                  <label key={m} className="mt-1 flex items-center gap-2 text-[12px] text-slate-400">
                    <input
                      type="checkbox"
                      checked={active.scope.includes(m)}
                      readOnly
                      data-scope-check={m}
                      style={{ accentColor: SCOPE_COLOURS[m] }}
                    />
                    <span className="font-mono font-semibold">{m}</span>
                    <span>{SCOPE_LABEL[m]}</span>
                  </label>
                ))}
                <p className="mt-2 font-mono text-[10px] text-slate-500" data-scope-unavailable>Scope can't be saved yet — the registry doesn't store it.</p>
              </fieldset>

              {alreadySuperseded ? (
                <p className="rounded-md bg-slate-50 p-3 text-[12px] text-slate-600" data-superseded-note>
                  This framework is superseded. That can't be reversed — it remains citable on historical submissions.
                </p>
              ) : (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Status</span>
                    <select value={newStatus} onChange={(e) => setNewStatus(e.currentTarget.value as RegulatoryFrameworkStatus)}
                      data-status-select
                      className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
                      {STATUS_OPTIONS.map(s => {
                        const storable = s === 'Current' || s === 'Deprecated'
                        return (
                          <option key={s} value={s} disabled={!storable}>
                            {s === 'Deprecated' ? 'Superseded' : s}{storable ? '' : ' (not available yet)'}
                          </option>
                        )
                      })}
                    </select>
                  </label>

                  <div className="flex gap-2">
                    <button type="button" onClick={save} disabled={!canSave}
                      data-save-framework
                      className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                    >{saving ? 'Saving…' : 'Mark as superseded →'}</button>
                    <button type="button" onClick={() => setNewStatus('Current')}
                      className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
                  </div>
                  <p className="font-mono text-[11px] text-slate-500" data-status-unavailable>
                    "Updated" and "Draft revision" (with change summaries and intelligence alerts) aren't stored by the registry yet.
                  </p>
                </>
              )}

              {saveError && (
                <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" role="alert" data-save-error>{saveError}</p>
              )}
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
