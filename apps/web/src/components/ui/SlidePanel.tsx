// Right-edge slide-in panel — reusable drawer for "New X" / "Edit X"
// forms that don't need a full-page route. Deliberately non-modal:
// the main workspace behind the panel stays interactive so a user can
// cross-reference while filling the form.
//
// Features:
//   - Slides in from the right with a transform animation
//   - Width persisted per `storageKey` in localStorage so the user's
//     preferred size sticks across sessions
//   - Resizable via a drag-handle on the left edge (grab + drag)
//   - Escape key closes
//   - No backdrop overlay (non-modal); click-outside does NOT close by
//     default (prevents accidental loss of unsaved form state). Read-only
//     detail panels opt in with `closeOnOutsideClick`; a click on another
//     slide panel or on an element marked `data-panel-trigger` (e.g. the
//     table row that opens the panel) never counts as "outside".

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface SlidePanelProps {
  open:         boolean
  onClose:      () => void
  title:        string
  subtitle?:    string
  children:     ReactNode
  // Width persisted under this key in localStorage. Omit to keep width
  // ephemeral.
  storageKey?:  string
  defaultWidth?: number
  minWidth?:    number
  maxWidth?:    number
  closeOnOutsideClick?: boolean
  // Temporarily widen to at least this many px (not persisted) — e.g. while a PDF is shown.
  expandedWidth?: number
  // Show an Expand / Shrink button in the header (expands to most of the window).
  expandable?: boolean
}

export function SlidePanel({
  open,
  onClose,
  title,
  subtitle,
  children,
  storageKey,
  defaultWidth = 480,
  minWidth = 360,
  maxWidth = 960,
  closeOnOutsideClick = false,
  expandedWidth,
  expandable = false,
}: SlidePanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [width, setWidth] = useState<number>(() => {
    if (!storageKey) return defaultWidth
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null
    const n = saved ? Number(saved) : NaN
    return Number.isFinite(n) && n >= minWidth && n <= maxWidth ? n : defaultWidth
  })
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // Persist width on change
  useEffect(() => {
    if (!storageKey) return
    window.localStorage.setItem(storageKey, String(width))
  }, [width, storageKey])

  // Escape closes
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Outside click closes (opt-in)
  useEffect(() => {
    if (!open || !closeOnOutsideClick) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (!t || panelRef.current?.contains(t)) return
      if (t.closest('[data-slide-panel], [data-panel-trigger], [data-row-menu]')) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, closeOnOutsideClick, onClose])

  // Drag-to-resize
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const next = Math.min(maxWidth, Math.max(minWidth, window.innerWidth - e.clientX))
      setWidth(next)
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // Prevent text selection while dragging
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [dragging, minWidth, maxWidth])

  const beginResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  if (!open) return null

  const shownWidth = expanded
    ? Math.round(window.innerWidth * 0.92)
    : expandedWidth ? Math.min(Math.max(width, expandedWidth), Math.round(window.innerWidth * 0.92)) : width

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      data-slide-panel
      className="fixed right-0 top-0 z-30 flex h-full flex-col bg-white shadow-xl"
      style={{
        width: shownWidth,
        borderLeft: '1px solid #E2E8F0',
        transform: 'translateX(0)',
        transition: dragging ? 'none' : 'transform 180ms ease-out',
      }}
    >
      {/* Drag handle — left edge, 6 px wide */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onMouseDown={beginResize}
        onDoubleClick={() => setWidth(defaultWidth)}
        title="Drag to resize · double-click to reset"
        className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-transparent hover:bg-blue-200 active:bg-blue-400"
        style={{ transition: dragging ? 'none' : 'background-color 120ms' }}
      />

      {/* Header */}
      <div className="flex flex-none items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-bold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 truncate text-[12px] text-slate-500">{subtitle}</p>}
        </div>
        {expandable && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? 'Shrink panel' : 'Expand panel'}
            title={expanded ? 'Shrink' : 'Expand'}
            className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {expanded
                ? <path d="M9 2v3h3M5 12V9H2M9 5l3-3M5 9l-3 3" />
                : <path d="M8 2h4v4M6 12H2V8M12 2 8 6M2 12l4-4" />}
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">{children}</div>
    </aside>
  )
}
