import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { TATag } from '@platform/types'
import { PLATFORM_ACCENT } from '@platform/types'
import { platformApi } from '../api/platformApi'
import { usePlatformStore } from '../store'

function StatusChip({ status }: { status: 'active' | 'archived' }) {
  if (status === 'active')
    return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: '#F0FDF4', color: '#166534', border: '1px solid #BBF7D0' }} data-status-chip="active">✓ Active</span>
  return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #CBD5E1' }} data-status-chip="archived">○ Archived</span>
}

export function TATagConfiguration() {
  const currentUser = usePlatformStore(s => s.currentUser)
  const qc = useQueryClient()
  const { data: tags = [] } = useQuery<TATag[]>({
    queryKey: ['ta-tags'],
    queryFn:  () => platformApi.listTATags(),
  })

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [name,       setName]       = useState('')
  const [abbrev,     setAbbrev]     = useState('')

  const [confirmArchive, setConfirmArchive] = useState<TATag | null>(null)

  const activeCount = tags.filter(t => t.status === 'active').length

  const nameRule = useMemo(() => {
    if (name === '')                                                          return 'Tag name is required'
    if (tags.some(t => t.name.toLowerCase() === name.trim().toLowerCase()))   return 'This tag name already exists'
    return ''
  }, [tags, name])

  const abbrevRule = useMemo(() => {
    if (abbrev.length > 6)                                                    return 'Maximum 6 characters'
    if (abbrev && tags.some(t => t.abbreviation.toLowerCase() === abbrev.toLowerCase()))
      return 'This abbreviation is already in use'
    return ''
  }, [tags, abbrev])

  const canSave = name.trim() && abbrev && !nameRule && !abbrevRule

  const autoSuggest = () => setAbbrev(name.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 6))

  const save = async () => {
    if (!canSave) return
    await platformApi.createTATag({ name: name.trim(), abbreviation: abbrev, createdBy: currentUser.id }).catch(() => {})
    await qc.invalidateQueries({ queryKey: ['ta-tags'] })
    setName(''); setAbbrev(''); setDrawerOpen(false)
  }
  const doArchive = async () => {
    if (!confirmArchive) return
    await platformApi.archiveTATag(confirmArchive.id).catch(() => {})
    await qc.invalidateQueries({ queryKey: ['ta-tags'] })
    setConfirmArchive(null)
  }
  const restore = async (t: TATag) => {
    await platformApi.restoreTATag(t.id).catch(() => {})
    await qc.invalidateQueries({ queryKey: ['ta-tags'] })
  }
  const del = async (t: TATag) => {
    await platformApi.deleteTATag(t.id).catch(() => {})
    await qc.invalidateQueries({ queryKey: ['ta-tags'] })
  }

  return (
    <div className="bg-slate-50" data-screen="ta-tag-configuration">
      <div className="flex flex-col gap-4" style={{ maxWidth: 1440, padding: '20px 32px 48px' }}>

        <nav className="flex items-center gap-2 text-xs text-slate-500">
          <span>Platform</span>
          <span style={{ color: '#CBD5E1' }}>&gt;</span>
          <span className="font-semibold text-slate-900">TA Tags</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[22px] font-bold text-slate-900" style={{ margin: 0 }}>Therapeutic area tags</h1>
            <p className="mt-1 font-mono text-xs text-slate-500" data-current-user>
              {currentUser.name} · Admin · <span data-active-count>{activeCount}</span> active
            </p>
            <p className="mt-2 max-w-[720px] text-[13px] text-slate-600" data-scope-note>
              TA tags are mandatory on every project, document and content artefact. Tags are available across all disciplines immediately after creation.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              data-add-tag
              className="h-9 rounded-md px-4 text-[13px] font-semibold text-white"
              style={{ backgroundColor: PLATFORM_ACCENT.primary }}
            >+ Add tag →</button>
          </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: drawerOpen ? '1fr 360px' : '1fr' }}>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-tag-table data-tag-count={tags.length}>
            <table className="w-full text-[13px]">
              <thead style={{ backgroundColor: '#F8FAFC' }}>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-2">Tag name</th>
                  <th className="px-4 py-2">Abbreviation</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">In use</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tags.map(t => {
                  const inUse = t.projectCount > 0
                  const note  = inUse ? `${t.projectCount} projects · ${t.documentCount} documents — cannot delete` : ''
                  const primaryLabel = t.status === 'archived' ? 'Restore' : 'Archive'
                  const showDelete   = t.projectCount === 0 && t.status === 'active'
                  return (
                    <tr key={t.id} className="border-t border-slate-200"
                        data-tag-row={t.id}
                        data-tag-status={t.status}
                        data-tag-in-use={inUse || undefined}
                        data-can-delete={showDelete || undefined}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{t.name}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-700">{t.abbreviation}</td>
                      <td className="px-4 py-3"><StatusChip status={t.status} /></td>
                      <td className="px-4 py-3 text-[12px] text-slate-600" data-tag-note>
                        {note || <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {t.status === 'archived'
                          ? <button type="button" onClick={() => restore(t)} className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-tag-primary-action="restore">Restore</button>
                          : (inUse
                              ? <button type="button" onClick={() => setConfirmArchive(t)} className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-tag-primary-action="archive">Archive</button>
                              : <button type="button" onClick={() => platformApi.archiveTATag(t.id).then(() => qc.invalidateQueries({ queryKey: ['ta-tags'] }))} className="text-[12px] font-semibold hover:underline" style={{ color: PLATFORM_ACCENT.primary }} data-tag-primary-action="archive">Archive</button>)}
                        {showDelete && (
                          <button type="button" onClick={() => del(t)} className="ml-3 text-[12px] font-semibold text-slate-500 hover:text-red-700" data-tag-delete>Delete</button>
                        )}
                        {(void primaryLabel)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="border-t border-slate-200 p-3 text-[12px]"
               style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
               data-archive-note>
              A tag in use cannot be deleted — archive it instead. Archiving keeps historical tagging intact and removes the tag from new selections.
            </p>
          </section>

          {drawerOpen && (
            <aside className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5" data-add-drawer>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Add therapeutic area tag</p>
                  <p className="mt-1 text-[13px] font-semibold text-slate-900">Available in every discipline on save</p>
                </div>
                <button type="button" onClick={() => setDrawerOpen(false)} className="text-[12px] font-semibold text-slate-500 hover:underline" data-close-drawer>Close</button>
              </div>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Tag name</span>
                <input type="text" value={name} onChange={(e) => setName(e.currentTarget.value)}
                  data-input-name
                  className="h-9 rounded-md border border-slate-300 px-3 text-[13px]" />
                {nameRule && <p className="text-[11px] font-semibold" style={{ color: '#B45309' }} data-name-rule>{nameRule}</p>}
              </label>

              <label className="flex flex-col gap-1">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Abbreviation</span>
                <div className="flex items-center gap-2">
                  <input type="text" value={abbrev} onChange={(e) => setAbbrev(e.currentTarget.value.toUpperCase())} maxLength={6}
                    data-input-abbrev
                    className="h-9 flex-1 rounded-md border border-slate-300 px-3 font-mono text-[13px]" />
                  <button type="button" onClick={autoSuggest} data-auto-suggest
                    className="text-[11px] font-semibold hover:underline"
                    style={{ color: PLATFORM_ACCENT.primary }}>Auto-suggest</button>
                </div>
                {abbrevRule && <p className="text-[11px] font-semibold" style={{ color: '#B45309' }} data-abbrev-rule>{abbrevRule}</p>}
              </label>

              <p className="rounded-md p-3 text-[12px]"
                 style={{ backgroundColor: PLATFORM_ACCENT.bgTint, color: PLATFORM_ACCENT.primary }}
                 data-audit-note>
                New tags appear in every discipline's tag selector immediately. Creation is written to the audit trail with the acting Admin named.
              </p>

              <div className="flex items-center gap-2">
                <button type="button" onClick={save} disabled={!canSave}
                  data-save-tag
                  className="h-9 rounded-md px-4 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: PLATFORM_ACCENT.primary }}
                >Save tag →</button>
                <button type="button" onClick={() => setDrawerOpen(false)}
                  className="h-9 rounded-md border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
                >Cancel</button>
              </div>
            </aside>
          )}
        </div>

        {confirmArchive && (
          <div className="rounded-lg border p-4"
               style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }}
               data-archive-confirm={confirmArchive.id}>
            <p className="text-[13px] font-semibold" style={{ color: '#78350F' }}>
              Archive {confirmArchive.name}? This tag is in use by {confirmArchive.projectCount} projects. It will be removed from new selections but existing tags are preserved.
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={doArchive} data-confirm-archive
                className="h-8 rounded-md px-3 text-[12px] font-semibold text-white"
                style={{ backgroundColor: PLATFORM_ACCENT.primary }}>Confirm archive</button>
              <button type="button" onClick={() => setConfirmArchive(null)}
                className="h-8 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
