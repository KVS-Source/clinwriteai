import { useCallback, useEffect, useRef, useState } from 'react'
import { useDocumentStore } from '../store'

// Right-hand drawer behaviour shared by the editor and the reviewer view. The drawer is docked to
// the window's right edge and runs from just under the top bar to the bottom of the screen. Drag its
// left edge to resize, "expand" to take the whole width beside the app sidebar, "shrink" to go back.
// The chosen width is remembered between sessions.

const MIN_WIDTH     = 320
const SIDEBAR_WIDTH = 220            // keep the app's left navigation visible when expanded
const STORAGE_KEY   = 'clinwrite.docPanelWidth'

export function useResizablePanel(opts: {
  /** The currently open panel. Changing it resets "expanded". */
  activePanel: string | null
  /** Width a given panel should open at when it is narrower than that. */
  preferredWidth?: (panel: string) => number | undefined
}) {
  const { activePanel, preferredWidth } = opts
  const width    = useDocumentStore(s => s.panelWidth)
  const setWidth = useDocumentStore(s => s.setPanelWidth)

  const [dragging, setDragging] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const widthBeforeExpand = useRef<number | null>(null)

  const maxWidth = () => Math.max(MIN_WIDTH, window.innerWidth - SIDEBAR_WIDTH)
  const clamp = useCallback((w: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w))), [])

  const remember = (w: number) => {
    try { window.localStorage.setItem(STORAGE_KEY, String(w)) } catch { /* storage unavailable — width just isn't remembered */ }
  }

  // Restore the last width the user chose.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(STORAGE_KEY))
      if (Number.isFinite(saved) && saved >= MIN_WIDTH) setWidth(clamp(saved))
    } catch { /* ignore */ }
  }, [setWidth, clamp])

  // Opening a different panel starts un-expanded, at least as wide as that panel needs.
  useEffect(() => {
    setExpanded(false)
    widthBeforeExpand.current = null
    if (!activePanel) return
    const current = useDocumentStore.getState().panelWidth
    const wanted  = preferredWidth?.(activePanel) ?? MIN_WIDTH
    if (current < wanted) setWidth(clamp(wanted))
  }, [activePanel, preferredWidth, setWidth, clamp])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => setWidth(clamp(window.innerWidth - e.clientX))
    const onUp = () => {
      setDragging(false)
      remember(useDocumentStore.getState().panelWidth)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.document.body.style.userSelect = 'none'
    window.document.body.style.cursor = 'ew-resize'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.document.body.style.userSelect = ''
      window.document.body.style.cursor = ''
    }
  }, [dragging, setWidth, clamp])

  const toggleExpanded = () => {
    if (!expanded) {
      widthBeforeExpand.current = width
      setWidth(maxWidth())
      setExpanded(true)
    } else {
      setWidth(clamp(widthBeforeExpand.current ?? MIN_WIDTH))
      setExpanded(false)
    }
  }

  const startDrag = () => { setExpanded(false); setDragging(true) }

  return { width, expanded, dragging, toggleExpanded, startDrag }
}
