import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { PanelMode } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { StatusPill } from '../../components/ui'
import { useDocumentStore, useProjectStore } from '../../store'
import { SectionNavigator } from './SectionNavigator'
import { EditorToolbar }    from './EditorToolbar'
import { VoiceNotePanel }         from '../../panels/VoiceNotePanel'
import { ChecklistPanel }         from '../../panels/ChecklistPanel'
import { AuditTrailPanel }        from '../../panels/AuditTrailPanel'
import { ReviewAssignmentPanel }  from '../../panels/ReviewAssignmentPanel'
import { ICHValidatorPanel }      from '../../panels/ICHValidatorPanel'
import { MedDRAPanel }            from '../../panels/MedDRAPanel'

// Panel titles for the right panel header
const PANEL_TITLES: Record<NonNullable<PanelMode>, string> = {
  'ai':                'AI Suggest',
  'traceability':      'Traceability',
  'voice':             'Voice Note',
  'checklist':         'Input Checklist',
  'audit':             'Audit Trail',
  'comments':          'Comments',
  'review-assignment': 'Submit for Review',
  'crm-resolution':    'CRM Resolution',
  'ich-e3':            'ICH E3 Validator',
  'meddra':            'MedDRA Lookup',
  'tlf':               'TLF Cross-Reference',
}

const PRESENCE_STACK = [
  { initials: 'MW', bg: '#DBEAFE', fg: '#1D4ED8', isLoggedIn: true  },
  { initials: 'JO', bg: '#F5F3FF', fg: '#7C3AED', isLoggedIn: false },
  { initials: 'EV', bg: '#FEF3C7', fg: '#D97706', isLoggedIn: false },
]

