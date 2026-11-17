// AssigneeCombobox — single-select user field with a search box, for lists too long to scroll.
//
// Opens on focus with every option listed; typing narrows by name or email. The caller owns the
// options, so this has no fetching of its own (compare UserPicker, the multi-select RACI list).

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface AssigneeOption {
  id: string
  name: string
  email: string
  /** Shown beside the name when the user has a role on the project. */
  role: string | null
  /** Set when the person is listed but can't be picked (for example they hold no can-author capability yet). */
  ineligibleReason?: string
}

export function filterAssignees(options: AssigneeOption[], query: string): AssigneeOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return options
  return options.filter(o => o.name.toLowerCase().includes(q) || o.email.toLowerCase().includes(q))
}

export interface AssigneeComboboxProps {
  label: string
  placeholder: string
  options: AssigneeOption[]
  value: string
  onChange: (userId: string) => void
}

export function AssigneeCombobox({ label, placeholder, options, value, onChange }: AssigneeComboboxProps) {
  const { t } = useTranslation()
  const id = useId()
  const listId = `${id}-list`
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const selected = options.find(o => o.id === value)
  const filtered = useMemo(() => filterAssignees(options, query), [options, query])

  function close() {
    setOpen(false)
    setQuery('')
    setActive(0)
  }

  function choose(option: AssigneeOption) {
    if (option.ineligibleReason) return
    onChange(option.id)
    close()
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    window.document.addEventListener('mousedown', onDown)
    return () => window.document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) setOpen(true)
        else setActive(i => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        // Never let Enter here submit the surrounding form.
        e.preventDefault()
        if (open && filtered[active]) choose(filtered[active])
        break
      case 'Escape':
        if (open) {
          // The form may sit in a drawer that also closes on Escape.
          e.stopPropagation()
          close()
        }
        break
      case 'Tab':
        close()
        break
    }
  }

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1" data-field="assignee">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</label>
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-required="true"
        aria-activedescendant={open && filtered[active] ? `${listId}-${filtered[active].id}` : undefined}
        value={open ? query : selected?.name ?? ''}
        placeholder={open ? selected?.name ?? t('component.user_picker.search_placeholder') : placeholder}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={e => { setQuery(e.currentTarget.value); setActive(0); setOpen(true) }}
        onKeyDown={onKeyDown}
        className="h-9 rounded-md border border-slate-300 px-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          // Keep focus in the input so a click on a row isn't read as leaving the field.
          onMouseDown={e => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-xs text-slate-500">{t('component.user_picker.no_matches')}</li>
          )}
          {filtered.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${o.id}`}
              role="option"
              aria-selected={o.id === value}
              aria-disabled={o.ineligibleReason ? true : undefined}
              data-ineligible={o.ineligibleReason ? '' : undefined}
              onClick={() => choose(o)}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-1.5 text-[13px] ${o.ineligibleReason ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${i === active && !o.ineligibleReason ? 'bg-blue-50' : ''}`}
            >
              <span className={`block truncate text-slate-900 ${o.id === value ? 'font-semibold' : ''}`}>
                {o.name}{o.role ? ` (${o.role})` : ''}
                {o.ineligibleReason && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{t('component.assignee_combobox.not_eligible')}</span>}
              </span>
              <span className="block truncate text-[11px] text-slate-500">{o.ineligibleReason ?? o.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
