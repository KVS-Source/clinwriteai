import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { RegulatoryFramework, RegulatoryFrameworkStatus } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { ApiError } from '../../api/client'
import { SlidePanel } from '../../components/ui'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

const SCOPE_COLOURS: Record<string, string> = {
  A: '#2563EB', B: '#0D9488', C: '#7C3AED', D: '#B0200D', E: '#0D9488', platform: PLATFORM_ACCENT.primary,
}
const SCOPE_LABEL_KEYS: Record<string, string> = {
  A: 'page.regulatory_framework_admin.scope_a',
  B: 'page.regulatory_framework_admin.scope_b',
  C: 'page.regulatory_framework_admin.scope_c',
  D: 'page.regulatory_framework_admin.scope_d',
  E: 'page.regulatory_framework_admin.scope_e',
  platform: 'page.regulatory_framework_admin.scope_platform',
}
const STATUS_OPTIONS: RegulatoryFrameworkStatus[] = ['Current', 'Draft revision', 'Updated', 'Deprecated']

function StatusChip({ status }: { status: RegulatoryFrameworkStatus }) {
  const { t } = useTranslation()
  const meta =
    status === 'Current'        ? { bg: '#F0FDF4', fg: '#166534', border: '#BBF7D0', label: t('page.regulatory_framework_admin.chip_current') } :
    status === 'Updated'        ? { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', label: t('page.regulatory_framework_admin.chip_updated') } :
    status === 'Draft revision' ? { bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', label: t('page.regulatory_framework_admin.chip_draft_revision') } :
                                  { bg: '#F1F5F9', fg: '#475569', border: '#CBD5E1', label: t('page.regulatory_framework_admin.chip_superseded') }
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: meta.bg, color: meta.fg, border: `1px solid ${meta.border}` }}
      data-status-chip={status}
    >{meta.label}</span>
  )
}

function ScopeDots({ scope }: { scope: string[] }) {
  const { t } = useTranslation()
  if (scope.length === 0) return <span className="font-mono text-[11px] text-slate-400" title={t('page.regulatory_framework_admin.scope_missing_tooltip')}>—</span>
  return (
    <div className="flex items-center gap-1" data-scope-dots>
      {scope.map(s => (
        <span
          key={s}
          title={SCOPE_LABEL_KEYS[s] ? t(SCOPE_LABEL_KEYS[s]) : s}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-[9px] font-semibold text-white"
          style={{ backgroundColor: SCOPE_COLOURS[s] ?? '#94A3B8' }}
          data-scope-dot={s}
        >{s}</span>
      ))}
    </div>
  )
}

const CATEGORY_OPTIONS = ['clinical', 'regulatory', 'safety', 'quality', 'compliance', 'publication'] as const
const CATEGORY_KEYS: Record<string, string> = {
  clinical:    'page.regulatory_framework_admin.category_clinical',
  regulatory:  'page.regulatory_framework_admin.category_regulatory',
  safety:      'page.regulatory_framework_admin.category_safety',
  quality:     'page.regulatory_framework_admin.category_quality',
  compliance:  'page.regulatory_framework_admin.category_compliance',
  publication: 'page.regulatory_framework_admin.category_publication',
}

