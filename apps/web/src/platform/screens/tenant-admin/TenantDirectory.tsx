// Tenant directory — Arc 4.3 of docs/pivot-plan.md.
//
// Super-admin only screen. Lists every tenant with status + module
// toggle chips. The "New tenant" dialog is intentionally minimalist
// (slug + name only); modules edit happens on the detail screen.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCreateTenant, useTenants, type Tenant } from '../../../hooks'
import { describeApiError } from '../../../api'

const MODULE_META: Record<string, { label: string; colour: string }> = {
  A: { label: 'Clinical Writing',      colour: '#2563EB' },
  B: { label: 'Scientific Writing',    colour: '#0D9488' },
  C: { label: 'Medical Writing',       colour: '#7C3AED' },
  D: { label: 'Regulatory Writing',    colour: '#B0200D' },
  E: { label: 'Ideation & Publishing', colour: '#0D9488' },
}

function StatusChip({ status }: { status: Tenant['status'] }) {
  const palette = {
    active:    { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0', label: '✓ Active' },
    suspended: { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', label: '⚠ Suspended' },
    archived:  { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', label: '○ Archived' },
  }[status]
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: palette.bg, color: palette.fg, border: `1px solid ${palette.border}` }}
      data-status-chip={status}
    >{palette.label}</span>
  )
}

function ModuleChips({ enabled, capped }: { enabled: string[]; capped: boolean }) {
  if (enabled.length === 0) {
    return <span className="font-mono text-[11px] text-slate-400">—</span>
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {enabled.map(m => {
        const meta = MODULE_META[m]
        return (
          <span
            key={m}
            title={meta?.label ?? m}
            className="inline-flex h-5 w-5 items-center justify-center rounded font-mono text-[10px] font-semibold"
            style={{
              backgroundColor: meta ? `${meta.colour}22` : '#F1F5F9',
              color:           meta?.colour ?? '#475569',
              border:          `1px solid ${meta?.colour ?? '#CBD5E1'}`,
            }}
          >{m}</span>
        )
      })}
      {capped && (
        <span
          title="Tenant has modules enabled that the deployment doesn't currently serve."
          className="rounded px-1.5 py-0.5 text-[10px] font-mono"
          style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}
        >capped</span>
      )}
    </div>
  )
}

function NewTenantDialog({ onClose }: { onClose: () => void }) {
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const create = useCreateTenant()
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setErr(null)
    try {
      await create.mutateAsync({ slug, name, modulesEnabled: ['A'] })
      onClose()
    } catch (e) {
      setErr(describeApiError(e).message)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40" data-dialog="new-tenant">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <h3 className="text-[16px] font-bold text-slate-900">New tenant</h3>
        <p className="mt-1 text-[12px] text-slate-500">
          Slug is lowercase alphanumeric + hyphens; shown in URLs. Only Module A is
          enabled by default — adjust after creation.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-slate-700">
            Slug
            <input
              className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px]"
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase())}
              placeholder="acme-oncology"
              data-input="tenant-slug"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-slate-700">
            Display name
            <input
              className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px]"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Acme Oncology"
              data-input="tenant-name"
            />
          </label>
          {err && (
            <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" data-error>{err}</p>
          )}
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!slug || !name || create.isPending}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
            data-action="create-tenant"
          >
            {create.isPending ? 'Creating…' : 'Create tenant'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function TenantDirectory() {
  const { data: tenants, isLoading, error } = useTenants()
  const [showNew, setShowNew] = useState(false)

  return (
    <div className="bg-slate-50" data-screen="tenant-directory">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Super Admin</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">Tenants</span>
        </nav>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900">Tenant directory</h1>
            <p className="mt-1 text-[12px] text-slate-500">
              {tenants ? `${tenants.length} tenant${tenants.length === 1 ? '' : 's'}` : ' '}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="h-9 rounded-md bg-slate-800 px-3 text-[13px] font-semibold text-white hover:bg-slate-700"
            data-action="new-tenant"
          >+ New tenant</button>
        </div>

        {isLoading && <p className="text-[13px] text-slate-500">Loading tenants…</p>}
        {error && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800">{describeApiError(error).message}</p>}

        {tenants && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-[13px]">
              <thead style={{ backgroundColor: '#F8FAFC' }}>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-2">Tenant</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Modules (effective)</th>
                  <th className="px-4 py-2">Created</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(t => (
                  <tr key={t.id} className="border-t border-slate-200" data-tenant-row={t.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{t.name}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-500">{t.slug}</p>
                    </td>
                    <td className="px-4 py-3"><StatusChip status={t.status} /></td>
                    <td className="px-4 py-3"><ModuleChips enabled={t.effectiveModules} capped={t.deploymentCapped} /></td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                      {new Date(t.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/super-admin/tenants/${t.id}`}
                        className="text-[12px] font-semibold text-slate-700 hover:underline"
                      >Manage →</Link>
                    </td>
                  </tr>
                ))}
                {tenants.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px] text-slate-500">
                    No tenants yet. Click <strong>+ New tenant</strong> to get started.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {showNew && <NewTenantDialog onClose={() => setShowNew(false)} />}
      </div>
    </div>
  )
}
