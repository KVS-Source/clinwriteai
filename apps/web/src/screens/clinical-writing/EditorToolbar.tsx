import type { DocumentType, PanelMode } from '@platform/types'
import { useEditorState } from '@tiptap/react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useDocumentStore, useEditorStore } from '../../store'
import { ReferenceDropdown } from '../../components/ui'
import { documentsApi } from '../../api'

// --- Icons ---

function BoldIcon()      { return <span className="font-sans text-[13px] font-bold">B</span> }
function ItalicIcon()    { return <span className="font-sans text-[13px] font-semibold italic">I</span> }
function UnderlineIcon() { return <span className="font-sans text-[13px] font-semibold underline">U</span> }

function BulletListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <circle cx="2.4" cy="3" r="1.2"/><circle cx="2.4" cy="7" r="1.2"/><circle cx="2.4" cy="11" r="1.2"/>
      <rect x="5" y="2.3" width="8" height="1.4" rx="0.7"/>
      <rect x="5" y="6.3" width="8" height="1.4" rx="0.7"/>
      <rect x="5" y="10.3" width="8" height="1.4" rx="0.7"/>
    </svg>
  )
}
function NumberListIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <text x="0.6" y="4.6" fontFamily="monospace" fontSize="4.6">1</text>
      <text x="0.6" y="9"   fontFamily="monospace" fontSize="4.6">2</text>
      <text x="0.6" y="13.2" fontFamily="monospace" fontSize="4.6">3</text>
      <rect x="5" y="2.3"  width="8" height="1.4" rx="0.7"/>
      <rect x="5" y="6.7"  width="8" height="1.4" rx="0.7"/>
      <rect x="5" y="11.1" width="8" height="1.4" rx="0.7"/>
    </svg>
  )
}
function TableIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.2" y="2.2" width="11.6" height="9.6" rx="1.2"/>
      <line x1="1.2" y1="6.2" x2="12.8" y2="6.2" strokeWidth="1.3"/>
      <line x1="7"   y1="2.2" x2="7"    y2="11.8" strokeWidth="1.3"/>
    </svg>
  )
}
function VoiceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="5" y="1.6" width="4" height="6.6" rx="2"/>
      <path d="M3.4 7.2a3.6 3.6 0 0 0 7.2 0"/>
      <line x1="7" y1="10.4" x2="7" y2="12.4" strokeLinecap="round"/>
      <line x1="4.4" y1="13" x2="9.6" y2="13" strokeLinecap="round"/>
    </svg>
  )
}
function ChecklistIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.2" y="1.8" width="3.6" height="3.6" rx="0.9"/>
      <rect x="1.2" y="8.2" width="3.6" height="3.6" rx="0.9"/>
      <line x1="6.2" y1="3.5" x2="12.8" y2="3.5"/>
      <line x1="6.2" y1="9.9" x2="12.8" y2="9.9"/>
    </svg>
  )
}
function AuditIcon() {
  // Shield + check — distinguishes the compliance audit log from the
  // per-section revert icon (which uses a counter-clockwise arrow).
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1.2 L12 3 V7.2 C12 10 10 11.8 7 12.8 C4 11.8 2 10 2 7.2 V3 Z" />
      <polyline points="4.8,7 6.4,8.6 9.2,5.6" />
    </svg>
  )
}
function ProtocolIcon() {
  // Clipboard with a check — represents the protocol-metadata capture form.
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2.2" width="8" height="10.2" rx="1" />
      <rect x="5" y="1.2" width="4" height="2" rx="0.5" />
      <polyline points="5.4,7.6 6.6,8.8 8.8,6.2" />
    </svg>
  )
}
function CiteIcon() {
  // Quotation mark — a citation to a source.
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <path d="M2 8.2C2 5.6 3.4 3.8 5.6 3.2l.4 1C4.8 4.7 4.1 5.6 4 6.6h1.8V11H2zM8 8.2c0-2.6 1.4-4.4 3.6-5l.4 1c-1.2.5-1.9 1.4-2 2.4h1.8V11H8z" />
    </svg>
  )
}
function SparkleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14">
      <polygon points="7,1.2 8.6,5.4 12.8,7 8.6,8.6 7,12.8 5.4,8.6 1.2,7 5.4,5.4" fill="#2563EB"/>
    </svg>
  )
}

