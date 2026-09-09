import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CommentSeverity } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { useDocumentStore, useProjectStore } from '../../store'
import { SectionNavigator } from './SectionNavigator'
import { ReviewerToolbar } from './ReviewerToolbar'
import { CommentsPanel }   from '../../panels/CommentsPanel'
import { ChecklistPanel }  from '../../panels/ChecklistPanel'
import { AuditTrailPanel } from '../../panels/AuditTrailPanel'

// Logged-in user for the reviewer view = EV (Dr. Elena Vasquez, Regulatory Affairs, RACI: C)
const LOGGED_IN_REVIEWER = {
  userId:    'user-EV',
  name:      'Dr. Elena Vasquez',
  initials:  'EV',
  role:      'Regulatory Affairs',
  raci:      'C' as const,
  colourKey: 'EV' as const,
}
const RACI_LABEL: Record<'R' | 'A' | 'C' | 'I', string> = {
  R: 'Responsible', A: 'Accountable', C: 'Consulted', I: 'Informed',
}

const PANEL_TITLES: Record<string, string> = {
  comments:  'Comments',
  checklist: 'Input Checklist',
  audit:     'Audit Trail',
}

export function ReviewerView() {
  const { projectId, documentId } = useParams()
  const navigate                  = useNavigate()
  const qc                        = useQueryClient()
  const setActiveProject          = useProjectStore(s => s.setActiveProject)

  const activeSection      = useDocumentStore(s => s.activeSection)
  const activePanel        = useDocumentStore(s => s.activePanel)
  const panelWidth         = useDocumentStore(s => s.panelWidth)
  const setActiveDocument  = useDocumentStore(s => s.setActiveDocument)
  const setActiveSection   = useDocumentStore(s => s.setActiveSection)
  const setActivePanel     = useDocumentStore(s => s.setActivePanel)

  const [commentText,     setCommentText]     = useState('')
  const [severity,        setSeverity]        = useState<CommentSeverity>('minor')
  const [flagged,         setFlagged]         = useState(false)
  const [returningReason, setReturningReason] = useState<string | null>(null)
  const [returnText,      setReturnText]      = useState('')
  const [approveNote,     setApproveNote]     = useState<string | null>(null)

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

  // Open Comments panel automatically on mount
  useEffect(() => {
    setActivePanel('comments')
  }, [setActivePanel])

  useEffect(() => {
    if (document) {
      setActiveDocument(document)
      const defaultSection = document.sections.find(s => s.id === 's11_4')?.id
        ?? document.sections.find(s => s.status === 'in-progress')?.id
        ?? document.sections[0]?.id
        ?? null
      setActiveSection(defaultSection)
    }
  }, [document, setActiveDocument, setActiveSection])

  useEffect(() => {
    if (project) setActiveProject(project)
  }, [project, setActiveProject])

  const addCommentMut = useMutation({
    mutationFn: () => documentsApi.addComment(documentId!, {
      sectionRef: '§11.4.1',
      text:       commentText,
      severity,
    }),
    onSuccess: () => {
      setCommentText('')
      qc.invalidateQueries({ queryKey: ['comments', documentId] })
    },
  })

  const handlePostComment = () => {
    if (!commentText.trim() || !documentId) return
    addCommentMut.mutate()
  }

  const handleApproveSection = () => {
    setApproveNote(`Section approved: ${activeSection ?? '§11.4.1'}`)
    console.log('[reviewer] approve section', { documentId, sectionId: activeSection })
  }

  const handleReturnForRevision = () => {
    if (returningReason === null) {
      setReturningReason('')
      return
    }
    if (!returnText.trim()) {
      setReturningReason('Reason is required')
      return
    }
    console.log('[reviewer] return for revision', { documentId, reason: returnText })
    setReturningReason(null)
    setReturnText('')
  }

  const handleFlagSection = () => setFlagged(v => !v)

  if (!document) {
    return <div className="flex h-full items-center justify-center"><p className="font-mono text-sm text-slate-400">Loading document…</p></div>
  }

  const panelTitle = activePanel && activePanel in PANEL_TITLES ? PANEL_TITLES[activePanel] : ''

  return (
    <div className="flex h-full flex-col">

      {/* ============ Document header ============ */}
      <div
        className="flex flex-none flex-col gap-2 border-b border-slate-200 bg-white px-6 pt-3"
        style={{ position: 'relative', zIndex: 6 }}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-slate-500">
          <button onClick={() => navigate('/projects')} className="hover:text-slate-900">All Projects</button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}`)} className="hover:text-slate-900">
            {project?.shortTitle ?? '…'}
          </button>
          <span className="text-slate-300">›</span>
          <button onClick={() => navigate(`/projects/${projectId}/clinical-writing`)} className="hover:text-slate-900">Clinical Writing</button>
          <span className="text-slate-300">›</span>
          <span className="overflow-hidden text-ellipsis font-semibold text-slate-900">{document.title}</span>
        </div>

        {/* Title row */}
        <div className="flex h-14 items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-base font-bold tracking-tight">{document.title}</h1>
            <span
              className="flex-none rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ backgroundColor: '#FFFBEB', color: '#B45309' }}
            >
              In Review
            </span>
            <span className="flex-none font-mono text-[11px] text-slate-500">v{document.version} · For Review</span>
          </div>

          {/* Right cluster */}
          <div className="flex flex-none items-center gap-3.5">
            <p className="whitespace-nowrap text-xs text-slate-500">Review due 05 Nov 2024 · 10 days remaining</p>

            {/* Presence stack — EV as logged-in (amber ring) */}
            <div className="flex flex-none items-center">
              {[
                { initials: 'EV', bg: '#FEF3C7', fg: '#D97706', ring: '#D97706' },
                { initials: 'MW', bg: '#DBEAFE', fg: '#1D4ED8' },
                { initials: 'JO', bg: '#F5F3FF', fg: '#7C3AED' },
              ].map((p, i) => (
                <div
                  key={p.initials}
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold"
                  style={{
                    backgroundColor: p.bg,
                    color: p.fg,
                    boxShadow: p.ring ? `0 0 0 2px #FFFFFF, 0 0 0 4px ${p.ring}` : '0 0 0 2px #FFFFFF',
                    marginLeft: i === 0 ? 0 : -6,
                    zIndex: 3 - i,
                  }}
                >
                  {p.initials}
                </div>
              ))}
            </div>

            <span className="h-5 w-px" style={{ backgroundColor: '#E2E8F0' }} />
            <span className="flex-none text-xs text-slate-500">3 active</span>

            <button
              type="button"
              onClick={handleApproveSection}
              className="whitespace-nowrap rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors hover:opacity-90"
              style={{ backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' }}
            >
              Approve section
            </button>
            <button
              type="button"
              onClick={handleReturnForRevision}
              className="whitespace-nowrap rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors hover:opacity-90"
              style={{ backgroundColor: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' }}
            >
              Return for revision
            </button>
          </div>
        </div>
      </div>

      {/* Approve/Return inline notices */}
      {approveNote && (
        <div className="flex-none border-b border-slate-200 px-6 py-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#15803D' }}>
          ✓ {approveNote}
          <button onClick={() => setApproveNote(null)} className="ml-3 text-xs underline">Dismiss</button>
        </div>
      )}
      {returningReason !== null && (
        <div className="flex flex-none flex-col gap-2 border-b border-slate-200 px-6 py-3" style={{ backgroundColor: '#FFFBEB' }}>
          <label className="text-[12px] font-semibold" style={{ color: '#B45309' }}>Reason for return (required)</label>
          <input
            type="text"
            value={returnText}
            onChange={e => { setReturnText(e.target.value); if (returningReason && returningReason !== '') setReturningReason('') }}
            placeholder="Explain what needs revision"
            className="h-8 rounded border px-2 text-[12px] outline-none focus:border-blue-600 focus:shadow-focus"
            style={{ borderColor: '#E2E8F0' }}
            autoFocus
          />
          {returningReason && (
            <p className="text-[11px] font-semibold" style={{ color: '#DC2626' }}>{returningReason}</p>
          )}
          <div className="flex gap-2">
            <button onClick={() => { setReturningReason(null); setReturnText('') }} className="rounded border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold">Cancel</button>
            <button onClick={handleReturnForRevision} className="rounded px-3 py-1 text-[11px] font-semibold text-white" style={{ backgroundColor: '#B45309' }}>Confirm return</button>
          </div>
        </div>
      )}

      {/* ============ Three-panel row ============ */}
      <div className="flex flex-1 min-h-0">

        <SectionNavigator
          sections={document.sections}
          loggedInUser={{ initials: 'EV', colourKey: 'EV' }}
          activeSectionBadge="IN REVIEW"
          progressLabelSuffix="reviewed"
        />

        {/* Editor pane */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-white">
          <ReviewerToolbar
            onAddComment={() => {
              const el = window.document.getElementById('reviewer-comment-textarea') as HTMLTextAreaElement | null
              el?.focus()
            }}
            onFlagSection={handleFlagSection}
            raciRole={LOGGED_IN_REVIEWER.raci}
            raciLabel={RACI_LABEL[LOGGED_IN_REVIEWER.raci]}
          />

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-12 pt-6 pb-8">
            <div className="flex max-w-[760px] flex-col">
              <h2 className="text-[22px] font-bold tracking-tight">11. Efficacy Evaluation</h2>
              <h3 className="mt-4 text-[17px] font-bold">11.4 Primary Efficacy Endpoint</h3>
              <h4 className="mt-3 text-[15px] font-bold">§11.4.1 Progression-Free Survival</h4>

              {/* AI paragraph block */}
              <div className="relative mt-3 rounded-r-[4px] p-[10px_14px]" style={{ borderLeft: '3px solid #93C5FD', backgroundColor: '#F0F7FF' }}>
                <div className="absolute right-2.5 top-2.5 rounded px-1.5 py-1 font-mono text-[9px] font-medium" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>AI</div>
                <p className="pr-10 text-sm leading-[1.8] text-slate-900">
                  Veloricept in combination with pembrolizumab demonstrated a statistically significant improvement in progression-free survival (PFS) compared to placebo plus pembrolizumab, with a median PFS of <span style={{ borderBottom: '1.5px solid #93C5FD' }}>14.2 months</span> versus <span style={{ borderBottom: '1.5px solid #93C5FD' }}>8.7 months</span> (<span style={{ borderBottom: '1.5px solid #93C5FD' }}>HR 0.61</span>; <span style={{ borderBottom: '1.5px solid #93C5FD' }}>95% CI 0.48–0.77</span>; <span style={{ borderBottom: '1.5px solid #93C5FD' }}>p&lt;0.0001</span>).
                </p>
              </div>

              {/* Comment composition box — persistent */}
              <div
                className="mt-4 flex flex-col gap-2.5 rounded-lg border bg-white p-3.5"
                style={{ borderColor: '#2563EB', boxShadow: '0 0 0 3px rgba(37,99,235,0.12)' }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex h-5 w-5 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold" style={{ backgroundColor: '#FEF3C7', color: '#D97706' }}>EV</div>
                  <p className="text-[13px] font-bold">Dr. Elena Vasquez</p>
                  <p className="font-mono text-[10px] tracking-wider text-slate-500">Regulatory Affairs · C</p>
                  <div className="flex-1" />
                  <p className="text-[11px] text-slate-500">Draft</p>
                </div>
                <textarea
                  id="reviewer-comment-textarea"
                  rows={3}
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder="Write a comment for §11.4.1…"
                  className="w-full rounded border p-2.5 text-sm outline-none focus:border-blue-600 focus:shadow-focus"
                  style={{ borderColor: '#E2E8F0', resize: 'vertical' }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-500">Tag to:</span>
                  <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900" style={{ backgroundColor: '#F1F5F9' }}>§11.4.1</span>
                  <span className="ml-1.5 text-[11px] text-slate-500">Severity:</span>
                  <SeverityButton value="major"  active={severity === 'major'}  onClick={() => setSeverity('major')}  label="Major"  bg="#FEE2E2" fg="#DC2626" />
                  <SeverityButton value="minor"  active={severity === 'minor'}  onClick={() => setSeverity('minor')}  label="Minor"  bg="#FFFBEB" fg="#B45309" />
                  <SeverityButton value="query"  active={severity === 'query'}  onClick={() => setSeverity('query')}  label="Query"  bg="#EFF6FF" fg="#2563EB" />
                </div>
                <div className="flex items-center justify-end gap-3">
                  <button onClick={() => setCommentText('')} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
                  <button
                    type="button"
                    onClick={handlePostComment}
                    disabled={!commentText.trim() || addCommentMut.isPending}
                    className="rounded-md bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    {addCommentMut.isPending ? 'Posting…' : 'Post comment'}
                  </button>
                </div>
              </div>

              <p className="mt-4 text-sm leading-[1.8] text-slate-900">
                The Kaplan–Meier curves for PFS demonstrated early and sustained separation between treatment arms from Week 8 onwards, with the separation widening through to the data cut-off date of 30 September 2024.
              </p>

              {flagged && (
                <div className="mt-3 rounded border px-3 py-2 text-[12px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' }}>
                  ⚑ Section flagged for follow-up
                </div>
              )}
            </div>
          </div>

          {/* Provenance bar */}
          <div className="flex h-10 flex-none items-center overflow-hidden truncate whitespace-nowrap border-t border-slate-200 px-5 text-xs text-slate-500" style={{ backgroundColor: '#F8FAFC' }}>
            Section {activeSection ? activeSection.replace('s', '').replace('_', '.') : '11.4.1'} · 2 AI-drafted spans · 1 human-authored span · Reviewing as {LOGGED_IN_REVIEWER.name} · {LOGGED_IN_REVIEWER.raci} ({RACI_LABEL[LOGGED_IN_REVIEWER.raci]})
          </div>

          {/* Right panel — absolute overlay per Pattern 6 */}
          {activePanel !== null && (
            <div
              className="absolute top-0 right-0 bottom-0 flex flex-col border-l border-slate-200"
              style={{
                width:           panelWidth,
                zIndex:          6,
                backgroundColor: '#FFFFFF',
                boxShadow:       '-16px 0 40px rgba(15,23,42,0.12)',
              }}
            >
              {/* Panel header */}
              <div className="flex h-12 flex-none items-center gap-2 border-b border-slate-200 px-4">
                <h3 className="text-sm font-bold text-slate-900">{panelTitle}{activePanel === 'comments' ? ' (3 open)' : ''}</h3>
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

              {/* Panel body */}
              {activePanel === 'comments' && documentId && (
                <CommentsPanel documentId={documentId} />
              )}
              {activePanel === 'checklist' && documentId && (
                <ChecklistPanel documentId={documentId} />
              )}
              {activePanel === 'audit' && documentId && (
                <AuditTrailPanel documentId={documentId} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Sub-component ---

function SeverityButton({
  active, onClick, label, bg, fg,
}: {
  value: CommentSeverity
  active: boolean
  onClick: () => void
  label: string
  bg: string
  fg: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-all"
      style={{
        backgroundColor: active ? bg : '#F8FAFC',
        color:           active ? fg : '#64748B',
        border:          active ? `1px solid ${fg}` : '1px solid #E2E8F0',
      }}
    >
      {label}
    </button>
  )
}
