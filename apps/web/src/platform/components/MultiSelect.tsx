// The filter dropdown shared by the Master Library pages (Master Documents, Best Practices).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { PLATFORM_ACCENT } from '@platform/types'

// A dropdown of checkboxes: nothing ticked means "all". The list is drawn on the page itself (not inside
// the filter row) so the row cannot clip it. Closes on an outside click, Esc, scroll or resize.
export function MultiSelect({ label, allLabel, options, value, onChange, optionAttr, className, single = false }: {
  single?: boolean
  label: string
  allLabel: string
  options: { value: string; label: string }[]
  value: string[]
  onChange: (next: string[]) => void
  optionAttr: string
  className: string
}) {
  const { t } = useTranslation()
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number } | null>(null)
  const open = pos !== null
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = () => setPos(null)
    const inside = (e: Event) => !!e.target && (btnRef.current?.contains(e.target as Node) || popRef.current?.contains(e.target as Node))
    const onDown = (e: MouseEvent) => { if (!inside(e)) close() }
    const onScroll = (e: Event) => { if (!inside(e)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', close)
    }
  }, [open])
  const toggle = () => {
    if (open) { setPos(null); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ left: r.left, top: r.bottom + 4, minWidth: Math.max(r.width, 190) })
  }
  const summary = value.length === 0 ? allLabel : value.length === 1 ? (options.find(o => o.value === value[0])?.label ?? value[0]) : t('page.master_library.n_selected', { label, count: value.length })
  return (
    <div className="relative w-full">
      <button ref={btnRef} type="button" onClick={toggle} aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        className={`${className} !w-full inline-flex items-center justify-between gap-2 text-left`}>
        <span className="truncate">{summary}</span>
        <span aria-hidden="true" className="text-[10px] text-slate-500">▾</span>
      </button>
      {pos && createPortal(
        <div ref={popRef} role="listbox" aria-multiselectable="true"
          style={{ position: 'fixed', left: pos.left, top: pos.top, minWidth: pos.minWidth, zIndex: 60 }}
          className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg" data-multiselect-list>
          {single && (
            <button type="button" role="option" aria-selected={value.length === 0} onClick={() => { onChange([]); setPos(null) }}
              className="flex w-full items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 text-left text-[13px] text-slate-800 hover:bg-slate-50">
              <span className="w-4 text-[12px] text-blue-600">{value.length === 0 ? '✓' : ''}</span>{allLabel}
            </button>
          )}
          {options.map(o => {
            const on = value.includes(o.value)
            return single ? (
              <button key={o.value} type="button" role="option" aria-selected={on} {...{ [optionAttr]: o.value }}
                onClick={() => { onChange([o.value]); setPos(null) }}
                className="flex w-full items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 text-left text-[13px] text-slate-800 hover:bg-slate-50">
                <span className="w-4 text-[12px] text-blue-600">{on ? '✓' : ''}</span>{o.label}
              </button>
            ) : (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 text-[13px] text-slate-800 hover:bg-slate-50">
                <input type="checkbox" checked={on} {...{ [optionAttr]: o.value }}
                  onChange={() => onChange(on ? value.filter(v => v !== o.value) : [...value, o.value])}
                  style={{ accentColor: PLATFORM_ACCENT.primary }} />
                {o.label}
              </label>
            )
          })}
          {!single && value.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded px-2 py-1.5 text-left text-[12px] font-semibold text-slate-600 hover:bg-slate-50">
              {t('page.master_library.clear_selection')}
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
