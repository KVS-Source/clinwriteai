// Checklist hub — one right-hand panel for both checklists.
//
//   Inputs   — the per-document input checklist (all document types)
//   ICH E3   — the 18 mandatory CSR sections (full CSRs only)
//   ICH Guidelines — the ICH guidelines the document is built on, from the ICH Frameworks registry
//
// A summary strip shows both counts at a glance. The ICH E3 tab is hidden
// for non-CSR documents, so those documents see the same panel as before.
// Both panels keep their own data, actions and progress header; the hub only
// adds the tab bar and the summary, reusing the same query keys (no extra fetch).

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { documentsApi } from '../api'
import { useCanViewChecklist } from '../hooks/useCanViewChecklist'
import { ChecklistPanel } from './ChecklistPanel'
import { ICHValidatorPanel } from './ICHValidatorPanel'
import { platformApi } from '../platform/api/platformApi'
import { ichGuidelinesUsed } from '../utils/ichFramework'

export type ChecklistTab = 'inputs' | 'ich-e3' | 'guidelines'

interface Props {
  documentId: string
  tab:        ChecklistTab
  onTabChange: (tab: ChecklistTab) => void
  /** True for full CSRs — the only document type ICH E3 governs. */
  showIch:    boolean
  /** Why the document is locked for authoring (e.g. "in review"); null when editable. */
  lockReason?: string | null
}

