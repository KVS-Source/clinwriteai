// Tenant directory — Arc 4.3 of docs/pivot-plan.md.
//
// Super-admin only screen. Lists every tenant with status + module
// toggle chips. The "New tenant" dialog is intentionally minimalist
// (slug + name only); modules edit happens on the detail screen.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useCreateTenant, useTenants, type Tenant } from '../../../hooks'
import { describeApiError } from '../../../api'

const MODULE_META: Record<string, { labelKey: string; colour: string }> = {
  A: { labelKey: 'nav.clinical_writing',    colour: '#2563EB' },
  B: { labelKey: 'nav.scientific_writing',  colour: '#0D9488' },
  C: { labelKey: 'nav.medical_writing',     colour: '#7C3AED' },
  D: { labelKey: 'nav.regulatory_writing',  colour: '#B0200D' },
  E: { labelKey: 'nav.ideation_publishing', colour: '#0D9488' },
}

function StatusChip({ status }: { status: Tenant['status'] }) {
  const { t } = useTranslation()
  const palette = {
    active:    { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0', label: `✓ ${t('page.tenant_directory.status_active')}` },
    suspended: { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', label: `⚠ ${t('page.tenant_directory.status_suspended')}` },
    archived:  { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', label: `○ ${t('page.tenant_directory.status_archived')}` },
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
  const { t } = useTranslation()
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
            title={meta ? t(meta.labelKey) : m}
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
          title={t('page.tenant_directory.capped_tooltip')}
          className="rounded px-1.5 py-0.5 text-[10px] font-mono"
          style={{ backgroundColor: '#FFFBEB', color: '#B45309', border: '1px solid #FDE68A' }}
        >{t('page.tenant_directory.capped_label')}</span>
      )}
    </div>
  )
}

// Also opened from the Super Admin Panel's "+ New client" (a client is a tenant).
export function NewTenantDialog({ onClose, noun = 'tenant' }: { onClose: () => void; noun?: 'tenant' | 'client' }) {
  const { t } = useTranslation()
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

  const titleKey    = noun === 'client' ? 'page.tenant_directory.new_client_title'    : 'page.tenant_directory.new_tenant_title'
  const createKey   = noun === 'client' ? 'page.tenant_directory.create_client'       : 'page.tenant_directory.create_tenant'
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40" data-dialog="new-tenant">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <h3 className="text-[16px] font-bold text-slate-900">{t(titleKey)}</h3>
        <p className="mt-1 text-[12px] text-slate-500">{t('page.tenant_directory.new_tenant_hint')}</p>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-slate-700">
            <span>{t('page.tenant_directory.field_slug')} <span className="text-red-600" aria-hidden="true">*</span></span>
            <input
              required
              className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px]"
              value={slug}
              onChange={e => setSlug(e.target.value.toLowerCase())}
              placeholder={t('page.tenant_directory.slug_placeholder')}
              data-input="tenant-slug"
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-slate-700">
            <span>{t('page.tenant_directory.field_display_name')} <span className="text-red-600" aria-hidden="true">*</span></span>
            <input
              required
              className="rounded-md border border-slate-300 px-2 py-1.5 text-[13px]"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('page.tenant_directory.display_name_placeholder')}
              data-input="tenant-name"
            />
          </label>
          {err && (
            <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" data-error>{err}</p>
          )}
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100">
            {t('button.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!slug || !name || create.isPending}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
            data-action="create-tenant"
          >
            {create.isPending ? t('page.tenant_directory.creating') : t(createKey)}
          </button>
        </div>
      </div>
    </div>
  )
}

export function TenantDirectory() {
  const { t } = useTranslation()
  const { data: tenants, isLoading, error } = useTenants()
  const [showNew, setShowNew] = useState(false)

  return (
    <div className="bg-slate-50" data-screen="tenant-directory">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1280, padding: '20px 32px 48px' }}>
        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.tenant_directory.crumb_super_admin')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.tenant_directory.crumb_tenants')}</span>
        </nav>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900">{t('page.tenant_directory.title')}</h1>
            <p className="mt-1 text-[12px] text-slate-500">
              {tenants ? t('page.tenant_directory.tenant_count', { count: tenants.length }) : ' '}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="h-9 rounded-md bg-slate-800 px-3 text-[13px] font-semibold text-white hover:bg-slate-700"
            data-action="new-tenant"
          >{t('page.tenant_directory.new_tenant_button')}</button>
        </div>

        {isLoading && <p className="text-[13px] text-slate-500">{t('page.tenant_directory.loading_tenants')}</p>}
        {error && <p className="rounded-md bg-red-50 p-3 text-[13px] text-red-800">{describeApiError(error).message}</p>}

        {tenants && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-[13px]">
              <thead style={{ backgroundColor: '#F8FAFC' }}>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-2">{t('page.tenant_directory.col_tenant')}</th>
                  <th className="px-4 py-2">{t('page.tenant_directory.col_status')}</th>
                  <th className="px-4 py-2">{t('page.tenant_directory.col_modules_effective')}</th>
                  <th className="px-4 py-2">{t('page.tenant_directory.col_created')}</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map(row => (
                  <tr key={row.id} className="border-t border-slate-200" data-tenant-row={row.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{row.name}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-slate-500">{row.slug}</p>
                    </td>
                    <td className="px-4 py-3"><StatusChip status={row.status} /></td>
                    <td className="px-4 py-3"><ModuleChips enabled={row.effectiveModules} capped={row.deploymentCapped} /></td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                      {new Date(row.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/super-admin/tenants/${row.id}`}
                        className="text-[12px] font-semibold text-slate-700 hover:underline"
                      >{t('page.tenant_directory.manage_link')}</Link>
                    </td>
                  </tr>
                ))}
                {tenants.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px] text-slate-500">
                    {t('page.tenant_directory.empty_state')}
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
