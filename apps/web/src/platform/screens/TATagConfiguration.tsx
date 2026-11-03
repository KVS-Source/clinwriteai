import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { TATag } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { ApiError } from '../../api/client'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

// createdAt arrives as an ISO timestamp (or 'YYYY-MM-DD' from mocks); only the
// date part is shown, parsed as a local date so the day never shifts with the
// viewer's timezone.
function formatCreated(ymd: string | undefined): string {
  if (!ymd) return '—'
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function StatusChip({ status }: { status: 'active' | 'archived' }) {
  const { t } = useTranslation()
  if (status === 'active')
    return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }} data-status-chip="active">{t('page.ta_tag_configuration.chip_active')}</span>
  return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #CBD5E1' }} data-status-chip="archived">{t('page.ta_tag_configuration.chip_archived')}</span>
}

export function TATagConfiguration() {
  const { t } = useTranslation()
  const currentUser = usePlatformStore(s => s.currentUser)
  const qc = useQueryClient()
  const { data: tags = [], isLoading, error: loadError } = useQuery<TATag[]>({
    queryKey: ['ta-tags'],
    queryFn:  () => platformApi.listTATags(),
  })

  // Prefer the API's human-readable message (e.g. the in-use refusal).
  const errorMessage = (err: unknown): string => {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string; error?: string } | null
      if (body?.message) return body.message
      if (err.status === 403) return t('page.ta_tag_configuration.err_forbidden')
    }
    return t('page.ta_tag_configuration.err_generic')
  }

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [name,       setName]       = useState('')
  const [abbrev,     setAbbrev]     = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const [confirmArchive, setConfirmArchive] = useState<TATag | null>(null)

  const activeCount = tags.filter(ta => ta.status === 'active').length

  // In-use tags (linked to projects/documents) first, then the rest; newest
  // created first within each group, name as the tie-break. createdAt is a full
  // ISO timestamp, so string order is creation order — same-day tags included.
  const sortedTags = useMemo(() => {
    const inUse = (ta: TATag) => ta.projectCount + ta.documentCount > 0
    return [...tags].sort((a, b) =>
      Number(inUse(b)) - Number(inUse(a))
      || (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
      || a.name.localeCompare(b.name))
  }, [tags])

  const nameRule = useMemo(() => {
    if (name === '')                                                             return t('page.ta_tag_configuration.rule_name_required')
    if (tags.some(ta => ta.name.toLowerCase() === name.trim().toLowerCase()))    return t('page.ta_tag_configuration.rule_name_duplicate')
    return ''
  }, [tags, name, t])

  const abbrevRule = useMemo(() => {
    if (abbrev.length > 6)                                                       return t('page.ta_tag_configuration.rule_abbrev_max')
    if (abbrev && !/^[A-Z][A-Z0-9]{1,5}$/.test(abbrev))                          return t('page.ta_tag_configuration.rule_abbrev_format')
    if (abbrev && tags.some(ta => ta.abbreviation.toLowerCase() === abbrev.toLowerCase()))
      return t('page.ta_tag_configuration.rule_abbrev_duplicate')
    return ''
  }, [tags, abbrev, t])

  const canSave = name.trim() && abbrev && !nameRule && !abbrevRule

  const autoSuggest = () => setAbbrev(name.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 6))

  // Runs a mutation, surfaces the API's refusal message, and refreshes the
  // list plus every TA selector (they read the ['taxonomy'] queries).
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setActionError(null)
    try {
      await fn()
      return true
    } catch (err) {
      setActionError(errorMessage(err))
      return false
    } finally {
      await qc.invalidateQueries({ queryKey: ['ta-tags'] })
      await qc.invalidateQueries({ queryKey: ['taxonomy'] })
    }
  }

  const save = async () => {
    if (!canSave) return
    if (await run(() => platformApi.createTATag({ name: name.trim(), abbreviation: abbrev }))) {
      setName(''); setAbbrev(''); setDrawerOpen(false)
    }
  }
  const archive = (ta: TATag) => run(() => platformApi.archiveTATag(ta.id))
  const doArchive = async () => {
    if (!confirmArchive) return
    await archive(confirmArchive)
    setConfirmArchive(null)
  }
  const restore = (ta: TATag) => run(() => platformApi.restoreTATag(ta.id))
  const del = (ta: TATag) => run(() => platformApi.deleteTATag(ta.id))

  return (
    <div className="bg-slate-50" data-screen="ta-tag-configuration">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>{t('page.ta_tag_configuration.crumb_platform')}</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">{t('page.ta_tag_configuration.crumb_ta_tags')}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>{t('page.ta_tag_configuration.title')}</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>
              {t('page.ta_tag_configuration.user_byline', { name: currentUser.name })} · <span data-active-count>{t('page.ta_tag_configuration.active_count', { count: activeCount })}</span>
            </p>
            <p className="mt-2 max-w-[720px] text-[13px] text-slate-600" data-scope-note>
              {t('page.ta_tag_configuration.scope_note')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              data-add-tag
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >{t('page.ta_tag_configuration.add_tag')}</button>
          </div>
        </div>

        {(loadError || actionError) && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-800" data-ta-error>
            {actionError ?? t('page.ta_tag_configuration.err_load', { message: errorMessage(loadError) })}
          </div>
        )}
        {isLoading && <p className="text-[13px] text-slate-500" data-ta-loading>{t('page.ta_tag_configuration.loading')}</p>}

        <div className="grid gap-4" style={{ gridTemplateColumns: drawerOpen ? '1fr 360px' : '1fr' }}>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-tag-table data-tag-count={tags.length}>
            <table className="w-full text-[13px]">
              <thead style={{ backgroundColor: '#F8FAFC' }}>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-2">{t('page.ta_tag_configuration.col_tag_name')}</th>
                  <th className="px-4 py-2">{t('page.ta_tag_configuration.col_abbreviation')}</th>
                  <th className="px-4 py-2">{t('page.ta_tag_configuration.col_status')}</th>
                  <th className="px-4 py-2">{t('page.ta_tag_configuration.col_created')}</th>
                  <th className="px-4 py-2">{t('page.ta_tag_configuration.col_in_use')}</th>
                  <th className="px-4 py-2 text-right">{t('page.ta_tag_configuration.col_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedTags.map(ta => {
                  const inUse = ta.projectCount + ta.documentCount > 0
                  const note  = inUse ? t('page.ta_tag_configuration.in_use_note', { projects: ta.projectCount, documents: ta.documentCount }) : ''
                  const showDelete   = !inUse && ta.status === 'active'
                  return (
                    <tr key={ta.id} className="border-t border-slate-200"
                        data-tag-row={ta.id}
                        data-tag-status={ta.status}
                        data-tag-in-use={inUse || undefined}
                        data-can-delete={showDelete || undefined}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{ta.name}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-700">{ta.abbreviation}</td>
                      <td className="px-4 py-3"><StatusChip status={ta.status} /></td>
                      <td className="px-4 py-3 text-[12px] text-slate-600" data-tag-created>{formatCreated(ta.createdAt)}</td>
                      <td className="px-4 py-3 text-[12px] text-slate-600" data-tag-note>
                        {note || <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {ta.status === 'archived'
                          ? <button type="button" onClick={() => restore(ta)} className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-tag-primary-action="restore">{t('page.ta_tag_configuration.action_restore')}</button>
                          : (inUse
                              ? <button type="button" onClick={() => setConfirmArchive(ta)} className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-tag-primary-action="archive">{t('page.ta_tag_configuration.action_archive')}</button>
                              : <button type="button" onClick={() => { void archive(ta) }} className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-tag-primary-action="archive">{t('page.ta_tag_configuration.action_archive')}</button>)}
                        {showDelete && (
                          <button type="button" onClick={() => del(ta)} className="ml-3 text-[12px] font-semibold text-slate-500 hover:text-red-700" data-tag-delete>{t('page.ta_tag_configuration.action_delete')}</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="border-t border-slate-200 p-3 text-[12px]"
               style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
               data-archive-note>
              {t('page.ta_tag_configuration.archive_note')}
            </p>
          </section>

          {drawerOpen && (
            <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-add-drawer>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.ta_tag_configuration.drawer_eyebrow')}</p>
                  <p className="mt-1 text-[13px] font-semibold text-slate-900">{t('page.ta_tag_configuration.drawer_subtitle')}</p>
                </div>
                <button type="button" onClick={() => setDrawerOpen(false)} className="text-[12px] font-semibold text-slate-500 hover:underline" data-close-drawer>{t('button.close')}</button>
              </div>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.ta_tag_configuration.field_tag_name')}</span>
                <input type="text" value={name} onChange={(e) => setName(e.currentTarget.value)}
                  data-input-name
                  className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
                {nameRule && <p className="text-[11px] font-semibold" style={{ color: '#B45309' }} data-name-rule>{nameRule}</p>}
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">{t('page.ta_tag_configuration.field_abbreviation')}</span>
                <div className="flex items-center gap-2">
                  <input type="text" value={abbrev} onChange={(e) => setAbbrev(e.currentTarget.value.toUpperCase())} maxLength={6}
                    data-input-abbrev
                    className="h-9 flex-1 rounded-md border border-slate-300 px-3 font-mono text-[13px]" />
                  <button type="button" onClick={autoSuggest} data-auto-suggest
                    className="text-[11px] font-semibold hover:underline"
                    style={{ color: PLATFORM_ACCENT.primary }}>{t('page.ta_tag_configuration.auto_suggest')}</button>
                </div>
                {abbrevRule && <p className="text-[11px] font-semibold" style={{ color: '#B45309' }} data-abbrev-rule>{abbrevRule}</p>}
              </label>

              <p className="rounded-md p-3 text-[12px]"
                 style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
                 data-audit-note>
                {t('page.ta_tag_configuration.audit_note')}
              </p>

              <div className="flex items-center gap-2">
                <button type="button" onClick={save} disabled={!canSave}
                  data-save-tag
                  className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                >{t('page.ta_tag_configuration.save_tag')}</button>
                <button type="button" onClick={() => setDrawerOpen(false)}
                  className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
                >{t('button.cancel')}</button>
              </div>
            </aside>
          )}
        </div>

        {confirmArchive && (
          <div className="rounded-lg border p-4"
               style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}
               data-archive-confirm={confirmArchive.id}>
            <p className="text-[13px] font-semibold" style={{ color: '#78350F' }}>
              {t('page.ta_tag_configuration.confirm_archive_body', { name: confirmArchive.name, projects: confirmArchive.projectCount, documents: confirmArchive.documentCount })}
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={doArchive} data-confirm-archive
                className="h-8 rounded-md px-3 text-[12px] font-semibold text-white"
                style={{ backgroundColor: PLATFORM_ACCENT.primary }}>{t('page.ta_tag_configuration.confirm_archive_action')}</button>
              <button type="button" onClick={() => setConfirmArchive(null)}
                className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700">{t('button.cancel')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