export function ChecklistHub({ documentId, tab, onTabChange, showIch, lockReason = null }: Props) {
  const { t } = useTranslation()
  // A stale 'ich-e3' request on a non-CSR falls back to the inputs list.
  const activeTab: ChecklistTab = tab === 'ich-e3' && !showIch ? 'inputs' : tab
  const canView = useCanViewChecklist(documentId)

  const { data: items = [] } = useQuery({
    queryKey: ['checklist', documentId],
    queryFn:  () => documentsApi.getChecklist(documentId),
    enabled:  !!documentId && canView !== false,
  })
  const { data: ich } = useQuery({
    queryKey: ['ich-e3', documentId],
    queryFn:  () => documentsApi.getICHE3(documentId),
    enabled:  !!documentId && showIch && canView !== false,
  })

  // The ICH guidelines this document is built on, as held in the ICH Frameworks registry (synced from ich.org):
  // ICH E3 for a full CSR, plus every ICH guideline its checklist items cite.
  const { data: registry = [] } = useQuery({
    queryKey: ['regulatory-frameworks'],
    queryFn:  () => platformApi.listFrameworks(),
    enabled:  !!documentId && canView !== false,
    staleTime: 5 * 60_000,
  })
  // Which guideline cards are opened to show their checklist items.
  const [openGuidelines, setOpenGuidelines] = useState<string[]>([])
  const toggleGuideline = (key: string) => setOpenGuidelines(o => (o.includes(key) ? o.filter(k => k !== key) : [...o, key]))
  const guidelines = ichGuidelinesUsed([
    ...(showIch ? ['ICH E3'] : []),
    ...items.filter(i => i.status !== 'removed').map(i => i.framework),
  ], registry)

  // The toolbar button is hidden too; this covers a panel left open or opened another way.
  if (canView === false) {
    return <p className="p-4 text-[13px] text-slate-500" data-checklist-not-allowed>{t('page.checklist_hub.not_allowed')}</p>
  }

  const liveItems  = items.filter(i => i.status !== 'removed')
  const inputsDone = liveItems.filter(i => i.status === 'complete' || i.status === 'waived').length
  const ichTotal   = ich?.totalSections ?? 0
  const ichDone    = ich?.completeCount ?? 0
  const ichWaived  = ich?.waivedCount ?? 0

  const tabs: { key: ChecklistTab; label: string }[] = [
    { key: 'inputs', label: t('page.checklist_hub.tab_inputs') },
    ...(showIch ? [{ key: 'ich-e3' as const, label: t('page.checklist_hub.tab_ich_e3') }] : []),
    { key: 'guidelines', label: t('page.checklist_hub.tab_guidelines', { count: guidelines.length }) },
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden" data-panel-body="checklist-hub">
      <>
        {showIch && (
          <div
            className="flex-none border-b border-slate-200 px-4 py-2 text-[11px] font-semibold text-slate-600"
            style={{ backgroundColor: '#FFFFFF' }}
            data-checklist-summary
          >
            {t('page.checklist_hub.summary_inputs', { done: inputsDone, total: liveItems.length })}
            {ich && ich.applicable && (
              <> · {t('page.checklist_hub.summary_ich_e3', { done: ichDone, total: ichTotal })}{ichWaived > 0 && ` · ${t('page.checklist_hub.summary_waived_count', { count: ichWaived })}`}</>
            )}
          </div>
        )}
          <div className="flex flex-none border-b border-slate-200" role="tablist" data-checklist-tabs>
            {tabs.map(ty => {
              const active = ty.key === activeTab
              return (
                <button
                  key={ty.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-checklist-tab={ty.key}
                  onClick={() => onTabChange(ty.key)}
                  className="flex-1 px-3 py-2 text-xs font-semibold transition-colors hover:bg-slate-50"
                  style={{
                    color:        active ? '#2563EB' : '#64748B',
                    borderBottom: `2px solid ${active ? '#2563EB' : 'transparent'}`,
                    marginBottom: -1,
                  }}
                >
                  {ty.label}
                </button>
              )
            })}
          </div>
      </>
      {activeTab === 'ich-e3' && lockReason && (
        <p
          className="flex-none border-b px-4 py-2 text-[11px] font-semibold"
          style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A', color: '#92400E' }}
          data-ich-locked-note
        >
          {t('page.checklist_hub.locked_note', { reason: lockReason })}
        </p>
      )}
      <div className="min-h-0 flex-1">
        {activeTab === 'inputs' && <ChecklistPanel documentId={documentId} />}
        {activeTab === 'ich-e3' && <ICHValidatorPanel documentId={documentId} />}
        {activeTab === 'guidelines' && (guidelines.length === 0
          ? <p className="p-4 text-[13px] text-slate-500" data-ich-guidelines-empty>{t('page.checklist_hub.guidelines_empty')}</p>
          : (
    <ul className="h-full overflow-y-auto px-4 py-2" data-ich-guidelines>
      {guidelines.map(g => {
        const fw = g.framework
        return (
          <li key={fw?.id ?? g.base} className="border-b border-slate-100 py-2 last:border-b-0" data-ich-guideline={fw?.code ?? `ICH ${g.base}`}>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12px] font-semibold text-slate-900">{fw?.code ?? `ICH ${g.base}`}</span>
              {fw?.status === 'Deprecated' && <span className="rounded-full border border-slate-300 bg-slate-100 px-2 text-[10px] text-slate-600" data-ich-superseded>{t('page.checklist_hub.guideline_superseded')}</span>}
              {fw?.sourceUrl && (
                <a href={fw.sourceUrl} target="_blank" rel="noreferrer" className="ml-auto text-[11px] font-semibold text-blue-700 hover:underline" data-ich-source>{t('page.checklist_hub.guideline_source')}</a>
              )}
            </div>
            {fw ? (
              <>
                <p className="mt-0.5 text-[12px] text-slate-700" data-ich-title>{fw.name}</p>
                <p className="mt-0.5 text-[11px] text-slate-500" data-ich-meta>
                  {t('page.checklist_hub.guideline_meta', { step: fw.version, date: new Date(fw.effectiveDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) })}
                </p>
              </>
            ) : (
              <p className="mt-0.5 text-[11px] text-amber-800" data-ich-missing>{t('page.checklist_hub.guideline_missing')}</p>
            )}
            <p className="mt-0.5 text-[11px] text-slate-400" data-ich-cited>{t('page.checklist_hub.guideline_cited', { list: g.citations.join(', ') })}</p>
            {(() => {
              // The document's checklist items that cite this guideline, and how far along they are.
              const key = fw?.id ?? g.base
              const cited = liveItems.filter(i => g.citations.includes(i.framework))
              const done  = cited.filter(i => i.status === 'complete' || i.status === 'waived').length
              const open  = openGuidelines.includes(key)
              const isE3  = showIch && (fw?.code ?? `ICH ${g.base}`) === 'ICH E3'
              return (
                <div className="mt-1.5">
                  {isE3 && ich?.applicable && (
                    <button type="button" onClick={() => onTabChange('ich-e3')} className="block text-[11px] font-semibold text-blue-700 hover:underline" data-ich-e3-link>
                      {t('page.checklist_hub.guideline_e3_sections', { done: ichDone, total: ichTotal })}
                    </button>
                  )}
                  {cited.length === 0 ? (
                    <p className="text-[11px] text-slate-500" data-ich-progress="none">{t('page.checklist_hub.guideline_no_items')}</p>
                  ) : (
                    <>
                      <button type="button" onClick={() => toggleGuideline(key)} aria-expanded={open}
                        className="flex w-full items-center gap-2 text-left text-[11px] font-semibold text-slate-700 hover:text-slate-900" data-ich-progress={`${done}/${cited.length}`}>
                        <span className="h-1.5 w-16 flex-none overflow-hidden rounded-full bg-slate-200"><span className="block h-full bg-blue-600" style={{ width: `${Math.round((done / cited.length) * 100)}%` }} /></span>
                        {t('page.checklist_hub.guideline_items_progress', { done, total: cited.length })}
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M3 4.5l3 3 3-3" /></svg>
                      </button>
                      {open && (
                        <ul className="mt-1.5 flex flex-col gap-1 rounded-md bg-slate-50 p-2" data-ich-items>
                          {cited.map(i => {
                            const st = i.status === 'complete' ? { icon: '✓', cls: 'text-green-700' } : i.status === 'waived' ? { icon: '–', cls: 'text-slate-500' } : { icon: '○', cls: 'text-amber-700' }
                            return (
                              <li key={i.id} className="flex items-start gap-2 text-[12px] text-slate-800" data-ich-item={i.status}>
                                <span className={`w-3 flex-none font-semibold ${st.cls}`} aria-hidden="true">{st.icon}</span>
                                <span className="min-w-0 flex-1">
                                  {i.text}
                                  <span className="block text-[10px] text-slate-500">
                                    {t(`page.checklist_hub.item_${i.status}`)}{i.frameworkMandatory ? ` · ${t('page.checklist_hub.item_mandatory')}` : ''}{i.framework !== (fw?.code ?? '') ? ` · ${i.framework}` : ''}
                                  </span>
                                </span>
                              </li>
                            )
                          })}
                          <li>
                            <button type="button" onClick={() => onTabChange('inputs')} className="mt-1 text-[11px] font-semibold text-blue-700 hover:underline" data-ich-open-inputs>
                              {t('page.checklist_hub.guideline_open_inputs')}
                            </button>
                          </li>
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )
            })()}
          </li>
        )
      })}
    </ul>
          ))}
      </div>
    </div>
  )
}