// "+ Add framework" form — fields match POST /admin/frameworks (Super Admin only, audited).
function AddFrameworkPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
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
        e instanceof ApiError && e.status === 409 ? t('page.regulatory_framework_admin.err_duplicate', { code: code.trim() }) :
        e instanceof ApiError && e.status === 403 ? t('page.regulatory_framework_admin.err_forbidden_add') :
        t('page.regulatory_framework_admin.err_add_generic'),
      )
    } finally {
      setSaving(false)
    }
  }

  const field = 'h-9 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-[13px] focus:border-slate-500 focus:outline-none'
  const label = 'font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500'

  return (
    <SlidePanel open={open} onClose={onClose} title={t('page.regulatory_framework_admin.add_panel_title')} subtitle={t('page.regulatory_framework_admin.add_panel_subtitle')} defaultWidth={480}>
      <div className="flex flex-col gap-4 px-5 py-5" data-add-framework-form>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>{t('page.regulatory_framework_admin.field_code')}</span>
          <input value={code} onChange={e => setCode(e.currentTarget.value)} placeholder="ICH E3" className={field} data-input-code />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>{t('page.regulatory_framework_admin.field_full_name')}</span>
          <input value={fullName} onChange={e => setFullName(e.currentTarget.value)} placeholder={t('page.regulatory_framework_admin.placeholder_full_name')} className={field} data-input-name />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>{t('page.regulatory_framework_admin.field_issuer')}</span>
            <input value={issuer} onChange={e => setIssuer(e.currentTarget.value)} placeholder="ICH" className={field} data-input-issuer />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>{t('page.regulatory_framework_admin.field_version')}</span>
            <input value={version} onChange={e => setVersion(e.currentTarget.value)} placeholder="R1 2016" className={field} data-input-version />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>{t('page.regulatory_framework_admin.field_category')}</span>
            <select value={category} onChange={e => setCategory(e.currentTarget.value)} className={field} data-input-category>
              {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{t(CATEGORY_KEYS[c])}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className={label}>{t('page.regulatory_framework_admin.field_effective_date')}</span>
            <input type="date" value={effectiveDate} onChange={e => setEffective(e.currentTarget.value)} className={field} data-input-effective />
          </label>
        </div>
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className={label}>{t('page.regulatory_framework_admin.field_source_url')}</span>
          <input value={sourceUrl} onChange={e => setSourceUrl(e.currentTarget.value)} placeholder="https://database.ich.org/…" className={field} data-input-source-url />
          {!urlValid && <span className="text-[11px] font-semibold" style={{ color: '#B45309' }}>{t('page.regulatory_framework_admin.err_url')}</span>}
        </label>

        {error && <p className="rounded-md bg-red-50 p-2 text-[12px] text-red-800" role="alert" data-add-framework-error>{error}</p>}

        <div className="mt-2 flex gap-2 border-t border-slate-200 pt-4">
          <button type="button" onClick={submit} disabled={!canSave}
            data-submit-framework
            className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: PLATFORM_ACCENT.primary }}
          >{saving ? t('page.regulatory_framework_admin.adding') : t('page.regulatory_framework_admin.add_framework_action')}</button>
          <button type="button" onClick={onClose}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">{t('button.cancel')}</button>
        </div>
        <p className="font-mono text-[11px] text-slate-500">
          {t('page.regulatory_framework_admin.add_audit_footer')}
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
  const { t } = useTranslation()
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
    if (!window.confirm(t('page.regulatory_framework_admin.confirm_supersede', { code: active.code }))) return
    setSaving(true)
    setSaveError(null)
    setSaveResult(null)
    try {
      await platformApi.retireFramework(active.id)
      await qc.invalidateQueries({ queryKey: ['regulatory-frameworks'] })
      setSaveResult(t('page.regulatory_framework_admin.save_success', { code: active.code }))
      setNewStatus('Current')
    } catch (e) {
      setSaveError(
        e instanceof ApiError && e.status === 403 ? t('page.regulatory_framework_admin.err_forbidden_status') :
        e instanceof ApiError && e.status === 409 ? t('page.regulatory_framework_admin.err_already_superseded', { code: active.code }) :
        t('page.regulatory_framework_admin.err_save_generic'),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-slate-50" data-screen="regulatory-framework-admin" data-read-only={readOnly || undefined}>
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.regulatory_framework_admin.crumb_super_admin')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.regulatory_framework_admin.crumb_framework_registry')}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.regulatory_framework_admin.title')}</h1>
            <p className="mt-1 max-w-[720px] text-[13px] text-slate-600" data-header-note>
              {t('page.regulatory_framework_admin.header_note')}
            </p>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>
              {t('page.regulatory_framework_admin.user_byline', {
                name:   currentUser.name,
                role:   readOnly ? t('page.regulatory_framework_admin.role_admin_readonly') : t('page.regulatory_framework_admin.role_super_admin'),
                total:  frameworks.length,
                changed: changedInLast12,
              })}
            </p>
          </div>
          {!readOnly && (
            <button
              type="button"
              data-add-framework
              onClick={() => setAddOpen(true)}
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >{t('page.regulatory_framework_admin.add_framework_button')}</button>
          )}
        </div>
        {!readOnly && <AddFrameworkPanel open={addOpen} onClose={() => setAddOpen(false)} />}

        <p
          className="rounded-md p-3 text-[12px]"
          style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
          data-access-note
        >
          {t('page.regulatory_framework_admin.access_note')}
        </p>

        <div className="grid gap-4" style={{ gridTemplateColumns: readOnly ? '1fr' : '1fr 380px' }}>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-frameworks-table data-count={frameworks.length}>
            <table className="w-full text-[13px]">
              <thead style={{ backgroundColor: '#F8FAFC' }}>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-2">{t('page.regulatory_framework_admin.col_code')}</th>
                  <th className="px-4 py-2">{t('page.regulatory_framework_admin.col_full_name')}</th>
                  <th className="px-4 py-2">{t('page.regulatory_framework_admin.col_issuer')}</th>
                  <th className="px-4 py-2">{t('page.regulatory_framework_admin.col_scope')}</th>
                  <th className="px-4 py-2">{t('page.regulatory_framework_admin.col_status')}</th>
                  <th className="px-4 py-2">{t('page.regulatory_framework_admin.col_updated')}</th>
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
              {t('page.regulatory_framework_admin.scope_hover_hint')}
            </p>
          </section>

          {!readOnly && active && (
            <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-edit-drawer data-active-framework={active.id}>
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.regulatory_framework_admin.edit_eyebrow')}</p>
                <p className="mt-1 text-[16px] font-bold text-slate-900" data-active-code>{active.code}</p>
                <p className="text-[13px] text-slate-700" data-active-name>{active.name}</p>
                <p className="mt-1 font-mono text-[11px] text-slate-500">
                  <span data-active-issuer>{active.issuer}</span> · {t('page.regulatory_framework_admin.updated_prefix')} <span data-active-updated>{formatDay(active.lastUpdated)}</span>
                </p>
              </div>

              <fieldset className="rounded-md border border-slate-200 p-3" data-scope-checkboxes disabled>
                <legend className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.regulatory_framework_admin.scope_legend')}</legend>
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
                    <span>{t(SCOPE_LABEL_KEYS[m])}</span>
                  </label>
                ))}
                <p className="mt-2 font-mono text-[10px] text-slate-500" data-scope-unavailable>{t('page.regulatory_framework_admin.scope_unavailable')}</p>
              </fieldset>

              {alreadySuperseded ? (
                <p className="rounded-md bg-slate-50 p-3 text-[12px] text-slate-600" data-superseded-note>
                  {t('page.regulatory_framework_admin.superseded_note')}
                </p>
              ) : (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.regulatory_framework_admin.status_label')}</span>
                    <select value={newStatus} onChange={(e) => setNewStatus(e.currentTarget.value as RegulatoryFrameworkStatus)}
                      data-status-select
                      className="h-9 rounded-md border border-slate-300 px-3 text-[13px]">
                      {STATUS_OPTIONS.map(s => {
                        const storable = s === 'Current' || s === 'Deprecated'
                        const label = s === 'Deprecated'
                          ? t('page.regulatory_framework_admin.option_superseded')
                          : s === 'Current'        ? t('page.regulatory_framework_admin.option_current')
                          : s === 'Updated'        ? t('page.regulatory_framework_admin.option_updated')
                          :                          t('page.regulatory_framework_admin.option_draft_revision')
                        return (
                          <option key={s} value={s} disabled={!storable}>
                            {storable ? label : t('page.regulatory_framework_admin.option_not_available', { label })}
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
                    >{saving ? t('page.regulatory_framework_admin.saving') : t('page.regulatory_framework_admin.mark_superseded_action')}</button>
                    <button type="button" onClick={() => setNewStatus('Current')}
                      className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">{t('button.cancel')}</button>
                  </div>
                  <p className="font-mono text-[11px] text-slate-500" data-status-unavailable>
                    {t('page.regulatory_framework_admin.status_unavailable')}
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
                {t('page.regulatory_framework_admin.never_deleted_note')}
              </p>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
