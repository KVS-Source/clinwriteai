import { useDocumentStore } from '../../store'

interface Props {
  onAddComment: () => void
  onFlagSection: () => void
  raciRole: 'R' | 'A' | 'C' | 'I'
  raciLabel: string
}

function CommentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.4" y="2" width="11.2" height="8" rx="2"/>
      <polygon points="4.2,10 4.2,12.6 7,10" fill="currentColor"/>
    </svg>
  )
}

function FlagIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2.6" y="1.6" width="1.3" height="10.8" rx="0.65" fill="currentColor"/>
      <path d="M4.4 2.4h7l-1.6 2.6 1.6 2.6h-7z"/>
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

function IconButton({
  onClick, active, title, children,
}: {
  onClick?: () => void
  active?:  boolean
  title:    string
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

export function ReviewerToolbar({ onAddComment, onFlagSection, raciRole, raciLabel }: Props) {
  const activePanel    = useDocumentStore(s => s.activePanel)
  const setActivePanel = useDocumentStore(s => s.setActivePanel)

  const toggle = (mode: 'checklist' | 'audit') =>
    setActivePanel(activePanel === mode ? null : mode)

  return (
    <div
      className="flex h-10 flex-none items-center gap-2 border-b border-slate-200 px-5"
      style={{ backgroundColor: '#F8FAFC' }}
    >

      {/* Add comment — blue accent */}
      <button
        type="button"
        onClick={onAddComment}
        title="Add comment"
        className="flex h-7 flex-none items-center gap-1.5 rounded-md px-2.5 text-xs font-bold text-white transition-colors hover:bg-blue-700"
        style={{ backgroundColor: '#2563EB' }}
      >
        <CommentIcon />
        Add comment
        <span
          className="rounded-[3px] px-1 py-0.5 font-mono text-[9px] font-medium"
          style={{ backgroundColor: 'rgba(255,255,255,0.22)', color: '#FFFFFF' }}
        >
          ⌘K
        </span>
      </button>

      {/* Flag section — outline */}
      <button
        type="button"
        onClick={onFlagSection}
        title="Flag section"
        className="flex h-7 flex-none items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100"
      >
        <FlagIcon />
        Flag section
      </button>

      <Divider />

      {/* Checklist (view-only) */}
      <IconButton
        title="View checklist"
        active={activePanel === 'checklist'}
        onClick={() => toggle('checklist')}
      >
        <ChecklistIcon />
      </IconButton>

      {/* Audit trail */}
      <IconButton
        title="Audit trail"
        active={activePanel === 'audit'}
        onClick={() => toggle('audit')}
      >
        <AuditIcon />
      </IconButton>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Role label — right */}
      <span className="whitespace-nowrap font-mono text-[10px] font-medium tracking-wider text-slate-500">
        Your review: {raciRole} ({raciLabel})
      </span>
    </div>
  )
}