export function DocumentEditor() {
  const { projectId, documentId } = useParams()
  const navigate                  = useNavigate()
  const setActiveProject          = useProjectStore(s => s.setActiveProject)

  const activeSection        = useDocumentStore(s => s.activeSection)
  const activePanel          = useDocumentStore(s => s.activePanel)
  const panelWidth           = useDocumentStore(s => s.panelWidth)
  const setActiveDocument    = useDocumentStore(s => s.setActiveDocument)
  const setActiveSection     = useDocumentStore(s => s.setActiveSection)
  const setActivePanel       = useDocumentStore(s => s.setActivePanel)
  const toggleDiffMode       = useDocumentStore(s => s.toggleDiffMode)
  const setVersions          = useDocumentStore(s => s.setVersions)

  const { data: document } = useQuery({
    queryKey: ['document', documentId],
    queryFn:  () => documentsApi.get(documentId!),
    enabled:  !!documentId,
  })

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn:  () => projectsApi.get(projectId!),
    enabled:  !!projectId,
  })

  const { data: versions = [] } = useQuery({
    queryKey: ['versions', documentId],
    queryFn:  () => documentsApi.getVersions(documentId!),
    enabled:  !!documentId,
  })

  // Hydrate active document + default active section + presence heartbeat
  useEffect(() => {
    if (!document) return
    setActiveDocument(document)
    // Default to §11.4 Primary Efficacy Analysis if it exists (matches prototype)
    const defaultSection = document.sections.find(s => s.id === 's11_4')?.id
      ?? document.sections.find(s => s.status === 'in-progress')?.id
      ?? document.sections[0]?.id
      ?? null
    setActiveSection(defaultSection)

    // Fire-and-forget presence heartbeat
    if (documentId && defaultSection) {
      documentsApi.updatePresence(documentId, { sectionId: defaultSection, status: 'active' }).catch(() => { /* ignore */ })
    }
  }, [document, documentId, setActiveDocument, setActiveSection])

  useEffect(() => {
    if (project) setActiveProject(project)
  }, [project, setActiveProject])

  useEffect(() => {
    if (versions.length > 0) setVersions(versions)
  }, [versions, setVersions])

  const currentVersion = versions.find(v => v.isCurrent)?.versionNumber ?? document?.version ?? 'v0.4'
  const previousVersion = (() => {
    const idx = versions.findIndex(v => v.isCurrent)
    if (idx < 0 || idx + 1 >= versions.length) return 'v0.3'
    return versions[idx + 1].versionNumber
  })()

  const openCompareVersions = () => {
    toggleDiffMode(previousVersion, currentVersion)
    navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}/diff`)
  }

  const handleSubmitForReview = () => {
    setActivePanel('review-assignment')
  }

  if (!document) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-slate-400">Loading document…</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-screen="document-editor">

      {/* ============ Document header (56px) ============ */}
      <div
        className="flex flex-none flex-col gap-2 border-b border-slate-200 bg-white px-6 pt-3"
        style={{ position: 'relative', zIndex: 6 }}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900 transition-colors">All Projects</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900 transition-colors">
            {project?.shortTitle ?? '…'}
          </button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}/clinical-writing`)} className="hover:text-slate-900 transition-colors">
            Clinical Writing
          </button>
          <span className="text-slate-300">›</span>
          <span className="overflow-hidden text-ellipsis font-semibold text-slate-900">{document.title}</span>
        </div>

        {/* Title row */}
        <div className="flex h-14 items-center justify-between gap-6">

          {/* Left: title + status + version chip */}
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-base font-bold tracking-tight text-slate-900">{document.title}</h1>
            <span className="flex-none"><StatusPill status={document.status} size="sm" /></span>
            <button
              type="button"
              onClick={openCompareVersions}
              title="Switch revision / compare"
              className="flex flex-none items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors hover:bg-slate-50"
              style={{ borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' }}
            >
              <span className="font-mono text-[11px] font-medium text-slate-500">{currentVersion}</span>
              <svg width="9" height="9" viewBox="0 0 10 10" className="text-slate-500"><polygon points="1,3 9,3 5,8" fill="currentColor"/></svg>
            </button>
          </div>

          {/* Right: autosave + presence + Save + Submit */}
          <div className="flex flex-none items-center gap-3.5">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#16A34A' }} />
              Autosaved 09:14 UTC
            </div>

            {/* Presence stack */}
            <div className="flex flex-none items-center">
              {PRESENCE_STACK.map((p, i) => (
                <div
                  key={p.initials}
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold"
                  style={{
                    backgroundColor: p.bg,
                    color: p.fg,
                    boxShadow: p.isLoggedIn
                      ? '0 0 0 2px #FFFFFF, 0 0 0 4px #2563EB'
                      : '0 0 0 2px #FFFFFF',
                    marginLeft: i === 0 ? 0 : -6,
                    zIndex: PRESENCE_STACK.length - i,
                  }}
                >
                  {p.initials}
                </div>
              ))}
            </div>

            <span className="h-5 w-px" style={{ backgroundColor: '#E2E8F0' }} />
            <span className="flex-none text-xs text-slate-500">{PRESENCE_STACK.length} active</span>

            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={handleSubmitForReview}
              className="rounded-md bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Submit for review
            </button>
          </div>
        </div>
      </div>

      {/* ============ Three-panel row ============ */}
      <div className="flex flex-1 min-h-0">

        <SectionNavigator sections={document.sections} />

        {/* Editor pane — position:relative so right panel can overlay */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-white">
          <EditorToolbar />

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-12 pt-6 pb-8">
            <div className="flex max-w-[760px] flex-col">
              <h2 className="text-[22px] font-bold tracking-tight">11. Efficacy Evaluation</h2>
              <h3 className="mt-4 text-[17px] font-bold">11.4 Primary Efficacy Endpoint</h3>
              <h4 className="mt-3 text-[15px] font-bold">§11.4.1 Progression-Free Survival</h4>

              {/* AI paragraph block */}
              <div
                className="relative mt-3 mb-3 rounded-r-[4px] p-[10px_14px]"
                style={{ borderLeft: '3px solid #93C5FD', backgroundColor: '#F0F7FF' }}
              >
                <div
                  className="absolute right-2.5 top-2.5 rounded px-1.5 py-1 font-mono text-[9px] font-medium"
                  style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}
                >
                  AI
                </div>
                <p className="pr-10 text-sm leading-[1.8] text-slate-900">
                  Veloricept in combination with pembrolizumab demonstrated a statistically significant improvement in progression-free survival (PFS) compared to placebo plus pembrolizumab, with a median PFS of{' '}
                  <span className="cursor-pointer" style={{ borderBottom: '1.5px solid #93C5FD' }}>14.2 months</span> versus{' '}
                  <span className="cursor-pointer" style={{ borderBottom: '1.5px solid #93C5FD' }}>8.7 months</span> (
                  <span className="cursor-pointer" style={{ borderBottom: '1.5px solid #93C5FD' }}>HR 0.61</span>;{' '}
                  <span className="cursor-pointer" style={{ borderBottom: '1.5px solid #93C5FD' }}>95% CI 0.48–0.77</span>;{' '}
                  <span className="cursor-pointer" style={{ borderBottom: '1.5px solid #93C5FD' }}>p&lt;0.0001</span>). This result is consistent with the pre-specified primary analysis outlined in the Statistical Analysis Plan (SAP v2.0, Section 6.3).
                </p>
              </div>

              <p className="mt-3 text-sm leading-[1.8] text-slate-900">
                The Kaplan–Meier curves for PFS demonstrated early and sustained separation between treatment arms from Week 8 onwards, with the separation widening through to the data cut-off date of 30 September 2024.
              </p>

              {/* Cursor placeholder */}
              <div className="mt-4 flex items-center gap-2.5">
                <div className="h-[18px] w-[2px]" style={{ backgroundColor: '#94A3B8' }} />
                <p className="text-sm italic text-slate-400">
                  Continue writing, type{' '}
                  <span className="rounded-[3px] px-1.5 py-0.5 font-mono text-xs not-italic text-slate-500" style={{ backgroundColor: '#F1F5F9' }}>/ai</span>{' '}
                  or press{' '}
                  <span className="rounded-[3px] px-1.5 py-0.5 font-mono text-xs not-italic text-slate-500" style={{ backgroundColor: '#F1F5F9' }}>⌘J</span>
                </p>
                <button
                  type="button"
                  onClick={() => setActivePanel('ai')}
                  className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-bold transition-colors hover:bg-blue-100"
                  style={{ borderColor: '#BFDBFE', backgroundColor: '#EFF6FF', color: '#1D4ED8' }}
                >
                  <svg width="11" height="11" viewBox="0 0 14 14"><polygon points="7,1.2 8.6,5.4 12.8,7 8.6,8.6 7,12.8 5.4,8.6 1.2,7 5.4,5.4" fill="#2563EB"/></svg>
                  AI Suggest
                </button>
              </div>

              {/* §12.2 Locked section overlay */}
              <div
                className="mt-7 overflow-hidden rounded-lg border border-slate-200"
                style={{ backgroundColor: 'rgba(241,245,249,0.5)' }}
              >
                <div className="flex items-center gap-2.5 border-b border-slate-200 bg-white px-3.5 py-2.5">
                  <div
                    className="flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full font-mono text-[9px] font-bold"
                    style={{ backgroundColor: '#F5F3FF', color: '#7C3AED' }}
                  >
                    JO
                  </div>
                  <p className="flex-1 text-[11px] text-slate-500">Dr. James Okonkwo is editing this section</p>
                  <button className="whitespace-nowrap text-[11px] font-semibold text-blue-600 hover:text-blue-700">Request section</button>
                </div>
                <div className="flex flex-col gap-2.5 px-3.5 py-4">
                  <div className="flex items-center gap-2">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#94A3B8" strokeWidth="1.2" className="flex-none">
                      <rect x="2.2" y="5.2" width="7.6" height="5.4" rx="1"/>
                      <path d="M4 5.2V3.8a2 2 0 0 1 4 0v1.4"/>
                    </svg>
                    <h4 className="text-[15px] font-bold text-slate-400">§12.2 Safety Evaluation</h4>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="h-2.5 w-full rounded-[5px] bg-slate-200" />
                    <div className="h-2.5 w-[92%] rounded-[5px] bg-slate-200" />
                    <div className="h-2.5 w-[74%] rounded-[5px] bg-slate-200" />
                  </div>
                  <p className="text-[11px] text-slate-500">Section content is hidden while another author holds the edit lock.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Provenance bar (40px) */}
          <div
            className="flex h-10 flex-none items-center overflow-hidden truncate whitespace-nowrap border-t border-slate-200 px-5 text-xs text-slate-500"
            style={{ backgroundColor: '#F8FAFC' }}
          >
            Section {activeSection ? activeSection.replace('s', '').replace('_', '.') : '11.4.1'} · 2 AI-drafted spans · 1 human-authored span · Last edited Marcus Webb · 22 Oct 2024 09:14 UTC
          </div>

          {/* Right panel — Pattern 6: absolute overlay on editor column, editor width stays constant */}
          {activePanel !== null && (
            <div
              className="absolute top-0 right-0 bottom-0 flex flex-col border-l border-slate-200"
              style={{
                width:           panelWidth,
                zIndex:          6,
                backgroundColor: (activePanel === 'checklist' || activePanel === 'audit' || activePanel === 'review-assignment' || activePanel === 'ich-e3' || activePanel === 'meddra') ? '#FFFFFF' : '#F8FAFC',
                boxShadow:       '-16px 0 40px rgba(15,23,42,0.12)',
              }}
            >
            {/* Panel header (48px) */}
            <div className="flex h-12 flex-none items-center gap-2 border-b border-slate-200 px-4">
              {activePanel === 'voice' && (
                <span className="flex flex-none" style={{ color: '#2563EB' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <rect x="5" y="1.6" width="4" height="6.6" rx="2"/>
                    <path d="M3.4 7.2a3.6 3.6 0 0 0 7.2 0"/>
                    <line x1="7" y1="10.4" x2="7" y2="12.4" strokeLinecap="round"/>
                    <line x1="4.4" y1="13" x2="9.6" y2="13" strokeLinecap="round"/>
                  </svg>
                </span>
              )}
              {activePanel === 'checklist' && (
                <span className="flex flex-none" style={{ color: '#2563EB' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <rect x="1.2" y="1.8" width="3.6" height="3.6" rx="0.9"/>
                    <rect x="1.2" y="8.2" width="3.6" height="3.6" rx="0.9"/>
                    <line x1="6.2" y1="3.5" x2="12.8" y2="3.5"/>
                    <line x1="6.2" y1="9.9" x2="12.8" y2="9.9"/>
                  </svg>
                </span>
              )}
              {activePanel === 'audit' && (
                <span className="flex flex-none" style={{ color: '#2563EB' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <circle cx="7" cy="7" r="5.4"/>
                    <line x1="7" y1="4" x2="7" y2="7.4" strokeLinecap="round"/>
                    <line x1="7" y1="7.4" x2="9.6" y2="7.4" strokeLinecap="round"/>
                  </svg>
                </span>
              )}
              {activePanel === 'review-assignment' && (
                <span className="flex flex-none" style={{ color: '#2563EB' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <polygon points="1.6,7 12.4,2 9.6,12" strokeLinejoin="round"/>
                  </svg>
                </span>
              )}
              {activePanel === 'ich-e3' && (
                <span className="flex flex-none" style={{ color: '#2563EB' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <rect x="1.2" y="1.8" width="3.6" height="3.6" rx="0.9"/>
                    <rect x="1.2" y="8.2" width="3.6" height="3.6" rx="0.9"/>
                    <rect x="6.2" y="2.9" width="6.6" height="1.3" rx="0.65" fill="currentColor" stroke="none"/>
                    <rect x="6.2" y="9.3" width="6.6" height="1.3" rx="0.65" fill="currentColor" stroke="none"/>
                  </svg>
                </span>
              )}
              {activePanel === 'meddra' && (
                <span className="flex flex-none" style={{ color: '#2563EB' }}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4"/>
                    <rect x="8.9" y="9.6" width="4.4" height="1.4" rx="0.7" transform="rotate(45 8.9 9.6)" fill="currentColor"/>
                  </svg>
                </span>
              )}
              <h3 className="text-sm font-bold text-slate-900">{PANEL_TITLES[activePanel]}</h3>
              {activePanel === 'ai' && (
                <span
                  className="rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-500"
                  style={{ borderColor: '#E2E8F0', backgroundColor: '#F1F5F9' }}
                >
                  claude-sonnet
                </span>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setActivePanel(null)}
                aria-label="Close panel"
                className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Panel body — real panel per mode; placeholder for not-yet-built modes */}
            {activePanel === 'voice' && documentId && (
              <VoiceNotePanel
                documentId={documentId}
                sectionRef={activeSection ? `§${activeSection.replace('s', '').replace('_', '.')} Progression-Free Survival` : '§11.4.1 Progression-Free Survival'}
              />
            )}
            {activePanel === 'checklist' && documentId && (
              <ChecklistPanel documentId={documentId} />
            )}
            {activePanel === 'audit' && documentId && (
              <AuditTrailPanel documentId={documentId} />
            )}
            {activePanel === 'review-assignment' && documentId && projectId && (
              <ReviewAssignmentPanel
                documentId={documentId}
                projectId={projectId}
                onClose={() => setActivePanel(null)}
              />
            )}
            {activePanel === 'ich-e3' && documentId && (
              <ICHValidatorPanel documentId={documentId} />
            )}
            {activePanel === 'meddra' && documentId && (
              <MedDRAPanel documentId={documentId} />
            )}
            {activePanel !== 'voice' && activePanel !== 'checklist' && activePanel !== 'audit' && activePanel !== 'review-assignment' && activePanel !== 'ich-e3' && activePanel !== 'meddra' && (
              <div className="flex-1 overflow-y-auto p-4">
                <p className="font-mono text-xs uppercase tracking-widest text-slate-400">Placeholder</p>
                <p className="mt-2 text-sm text-slate-700">
                  {PANEL_TITLES[activePanel]} panel — built in a later session.
                </p>
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
