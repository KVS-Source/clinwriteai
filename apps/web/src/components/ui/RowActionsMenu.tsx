// The "⋯" button at the end of a table row and the small menu it opens — same look and behaviour as the Clinical
// Writing documents table's row menu: fixed positioning (the table's scroll box can't clip it, and it flips up when
// there's no room below), closes on an outside press, Esc, scroll or resize. Items are given by the caller.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface RowAction {
  key: string
  label: string
  onSelect: () => void
}

export function RowActionsMenu({ actions, ariaLabel }: { actions: RowAction[]; ariaLabel: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    const h = popRef.current?.offsetHeight ?? 90
    const below = b.bottom + 4
    setPos({
      top: below + h > window.innerHeight ? Math.max(8, b.top - h - 4) : below,
      right: Math.max(8, window.innerWidth - b.right),
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onScroll = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <div ref={menuRef} className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className="flex gap-[2.5px] rounded-md bg-slate-100 px-2 py-2 transition-colors hover:bg-slate-200"
        data-row-menu-button
      >
        <span className="h-[3px] w-[3px] rounded-full bg-slate-500" />
        <span className="h-[3px] w-[3px] rounded-full bg-slate-500" />
        <span className="h-[3px] w-[3px] rounded-full bg-slate-500" />
      </button>
      {open && (
        <div
          ref={popRef}
          className="fixed z-50 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
          style={{ top: pos?.top ?? -9999, right: pos?.right ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          role="menu"
          data-row-menu
          onClick={e => e.stopPropagation()}
        >
          {actions.map(a => (
            <button key={a.key} type="button" role="menuitem" data-action={a.key}
              onClick={() => { setOpen(false); a.onSelect() }}
              className="flex w-full items-center px-3 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-50">
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
