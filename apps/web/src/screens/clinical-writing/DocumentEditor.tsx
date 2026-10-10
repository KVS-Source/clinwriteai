import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PanelMode, PlatformUser } from '@platform/types'
import { documentsApi, projectsApi } from '../../api'
import { usePresenceSnapshot } from '../../hooks/usePresence'
import { platformApi } from '../../platform/api/platformApi'
import { StatusPill } from '../../components/ui'
import { useDocumentStore, useProjectStore, useAuthStore } from '../../store'
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
import { AIAssistPanel }          from '../../panels/AIAssistPanel'

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
  const panelWidth           = useDocumentStore(s => s.panelWidth)
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

  useEffect(() => {
    // Hydrate the draft when the user switches sections. Blow away any
    // in-flight edits silently — the editor's save pattern is explicit
    // (click Save) so switching sections before saving IS a discard.
    setDraftContent(activeSectionData?.contentHtml ?? '')
    setIsEditing(false)
  }, [activeSectionData?.id, activeSectionData?.contentHtml])

  const saveSection = useMutation({
    mutationFn: () => {
      if (!documentId || !activeSectionData) throw new Error('no_active_section')
      return documentsApi.updateSection(documentId, activeSectionData.id, {
        contentHtml: draftContent,
      })
    },
    onSuccess: () => {
      setIsEditing(false)
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
  const editor = useRichTextEditor({
    content:  activeSectionData?.contentHtml ?? '',
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
          <EditorToolbar editor={editor} />

          {/* Content — real section content, editable textarea for the
               MVP editor. Rich-text (TipTap) lands in Phase 2 per
               docs/decisions/module-a-defaults.md. */}
          <div className="flex-1 overflow-y-auto px-12 pt-6 pb-8" data-section-content>
            <div className="flex max-w-[760px] flex-col">
              {activeSectionData ? (
                <>
                  <h2 className="text-[22px] font-bold tracking-tight">
                    {activeSectionData.number} {activeSectionData.title}
                  </h2>

                  {isEditing ? (
                    <>
                      <div className="mt-4" data-section-editor>
                        <EditorContent editor={editor} />
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-xs text-slate-500">
                          {isDirty
                            ? 'Unsaved changes — click Save Section to commit.'
                            : 'No changes yet.'}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setDraftContent(activeSectionData.contentHtml)
                              editor?.commands.setContent(activeSectionData.contentHtml, { emitUpdate: false })
                              setIsEditing(false)
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
                          This section is empty. Click Edit to add content, or open the AI Suggest panel to draft it from source documents.
                        </p>
                      )}
                      <div className="mt-6 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setIsEditing(true)}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Edit section
                        </button>
                        <button
                          type="button"
                          onClick={() => setActivePanel('ai')}
                          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-bold transition-colors hover:bg-blue-100"
                          style={{ borderColor: '#BFDBFE', backgroundColor: '#EFF6FF', color: '#1D4ED8' }}
                        >
                          <svg width="11" height="11" viewBox="0 0 14 14"><polygon points="7,1.2 8.6,5.4 12.8,7 8.6,8.6 7,12.8 5.4,8.6 1.2,7 5.4,5.4" fill="#2563EB"/></svg>
                          AI Suggest
                        </button>
                      </div>
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

          {/* Provenance bar (40px) — real section metadata from the
               loaded document. AI-drafted / human-authored span counts
               come from the Traceability panel endpoint when that lands
               (CD prompt 04-traceability-panel.md). */}
          <div
            className="flex h-10 flex-none items-center overflow-hidden truncate whitespace-nowrap border-t border-slate-200 px-5 text-xs text-slate-500"
            style={{ backgroundColor: '#F8FAFC' }}
            data-provenance-bar
          >
            {(() => {
              const section = document.sections.find(s => s.id === activeSection)
              if (!section) return 'No section selected'
              const edited = document.updatedAt
                ? ` · Last edited ${new Date(document.updatedAt).toLocaleString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })} UTC`
                : ''
              return `§${section.number} ${section.title} · ${section.status}${edited}`
            })()}
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
            {activePanel === 'comments' && documentId && (
              <CommentsPanel documentId={documentId} />
            )}
            {activePanel === 'ai' && documentId && (
              <AIAssistPanel
                documentId={documentId}
                sectionId={activeSection}
                sectionLabel={activeSectionData ? `§${activeSectionData.number} ${activeSectionData.title}` : undefined}
              />
            )}
            {activePanel !== 'voice' && activePanel !== 'checklist' && activePanel !== 'audit' && activePanel !== 'review-assignment' && activePanel !== 'ich-e3' && activePanel !== 'meddra' && activePanel !== 'comments' && activePanel !== 'ai' && (
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
