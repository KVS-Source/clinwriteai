import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { documentsApi, projectsApi } from '../../api'
import { StatusPill } from '../../components/ui'
import { useDocumentStore, useProjectStore } from '../../store'
import { SectionNavigator } from './SectionNavigator'

// Presence stack — matches DocumentEditor
const PRESENCE_STACK = [
  { initials: 'MW', bg: '#DBEAFE', fg: '#1D4ED8', isLoggedIn: true  },
  { initials: 'JO', bg: '#F5F3FF', fg: '#7C3AED', isLoggedIn: false },
  { initials: 'EV', bg: '#FEF3C7', fg: '#D97706', isLoggedIn: false },
]

// Section that hosts all the diff content (matches prototype)
const DIFF_SECTION_ID    = 's11_4'
const DIFF_SECTION_LABEL = '§11.4.1 Progression-Free Survival'
const DIFF_CHANGE_COUNT  = 3
const DIFF_TOTAL_CHANGES = 17

function AISparkle({ size = 10, colour = '#2563EB' }: { size?: number; colour?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className="flex-none">
      <polygon points="7,1.2 8.6,5.4 12.8,7 8.6,8.6 7,12.8 5.4,8.6 1.2,7 5.4,5.4" fill={colour} />
    </svg>
  )
}