// --- Sub-components ---

function IconButton({
  onClick,
  active,
  disabled,
  title,
  panelTrigger,
  children,
}: {
  onClick?: () => void
  active?:  boolean
  disabled?: boolean
  title?:   string
  /** opens a right-hand panel — clicking it doesn't count as an outside click */
  panelTrigger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      data-panel-trigger={panelTrigger || undefined}
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex h-7 w-7 flex-none items-center justify-center rounded-md border transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        borderColor:     active ? '#BFDBFE' : '#E2E8F0',
        backgroundColor: active ? '#EFF6FF' : '#FFFFFF',
        color:           active ? '#1D4ED8' : '#475569',
      }}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="h-[18px] w-px flex-none" style={{ backgroundColor: '#E2E8F0' }} />
}

interface EditorToolbarProps {
  // Phase 2.1 — TipTap editor instance drives the formatting cluster.
  // Null while no section is active (buttons render disabled).
  editor?: import('@tiptap/react').Editor | null
  // ICH E3 governs full CSRs only; other documents hide the ICH shortcut.
  ichApplicable?: boolean
  // Enables type-conditional panel triggers (e.g. Protocol metadata, which
  // only applies to 'protocol' / 'protocol-amendment' documents).
  documentType?: DocumentType
  // The Checklist button is left out once this is known to be false.
  canViewChecklist?: boolean
  // The section is open for editing (this user holds its lock). The editor is re-created when
  // this flips, and useEditorState only re-reads on the next transaction, so without it the
  // buttons stayed grey until the first click in the text.
  editable?: boolean
  // AI Chat is for this document's authors; the button stays disabled until that's known.
  aiChatAllowed?: boolean
  // Voice notes are for this document's authors too; the button stays disabled until that's known.
  voiceNotesAllowed?: boolean
  // The Source References option is left out once this is known to be false.
  canViewSources?: boolean
  // Document id — drives the open-flag count badge on the AI Chat button.
  // Omitted (no badge) when the toolbar is rendered without a loaded doc.
  documentId?: string
}

// Document types where the Protocol metadata panel is reachable. Non-
// protocol documents hide the button outright — these fields don't
// belong on a CSR / IB / DSUR row.
const PROTOCOL_DOC_TYPES: ReadonlySet<DocumentType> = new Set(['protocol', 'protocol-amendment'])

