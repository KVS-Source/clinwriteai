import { useEffect, useRef, useState } from 'react'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CommentSeverity } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { useCurrentUser } from '../../hooks'
import { useDocumentPresence } from '../../hooks/usePresence'
import { withSectionMark } from '../../panels/CommentComposer'
import { PLATFORM_USER_ROLE_LABEL, STATUS_META, type PlatformUserRole } from '@platform/types'
import { EditorContent } from '@tiptap/react'
import { useDocumentStore, useProjectStore } from '../../store'
import { useRichTextEditor } from './RichTextEditor'
import { SectionNavigator } from './SectionNavigator'
import { PresenceStack } from './PresenceStack'
import { ReviewerToolbar } from './ReviewerToolbar'
import { CommentsPanel }   from '../../panels/CommentsPanel'
import { ChecklistPanel }  from '../../panels/ChecklistPanel'
import { AuditTrailPanel } from '../../panels/AuditTrailPanel'

// Avatar colours for known people; anyone else gets the neutral blue. The person
// shown as "you" is whoever the API says is signed in (useCurrentUser) — the
// server records comments against that identity, so the screen must show it too.
const AVATAR: Record<string, { bg: string; fg: string }> = {
  MW: { bg: '#DBEAFE', fg: '#1D4ED8' }, SC: { bg: '#F0FDF4', fg: '#15803D' },
  JO: { bg: '#F5F3FF', fg: '#7C3AED' }, EV: { bg: '#FEF3C7', fg: '#D97706' },
  PN: { bg: '#FEE2E2', fg: '#DC2626' }, AH: { bg: '#E0F2FE', fg: '#0369A1' },
  RT: { bg: '#FCE7F3', fg: '#9D174D' }, LP: { bg: '#F3F4F6', fg: '#374151' },
}
const NEUTRAL_AVATAR = { bg: '#DBEAFE', fg: '#1D4ED8' }

