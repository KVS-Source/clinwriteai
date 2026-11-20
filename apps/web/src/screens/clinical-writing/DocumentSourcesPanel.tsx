// Sources tab — the third tab in SectionNavigator's left sidebar.
//
// Lists every source document linked to THIS document (not the project-wide
// library) with per-section usage counts. Each row shows:
//   - title + category chip + file type hint
//   - "Used in N sections" badge
//   - click-to-expand: chips for every section that cites the source → jump
//
// Reuses the existing GET /documents/:id/sources endpoint and the
// DocumentSourceLink type on the web side. No new API surface needed.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { documentsApi, type DocumentSourceLink } from '../../api/documents'
import { useDocumentStore } from '../../store'

interface Props {
  documentId: string
}

export function DocumentSourcesPanel({ documentId }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['document-sources', documentId],
    queryFn:  () => documentsApi.listDocumentSources(documentId),
    retry:    false,
  })

  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const items = useMemo(() => data?.items ?? [], [data])

  if (isLoading) {
    return <p className="px-5 py-6 text-center text-[12px] italic text-slate-400">Loading sources…</p>
  }
  if (isError) {
    return <p className="px-5 py-6 text-center text-[12px] italic text-red-600">Couldn&rsquo;t load source list.</p>
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 py-6">
        <p className="text-center text-[12px] italic text-slate-400">
          No source documents linked yet. Upload sources through the editor&rsquo;s paperclip or the project&rsquo;s Source Documents screen.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {items.map(item => (
        <SourceRow
          key={item.uploadId}
          item={item}
          isExpanded={expandedKey === item.uploadId}
          onToggle={() => setExpandedKey(expandedKey === item.uploadId ? null : item.uploadId)}
        />
      ))}
    </div>
  )
}

function SourceRow({ item, isExpanded, onToggle }: { item: DocumentSourceLink; isExpanded: boolean; onToggle: () => void }) {
  const setActiveSection = useDocumentStore(s => s.setActiveSection)
  const usedInCount = item.sections.length
  const totalRefs   = item.sections.reduce((n, s) => n + s.references, 0)

  return (
    <div className="border-b border-slate-200" data-source-row={item.uploadId}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-3 py-2 text-left text-[12px] hover:bg-slate-100"
      >
        <span
          className="mt-0.5 flex h-4 min-w-[18px] flex-none items-center justify-center rounded-full px-1 font-mono text-[10px] font-bold"
          style={{ backgroundColor: usedInCount > 0 ? '#DBEAFE' : '#F1F5F9', color: usedInCount > 0 ? '#1D4ED8' : '#64748B' }}
          title={usedInCount === 0 ? 'Attached but not yet cited by any section' : `Referenced by ${usedInCount} section${usedInCount === 1 ? '' : 's'} (${totalRefs} total marker${totalRefs === 1 ? '' : 's'})`}
        >
          {usedInCount}
        </span>
        <span className="flex flex-1 flex-col break-words">
          <span className="text-slate-800" style={{ fontWeight: isExpanded ? 600 : 500 }}>
            {item.title || item.fileName}
          </span>
          <span className="mt-0.5 font-mono text-[10px] text-slate-500">
            {item.category}{item.version ? ` · v${item.version}` : ''}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="mt-0.5 flex-none text-slate-400 transition-transform"
          style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          ▸
        </span>
      </button>

      {isExpanded && (
        <div className="flex flex-col gap-2 bg-slate-50 px-3 pb-3 pt-1">
          {usedInCount === 0 ? (
            <p className="text-[11px] italic text-slate-500">Not cited by any section yet.</p>
          ) : (
            <>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                Cited in {usedInCount} section{usedInCount === 1 ? '' : 's'}
              </div>
              <div className="flex flex-wrap gap-1">
                {item.sections.map(sec => (
                  <button
                    key={sec.sectionId}
                    type="button"
                    onClick={() => setActiveSection(sec.sectionId)}
                    title={sec.title}
                    className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 hover:border-blue-400 hover:text-blue-700"
                  >
                    {sec.number ?? sec.sectionId}
                    {sec.references > 1 && (
                      <span className="ml-1 text-[10px] text-slate-400">×{sec.references}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
