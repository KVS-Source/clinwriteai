// UserPicker — searchable list of assignable users for one RACI letter.
//
// Hits GET /projects/:projectId/assignable-users?capability=<cap>
// so the list is already filtered server-side to users who can hold the
// chosen letter. Multi-select (per the design doc §5a — every letter
// supports multiple users).
//
// Minimal + headless — the component manages its own fetch + search state
// but exposes the current selection via `onChange(userIds)`. Styling kept
// deliberately plain so the parent panel can wrap or restyle it.

import { useEffect, useMemo, useState } from 'react'
import {
  assignableUsersApi,
  capabilityForLetter,
  type AssignableUser,
  type RaciLetter,
} from '../../api/raci'

/** The search only filters once this many characters are typed; shorter input shows everyone. */
export const MIN_SEARCH_CHARS = 3

export function filterUsers(users: AssignableUser[], query: string): AssignableUser[] {
  const q = query.trim().toLowerCase()
  if (q.length < MIN_SEARCH_CHARS) return users
  return users.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
}

export interface UserPickerProps {
  projectId: string
  letter: RaciLetter
  /** Current selection — user ids already chosen for this letter. */
  value: string[]
  onChange: (userIds: string[]) => void
  /** Set to true when the parent is read-only (e.g. doc is signed). */
  disabled?: boolean
  /** Users already holding another letter on the document — shown greyed out, not selectable. */
  heldElsewhere?: Map<string, RaciLetter>
  className?: string
}

export function UserPicker({ projectId, letter, value, onChange, disabled, heldElsewhere, className }: UserPickerProps) {
  const [users, setUsers] = useState<AssignableUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const capability = capabilityForLetter(letter)

  useEffect(() => {
    let cancelled = false
    setUsers(null)
    setError(null)
    // Every non-admin is offered; assigning someone without the letter's capability grants it server-side.
    assignableUsersApi.listForRaci(projectId)
      .then(list => {
        if (cancelled) return
        setUsers(list)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load users')
      })
    return () => { cancelled = true }
  }, [projectId])

  const filtered = useMemo(() => (users ? filterUsers(users, query) : []), [users, query])
  const typed = query.trim().length
  const searching = typed >= MIN_SEARCH_CHARS

  const selected = useMemo(() => new Set(value), [value])

  function toggle(userId: string) {
    if (disabled) return
    const next = new Set(selected)
    if (next.has(userId)) next.delete(userId)
    else next.add(userId)
    onChange(Array.from(next))
  }

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search users…"
        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
        aria-label="Filter users"
        disabled={disabled}
      />
      {typed > 0 && !searching && (
        <p className="text-[11px] text-slate-500" data-search-hint>
          Type at least {MIN_SEARCH_CHARS} characters to search.
        </p>
      )}
      <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
        {users === null && !error && (
          <div className="p-3 text-xs text-slate-500">Loading…</div>
        )}
        {error && (
          <div className="p-3 text-xs text-rose-600">{error}</div>
        )}
        {users && filtered.length === 0 && (
          <div className="p-3 text-xs text-slate-500">
            {searching ? 'No matches.' : 'No users available.'}
          </div>
        )}
        {filtered.map(u => {
          const isSelected = selected.has(u.id)
          const otherLetter = isSelected ? undefined : heldElsewhere?.get(u.id)
          const blocked = disabled || !!otherLetter
          const grants = !isSelected && !otherLetter && capability && !u.capabilities.includes(capability) ? capability : null
          return (
            <label
              key={u.id}
              title={otherLetter ? `${u.name} already holds ${otherLetter} on this document — one letter per person.` : undefined}
              className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'} ${blocked ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggle(u.id)}
                disabled={blocked}
                className="shrink-0"
              />
              <span className="shrink-0 w-7 h-7 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center text-[11px] font-semibold">
                {u.initials ?? u.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-medium text-slate-900 truncate">{u.name}</span>
                <span className="block text-[11px] text-slate-500 truncate">{u.email}</span>
              </span>
              {grants && (
                <span
                  className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                  title={`${u.name} doesn't have ${grants} yet — assigning grants it (recorded in the audit log).`}
                  data-grants-capability
                >
                  Grants {grants}
                </span>
              )}
              {otherLetter && (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500" data-held-elsewhere>
                  Already {otherLetter}
                </span>
              )}
              {u.projectRole && (
                <span className="shrink-0 text-[11px] text-slate-500 italic">
                  {u.projectRole}
                </span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}