// "Review due 05 Nov 2026 · 3 days remaining" from the due date set on Submit
// for review; null when none was set. The date is a calendar day stored as UTC
// midnight, so it's shown in UTC (no off-by-one west of Greenwich) and counted
// against today's local calendar day.
function reviewDueLabel(reviewDueAt: string | null | undefined): string | null {
  if (!reviewDueAt) return null
  const due = new Date(reviewDueAt)
  if (Number.isNaN(due.getTime())) return null
  const dateLabel = due.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const now = new Date()
  const days = Math.round(
    (Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000,
  )
  const remaining =
    days > 1   ? `${days} days remaining` :
    days === 1 ? '1 day remaining' :
    days === 0 ? 'due today' :
    days === -1 ? '1 day overdue' :
                 `${-days} days overdue`
  return `Review due ${dateLabel} · ${remaining}`
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
  const setActiveDocument  = useDocumentStore(s => s.setActiveDocument)
  const setActiveSection   = useDocumentStore(s => s.setActiveSection)
  const setActivePanel     = useDocumentStore(s => s.setActivePanel)

  // Side panel: drag the edge to resize, or expand it to the whole working area.
  const panel = useResizablePanel({ activePanel })

  // A click outside the Audit Trail or Comments panel, or Esc, closes it. (Checklist stays open.)
  // Comments stays open while a resolution note is half-typed in it, so the draft isn't lost.
  // The toolbar buttons that open panels are marked [data-panel-trigger] and handle their own
  // toggle. Outside clicks are judged on mousedown + click so a press that starts inside the
  // panel (resizing, selecting) never closes it.
  const rightPanelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (activePanel !== 'audit' && activePanel !== 'comments') return
    const hasDraft = () => activePanel === 'comments' && Array.from(rightPanelRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea') ?? [])
      .some(el => el.value.trim() !== '')
    const close = () => { if (!hasDraft()) setActivePanel(null) }
    let pressedOutside = false
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      pressedOutside = !!t && !rightPanelRef.current?.contains(t)
        && !t.closest('[data-slide-panel], [data-panel-trigger]')
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null
      const outside = pressedOutside
      pressedOutside = false
      if (!outside || !t?.isConnected || rightPanelRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close()
    }
    window.document.addEventListener('mousedown', onDown, true)
    window.document.addEventListener('click', onClick)
    window.document.addEventListener('keydown', onKey)
    return () => {
      window.document.removeEventListener('mousedown', onDown, true)
      window.document.removeEventListener('click', onClick)
      window.document.removeEventListener('keydown', onKey)
    }
  }, [activePanel, setActivePanel])

  const [commentText,     setCommentText]     = useState('')
  const [severity,        setSeverity]        = useState<CommentSeverity>('minor')
  const [flagged,         setFlagged]         = useState(false)
  const [composerOpen,    setComposerOpen]    = useState(true)
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

  // Start with no side panel open. The panel state is shared with the Editor, so also clear
  // anything left open there (e.g. Submit for review) — the reviewer only has Comments,
  // Checklist and Audit. Reviewers open them from the toolbar when they want them.
  // ?panel=comments (e.g. from a comment card on the module home) opens Comments instead.
  const [searchParams] = useSearchParams()
  const openCommentsOnLoad = searchParams.get('panel') === 'comments'
  useEffect(() => {
    setActivePanel(openCommentsOnLoad ? 'comments' : null)
  }, [setActivePanel, openCommentsOnLoad])

  // Choose the starting section once per document; a reload of the same document keeps the
  // reviewer on the section they are reading.
  const startedDocumentRef = useRef<string | null>(null)
  useEffect(() => {
    if (document) {
      setActiveDocument(document)
      const current = useDocumentStore.getState().activeSection
      if (startedDocumentRef.current === document.id && current && document.sections.some(s => s.id === current)) return
      startedDocumentRef.current = document.id
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

  // Who is acting — the same identity the server records the comment under.
  const { data: me } = useCurrentUser()
  const reviewer = {
    name:     me?.name ?? '…',
    initials: me?.initials ?? '',
    role:     me ? (PLATFORM_USER_ROLE_LABEL[me.role as PlatformUserRole] ?? me.role) : '',
  }
  const reviewerColours = AVATAR[reviewer.initials] ?? NEUTRAL_AVATAR

  // Keep this reviewer in the document's presence list ("N active" here and in the Editor).
  useDocumentPresence(documentId, activeSection)

  // Same query key the Comments panel uses, so this is a cache read, not a second fetch.
  const { data: commentList = [] } = useQuery({
    queryKey: ['comments', documentId],
    queryFn:  () => documentsApi.getComments(documentId!),
    enabled:  !!documentId,
  })
  // Approvals are stored as verdict comments but need no action, so they don't
  // count as "open" (the Comments panel lists them separately as approvals).
  const openCommentCount = commentList.filter(c => c.status === 'open' && c.verdict !== 'approve').length

  // The section being reviewed. Verdicts are only meaningful against a real
  // section — a document with no sections must not record "§?" approvals.
  const activeSectionData = document?.sections.find(s => s.id === activeSection) ?? null
  const hasSections       = (document?.sections.length ?? 0) > 0
  const activeRef         = activeSectionData ? withSectionMark(activeSectionData.number) : null
  // Footer provenance counts come from the API; without a section there is nothing to count.
  const spanCount = (n: number, label: string) => `${n} ${label} span${n === 1 ? '' : 's'}`
  const provenanceText = activeSectionData
    ? ` · ${spanCount(activeSectionData.aiSpanCount ?? 0, 'AI-drafted')} · ${spanCount(activeSectionData.humanSpanCount ?? 0, 'human-authored')}`
    : ''
  const alreadyApproved   = !!me && !!activeRef && commentList.some(
    c => c.verdict === 'approve' && c.reviewerId === me.id && c.sectionRef === activeRef,
  )
  const verdictBlockedReason = !hasSections ? 'This document has no sections yet'
                             : !activeSectionData ? 'Select a section to review'
                             : null
  // Returned for revision (by any reviewer) and not saved by the writer since:
  // it can't be approved until it comes back revised. The API enforces the same rule.
  const lastReturn = activeRef
    ? commentList
        .filter(c => c.sectionRef === activeRef && (c.verdict === 'request_changes' || c.verdict === 'block_approval'))
        .reduce<string | null>((latest, c) => (!latest || c.createdAt > latest ? c.createdAt : latest), null)
    : null
  const awaitingRevision = !!lastReturn
    && !(activeSectionData?.lastEditedAt && new Date(activeSectionData.lastEditedAt) > new Date(lastReturn))
  const approveBlockedReason = verdictBlockedReason
    ?? (awaitingRevision ? `${activeRef} was returned for revision — it can be approved once the writer has revised it` : null)

  // Read-only render of the active section's real content (same TipTap schema
  // as the editor, so only known formatting is rendered).
  const sectionViewer = useRichTextEditor({ content: activeSectionData?.contentHtml ?? '', editable: false })
  const sectionIsBlank = !activeSectionData?.contentHtml || activeSectionData.contentHtml === '<p></p>'

  // Plain comments post against the section being viewed; §11.4.1 remains the
  // fallback for documents whose sections aren't loaded / don't exist.
  const commentRef = activeRef ?? '§11.4.1'

  const addCommentMut = useMutation({
    mutationFn: () => documentsApi.addComment(documentId!, {
      sectionRef: commentRef,
      text:       commentText,
      severity,
    }),
    onSuccess: () => {
      setCommentText('')
      setComposerOpen(false)   // posted — close the box; the prompt below reopens it
      setActivePanel('comments')   // show the reviewer their comment in the drawer
      qc.invalidateQueries({ queryKey: ['comments', documentId] })
      qc.invalidateQueries({ queryKey: ['project-comments'] })
      qc.invalidateQueries({ queryKey: ['document-audit', documentId] })
    },
  })

  const handlePostComment = () => {
    if (!commentText.trim() || !documentId) return
    addCommentMut.mutate()
  }

  // Reviewer verdict posts (Phase 2.2). Sections are referenced by the
  // active section's human-readable number — the server's audit event
  // picks up `reviewer_approve` / `reviewer_request_changes` /
  // `reviewer_block_approval` based on the verdict field.
  const sectionRefFor = (sid: string | null) => {
    if (!sid) return '§?'
    const s = document?.sections.find(x => x.id === sid)
    return s ? withSectionMark(s.number) : `§${sid.replace('s', '').replace('_', '.')}`
  }

  const approveMut = useMutation({
    mutationFn: () => documentsApi.addComment(documentId!, {
      sectionRef: sectionRefFor(activeSection),
      text:       '',
      severity:   'query',
      verdict:    'approve',
    }),
    onSuccess: () => {
      setApproveNote(`Section approved: ${sectionRefFor(activeSection)}`)
      qc.invalidateQueries({ queryKey: ['comments', documentId] })
      qc.invalidateQueries({ queryKey: ['project-comments'] })
    },
  })

  const requestChangesMut = useMutation({
    mutationFn: () => documentsApi.addComment(documentId!, {
      sectionRef: sectionRefFor(activeSection),
      text:       '',
      severity:   'major',
      verdict:    'request_changes',
    }),
    onSuccess: () => {
      setApproveNote(`Section returned for revision: ${sectionRefFor(activeSection)}`)
      qc.invalidateQueries({ queryKey: ['comments', documentId] })
      qc.invalidateQueries({ queryKey: ['project-comments'] })
    },
  })

  const handleApproveSection = () => {
    // No approvals against "§?" (document without sections) and no duplicate
    // approvals of the same section by the same reviewer.
    if (!documentId || approveBlockedReason || alreadyApproved) return
    approveMut.mutate()
  }

  const handleReturnForRevision = () => {
    if (!documentId || verdictBlockedReason) return
    requestChangesMut.mutate()
  }

  const handleFlagSection = () => setFlagged(v => !v)

  // Cancel throws the draft away and collapses the box; opening it again (toolbar button or the
  // prompt that replaces it) brings back an empty box and puts the cursor in it.
  const cancelComposer = () => {
    setCommentText('')
    setSeverity('minor')
    addCommentMut.reset()
    setComposerOpen(false)
  }
  const openComposer = () => {
    addCommentMut.reset()   // drop the "posted" note from the last comment
    setComposerOpen(true)
    // The box may have been collapsed — wait for it to render before focusing.
    window.setTimeout(() => {
      (window.document.getElementById('reviewer-comment-textarea') as HTMLTextAreaElement | null)?.focus()
    }, 0)
  }

  if (!document) {
    return <div className="flex h-full items-center justify-center"><p className="font-mono text-sm text-slate-400">Loading document…</p></div>
  }

  const panelTitle = activePanel && activePanel in PANEL_TITLES ? PANEL_TITLES[activePanel] : ''
  // The Audit Trail panel is laid out like the editor's: beside the content, with an icon in
  // its header and no expand button. Comments and Checklist stay as overlays.
  const splitPanel = activePanel === 'audit'
  const statusMeta = STATUS_META[document.status] ?? { bg: '#F8FAFC', fg: '#64748B', label: document.status }

  return (
    <div className="flex h-full flex-col" data-screen="reviewer-view">

      {/* ============ Document header ============ */}
      <div
        className="flex flex-none flex-col gap-2 border-b border-slate-200 bg-white px-6 pt-3"
        style={{ position: 'relative', zIndex: 6 }}
      >
        {/* Breadcrumb moved to TopNav (same cleanup as DocumentEditor). */}

        {/* Title row */}
        <div className="flex h-14 items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="truncate text-base font-bold tracking-tight">{document.title}</h1>
            <span
              className="flex-none rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ backgroundColor: statusMeta.bg, color: statusMeta.fg }}
              data-document-status={document.status}
            >
              {statusMeta.label}
            </span>
            <span className="flex-none font-mono text-[11px] text-slate-500">
              {String(document.version).startsWith('v') ? document.version : `v${document.version}`}
              {document.status === 'in-review' ? ' · For Review' : ''}
            </span>
          </div>

          {/* Right cluster */}
          <div className="flex flex-none items-center gap-3.5">
            {reviewDueLabel(document.reviewDueAt) && (
              <p className="whitespace-nowrap text-xs text-slate-500" data-review-due>{reviewDueLabel(document.reviewDueAt)}</p>
            )}

            {/* Presence stack — live, same as the Editor (FR-A-053 / AC-A-037). */}
            {documentId && <PresenceStack documentId={documentId} currentUserId={me?.id} currentUserName={me?.name} />}

            <button
              type="button"
              onClick={handleApproveSection}
              disabled={approveMut.isPending || !!approveBlockedReason || alreadyApproved}
              title={approveBlockedReason ?? (alreadyApproved ? `You have already approved ${activeRef}` : undefined)}
              data-action="approve-section"
              className="whitespace-nowrap rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: '#F0FDF4', color: '#15803D', borderColor: '#BBF7D0' }}
            >
              {approveMut.isPending ? 'Approving…' : alreadyApproved ? '✓ Approved by you' : awaitingRevision ? 'Awaiting revision' : 'Approve section'}
            </button>
            <button
              type="button"
              onClick={handleReturnForRevision}
              disabled={requestChangesMut.isPending || !!verdictBlockedReason}
              title={verdictBlockedReason ?? undefined}
              data-action="return-for-revision"
              className="whitespace-nowrap rounded-md border px-3.5 py-2 text-[13px] font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' }}
            >
              {requestChangesMut.isPending ? 'Returning…' : 'Return for revision'}
            </button>
            {/* Review → Comments Resolution Meeting (PRD stage 5). */}
            {(document.status === 'in-review' || document.status === 'crm-in-progress') && (
              <button
                type="button"
                onClick={() => navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}/crm`)}
                data-action="open-crm"
                className="whitespace-nowrap rounded-md border border-blue-200 bg-blue-50 px-3.5 py-2 text-[13px] font-semibold text-blue-700 hover:bg-blue-100"
              >
                CRM meeting →
              </button>
            )}
            {/* Review + CRM done → the owner starts the Part 11 chain (FR-A-066). */}
            {document.status === 'pending-signature' && (
              <button
                type="button"
                onClick={() => navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}/sign`)}
                data-action="initiate-signature-chain"
                className="whitespace-nowrap rounded-md bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700"
              >
                Start signature chain →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Not submitted yet: say so, instead of looking like a live review. */}
      {(document.status === 'in-authoring' || document.status === 'not-started') && (
        <div
          role="status"
          className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-blue-200 bg-blue-50 px-6 py-2 text-[13px] text-blue-900"
          data-notice="not-submitted"
        >
          <span className="font-semibold">This document hasn't been submitted for review yet.</span>
          <span>It is {statusMeta.label}. Submit it from the Editor to start the review.</span>
          <button
            type="button"
            onClick={() => navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}`)}
            className="ml-auto font-semibold underline"
          >
            Go to Editor →
          </button>
        </div>
      )}

      {/* Approve/Return inline notices */}
      {!hasSections && (
        <div className="flex-none border-b border-slate-200 px-6 py-2 text-[12px] text-slate-600" style={{ backgroundColor: '#F8FAFC' }} data-notice="no-sections">
          This document has no sections yet, so sections can't be approved or returned. Comments can still be added.
        </div>
      )}
      {approveNote && (
        <div className="flex-none border-b border-slate-200 px-6 py-2 text-[12px]" style={{ backgroundColor: '#F0FDF4', color: '#15803D' }}>
          ✓ {approveNote}
          <button onClick={() => setApproveNote(null)} className="ml-3 text-xs underline">Dismiss</button>
        </div>
      )}
      {approveMut.isError && (
        <div className="flex-none border-b border-red-200 px-6 py-2 text-[12px] text-red-700" style={{ backgroundColor: '#FEE2E2' }}>
          Could not record approval: {(approveMut.error as { body?: { message?: string } } | null)?.body?.message ?? (approveMut.error as Error | null)?.message ?? 'see console for details.'}
        </div>
      )}
      {requestChangesMut.isError && (
        <div className="flex-none border-b border-red-200 px-6 py-2 text-[12px] text-red-700" style={{ backgroundColor: '#FEE2E2' }}>
          Could not post return comment: {(requestChangesMut.error as { body?: { message?: string } } | null)?.body?.message ?? (requestChangesMut.error as Error | null)?.message ?? 'see console for details.'}
        </div>
      )}
      {/* ============ Three-panel row ============ */}
      <div className="flex flex-1 min-h-0">

        <SectionNavigator
          sections={document.sections}
          loggedInUser={{ initials: reviewer.initials, colourKey: (reviewer.initials in AVATAR ? reviewer.initials : 'MW') as 'MW' }}
          activeSectionBadge="IN REVIEW"
          progressLabelSuffix="reviewed"
        />

        {/* Editor pane */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-white">
          <ReviewerToolbar
            onAddComment={openComposer}
            onFlagSection={handleFlagSection}
            roleLabel={reviewer.role}
            openCommentCount={openCommentCount}
          />

          {/* Split row — content column + (for the Audit Trail) the right panel beside it, as in the
              editor: the content narrows and stays visible instead of being covered. */}
          <div className="flex min-h-0 flex-1">

          {/* Content column */}
          <div className="flex min-w-0 flex-1 flex-col">

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-12 pt-6 pb-8">
            <div className="flex max-w-[760px] flex-col">
              {/* Section under review — the document's real content, read-only */}
              {activeSectionData ? (
                <section data-section-content={activeSectionData.id}>
                  <h2 className="text-[20px] font-bold tracking-tight">
                    {withSectionMark(activeSectionData.number)} {activeSectionData.title}
                  </h2>
                  {sectionIsBlank ? (
                    <p className="mt-3 rounded-md border border-dashed border-slate-300 p-4 text-center text-[13px] text-slate-500" data-state="empty-section">
                      This section has no content yet.
                    </p>
                  ) : (
                    <div className="mt-3 [&_.tiptap-editor]:min-h-0">
                      <EditorContent editor={sectionViewer} />
                    </div>
                  )}
                </section>
              ) : (
                <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-[13px] text-slate-500" data-state="no-sections">
                  {hasSections ? 'Select a section from the list to review it.' : 'This document has no sections yet.'}
                </p>
              )}

              {/* Comment composition box — Cancel collapses it; "Add comment" (or the prompt below) reopens it */}
              {composerOpen ? (
              <div
                className="mt-4 flex flex-col gap-2.5 rounded-lg border bg-white p-3.5"
                style={{ borderColor: '#2563EB', boxShadow: '0 0 0 3px rgba(37,99,235,0.12)' }}
                data-comment-composer
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex h-5 w-5 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold" style={{ backgroundColor: reviewerColours.bg, color: reviewerColours.fg }} data-comment-author-initials>{reviewer.initials}</div>
                  <p className="text-[13px] font-bold" data-comment-author>{reviewer.name}</p>
                  <p className="font-mono text-[10px] tracking-wider text-slate-500">{reviewer.role}</p>
                  <div className="flex-1" />
                  <p className="text-[11px] text-slate-500">Draft</p>
                </div>
                <textarea
                  id="reviewer-comment-textarea"
                  rows={3}
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder={`Write a comment for ${commentRef}…`}
                  className="w-full rounded border p-2.5 text-sm outline-none focus:border-blue-600 focus:shadow-focus"
                  style={{ borderColor: '#E2E8F0', resize: 'vertical' }}
                />
                {/* Tag/Severity + actions share one row so the composer uses one less
                    line of vertical space. flex-1 spacer between them pushes
                    Cancel / Post comment to the right edge. */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-500">Tag to:</span>
                  <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-900" style={{ backgroundColor: '#F1F5F9' }} data-comment-tag>{commentRef}</span>
                  <span className="ml-1.5 text-[11px] text-slate-500">Severity:</span>
                  <SeverityButton value="major"  active={severity === 'major'}  onClick={() => setSeverity('major')}  label="Major"  bg="#FEE2E2" fg="#DC2626" />
                  <SeverityButton value="minor"  active={severity === 'minor'}  onClick={() => setSeverity('minor')}  label="Minor"  bg="#FFFBEB" fg="#B45309" />
                  <SeverityButton value="query"  active={severity === 'query'}  onClick={() => setSeverity('query')}  label="Query"  bg="#EFF6FF" fg="#2563EB" />
                  <div className="flex-1 min-w-[12px]" />
                  <button
                    type="button"
                    onClick={cancelComposer}
                    disabled={addCommentMut.isPending}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
                  >Cancel</button>
                  <button
                    type="button"
                    onClick={handlePostComment}
                    disabled={!commentText.trim() || addCommentMut.isPending}
                    className="rounded-md bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                  >
                    {addCommentMut.isPending ? 'Posting…' : 'Post comment'}
                  </button>
                </div>
                {addCommentMut.isError && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700" role="alert">
                    {(addCommentMut.error as { body?: { message?: string } } | null)?.body?.message
                      ?? (addCommentMut.error as Error | null)?.message
                      ?? 'Could not post comment — see console for details.'}
                  </div>
                )}
                {addCommentMut.isSuccess && !addCommentMut.isPending && (
                  <p className="text-[11px] font-semibold text-green-700">Comment posted — see Comments panel.</p>
                )}
              </div>
              ) : (
                <>
                {addCommentMut.isSuccess && (
                  <p className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-[12px] font-semibold text-green-700" role="status" data-comment-posted>
                    ✓ Comment posted — see the Comments panel.
                  </p>
                )}
                <button
                  type="button"
                  onClick={openComposer}
                  className="mt-3 flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3.5 py-3 text-left text-[13px] font-semibold text-slate-600 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
                  data-open-composer
                >
                  <span aria-hidden="true">＋</span> Add a comment{commentRef ? ` for ${commentRef}` : ''}
                </button>
                </>
              )}

              {flagged && (
                <div className="mt-3 rounded border px-3 py-2 text-[12px] font-semibold" style={{ backgroundColor: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' }}>
                  ⚑ Section flagged for follow-up
                </div>
              )}
            </div>
          </div>

          {/* Provenance bar */}
          <div className="flex h-10 flex-none items-center overflow-hidden truncate whitespace-nowrap border-t border-slate-200 px-5 text-xs text-slate-500" style={{ backgroundColor: '#F8FAFC' }}>
            Section {activeRef ?? '—'}<span data-provenance-counts>{provenanceText}</span> · Reviewing as {reviewer.name}{reviewer.role ? ` · ${reviewer.role}` : ''}
          </div>

          </div>{/* /Content column */}

          {/* Right panel. The Audit Trail sits beside the content exactly like the editor's panel
              (in-flow, no shadow); Comments and Checklist keep the overlay (Pattern 6). */}
          {activePanel !== null && (
            <div
              ref={rightPanelRef}
              className={splitPanel
                ? 'relative flex flex-none flex-col border-l border-slate-200'
                : 'fixed top-14 right-0 bottom-0 flex flex-col border-l border-slate-200'}
              style={splitPanel
                ? { width: panel.width, maxWidth: '100%', backgroundColor: '#FFFFFF' }
                : {
                    width:           panel.width,
                    maxWidth:        '100%',
                    zIndex:          30,
                    backgroundColor: '#FFFFFF',
                    boxShadow:       '-16px 0 40px rgba(15,23,42,0.12)',
                  }}
            >
              {/* Drag handle on the left edge: drag to resize, double-click to expand/shrink */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panel"
                title="Drag to resize · double-click to expand"
                onMouseDown={e => { e.preventDefault(); panel.startDrag() }}
                onDoubleClick={panel.toggleExpanded}
                className="absolute inset-y-0 -left-1 z-10 w-2 cursor-ew-resize transition-colors hover:bg-blue-300/60"
                style={panel.dragging ? { backgroundColor: 'rgba(147,197,253,0.7)' } : undefined}
              />
              {/* Panel header */}
              <div className="flex h-12 flex-none items-center gap-2 border-b border-slate-200 px-4">
                {splitPanel && (
                  <span className="flex flex-none" style={{ color: '#2563EB' }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                      <circle cx="7" cy="7" r="5.4"/>
                      <line x1="7" y1="4" x2="7" y2="7.4" strokeLinecap="round"/>
                      <line x1="7" y1="7.4" x2="9.6" y2="7.4" strokeLinecap="round"/>
                    </svg>
                  </span>
                )}
                <h3 className="text-sm font-bold text-slate-900">{panelTitle}{activePanel === 'comments' ? ` (${openCommentCount} open)` : ''}</h3>
                <div className="flex-1" />
                {/* Expand / shrink — not shown on the Audit Trail, same as the editor's panel
                    (drag the left edge or double-click it to resize instead). */}
                {!splitPanel && (
                  <button
                    type="button"
                    onClick={panel.toggleExpanded}
                    aria-label={panel.expanded ? 'Shrink panel' : 'Expand panel'}
                    title={panel.expanded ? 'Shrink panel' : 'Expand panel'}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
                  >
                    {panel.expanded ? (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M7.5 1.5v3h3M4.5 10.5v-3h-3M7.5 4.5l3-3M4.5 7.5l-3 3"/>
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M7 1.5h3.5V5M5 10.5H1.5V7M10.5 1.5L7 5M1.5 10.5L5 7"/>
                      </svg>
                    )}
                  </button>
                )}
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
                <CommentsPanel
                  documentId={documentId}
                  sections={document?.sections ?? []}
                  activeSectionId={activeSection}
                  onAddComment={openComposer}
                />
              )}
              {activePanel === 'checklist' && documentId && (
                <ChecklistPanel documentId={documentId} />
              )}
              {activePanel === 'audit' && documentId && (
                <AuditTrailPanel
                  documentId={documentId}
                  section={activeSectionData ? { id: activeSectionData.id, number: activeSectionData.number, title: activeSectionData.title } : null}
                />
              )}
            </div>
          )}

          </div>{/* /Split row */}
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
