import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PanelMode, PlatformUser } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { usePresenceSnapshot } from '../../hooks/usePresence'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { platformApi } from '../../platform/api/platformApi'
import { StatusPill } from '../../components/ui'
import { useDocumentStore, useProjectStore, useAuthStore, useEditorStore } from '../../store'
import { SectionAIPrompt } from './SectionAIPrompt'
import { SourceReferencesPanel } from '../../panels/SourceReferencesPanel'
import {
  applyReferenceHighlights, buildTextIndex, clearReferenceHighlights, normalizeSpan, referenceAtPoint, spanOfRange, type LinkedRange,
} from './referenceHighlights'
import { SectionNavigator } from './SectionNavigator'
import { EditorToolbar }    from './EditorToolbar'
import { EditorContent, useRichTextEditor } from './RichTextEditor'
import { useCollabProvider } from './useCollabProvider'
import { VoiceNotePanel }         from '../../panels/VoiceNotePanel'
import { ChecklistPanel }         from '../../panels/ChecklistPanel'
import { AuditTrailPanel }        from '../../panels/AuditTrailPanel'
import { ReviewAssignmentPanel }  from '../../panels/ReviewAssignmentPanel'
import { ICHValidatorPanel }      from '../../panels/ICHValidatorPanel'
import { MedDRAPanel }            from '../../panels/MedDRAPanel'
import { CommentsPanel }          from '../../panels/CommentsPanel'
import { AIChatPanel }            from '../../panels/AIChatPanel'
import { SectionHistoryPanel }    from '../../panels/SectionHistoryPanel'
import { AIPromptHelpPanel }      from '../../panels/AIPromptHelpPanel'

// Panel titles for the right panel header
const PANEL_TITLES: Record<NonNullable<PanelMode>, string> = {
  'ai':                'AI Chat',
  'ai-help':           'Prompt library',
  'history':           'Section History',
  'traceability':      'Source References',
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

// Deterministic colour for a user's presence avatar — hashed from userId
// so the same user always gets the same colour across sessions.
const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: '#DBEAFE', fg: '#1D4ED8' },  // blue
  { bg: '#F5F3FF', fg: '#7C3AED' },  // purple
  { bg: '#FEF3C7', fg: '#D97706' },  // amber
  { bg: '#D1FAE5', fg: '#065F46' },  // green
  { bg: '#FEE2E2', fg: '#B91C1C' },  // red
  { bg: '#E0E7FF', fg: '#3730A3' },  // indigo
  { bg: '#FCE7F3', fg: '#9D174D' },  // pink
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function avatarColor(userId: string) {
  return AVATAR_PALETTE[hashString(userId) % AVATAR_PALETTE.length]
}

function initialsFromName(name: string | null | undefined, fallback = '?'): string {
  if (!name) return fallback
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() ?? '').join('') || fallback
}

