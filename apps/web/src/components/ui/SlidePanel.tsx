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
//   - No backdrop overlay (non-modal); click-outside does NOT close
//     (prevents accidental loss of unsaved form state)

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
}: SlidePanelProps) {
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

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      data-slide-panel
      className="fixed right-0 top-0 z-30 flex h-full flex-col bg-white shadow-xl"
      style={{
        width,
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
