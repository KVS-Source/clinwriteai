// Checklist hub — one right-hand panel for both checklists.
//
//   Inputs   — the per-document input checklist (all document types)
//   ICH E3   — the 18 mandatory CSR sections (full CSRs only)
//
// A summary strip shows both counts at a glance. The ICH E3 tab is hidden
// for non-CSR documents, so those documents see the same panel as before.
// Both panels keep their own data, actions and progress header; the hub only
// adds the tab bar and the summary, reusing the same query keys (no extra fetch).

import { useQuery } from '@tanstack/react-query'
import { documentsApi } from '../api'
import { ChecklistPanel } from './ChecklistPanel'
import { ICHValidatorPanel } from './ICHValidatorPanel'

export type ChecklistTab = 'inputs' | 'ich-e3'

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
  // A stale 'ich-e3' request on a non-CSR falls back to the inputs list.
  const activeTab: ChecklistTab = showIch ? tab : 'inputs'

  const { data: items = [] } = useQuery({
    queryKey: ['checklist', documentId],
    queryFn:  () => documentsApi.getChecklist(documentId),
    enabled:  !!documentId,
  })
  const { data: ich } = useQuery({
    queryKey: ['ich-e3', documentId],
    queryFn:  () => documentsApi.getICHE3(documentId),
    enabled:  !!documentId && showIch,
  })

  const inputsDone = items.filter(i => i.status === 'complete').length
  const ichTotal   = ich?.totalSections ?? 0
  const ichDone    = ich?.completeCount ?? 0
  const ichWaived  = ich?.waivedCount ?? 0

  const tabs: { key: ChecklistTab; label: string }[] = [
    { key: 'inputs', label: 'Inputs' },
    ...(showIch ? [{ key: 'ich-e3' as const, label: 'ICH E3' }] : []),
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden" data-panel-body="checklist-hub">
      {showIch && (
        <>
          <div
            className="flex-none border-b border-slate-200 px-4 py-2 text-[11px] font-semibold text-slate-600"
            style={{ backgroundColor: '#FFFFFF' }}
            data-checklist-summary
          >
            Inputs {inputsDone}/{items.length}
            {ich && ich.applicable && (
              <> · ICH E3 {ichDone}/{ichTotal}{ichWaived > 0 && ` · ${ichWaived} waived`}</>
            )}
          </div>
          <div className="flex flex-none border-b border-slate-200" role="tablist" data-checklist-tabs>
            {tabs.map(t => {
              const active = t.key === activeTab
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-checklist-tab={t.key}
                  onClick={() => onTabChange(t.key)}
                  className="flex-1 px-3 py-2 text-xs font-semibold transition-colors hover:bg-slate-50"
                  style={{
                    color:        active ? '#2563EB' : '#64748B',
                    borderBottom: `2px solid ${active ? '#2563EB' : 'transparent'}`,
                    marginBottom: -1,
                  }}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </>
      )}
      {activeTab === 'ich-e3' && lockReason && (
        <p
          className="flex-none border-b px-4 py-2 text-[11px] font-semibold"
          style={{ backgroundColor: '#FFFBEB', borderColor: '#FDE68A', color: '#92400E' }}
          data-ich-locked-note
        >
          Document is {lockReason} — sections can’t be marked complete or reopened.
        </p>
      )}
      <div className="min-h-0 flex-1">
        {activeTab === 'inputs'
          ? <ChecklistPanel documentId={documentId} />
          : <ICHValidatorPanel documentId={documentId} />}
      </div>
    </div>
  )
}