export function DocumentEditor() {
  const { projectId, documentId } = useParams()
  const navigate                  = useNavigate()
  const setActiveProject          = useProjectStore(s => s.setActiveProject)

  const activeSection        = useDocumentStore(s => s.activeSection)
  const activePanel          = useDocumentStore(s => s.activePanel)
  const setActiveDocument    = useDocumentStore(s => s.setActiveDocument)
  const setActiveSection     = useDocumentStore(s => s.setActiveSection)
  const setActivePanel       = useDocumentStore(s => s.setActivePanel)
  const toggleDiffMode       = useDocumentStore(s => s.toggleDiffMode)
  const setVersions          = useDocumentStore(s => s.setVersions)

  const { data: document, dataUpdatedAt, refetch: refetchDocument, isFetching: isRefetching } = useQuery({
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

  // Real presence — Socket.io emits presence:changed; the hook polls as a
  // fallback. Snapshot groups users by section; the header stack flattens
  // across all sections on this doc.
  const { data: presenceSnapshot } = usePresenceSnapshot(documentId ?? '', { pollMs: 15_000 })
  const currentUser = useAuthStore(s => s.user)

  // Resolve user id → PlatformUser so avatars can show initials + full
  // name tooltip without the presence payload having to carry them.
  const { data: platformUsers = [] } = useQuery<PlatformUser[]>({
    queryKey: ['platform-users'],
    queryFn:  () => platformApi.listUsers(),
    staleTime: 60_000,
  })
  const usersById = useMemo(() => new Map(platformUsers.map(u => [u.id, u])), [platformUsers])

  // ------- Section draft + save (Arc A3-mvp) -------
  // Local draft content for the active section. Hydrated from the
  // loaded document; dirty when the user types; cleared on save or
  // when the active section changes.
  const qc = useQueryClient()
  const activeSectionData = useMemo(
    () => (document && activeSection ? document.sections.find(s => s.id === activeSection) ?? null : null),
    [document, activeSection],
  )
  const [draftContent, setDraftContent] = useState<string>('')
  const [isEditing, setIsEditing] = useState<boolean>(false)
  // Set when an AI edit from the prompt box was accepted into the draft — the save is then
  // recorded as AI-drafted with this model (Part 11 provenance, FR-A-021).
  const [aiEditModel, setAiEditModel] = useState<string | null>(null)

  // Switching sections starts the new section fresh. The editor's save pattern is explicit (click
  // Save), so leaving a section mid-edit IS a discard.
  useEffect(() => {
    setDraftContent(activeSectionData?.contentHtml ?? '')
    setIsEditing(false)
    setAiEditModel(null)
  }, [activeSectionData?.id])

  // A reload that changes the section's saved text (someone else saved, or your own save came back)
  // refreshes the draft — but never while you're typing, and it never drops you out of edit mode.
  useEffect(() => {
    if (!isEditing) setDraftContent(activeSectionData?.contentHtml ?? '')
  }, [activeSectionData?.contentHtml])

  const saveSection = useMutation({
    mutationFn: () => {
      if (!documentId || !activeSectionData) throw new Error('no_active_section')
      return documentsApi.updateSection(documentId, activeSectionData.id, {
        contentHtml: draftContent,
        ...(aiEditModel ? { aiDrafted: true, aiModel: aiEditModel } : {}),
      })
    },
    onSuccess: () => {
      setIsEditing(false)
      setAiEditModel(null)
      // Server auto-creates a new DocumentVersion on content hash
      // change — invalidate both so the version chip updates too.
      qc.invalidateQueries({ queryKey: ['document', documentId] })
      qc.invalidateQueries({ queryKey: ['versions', documentId] })
    },
  })

  // Collab provider (Phase 2.3). Null when VITE_COLLAB_URL isn't set →
  // the editor runs solo. When set, a Y.Doc + WebsocketProvider is
  // created per (documentId, activeSection) room.
  const collab = useCollabProvider({ documentId, sectionId: activeSection })

  // Current user profile for the CollaborationCaret extension — name
  // + colour attached to this user's cursor + selection on other
  // clients' screens.
  const collabUser = currentUser ? {
    name:  currentUser.name,
    color: avatarColor(currentUser.id),
  } : undefined

  // TipTap editor instance (Phase 2.1). Mounted once per editor-pane
  // lifecycle; useRichTextEditor handles solo-mode hydration + collab
  // extension mounting.
  // Content prop tracks draftContent, NOT activeSectionData.contentHtml.
  // Why: useRichTextEditor re-creates the editor whenever `editable`
  // changes (its deps array). On Accept from the chat panel (view mode →
  // edit mode), the editor is destroyed and recreated — its initial
  // content comes from this `content` prop. If we passed the raw section
  // HTML, the AI response (just set via setDraftContent) would be lost.
  // draftContent is the single source of truth; the section-switch
  // useEffect below resets it when the active section changes.
  const editor = useRichTextEditor({
    content:  draftContent,
    editable: isEditing,
    onChange: html => setDraftContent(html),
    placeholder: 'Start writing this section…',
    collab,
    user: collabUser,
  })

  // When TipTap emits an empty paragraph for a blank doc the raw HTML
  // is '<p></p>'. Normalise so the dirty check doesn't fire spuriously
  // after switching from an empty section.
  const normaliseHtml = (s: string) => (s === '<p></p>' ? '' : s)
  const isDirty = isEditing && normaliseHtml(draftContent) !== normaliseHtml(activeSectionData?.contentHtml ?? '')

  const presenceStack = useMemo(() => {
    if (!presenceSnapshot) return []
    // Flatten all section rooms + dedupe by userId (same user may appear
    // on two sections if they rapidly navigated). "active" wins over
    // "idle" when the same user is in multiple states.
    const bestByUser = new Map<string, { userId: string; status: 'active' | 'idle' | 'ended' }>()
    for (const section of presenceSnapshot.sections) {
      for (const user of section.users) {
        const existing = bestByUser.get(user.userId)
        if (!existing || (existing.status !== 'active' && user.status === 'active')) {
          bestByUser.set(user.userId, { userId: user.userId, status: user.status })
        }
      }
    }
    return Array.from(bestByUser.values())
      .filter(u => u.status !== 'ended')
      .map(u => {
        const platformUser = usersById.get(u.userId)
        return {
          userId: u.userId,
          name: platformUser?.name ?? 'Unknown',
          initials: initialsFromName(platformUser?.name),
          isCurrentUser: currentUser?.id === u.userId,
          color: avatarColor(u.userId),
          status: u.status,
        }
      })
  }, [presenceSnapshot, usersById, currentUser])

  // Hydrate active document + default active section + presence heartbeat
  // The starting section is chosen once per document. A reload of the same document (after saving
  // a section, the Sync button, or the browser tab regaining focus) hands back a new `document`
  // object — that must not move the reader to a different section, so keep the current one for as
  // long as it still exists in the document.
  const startedDocumentRef = useRef<string | null>(null)
  useEffect(() => {
    if (!document) return
    setActiveDocument(document)
    const current = useDocumentStore.getState().activeSection
    const sameDocument = startedDocumentRef.current === document.id
    if (sameDocument && current && document.sections.some(s => s.id === current)) return
    startedDocumentRef.current = document.id
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

  const openCompareVersions = () => compareWith(previousVersion)

  // Version chip dropdown — lists every version; picking an older one opens
  // the diff against the current version.
  const [versionMenuOpen, setVersionMenuOpen] = useState(false)
  const versionMenuRef = useRef<HTMLDivElement>(null)
  // Create-new-version inline form state. Hidden by default inside the
  // version dropdown; expands when the user clicks "Create new version".
  const [createVersionFormOpen, setCreateVersionFormOpen] = useState(false)
  const [newVersionLabel, setNewVersionLabel] = useState<'Draft' | 'For Review' | 'Final'>('Draft')
  const [newVersionNote,  setNewVersionNote]  = useState('')
  const createVersion = useMutation({
    mutationFn: () => {
      if (!documentId) throw new Error('no_document')
      return documentsApi.createVersion(documentId, {
        label: newVersionLabel,
        note:  newVersionNote.trim() || undefined,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['versions', documentId] })
      qc.invalidateQueries({ queryKey: ['document', documentId] })
      setCreateVersionFormOpen(false)
      setNewVersionNote('')
      setNewVersionLabel('Draft')
      setVersionMenuOpen(false)
    },
  })
  useEffect(() => {
    if (!versionMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (versionMenuRef.current && !versionMenuRef.current.contains(e.target as Node)) setVersionMenuOpen(false)
    }
    window.document.addEventListener('mousedown', handler)
    return () => window.document.removeEventListener('mousedown', handler)
  }, [versionMenuOpen])

  function compareWith(fromVersion: string) {
    setVersionMenuOpen(false)
    toggleDiffMode(fromVersion, currentVersion)
    navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}/diff`)
  }

  const handleSubmitForReview = () => {
    setActivePanel('review-assignment')
  }

  // ------- Right panel: drag-to-resize, expand to the full working area, remembered width -------
  const panel = useResizablePanel({
    activePanel,
    // Per-panel default widths. AI Chat gets 480px so there's room for a
    // readable conversation; submit-for-review form needs 440px. Users
    // can still drag wider via the left-edge handle or double-click to
    // expand to the full working area.
    preferredWidth: p => (
      p === 'ai'                ? 480 :
      p === 'review-assignment' ? 440 :
      undefined
    ),
  })
  // const panelExpanded      = panel.expanded   // read only by the hidden expand button below
  const panelDragging         = panel.dragging
  const togglePanelExpanded   = panel.toggleExpanded

  // Deep-link: if the URL has ?submit=1 (e.g. from DiffView's "Submit for
  // review" button), auto-open the panel on mount + strip the param so a
  // reload doesn't re-open it.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('submit') === '1') {
      setActivePanel('review-assignment')
      const next = new URLSearchParams(searchParams)
      next.delete('submit')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setActivePanel, setSearchParams])

  // ------- Reference links (FR-A-022) -------
  // Reference-linked text is marked in the section (non-destructively), clicking it opens the source in the
  // right panel, and text selected in the section is remembered for the "Add reference" form.
  const sectionContentRef = useRef<HTMLDivElement>(null)
  const linkedRangesRef = useRef<LinkedRange[]>([])
  const setTraceabilityTarget = useEditorStore(s => s.setTraceabilityTarget)
  const setLinkedSpans = useEditorStore(s => s.setLinkedSpans)
  const setSourceViewer = useEditorStore(s => s.setSourceViewer)
  const { data: referencesData } = useQuery({
    queryKey: ['references', documentId],
    queryFn:  () => documentsApi.listReferences(documentId!),
    enabled:  !!documentId,
  })
  const sectionReferences = useMemo(
    () => (referencesData?.items ?? []).filter(r => r.sectionId === activeSection),
    [referencesData, activeSection],
  )

  useEffect(() => {
    const root = sectionContentRef.current
    if (!root) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const apply = () => {
      linkedRangesRef.current = applyReferenceHighlights(root, sectionReferences)
      setLinkedSpans(Object.fromEntries(linkedRangesRef.current.map(l => [l.id, { start: l.start, end: l.end }])))
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(apply, 80) }
    schedule()
    // TipTap renders after the section loads / mode toggles; re-apply when the content changes.
    const observer = new MutationObserver(schedule)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => { clearTimeout(timer); observer.disconnect(); clearReferenceHighlights(); linkedRangesRef.current = []; setLinkedSpans({}) }
  }, [sectionReferences, activeSectionData?.contentHtml, isEditing, document?.id, setLinkedSpans])

  useEffect(() => {
    const onSelection = () => {
      const sel = window.getSelection()
      const root = sectionContentRef.current
      if (!sel || sel.isCollapsed || !root || !sel.anchorNode || !sel.focusNode) return
      if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return
      // Remember where it sits, so the link points at this occurrence and the panel can tell
      // whether this exact text is already linked. The text comes from the same index, so it
      // always matches the span (paragraph breaks read as one space).
      const index = buildTextIndex(root)
      const span = spanOfRange(index, sel.getRangeAt(0))
      if (span && span.end - span.start <= 2000) { setTraceabilityTarget(index.text.slice(span.start, span.end), span); return }
      const text = normalizeSpan(sel.toString()).slice(0, 2000)
      if (text) setTraceabilityTarget(text, null)
    }
    window.document.addEventListener('selectionchange', onSelection)
    return () => window.document.removeEventListener('selectionchange', onSelection)
  }, [setTraceabilityTarget])

  // A new section starts without a stale selection / open source.
  useEffect(() => { setTraceabilityTarget(null) }, [activeSection, setTraceabilityTarget])
  // Closing the panel closes the viewer too.
  useEffect(() => { if (activePanel !== 'traceability') setSourceViewer(null) }, [activePanel, setSourceViewer])

  // Source References, Audit Trail and AI Suggest close on a click outside the panel. A click
  // in the section still counts as outside, except when it ends a text selection (picking the
  // text to link) or lands on reference-marked text (which opens that source in the panel). A press that starts in the
  // panel (resizing, selecting), the Reference menu or a button that opens a panel
  // ([data-panel-trigger] — it toggles/switches the panel itself) never closes it. Checked
  // on mousedown, since the menu is gone from the page by the time the click fires.
  const rightPanelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // AI Chat is intentionally sticky — the user wants it alongside the
    // editor while they work, not auto-closing on every editor click.
    // Close via the X in the panel header, Esc with focus outside the
    // chat input, or by opening a different panel.
    if (activePanel !== 'traceability' && activePanel !== 'audit') return
    // The click that opened the panel is still being dispatched when this listener is added,
    // so only clicks whose mousedown we saw count.
    let pressed = false
    let pressedExempt = false
    let pressedInContent = false
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      pressed = true
      pressedExempt = !t || !!rightPanelRef.current?.contains(t) || !!t.closest('[data-reference-dropdown], [data-slide-panel], [data-panel-trigger]')
      pressedInContent = !!t && !!sectionContentRef.current?.contains(t)
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (!pressed) return
      pressed = false
      if (!t || pressedExempt || !t.isConnected || rightPanelRef.current?.contains(t)) return
      // The click ended a text selection made in the section: keep the panel (the user is
      // picking text to link). A selection left over from earlier doesn't count — clicking a
      // button elsewhere doesn't clear it, and that click must still close the panel.
      if (pressedInContent && !window.getSelection()?.isCollapsed) return
      if (sectionContentRef.current?.contains(t) && referenceAtPoint(linkedRangesRef.current, e.clientX, e.clientY)) return
      setActivePanel(null)
    }
    // Esc closes the panel too — unless something else already used the key
    // (a menu, an input cancelling an edit).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (window.document.querySelector('[data-reference-menu]')) return   // an open Reference menu takes the key
      setActivePanel(null)
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

  const onSectionContentClick = (e: React.MouseEvent) => {
    if (isEditing || !window.getSelection()?.isCollapsed) return   // don't hijack text selection / editing
    const id = referenceAtPoint(linkedRangesRef.current, e.clientX, e.clientY)
    const ref = id ? sectionReferences.find(r => r.id === id) : undefined
    if (!ref) return
    setSourceViewer({ uploadId: ref.uploadId, page: ref.page, spanText: ref.spanText })
    setActivePanel('traceability')
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
            <div ref={versionMenuRef} className="relative flex-none" data-version-dropdown>
              <button
                type="button"
                onClick={() => setVersionMenuOpen(v => !v)}
                title="Switch revision / compare"
                aria-haspopup="menu"
                aria-expanded={versionMenuOpen}
                className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors hover:bg-slate-50"
                style={{ borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' }}
              >
                <span className="font-mono text-[11px] font-medium text-slate-500">{currentVersion}</span>
                <svg width="9" height="9" viewBox="0 0 10 10" className="text-slate-500"><polygon points="1,3 9,3 5,8" fill="currentColor"/></svg>
              </button>

              {versionMenuOpen && (
                <div
                  role="menu"
                  className="absolute left-0 z-30 flex flex-col rounded-lg bg-white p-1.5"
                  style={{ top: '100%', marginTop: 6, minWidth: 240, maxHeight: 320, overflowY: 'auto', border: '1px solid #E2E8F0', boxShadow: '0 8px 20px rgba(15,23,42,0.10)' }}
                  data-version-menu
                >
                  <p className="px-3 pb-1 pt-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-400">Versions</p>
                  {versions.length === 0 && (
                    <p className="px-3 py-2 text-[12px] text-slate-500">Only the current version exists.</p>
                  )}
                  {versions.map(v => (
                    <button
                      key={v.id}
                      type="button"
                      role="menuitem"
                      disabled={v.isCurrent}
                      onClick={() => compareWith(v.versionNumber)}
                      title={v.isCurrent ? 'This is the version you are editing' : `Compare ${v.versionNumber} with ${currentVersion}`}
                      className="flex items-center justify-between gap-3 rounded px-3 py-2 text-left transition-colors hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
                      data-version-option={v.versionNumber}
                    >
                      <span className="flex flex-col">
                        <span className="font-mono text-[12px] font-semibold text-slate-800">{v.versionNumber} <span className="font-sans font-normal text-slate-500">· {v.label}</span></span>
                        <span className="text-[11px] text-slate-400">{new Date(v.createdAt).toLocaleString()}</span>
                      </span>
                      {v.isCurrent
                        ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Current</span>
                        : <span className="text-[11px] font-semibold text-blue-600">Compare →</span>}
                    </button>
                  ))}
                  {versions.length > 1 && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={openCompareVersions}
                      className="mt-1 rounded border-t border-slate-100 px-3 py-2 text-left text-[12px] font-semibold text-blue-700 hover:bg-slate-50"
                      data-version-compare-previous
                    >Compare with previous version ({previousVersion} → {currentVersion})</button>
                  )}

                  {/* --- Create new version — explicit snapshot ----------------
                       Section saves mutate the current version in place. This
                       button is one of the three sanctioned ways to create a
                       new DocumentVersion row (the other two happen on
                       review-bounce and section restore). */}
                  {!createVersionFormOpen && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setCreateVersionFormOpen(true)}
                      className="mt-1 rounded border-t border-slate-100 px-3 py-2 text-left text-[12px] font-semibold text-emerald-700 hover:bg-emerald-50"
                      data-version-create
                    >+ Create new version</button>
                  )}
                  {createVersionFormOpen && (
                    <form
                      onSubmit={e => { e.preventDefault(); createVersion.mutate() }}
                      className="mt-1 flex flex-col gap-2 border-t border-slate-100 px-3 py-3"
                      data-version-create-form
                    >
                      <label className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Label</span>
                        <select
                          value={newVersionLabel}
                          onChange={e => setNewVersionLabel(e.currentTarget.value as 'Draft' | 'For Review' | 'Final')}
                          className="rounded-md border border-slate-300 px-2 py-1 text-[12px]"
                          disabled={createVersion.isPending}
                        >
                          <option value="Draft">Draft</option>
                          <option value="For Review">For Review</option>
                          <option value="Final">Final</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">Note (optional)</span>
                        <textarea
                          value={newVersionNote}
                          onChange={e => setNewVersionNote(e.currentTarget.value)}
                          rows={2}
                          maxLength={500}
                          placeholder="e.g. Pre-review checkpoint before Dr Chen's bounce"
                          className="rounded-md border border-slate-300 p-2 text-[12px]"
                          disabled={createVersion.isPending}
                        />
                      </label>
                      {createVersion.isError && (
                        <p className="text-[11px] text-rose-600" role="alert">
                          Could not create version — please try again.
                        </p>
                      )}
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => { setCreateVersionFormOpen(false); setNewVersionNote('') }}
                          disabled={createVersion.isPending}
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >Cancel</button>
                        <button
                          type="submit"
                          disabled={createVersion.isPending}
                          className="rounded-md bg-emerald-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                        >{createVersion.isPending ? 'Creating…' : 'Create'}</button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: autosave + presence + Save + Submit */}
          <div className="flex flex-none items-center gap-3.5">
            <div className="flex items-center gap-1.5 text-xs text-slate-500" title="Last synced from the server. Click Save to refresh.">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: isRefetching ? '#F59E0B' : '#16A34A' }} />
              {isRefetching
                ? 'Syncing…'
                : dataUpdatedAt
                  ? `Synced ${new Date(dataUpdatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
                  : 'Not synced'}
            </div>

            {/* Presence stack — real-time via /documents/:id/presence +
                 Socket.io presence:changed. Empty when it's just you. */}
            <div className="flex flex-none items-center" data-presence-stack>
              {presenceStack.slice(0, 5).map((p, i) => (
                <div
                  key={p.userId}
                  title={`${p.name}${p.isCurrentUser ? ' (you)' : ''} · ${p.status}`}
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-full font-mono text-[10px] font-bold"
                  style={{
                    backgroundColor: p.color.bg,
                    color: p.color.fg,
                    boxShadow: p.isCurrentUser
                      ? '0 0 0 2px #FFFFFF, 0 0 0 4px #2563EB'
                      : '0 0 0 2px #FFFFFF',
                    opacity: p.status === 'idle' ? 0.55 : 1,
                    marginLeft: i === 0 ? 0 : -6,
                    zIndex: 5 - i,
                  }}
                >
                  {p.initials}
                </div>
              ))}
              {presenceStack.length > 5 && (
                <div
                  title={`+${presenceStack.length - 5} more`}
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-200 font-mono text-[10px] font-bold text-slate-600"
                  style={{ boxShadow: '0 0 0 2px #FFFFFF', marginLeft: -6 }}
                >
                  +{presenceStack.length - 5}
                </div>
              )}
            </div>

            <span className="h-5 w-px" style={{ backgroundColor: '#E2E8F0' }} />
            <span className="flex-none text-xs text-slate-500">
              {presenceStack.length === 0 ? 'Only you' : `${presenceStack.length} active`}
            </span>

            <button
              type="button"
              onClick={() => refetchDocument()}
              disabled={isRefetching}
              title="Pull the latest version from the server (collaborator edits, new comments, etc.)"
              className="rounded-md border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-900 hover:bg-slate-50 transition-colors disabled:cursor-wait disabled:opacity-60"
            >
              {isRefetching ? 'Syncing…' : 'Sync'}
            </button>
            {document.status === 'in-review' ? (
              <button
                type="button"
                disabled
                title="This document has been submitted and is with the reviewers"
                className="cursor-not-allowed rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2 text-[13px] font-semibold text-amber-800"
                data-submitted
              >
                Submitted for review ✓
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmitForReview}
                className="rounded-md bg-blue-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                Submit for review
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Submitted state: the document is with the reviewers and locked for authoring. */}
      {document.status === 'in-review' && (
        <div
          role="status"
          className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-6 py-2 text-[13px] text-amber-900"
          data-submitted-banner
        >
          <span aria-hidden="true" className="font-bold">✓</span>
          <span className="font-semibold">Submitted for review.</span>
          <span>The document is locked for authoring while reviewers respond.</span>
          <button
            type="button"
            onClick={() => navigate(`/projects/${projectId}/clinical-writing/documents/${documentId}/review`)}
            className="ml-auto font-semibold underline"
          >
            Open Reviewer View →
          </button>
        </div>
      )}

      {/* ============ Three-panel row ============ */}
      <div className="flex flex-1 min-h-0">

        <SectionNavigator sections={document.sections} />

        {/* Editor pane — split: section content column + right panel column.
            Toolbar and AI prompt dock span full editor-pane width; the
            scrollable content + panel are side-by-side within the middle
            band so content narrows (text wraps) instead of being hidden
            when the panel opens. */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-white">
          <EditorToolbar
            editor={editor}
            editSection={activeSectionData && !isEditing ? {
              onClick: () => setIsEditing(true),
              disabled: document.status === 'in-review',
              title: document.status === 'in-review' ? 'Locked for authoring while the document is in review' : undefined,
            } : undefined}
          />

          {/* Split row — content column (flex-1, scrollable) + optional
              right panel column (fixed width, draggable). */}
          <div className="flex min-h-0 flex-1">

          {/* Content — real section content, editable textarea for the
               MVP editor. Rich-text (TipTap) lands in Phase 2 per
               docs/decisions/module-a-defaults.md. */}
          <div ref={sectionContentRef} onClick={onSectionContentClick} className="flex-1 overflow-y-auto px-12 pt-6 pb-8" data-section-content>
            <div className="flex max-w-[760px] flex-col">
              {activeSectionData ? (
                <>
                  <div className="flex items-center gap-2">
                    <h2 className="text-[22px] font-bold tracking-tight">
                      {activeSectionData.number} {activeSectionData.title}
                    </h2>
                    {/* Section edit history — per section (sPM-section-history).
                        Opens the right-rail SectionHistoryPanel listing manual +
                        AI edits + reverts, with per-row Revert. */}
                    <button
                      type="button"
                      onClick={() => setActivePanel('history')}
                      title="Edit history for this section"
                      aria-label="Section edit history"
                      className="flex items-center justify-center rounded-md border border-slate-300 bg-white p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    >
                      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="7" cy="7" r="5.6" />
                        <polyline points="7,3.4 7,7 9.4,8.4" />
                      </svg>
                    </button>
                  </div>
                  {/* Section meta — demoted from the pre-f196934 bottom bar so
                      the AI prompt dock owns the bottom of the pane. Lives
                      inline under the title. */}
                  <p className="mt-1 overflow-hidden truncate whitespace-nowrap text-[11px] text-slate-500" data-section-meta>
                    {(() => {
                      const edited = document.updatedAt
                        ? `Last edited ${new Date(document.updatedAt).toLocaleString('en-GB', {
                            day: '2-digit', month: 'short', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })} UTC`
                        : null
                      const refs = sectionReferences.length
                        ? `${sectionReferences.length} source ${sectionReferences.length === 1 ? 'reference' : 'references'}`
                        : null
                      return [activeSectionData.status, refs, edited].filter(Boolean).join(' · ')
                    })()}
                  </p>

                  {isEditing ? (
                    <>
                      <div className="mt-4" data-section-editor>
                        <EditorContent editor={editor} />
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-xs text-slate-500">
                          {isDirty
                            ? aiEditModel
                              ? 'Unsaved AI-assisted changes — review, then click Save Section to commit.'
                              : 'Unsaved changes — click Save Section to commit.'
                            : 'No changes yet.'}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setDraftContent(activeSectionData.contentHtml)
                              editor?.commands.setContent(activeSectionData.contentHtml, { emitUpdate: false })
                              setIsEditing(false)
                              setAiEditModel(null)
                            }}
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Discard
                          </button>
                          <button
                            type="button"
                            onClick={() => saveSection.mutate()}
                            disabled={!isDirty || saveSection.isPending}
                            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                          >
                            {saveSection.isPending ? 'Saving…' : 'Save Section (new version)'}
                          </button>
                        </div>
                      </div>
                      {saveSection.isError && (
                        <p className="mt-2 text-xs text-red-600" role="alert">
                          Save failed — please try again. If the problem persists, check your network and reload.
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      {activeSectionData.contentHtml ? (
                        <div className="mt-4">
                          <EditorContent editor={editor} />
                        </div>
                      ) : (
                        <p className="mt-4 text-[14px] italic text-slate-400">
                          This section is empty. Click Edit section above to add content, or type a prompt below to draft with AI.
                        </p>
                      )}
                    </>
                  )}
                </>
              ) : (
                <p className="mt-4 text-[14px] text-slate-400">
                  Select a section from the navigator to view or edit.
                </p>
              )}
            </div>
          </div>

          {/* The pre-f196934 bottom "provenance bar" is gone — its data
               moved to the section-meta line under the title (above). The
               AI prompt dock is now the actual bottom of the editor pane. */}

          {/* Right panel — in-flow split sibling of the content column.
              The content column (flex-1) shrinks horizontally when this
              opens so section text wraps narrower and stays visible
              alongside the panel. SectionNav outside the editor pane
              keeps its natural width either way. */}
          {activePanel !== null && (
            <div
              ref={rightPanelRef}
              className="relative flex flex-none flex-col border-l border-slate-200"
              style={{
                width:           panel.width,
                maxWidth:        '100%',
                backgroundColor: (activePanel === 'traceability' || activePanel === 'checklist' || activePanel === 'audit' || activePanel === 'review-assignment' || activePanel === 'ich-e3' || activePanel === 'meddra') ? '#FFFFFF' : '#F8FAFC',
              }}
            >
            {/* Drag handle on the left edge: drag to resize, double-click to expand/shrink */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panel"
              title="Drag to resize · double-click to expand"
              onMouseDown={e => { e.preventDefault(); panel.startDrag() }}
              onDoubleClick={togglePanelExpanded}
              className="absolute inset-y-0 -left-1 z-10 w-2 cursor-ew-resize transition-colors hover:bg-blue-300/60"
              style={panelDragging ? { backgroundColor: 'rgba(147,197,253,0.7)' } : undefined}
            />
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
              {/* Expand button — hidden for now (QA request); drag the left edge or double-click it to resize instead.
              <button
                type="button"
                onClick={togglePanelExpanded}
                aria-label={panelExpanded ? 'Shrink panel' : 'Expand panel'}
                title={panelExpanded ? 'Shrink panel' : 'Expand panel'}
                className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 transition-colors"
              >
                {panelExpanded ? (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7.5 1.5v3h3M4.5 10.5v-3h-3M7.5 4.5l3-3M4.5 7.5l-3 3"/>
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7 1.5h3.5V5M5 10.5H1.5V7M10.5 1.5L7 5M1.5 10.5L5 7"/>
                  </svg>
                )}
              </button>
              */}
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
            {activePanel === 'comments' && documentId && (
              <CommentsPanel
                documentId={documentId}
                sections={document?.sections ?? []}
                activeSectionId={activeSection}
              />
            )}
            {activePanel === 'ai' && documentId && (
              <AIChatPanel
                documentId={documentId}
                sectionId={activeSection}
                sectionLabel={activeSectionData ? `§${activeSectionData.number} ${activeSectionData.title}` : undefined}
                editor={editor}
                onAcceptSuggestion={(html, model, range) => {
                  if (!isEditing) setIsEditing(true)
                  if (range && editor) {
                    // Selection-scoped accept: swap just the range the user
                    // had highlighted when they sent the prompt. Plain
                    // inline text inserts without wrapping tags so a word
                    // swap doesn't get wrapped in <p>.
                    const inline = !/<(p|h3|h4|ul|ol|li|blockquote|table|thead|tbody|tr|th|td)[>\s]/i.test(html)
                    editor.chain().focus().setTextSelection(range)
                      .deleteSelection()
                      .insertContent(inline ? html.replace(/<\/?(p|br)\s*\/?>/gi, '').trim() : html)
                      .run()
                    const next = editor.getHTML()
                    setDraftContent(next)
                  } else {
                    editor?.commands.setContent(html, { emitUpdate: false })
                    setDraftContent(html)
                  }
                  setAiEditModel(model)
                }}
              />
            )}
            {activePanel === 'traceability' && documentId && projectId && (
              <SourceReferencesPanel
                documentId={documentId}
                projectId={projectId}
                sectionId={activeSection}
                sectionLabel={activeSectionData ? `${activeSectionData.number.startsWith('§') ? '' : '§'}${activeSectionData.number} ${activeSectionData.title}` : undefined}
                documentStatus={document?.status}
              />
            )}
            {activePanel === 'history' && documentId && (
              <SectionHistoryPanel
                documentId={documentId}
                sectionId={activeSection}
                sectionLabel={activeSectionData ? `§${activeSectionData.number} ${activeSectionData.title}` : undefined}
              />
            )}
            {activePanel === 'ai-help' && (
              <AIPromptHelpPanel documentType={document?.type} />
            )}
            {activePanel !== 'traceability' && activePanel !== 'voice' && activePanel !== 'checklist' && activePanel !== 'audit' && activePanel !== 'review-assignment' && activePanel !== 'ich-e3' && activePanel !== 'meddra' && activePanel !== 'comments' && activePanel !== 'ai' && activePanel !== 'history' && activePanel !== 'ai-help' && (
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

          {/* AI prompt dock — pinned to the bottom of the editor pane, below
              the content+panel split so it spans full width. First prompt in
              view mode auto-switches to edit mode so the AI output has
              somewhere to land. */}
          {activeSectionData && documentId && (
            <div className="flex-none border-t border-slate-200 bg-white px-12 py-3" data-section-ai-prompt-dock>
              <div className="max-w-[760px]">
                <SectionAIPrompt
                  documentId={documentId}
                  sectionId={activeSectionData.id}
                  currentHtml={draftContent}
                  editor={editor}
                  isEditing={isEditing}
                  onRequestEdit={() => setIsEditing(true)}
                  onAccept={(html, model) => {
                    if (!isEditing) setIsEditing(true)
                    editor?.commands.setContent(html, { emitUpdate: false })
                    setDraftContent(html)
                    setAiEditModel(model)
                  }}
                />
              </div>
            </div>
          )}
      </div>
      </div>
    </div>
  )
}
