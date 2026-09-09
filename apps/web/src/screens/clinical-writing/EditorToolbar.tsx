import type { PanelMode } from '@platform/types'
import { useDocumentStore } from '../../store'
import { ReferenceDropdown } from '../../components/ui'

// --- Icons ---

function BoldIcon()      { return <span className="font-sans text-[13px] font-bold">B</span> }
function ItalicIcon()    { return <span className="font-sans text-[13px] font-semibold italic">I</span> }
function UnderlineIcon() { return <span className="font-sans text-[13px] font-semibold underline">U</span> }

function CaretDownIcon() {
  return <svg width="9" height="9" viewBox="0 0 10 10" className="text-slate-500"><polygon points="1,3 9,3 5,8" fill="currentColor"/></svg>
}
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
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="7" cy="7" r="5.4"/>
      <line x1="7" y1="4" x2="7" y2="7.4" strokeLinecap="round"/>
      <line x1="7" y1="7.4" x2="9.6" y2="7.4" strokeLinecap="round"/>
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
  title,
  children,
}: {
  onClick?: () => void
  active?:  boolean
  title?:   string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 flex-none items-center justify-center rounded-md border transition-colors hover:bg-slate-100"
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

export function EditorToolbar() {
  const activePanel    = useDocumentStore(s => s.activePanel)
  const setActivePanel = useDocumentStore(s => s.setActivePanel)

  const toggle = (mode: NonNullable<PanelMode>) => setActivePanel(activePanel === mode ? null : mode)

  return (
    <div
      className="flex h-10 flex-none items-center gap-2 border-b border-slate-200 px-5"
      style={{ backgroundColor: '#F8FAFC' }}
    >

      {/* Formatting cluster — no-op stubs in Phase 1 */}
      <IconButton title="Bold"><BoldIcon /></IconButton>
      <IconButton title="Italic"><ItalicIcon /></IconButton>
      <IconButton title="Underline"><UnderlineIcon /></IconButton>

      <Divider />

      <button
        type="button"
        title="Heading level"
        className="flex h-7 flex-none items-center gap-2 rounded-md border px-2.5 text-xs font-semibold transition-colors hover:bg-slate-100"
        style={{ borderColor: '#E2E8F0', backgroundColor: '#FFFFFF', color: '#475569' }}
      >
        Heading 3 <CaretDownIcon />
      </button>

      <Divider />

      <IconButton title="Bulleted list"><BulletListIcon /></IconButton>
      <IconButton title="Numbered list"><NumberListIcon /></IconButton>

      <Divider />

      <IconButton title="Insert table"><TableIcon /></IconButton>

      <Divider />

      <ReferenceDropdown />

      <Divider />

      {/* Panel triggers */}
      <IconButton title="Voice note"      active={activePanel === 'voice'}     onClick={() => toggle('voice')}><VoiceIcon /></IconButton>
      <IconButton title="Input checklist" active={activePanel === 'checklist'} onClick={() => toggle('checklist')}><ChecklistIcon /></IconButton>
      <IconButton title="Audit trail"     active={activePanel === 'audit'}     onClick={() => toggle('audit')}><AuditIcon /></IconButton>

      {/* Spacer */}
      <div className="flex-1" />

      {/* AI Suggest — accent button */}
      <button
        type="button"
        title="Open AI Suggest (⌘J)"
        onClick={() => toggle('ai')}
        className="flex h-7 flex-none items-center gap-1.5 rounded-md border px-2.5 text-xs font-bold transition-colors"
        style={{
          borderColor:     activePanel === 'ai' ? '#93C5FD' : '#BFDBFE',
          backgroundColor: activePanel === 'ai' ? '#DBEAFE' : '#EFF6FF',
          color:           '#1D4ED8',
        }}
      >
        <SparkleIcon />
        AI Suggest
        <span className="rounded-[3px] px-1 py-0.5 font-mono text-[9px] font-medium" style={{ backgroundColor: '#DBEAFE', color: '#1D4ED8' }}>
          ⌘J
        </span>
      </button>

      {/* Insert citation — disabled coming-soon stub */}
      <button
        type="button"
        disabled
        className="flex h-7 flex-none items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold"
        style={{
          borderColor:     '#E2E8F0',
          backgroundColor: '#FFFFFF',
          color:           '#94A3B8',
          cursor:          'not-allowed',
        }}
      >
        Insert citation
        <span className="rounded-[3px] px-1 py-0.5 font-mono text-[9px] font-medium tracking-wider" style={{ backgroundColor: '#F1F5F9', color: '#94A3B8' }}>
          SOON
        </span>
      </button>
    </div>
  )
}
