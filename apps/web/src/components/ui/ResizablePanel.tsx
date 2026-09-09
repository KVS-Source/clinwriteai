import { useCallback, useEffect, useRef } from 'react'
import type React from 'react'

// ResizablePanel — drag-to-resize right panel used by B03 and B04.
//
// Critical implementation notes:
//   • Refs (not state) for the panel DOM node — avoids re-render on drag
//   • applyWidth() sets `panel.style.width` imperatively
//   • Drag handlers attach mousemove/mouseup to `window`, not the grip
//   • dblclick on grip resets to defaultWidth
//   • `children` is a render prop that receives { widen, narrow, reset }
//     — lets the parent wire panel-header buttons without lifting width to state

export interface ResizablePanelApi {
  widen:  () => void
  narrow: () => void
  reset:  () => void
}

interface Props {
  /** Initial + reset width (px). Default 280. */
  defaultWidth?:  number
  /** Minimum drag width (px). Default 280. */
  minWidth?:      number
  /** Maximum drag width (px). Default 760. */
  maxWidth?:      number
  /** Step size for widen/narrow controls (px). Default 120. */
  step?:          number
  /** Top offset from container top (px) — e.g. 48 to sit below a toolbar. Default 0. */
  topOffset?:     number
  /** Called after every width mutation. */
  onWidthChange?: (width: number) => void
  /** Panel body render prop — receives the width-control API. */
  children:       (api: ResizablePanelApi) => React.ReactNode
}

export function ResizablePanel({
  defaultWidth = 280,
  minWidth     = 280,
  maxWidth     = 760,
  step         = 120,
  topOffset    = 0,
  onWidthChange,
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const gripRef  = useRef<HTMLDivElement | null>(null)
  const widthRef = useRef<number>(defaultWidth)

  const applyWidth = useCallback((next: number) => {
    const clamped = Math.min(maxWidth, Math.max(minWidth, next))
    widthRef.current = clamped
    if (panelRef.current) panelRef.current.style.width = `${clamped}px`
    onWidthChange?.(clamped)
  }, [minWidth, maxWidth, onWidthChange])

  useEffect(() => {
    applyWidth(defaultWidth)
  }, [defaultWidth, applyWidth])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthRef.current
    if (gripRef.current) gripRef.current.style.setProperty('--grip-color', '#0D9488')

    const move = (ev: MouseEvent) => {
      // Grip is on the LEFT edge of the panel — dragging left widens the panel
      applyWidth(startW + (startX - ev.clientX))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.document.body.style.cursor = ''
      window.document.body.style.userSelect = ''
      if (gripRef.current) gripRef.current.style.setProperty('--grip-color', '#CBD5E1')
    }
    window.document.body.style.cursor = 'col-resize'
    window.document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [applyWidth])

  const reset  = useCallback(() => applyWidth(defaultWidth),                [applyWidth, defaultWidth])
  const widen  = useCallback(() => applyWidth(widthRef.current + step),     [applyWidth, step])
  const narrow = useCallback(() => applyWidth(widthRef.current - step),     [applyWidth, step])

  const api: ResizablePanelApi = { widen, narrow, reset }

  return (
    <div
      ref={panelRef}
      className="absolute right-0 bottom-0 flex flex-col border-l border-slate-200 bg-white"
      style={{
        top:       topOffset,
        width:     defaultWidth,
        zIndex:    20,
        boxShadow: '-16px 0 40px rgba(15,23,42,0.12)',
        minHeight: 0,
      }}
      data-resizable-panel
    >
      {/* Drag grip — 14px wide overlay on left edge */}
      <div
        ref={gripRef}
        onMouseDown={handleMouseDown}
        onDoubleClick={reset}
        title="Drag to resize · double-click to reset"
        className="absolute top-0 bottom-0 flex cursor-col-resize items-center justify-center"
        style={{ left: -7, width: 14, zIndex: 25 }}
        data-resize-grip
      >
        <div
          className="flex flex-col items-center justify-center gap-1 rounded-[3px]"
          style={{ width: 5, height: 44, backgroundColor: 'var(--grip-color, #CBD5E1)' }}
        >
          <span className="block rounded-full bg-white" style={{ width: 1.5, height: 1.5 }} />
          <span className="block rounded-full bg-white" style={{ width: 1.5, height: 1.5 }} />
          <span className="block rounded-full bg-white" style={{ width: 1.5, height: 1.5 }} />
        </div>
      </div>

      {/* Body — leaves 14px on the left for the grip */}
      <div className="flex flex-1 min-w-0 min-h-0 flex-col" style={{ paddingLeft: 14 }}>
        {children(api)}
      </div>
    </div>
  )
}