export function EditorToolbar({ editor, ichApplicable = true, documentType, canViewChecklist, aiChatAllowed = false, voiceNotesAllowed = false, canViewSources, editable, documentId }: EditorToolbarProps = {}) {
  const { t } = useTranslation()
  const activePanel    = useDocumentStore(s => s.activePanel)
  const setActivePanel = useDocumentStore(s => s.setActivePanel)

  // Open-flag badge next to the AI Chat button. Reads the same query the
  // AI Chat panel's OpenFindingsStrip uses, so the two views are always
  // consistent — resolving a flag updates both at once via the shared
  // cache key. Count = 0 hides the badge (no visual noise when the AI
  // hasn't flagged anything). Gated on aiChatAllowed since non-authors
  // never see the panel anyway.
  const flagsQ = useQuery({
    queryKey: ['open-flags', documentId],
    queryFn:  () => documentsApi.listOpenFlags(documentId!, 'open'),
    enabled:  !!documentId && aiChatAllowed,
  })
  const openFlagCount = flagsQ.data?.flags.length ?? 0

  const toggle = (mode: NonNullable<PanelMode>) => setActivePanel(activePanel === mode ? null : mode)
  const citationMode    = useEditorStore(s => s.citationMode)
  const setCitationMode = useEditorStore(s => s.setCitationMode)
  const setSourceViewer = useEditorStore(s => s.setSourceViewer)
  const citationOpen = citationMode && activePanel === 'traceability'

  // Formatting command shortcuts — null-safe so toolbar can mount
  // before the editor is ready.
  const runCmd = (cmd: (chain: ReturnType<NonNullable<typeof editor>['chain']>) => void) => () => {
    if (!editor) return
    const chain = editor.chain().focus()
    cmd(chain)
    chain.run()
  }
  // TipTap v3 no longer re-renders on every transaction, so reading
  // editor.isEditable / isActive() during render goes stale — the heading
  // select stayed disabled (or showed the wrong level) after entering edit
  // mode or moving the cursor. useEditorState subscribes to the editor and
  // re-renders the toolbar whenever these derived values change.
  const state = useEditorState({
    editor: editor ?? null,
    selector: ({ editor: e }) => ({
      editable:     !!e?.isEditable,
      bold:         !!e?.isActive('bold'),
      italic:       !!e?.isActive('italic'),
      underline:    !!e?.isActive('underline'),
      bulletList:   !!e?.isActive('bulletList'),
      orderedList:  !!e?.isActive('orderedList'),
      blockquote:   !!e?.isActive('blockquote'),
      headingLevel: (e && [2, 3, 4].find(l => e.isActive('heading', { level: l }))) || null,
    }),
  })
  const isActive = (name: string) => !!state?.[name as keyof typeof state]
  const formatDisabled = !(editable ?? state?.editable)
  const currentHeadingLevel = state?.headingLevel ?? null

  return (
    <div
      className="flex h-10 flex-none items-center gap-2 border-b border-slate-200 px-5"
      style={{ backgroundColor: '#F8FAFC' }}
    >

      {/* Formatting cluster — wired to TipTap commands (Phase 2.1) */}
      <IconButton title={t('page.editor_toolbar.bold_tooltip')}      active={isActive('bold')}      disabled={formatDisabled} onClick={runCmd(c => c.toggleBold())}><BoldIcon /></IconButton>
      <IconButton title={t('page.editor_toolbar.italic_tooltip')}    active={isActive('italic')}    disabled={formatDisabled} onClick={runCmd(c => c.toggleItalic())}><ItalicIcon /></IconButton>
      <IconButton title={t('page.editor_toolbar.underline_tooltip')} active={isActive('underline')} disabled={formatDisabled} onClick={runCmd(c => c.toggleUnderline())}><UnderlineIcon /></IconButton>

      <Divider />

      <select
        title={t('page.editor_toolbar.heading_level_tooltip')}
        disabled={formatDisabled}
        value={currentHeadingLevel ?? 'p'}
        onChange={e => {
          if (!editor) return
          const chain = editor.chain().focus()
          const v = e.currentTarget.value
          if (v === 'p') chain.setParagraph().run()
          else chain.toggleHeading({ level: Number(v) as 2 | 3 | 4 }).run()
        }}
        className="h-7 flex-none rounded-md border px-2 text-xs font-semibold transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderColor: '#E2E8F0', backgroundColor: '#FFFFFF', color: '#475569' }}
      >
        <option value="p">{t('page.editor_toolbar.paragraph')}</option>
        <option value="2">{t('page.editor_toolbar.heading_2')}</option>
        <option value="3">{t('page.editor_toolbar.heading_3')}</option>
        <option value="4">{t('page.editor_toolbar.heading_4')}</option>
      </select>

      <Divider />

      <IconButton title={t('page.editor_toolbar.bulleted_list_tooltip')} active={isActive('bulletList')}  disabled={formatDisabled} onClick={runCmd(c => c.toggleBulletList())}><BulletListIcon /></IconButton>
      <IconButton title={t('page.editor_toolbar.numbered_list_tooltip')} active={isActive('orderedList')} disabled={formatDisabled} onClick={runCmd(c => c.toggleOrderedList())}><NumberListIcon /></IconButton>

      <Divider />

      <IconButton title={t('page.editor_toolbar.blockquote_tooltip')} active={isActive('blockquote')} disabled={formatDisabled} onClick={runCmd(c => c.toggleBlockquote())}><TableIcon /></IconButton>

      <Divider />

      <ReferenceDropdown showIch={ichApplicable} showSources={canViewSources !== false} />

      <Divider />

      {/* Panel triggers */}
      <IconButton title={voiceNotesAllowed ? t('page.editor_toolbar.voice_note_tooltip') : t('page.editor_toolbar.voice_note_authors_only')} active={activePanel === 'voice'} disabled={!voiceNotesAllowed} panelTrigger onClick={() => toggle('voice')}><VoiceIcon /></IconButton>
      {canViewChecklist !== false && (
        <IconButton title={t('page.editor_toolbar.checklist_tooltip')} active={activePanel === 'checklist'} panelTrigger onClick={() => toggle('checklist')}><ChecklistIcon /></IconButton>
      )}
      <IconButton title={t('page.editor_toolbar.audit_trail_tooltip')} active={activePanel === 'audit'}     panelTrigger onClick={() => toggle('audit')}><AuditIcon /></IconButton>
      {documentType && PROTOCOL_DOC_TYPES.has(documentType) && (
        <IconButton
          title={t('page.editor_toolbar.protocol_tooltip')}
          active={activePanel === 'protocol-metadata'}
          panelTrigger
          onClick={() => toggle('protocol-metadata')}
        ><ProtocolIcon /></IconButton>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Comments — toggles the right-hand comments panel. Marked as a panel trigger so the editor's
          outside-click handler leaves it to toggle the panel itself. */}
      <button
        type="button"
        title={t('page.editor_toolbar.comments_tooltip')}
        aria-pressed={activePanel === 'comments'}
        onClick={() => toggle('comments')}
        data-panel-trigger
        data-action="toggle-comments"
        className="flex h-7 flex-none items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors hover:bg-slate-50"
        style={activePanel === 'comments'
          ? { borderColor: '#93C5FD', backgroundColor: '#EFF6FF', color: '#1D4ED8' }
          : { borderColor: '#CBD5E1', backgroundColor: '#FFFFFF', color: '#334155' }}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 2.5h10v7H7.2L4.4 12V9.5H2z" />
        </svg>
        {t('page.editor_toolbar.comments_label')}
      </button>

      {/* "Edit section" button removed in the autosave rollout — sections are
          now editable on click when this user holds the SectionLock, so the
          mode toggle has no job. The lock holder is indicated by a status
          pill next to the section title (SectionAutosaveStatus). */}

      {/* AI Chat — accent button (label matches the panel header). Disabled for
          everyone but the document's authors; the API refuses their AI calls too. */}
      <button
        type="button"
        title={aiChatAllowed ? t('page.editor_toolbar.ai_chat_tooltip') : t('page.editor_toolbar.ai_chat_authors_only')}
        onClick={() => { if (aiChatAllowed) toggle('ai') }}
        disabled={!aiChatAllowed}
        data-panel-trigger
        data-action="toggle-ai-chat"
        className="flex h-7 flex-none items-center gap-1.5 rounded-md border px-2.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          borderColor:     activePanel === 'ai' ? '#93C5FD' : '#BFDBFE',
          backgroundColor: activePanel === 'ai' ? '#DBEAFE' : '#EFF6FF',
          color:           '#1D4ED8',
        }}
      >
        <SparkleIcon />
        {t('page.editor_toolbar.ai_chat_label')}
        {openFlagCount > 0 && (
          <span
            className="flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-mono text-[9px] font-bold"
            style={{ backgroundColor: '#FBBF24', color: '#78350F' }}
            data-ai-chat-flag-count={openFlagCount}
            title={t('page.editor_toolbar.ai_chat_flag_badge_tooltip', { count: openFlagCount })}
          >
            {openFlagCount}
          </span>
        )}
        <span className="rounded-[3px] px-1 py-0.5 font-mono text-[9px] font-medium" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>
          ⌘J
        </span>
      </button>

      {/* Insert citation (FR-A-022) — opens the Source References panel with the citation form:
          pick a source document, and a citation linked to it goes in at the cursor. Needs the
          section open for editing (this user holds its lock); left out, like the Source References
          option, for someone who may not view the project's sources. */}
      {canViewSources !== false && (
      <button
        type="button"
        title={formatDisabled ? t('page.editor_toolbar.insert_citation_disabled_tooltip') : t('page.editor_toolbar.insert_citation_tooltip')}
        disabled={formatDisabled}
        aria-pressed={citationOpen}
        onClick={() => {
          setSourceViewer(null)
          setCitationMode(true)
          setActivePanel('traceability')
        }}
        data-panel-trigger
        data-action="insert-citation"
        className="flex h-7 flex-none items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
        style={citationOpen
          ? { borderColor: '#93C5FD', backgroundColor: '#EFF6FF', color: '#1D4ED8' }
          : { borderColor: '#CBD5E1', backgroundColor: '#FFFFFF', color: '#334155' }}
      >
        <CiteIcon />
        {t('page.editor_toolbar.insert_citation')}
      </button>
      )}
    </div>
  )
}
