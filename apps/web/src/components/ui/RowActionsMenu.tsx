// The "⋯" button at the end of a table row and the small menu it opens — same look and behaviour as the Clinical
// Writing documents table's row menu: fixed positioning (the table's scroll box can't clip it). It opens to the LEFT of
// the button, level with it, so it never covers the "⋯" of the rows above or below (it used to open underneath, over
// the next row's button, and a click aimed at that button hit a menu item instead). Closes on an outside press, Esc,
// scroll or resize. Arrow keys, Home and End move between items. Items are given by the caller.

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

  // Puts the menu beside the button. Returns false when the button is no longer on screen.
  const place = () => {
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return false
    const h = popRef.current?.offsetHeight ?? 73
    const w = popRef.current?.offsetWidth ?? 192
    setPos({
      top: Math.min(Math.max(8, b.top + b.height / 2 - h / 2), Math.max(8, window.innerHeight - h - 8)),
      // Right edge sits just left of the button; on a very narrow window it stays inside the screen.
      right: Math.max(8, Math.min(window.innerWidth - b.left + 6, window.innerWidth - w - 8)),
    })
    return b.bottom > 0 && b.top < window.innerHeight && b.right > 0 && b.left < window.innerWidth
  }
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    place()
  }, [open])

  // Opening puts the focus on the first item so the keyboard can carry on from there.
  useEffect(() => {
    if (open && pos) popRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open, pos])

  const closeAndRefocus = () => { setOpen(false); btnRef.current?.focus() }
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(popRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (!items.length) return
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length]?.focus() }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (e.key === 'Tab') setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAndRefocus() }
    // A scroll moves the button, so the menu follows it (a small nudge, e.g. the table sliding a few pixels to bring\n    // the button into view, used to close the menu the instant it opened); it closes once the button is off screen.
    const onScroll = (e: Event) => { if (!popRef.current?.contains(e.target as Node) && !place()) close() }
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
          onKeyDown={onMenuKey}
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
