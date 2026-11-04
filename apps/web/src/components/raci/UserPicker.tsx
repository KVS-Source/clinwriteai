// UserPicker — search box for adding a user to one RACI letter.
//
// Hits GET /projects/:projectId/assignable-users?scope=raci so every
// non-admin candidate is listed; assigning grants a missing capability.
// One click adds one person (per the design doc §5a every letter supports
// multiple users, so the box stays available for the next one). Taking
// someone off is the parent panel's job: its rows have Remove + Cancel.
//
// Minimal + headless — the component manages its own fetch + search state
// and reports the choice via `onAdd`. Styling kept deliberately plain so the
// parent panel can wrap or restyle it.

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  assignableUsersApi,
  capabilityForLetter,
  type AssignableUser,
  type RaciLetter,
} from '../../api/raci'

/** No one is listed until something is typed; from the first letter the list shows only the matches. */
export const MIN_SEARCH_CHARS = 1

export function filterUsers(users: AssignableUser[], query: string): AssignableUser[] {
  const q = query.trim().toLowerCase()
  if (q.length < MIN_SEARCH_CHARS) return []
  return users.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
}

export interface UserPickerProps {
  projectId: string
  letter: RaciLetter
  /** User ids already holding this letter — shown as added, not selectable. */
  value: string[]
  /** Add this user; resolves true once added. The search closes on success and stays open on failure. */
  onAdd: (user: AssignableUser) => Promise<boolean>
  /** Set to true when the parent is read-only (e.g. doc is signed) or busy. */
  disabled?: boolean
  /** Users already holding another letter on the document — shown greyed out, not selectable. */
  heldElsewhere?: Map<string, RaciLetter>
  className?: string
}

export function UserPicker({ projectId, letter, value, onAdd, disabled, heldElsewhere, className }: UserPickerProps) {
  const { t } = useTranslation()
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
        setError(e instanceof Error ? e.message : t('component.user_picker.failed_to_load'))
      })
    return () => { cancelled = true }
  }, [projectId, t])

  const filtered = useMemo(() => (users ? filterUsers(users, query) : []), [users, query])
  const searching = query.trim().length >= MIN_SEARCH_CHARS

  const added = useMemo(() => new Set(value), [value])

  async function add(user: AssignableUser) {
    if (disabled) return
    if (await onAdd(user)) setQuery('')
  }

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={t('component.user_picker.add_placeholder')}
        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
        aria-label={t('component.user_picker.filter_users_aria')}
        disabled={disabled}
      />
      {error && (
        <div className="p-3 text-xs text-rose-600">{error}</div>
      )}
      {searching && !error && (
      <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100" data-user-results>
        {users === null && (
          <div className="p-3 text-xs text-slate-500">{t('component.user_picker.loading')}</div>
        )}
        {users && filtered.length === 0 && (
          <div className="p-3 text-xs text-slate-500">{t('component.user_picker.no_matches')}</div>
        )}
        {filtered.map(u => {
          const isAdded = added.has(u.id)
          const otherLetter = isAdded ? undefined : heldElsewhere?.get(u.id)
          const canAdd = !disabled && !isAdded && !otherLetter
          const grants = !isAdded && !otherLetter && capability && !u.capabilities.includes(capability) ? capability : null
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => void add(u)}
              disabled={!canAdd}
              title={otherLetter ? t('component.user_picker.held_elsewhere_tooltip', { name: u.name, letter: otherLetter }) : undefined}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${canAdd ? 'cursor-pointer hover:bg-blue-50' : 'cursor-default'} ${otherLetter ? 'opacity-60' : ''} ${disabled && !isAdded ? 'opacity-60' : ''}`}
              data-user-result={u.id}
              data-result-state={isAdded ? 'added' : otherLetter ? 'held-elsewhere' : 'available'}
            >
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
                  title={t('component.user_picker.grants_tooltip', { name: u.name, capability: grants })}
                  data-grants-capability
                >
                  {t('component.user_picker.grants_label', { capability: grants })}
                </span>
              )}
              {otherLetter && (
                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500" data-held-elsewhere>
                  {t('component.user_picker.already_held', { letter: otherLetter })}
                </span>
              )}
              {u.projectRole && (
                <span className="shrink-0 text-[11px] text-slate-500 italic">
                  {u.projectRole}
                </span>
              )}
              {isAdded && (
                <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700" data-already-added>
                  ✓ {t('component.user_picker.added')}
                </span>
              )}
              {canAdd && (
                <span className="shrink-0 text-[12px] font-semibold text-blue-600">+ {t('component.user_picker.add')}</span>
              )}
            </button>
          )
        })}
      </div>
      )}
    </div>
  )
}