export function DiffView() {
  const { projectId, documentId } = useParams()
  const navigate                  = useNavigate()
  const qc                        = useQueryClient()
  const setActiveProject          = useProjectStore(s => s.setActiveProject)

  const diffVersions            = useDocumentStore(s => s.diffVersions)
  const selectedForRestore      = useDocumentStore(s => s.selectedForRestore)
  const toggleSectionForRestore = useDocumentStore(s => s.toggleSectionForRestore)
  const clearRestoreSelection   = useDocumentStore(s => s.clearRestoreSelection)
  const closeDiff               = useDocumentStore(s => s.closeDiff)
  const toggleDiffMode          = useDocumentStore(s => s.toggleDiffMode)
  const setActiveSection        = useDocumentStore(s => s.setActiveSection)

  const [reason, setReason] = useState('')

  // Fallback: if user hit /diff directly, seed the compare pair from the fixture
  useEffect(() => {
    if (!diffVersions) toggleDiffMode('v0.3', 'v0.4')
    setActiveSection('s11')
    return () => { /* leave diff state so back navigation shows editor if user re-enters */ }
  }, [diffVersions, toggleDiffMode, setActiveSection])

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

  useEffect(() => {
    if (project) setActiveProject(project)
  }, [project, setActiveProject])

  const fromVersion = diffVersions?.from ?? 'v0.3'
  const toVersion   = diffVersions?.to   ?? 'v0.4'

  const fromVersionRecord = useMemo(
    () => versions.find(v => v.versionNumber === fromVersion) ?? null,
    [versions, fromVersion],
  )

  const nextVersionLabel = 'v0.5'
  const isSelected = selectedForRestore.includes(DIFF_SECTION_ID)

  const restoreMut = useMutation({
    mutationFn: () => documentsApi.restoreSections(documentId!, {
      sections: selectedForRestore.map(sectionId => ({
        sectionId,
        fromVersionId: fromVersionRecord?.id ?? 'ver-3',
      })),
      reason,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document', documentId] })
      qc.invalidateQueries({ queryKey: ['versions', documentId] })
      clearRestoreSelection()
      closeDiff()
      setReason('')
      navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}`)
    },
  })

  const handleExitDiff = () => {
    closeDiff()
    navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}`)
  }

  const handleToggleSection = () => {
    toggleSectionForRestore(DIFF_SECTION_ID)
  }

  const canSubmit = selectedForRestore.length > 0 && reason.trim().length > 0 && !restoreMut.isPending
  const restoreLabelList = selectedForRestore
    .map(id => `§${id.replace('s', '').replace('_', '.')} from ${fromVersion}`)
    .join(' · ')

  if (!document) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-sm text-slate-400">Loading document…</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-screen="diff-view">

      {/* ============ Document header ============ */}
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
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-base font-bold tracking-tight text-slate-900">{document.title}</h1>
            <span className="flex-none"><StatusPill status={document.status} size="sm" /></span>

            {/* Version chip — active diff state */}
            <button
              type="button"
              onClick={handleExitDiff}
              title="Exit diff view"
              data-version-chip-active
              className="flex flex-none items-center gap-2 rounded-md transition-colors hover:bg-blue-100"
              style={{ border: '1px solid #2563EB', backgroundColor: '#EFF6FF', padding: '5px 9px' }}
            >
              <span className="font-mono text-[11px] font-medium" style={{ color: '#2563EB' }}>{toVersion} · Draft</span>
              <span className="text-xs font-bold" style={{ color: '#2563EB' }}>×</span>
            </button>

            {/* Comparing label */}
            <span className="whitespace-nowrap font-mono text-[11px] font-medium text-slate-500">
              Comparing {fromVersion} → {toVersion}
            </span>
          </div>

          <div className="flex flex-none items-center gap-3.5">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#16A34A' }} />
              Autosaved 09:14 UTC
            </div>

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
              className="rounded-md bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              Submit for review
            </button>
          </div>
        </div>
      </div>

      {/* ============ Body ============ */}
      <div className="flex flex-1 min-h-0">

        <SectionNavigator sections={document.sections} />

        {/* Diff pane */}
        <div className="flex min-w-0 flex-1 flex-col bg-white">

          {/* Diff toolbar */}
          <div
            className="flex h-10 flex-none items-center gap-4 border-b border-slate-200 px-8"
            style={{ backgroundColor: '#F8FAFC' }}
            data-diff-toolbar
          >
            <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">Diff view</p>
            <span className="h-4 w-px bg-slate-200" />
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#16A34A' }} />
              <span className="text-[11px] text-slate-500">Added</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#DC2626' }} />
              <span className="text-[11px] text-slate-500">Removed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <AISparkle size={10} colour="#2563EB" />
              <span className="text-[11px] text-slate-500">AI-drafted</span>
            </div>
            <div className="flex-1" />
            <span className="whitespace-nowrap font-mono text-[11px] text-slate-500">
              {DIFF_TOTAL_CHANGES} changes · {DIFF_CHANGE_COUNT} in §11.4.1
            </span>
            <button
              type="button"
              onClick={handleExitDiff}
              className="whitespace-nowrap text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors"
            >
              Exit diff view
            </button>
          </div>

          {/* Diff content */}
          <div className="flex-1 overflow-y-auto px-12 py-8">
            <div className="flex max-w-[760px] flex-col">
              <h2 className="text-[22px] font-bold tracking-tight">11. Efficacy Evaluation</h2>
              <h3 className="mt-4 text-[17px] font-bold">11.4 Primary Efficacy Endpoint</h3>

              {/* Section header row for §11.4.1 */}
              <div
                className="mt-3 flex items-center gap-3 rounded-md px-3 py-2"
                style={{ backgroundColor: '#F0FDF4' }}
                data-section-header={DIFF_SECTION_ID}
              >
                <h4 className="min-w-0 flex-1 text-[15px] font-bold text-slate-900">11.4.1 Progression-Free Survival</h4>
                <span
                  className="flex-none rounded font-mono text-[9px] font-medium tracking-wide text-slate-500"
                  style={{ backgroundColor: '#F1F5F9', padding: '2px 6px' }}
                >
                  {DIFF_CHANGE_COUNT} changes
                </span>
                <button
                  type="button"
                  onClick={handleToggleSection}
                  title={isSelected ? 'Deselect' : 'Select for restore'}
                  data-restore-checkbox
                  data-checked={isSelected || undefined}
                  className="flex h-4 w-4 flex-none cursor-pointer items-center justify-center rounded"
                  style={{
                    border: `1px solid ${isSelected ? '#2563EB' : '#CBD5E1'}`,
                    backgroundColor: isSelected ? '#2563EB' : '#FFFFFF',
                  }}
                >
                  {isSelected && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <polyline points="2,6.4 4.6,9 10,3.2" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleToggleSection}
                  data-restore-link
                  className="flex-none whitespace-nowrap text-xs font-semibold transition-colors"
                  style={{ color: isSelected ? '#15803D' : '#2563EB' }}
                >
                  {isSelected ? 'Selected for restore ✓' : `Restore ${DIFF_SECTION_LABEL.split(' ')[0]} from ${fromVersion} →`}
                </button>
              </div>

              {/* Word-level diff paragraph */}
              <p className="mt-3.5 text-sm leading-[1.9] text-slate-900">
                Veloricept in combination with pembrolizumab demonstrated a{' '}
                <del
                  data-diff-del
                  style={{ backgroundColor: '#FEE2E2', color: '#DC2626', textDecoration: 'line-through', borderRadius: 2, padding: '0 2px' }}
                >
                  significant
                </del>{' '}
                <ins
                  data-diff-ins
                  style={{ backgroundColor: '#DCFCE7', color: '#15803D', textDecoration: 'none', borderRadius: 2, padding: '0 2px' }}
                >
                  statistically significant
                </ins>{' '}
                improvement in progression-free survival (PFS) compared to placebo plus pembrolizumab.
              </p>

              {/* Added-line block WITH AI badge */}
              <div
                className="relative mt-3"
                style={{
                  borderLeft: '3px solid #16A34A',
                  backgroundColor: '#F0FDF4',
                  borderRadius: '0 4px 4px 0',
                  padding: '8px 14px 8px 26px',
                }}
                data-diff-added-line
                data-ai-sourced
              >
                <span
                  className="absolute font-mono font-medium"
                  style={{ left: 8, top: 8, fontSize: 11, color: '#16A34A' }}
                >
                  +
                </span>
                <p className="text-sm leading-[1.8] text-slate-900" style={{ paddingRight: 44 }}>
                  Median PFS was 14.2 months versus 8.7 months (HR 0.61; 95% CI 0.48–0.77; p&lt;0.0001), consistent with the pre-specified primary analysis outlined in the Statistical Analysis Plan (SAP v2.0, Section 6.3).
                </p>
                <span
                  className="absolute font-mono font-medium"
                  data-ai-badge
                  style={{
                    top: 8, right: 10, fontSize: 9, color: '#1D4ED8', backgroundColor: '#DBEAFE',
                    borderRadius: 4, padding: '2px 6px',
                  }}
                >
                  AI
                </span>
              </div>

              {/* Added-line block WITHOUT AI badge */}
              <div
                className="relative mt-3"
                style={{
                  borderLeft: '3px solid #16A34A',
                  backgroundColor: '#F0FDF4',
                  borderRadius: '0 4px 4px 0',
                  padding: '8px 14px 8px 26px',
                }}
                data-diff-added-line
              >
                <span
                  className="absolute font-mono font-medium"
                  style={{ left: 8, top: 8, fontSize: 11, color: '#16A34A' }}
                >
                  +
                </span>
                <p className="text-sm leading-[1.8] text-slate-900">
                  The Kaplan–Meier curves for PFS demonstrated early and sustained separation between treatment arms from Week 8 onwards, with the separation widening through to the data cut-off date of 30 September 2024.
                </p>
              </div>

              {/* Dimmed unchanged sections */}
              <div
                className="mt-7 flex flex-col gap-2.5"
                style={{ opacity: 0.4 }}
                data-diff-unchanged
              >
                <h4 className="text-[15px] font-bold text-slate-500">11.4.2 Overall Response Rate</h4>
                <div className="h-2.5 w-full rounded-[5px] bg-slate-200" />
                <div className="h-2.5 w-[94%] rounded-[5px] bg-slate-200" />
                <div className="h-2.5 w-[88%] rounded-[5px] bg-slate-200" />
                <p className="text-xs text-slate-500">
                  Unchanged sections are dimmed — 14 further changes in §9, §12 and §16.
                </p>
              </div>
            </div>
          </div>

          {/* Sticky restore bar */}
          {selectedForRestore.length > 0 && (
            <div
              className="flex flex-none flex-col bg-white"
              style={{
                borderTop: '2px solid #2563EB',
                boxShadow: '0 -4px 12px rgba(15,23,42,0.08)',
              }}
              data-restore-bar
            >
              <div className="flex h-14 flex-none items-center gap-3 px-7">
                <p className="whitespace-nowrap text-[13px] font-bold text-slate-900">
                  {selectedForRestore.length} section{selectedForRestore.length === 1 ? '' : 's'} selected for restore
                </p>
                <p className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] font-medium text-slate-500">
                  {restoreLabelList}
                </p>
                <div className="flex flex-none items-center gap-2">
                  <label htmlFor="restore-reason" className="whitespace-nowrap text-xs text-slate-500">Reason (required)</label>
                  <input
                    id="restore-reason"
                    type="text"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="Why are you restoring this section?"
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-900 outline-none focus:border-blue-600 focus:shadow-focus"
                    style={{ width: 200 }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { clearRestoreSelection(); setReason('') }}
                  className="flex-none rounded-md border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => restoreMut.mutate()}
                  disabled={!canSubmit}
                  className="flex-none whitespace-nowrap rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  data-restore-submit
                >
                  {restoreMut.isPending ? 'Creating…' : `Create ${nextVersionLabel} from selected sections →`}
                </button>
              </div>
              <p
                className="px-7 pb-2.5 text-center font-mono text-[11px] italic leading-relaxed text-slate-500"
                data-restore-note
              >
                {fromVersion} and {toVersion} remain permanently in version history. A new {nextVersionLabel} will be created.
              </p>
            </div>
          )}

          {/* Provenance bar */}
          <div
            className="flex h-10 flex-none items-center overflow-hidden truncate whitespace-nowrap border-t border-slate-200 px-5 text-xs text-slate-500"
            style={{ backgroundColor: '#F8FAFC' }}
          >
            Diff: {fromVersion} → {toVersion} · §11.4.1 · {DIFF_CHANGE_COUNT} changes · Last edited Marcus Webb · 22 Oct 2024 09:14 UTC
          </div>
        </div>
      </div>
    </div>
  )
}
