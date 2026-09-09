import { useQuery } from '@tanstack/react-query'
import { documentsApi } from '../api'
import { useDocumentStore } from '../store'

type ICHStatus = 'complete' | 'in-progress' | 'not-started' | 'warning'

interface ICHSection {
  section: string
  title:   string
  status:  ICHStatus
  note?:   string
}

interface ICHE3Payload {
  completionPercent: number
  completeSections:  number
  totalSections:     number
  sections:          ICHSection[]
}

// Map ICH section labels to editor section IDs (used by "Open in editor →")
const OPEN_IN_EDITOR: Record<string, string> = {
  '§11': 's11',
  '§12': 's12',
}

function CompleteIcon() {
  return (
    <div
      className="flex h-4 w-4 flex-none items-center justify-center rounded-full"
      style={{ backgroundColor: '#16A34A' }}
      data-status-icon="complete"
    >
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
        <polyline points="2,6.4 4.6,9 10,3.2" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function InProgressIcon() {
  return (
    <div className="flex h-4 w-4 flex-none items-center justify-center" data-status-icon="in-progress">
      <svg width="12" height="12" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="6" fill="none" stroke="#2563EB" strokeWidth="2" strokeDasharray="28 10" transform="rotate(-90 9 9)" />
      </svg>
    </div>
  )
}

function NotStartedIcon() {
  return (
    <div
      className="h-4 w-4 flex-none rounded-full"
      style={{ border: '1px solid #CBD5E1', backgroundColor: '#FFFFFF' }}
      data-status-icon="not-started"
    />
  )
}

function WarningIcon() {
  return (
    <div
      className="flex h-4 w-4 flex-none items-center justify-center text-xs font-extrabold"
      style={{ color: '#D97706' }}
      data-status-icon="warning"
    >
      ⚠
    </div>
  )
}

function StatusIcon({ status }: { status: ICHStatus }) {
  if (status === 'complete')    return <CompleteIcon />
  if (status === 'in-progress') return <InProgressIcon />
  if (status === 'warning')     return <WarningIcon />
  return <NotStartedIcon />
}

interface RowProps {
  section:   ICHSection
  onOpen:    (sectionId: string) => void
}

function ICHRow({ section, onOpen }: RowProps) {
  const editorSectionId = OPEN_IN_EDITOR[section.section]
  const isDim = section.status === 'not-started'

  return (
    <div
      className="flex cursor-pointer items-center gap-2.5 px-4 py-2 hover:bg-slate-50 transition-colors"
      style={{ borderBottom: '1px solid #F1F5F9' }}
      data-ich-row={section.section}
      data-ich-status={section.status}
    >
      <StatusIcon status={section.status} />
      <span
        className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px]"
        style={{ color: isDim ? '#64748B' : '#1E293B' }}
      >
        {section.section} {section.title}
      </span>

      {section.note && (
        <span
          className="flex-none whitespace-nowrap text-[11px]"
          style={{ color: section.status === 'warning' ? '#B45309' : '#64748B' }}
          data-ich-note
        >
          {section.note}
        </span>
      )}

      {editorSectionId && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(editorSectionId) }}
          className="flex-none whitespace-nowrap text-[11px] font-semibold text-blue-600 hover:text-blue-700 transition-colors"
          data-open-in-editor={editorSectionId}
        >
          {section.section === '§11' ? 'Open in editor →' : 'Open →'}
        </button>
      )}
    </div>
  )
}

interface Props {
  documentId: string
}

export function ICHValidatorPanel({ documentId }: Props) {
  const setActiveSection = useDocumentStore(s => s.setActiveSection)
  const setActivePanel   = useDocumentStore(s => s.setActivePanel)

  const { data } = useQuery({
    queryKey: ['ich-e3', documentId],
    queryFn:  () => documentsApi.getICHE3(documentId) as Promise<ICHE3Payload>,
    enabled:  !!documentId,
  })

  const sections          = data?.sections          ?? []
  const completeSections  = data?.completeSections  ?? 0
  const totalSections     = data?.totalSections     ?? sections.length
  const completionPercent = data?.completionPercent ?? 0

  const handleOpenInEditor = (sectionId: string) => {
    setActiveSection(sectionId)
    setActivePanel(null)
  }

  const handleExport = () => {
    // Phase 1 stub — later posts to /documents/:id/ich-e3/report
    console.log('[ich-e3] export report', { documentId, completionPercent, completeSections, totalSections })
  }

  return (
    <div className="flex h-full flex-col" data-panel-body="ich-e3">

      {/* Completion strip */}
      <div className="flex-none border-b border-slate-200 px-4 py-3" style={{ backgroundColor: '#F8FAFC' }} data-ich-completion>
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-bold text-slate-900">{completeSections} of {totalSections} sections complete</p>
          <p className="text-xs font-bold" style={{ color: '#2563EB' }}>{completionPercent}%</p>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-[3px]" style={{ backgroundColor: '#E2E8F0' }}>
          <div className="h-full" style={{ width: `${completionPercent}%`, backgroundColor: '#2563EB' }} />
        </div>
      </div>

      {/* Scroll region: mandatory sections + compliance notes */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pb-1.5 pt-3">
          <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
            ICH E3 mandatory sections
          </p>
        </div>

        {sections.map(section => (
          <ICHRow key={section.section} section={section} onOpen={handleOpenInEditor} />
        ))}

        <div className="px-4 pb-1.5 pt-3">
          <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
            ICH E3 compliance notes
          </p>
        </div>

        {/* Waiver note — amber */}
        <div
          className="mx-4 mb-2 flex flex-col gap-1 rounded-lg p-3"
          style={{ border: '1px solid #E2E8F0', borderLeft: '3px solid #D97706', backgroundColor: '#FFFBEB' }}
          data-note-card="waiver"
        >
          <p className="text-xs font-bold" style={{ color: '#B45309' }}>§16.4 Waived</p>
          <p className="text-[11px] leading-relaxed" style={{ color: '#B45309' }}>
            US Patient Data Listings waived for non-US submission markets. Audit trail entry logged.
          </p>
        </div>

        {/* Auto-generated note — blue */}
        <div
          className="mx-4 mb-2 flex flex-col gap-1 rounded-lg p-3"
          style={{ border: '1px solid #E2E8F0', borderLeft: '3px solid #2563EB', backgroundColor: '#EFF6FF' }}
          data-note-card="auto-generated"
        >
          <p className="text-xs font-bold" style={{ color: '#1D4ED8' }}>§3 Auto-generated</p>
          <p className="text-[11px] leading-relaxed" style={{ color: '#1D4ED8' }}>
            Table of Contents generated automatically from section headings. Reviewed and locked.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex-none border-t border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={handleExport}
          data-ich-export
          className="w-full rounded-md border border-slate-200 bg-white py-2 text-xs font-semibold text-slate-900 hover:bg-slate-100 transition-colors"
        >
          Export ICH E3 report
        </button>
      </div>
    </div>
  )
}
