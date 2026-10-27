import { useMemo, useState } from 'react'
import type { Section } from '@platform/types'
import { useDocumentStore } from '../../store'

interface Props {
  sections: Section[]
  loggedInUser?: { initials: string; colourKey: 'MW' | 'SC' | 'JO' | 'EV' | 'PN' | 'AH' | 'RT' | 'LP' | 'AI' }
  activeSectionBadge?: string  // e.g. "IN REVIEW" for reviewer view
  progressLabelSuffix?: string // e.g. "reviewed" so footer reads "N of M sections reviewed · X%"
}

// Presence avatar colours — matches design-system Pattern 7
const USER_AVATAR: Record<string, { bg: string; fg: string }> = {
  MW: { bg: '#DBEAFE', fg: '#1D4ED8' },
  SC: { bg: '#F0FDF4', fg: '#15803D' },
  JO: { bg: '#F5F3FF', fg: '#7C3AED' },
  EV: { bg: '#FEF3C7', fg: '#D97706' },
  PN: { bg: '#FEE2E2', fg: '#DC2626' },
  AH: { bg: '#E0F2FE', fg: '#0369A1' },
  RT: { bg: '#FCE7F3', fg: '#9D174D' },
  LP: { bg: '#F3F4F6', fg: '#374151' },
}

function LockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className="flex-none">
      <rect x="2.2" y="5.2" width="7.6" height="5.4" rx="1"/>
      <path d="M4 5.2V3.8a2 2 0 0 1 4 0v1.4"/>
    </svg>
  )
}

function statusDotColour(status: Section['status']): string {
  switch (status) {
    case 'complete':    return '#16A34A'
    case 'in-progress': return '#2563EB'
    case 'warning':     return '#D97706'
    case 'not-started': return '#CBD5E1'
    default:            return '#CBD5E1'
  }
}

// Team-member lookup for locked-section avatars (matches team.json fixture initials)
const TEAM_INITIALS: Record<string, string> = {
  'user-MW': 'MW', 'user-SC': 'SC', 'user-JO': 'JO', 'user-EV': 'EV',
  'user-PN': 'PN', 'user-AH': 'AH', 'user-RT': 'RT', 'user-LP': 'LP',
}

export function SectionNavigator({
  sections,
  loggedInUser = { initials: 'MW', colourKey: 'MW' },
  activeSectionBadge,
  progressLabelSuffix,
}: Props) {
  const activeSection    = useDocumentStore(s => s.activeSection)
  const setActiveSection = useDocumentStore(s => s.setActiveSection)

  // Filter — writers wanted to jump to a section by name/number instead of
  // scrolling the full ToC. Case-insensitive, matches on both "11.4" and
  // "primary efficacy". Footer progress still reports the FULL counts so
  // a filtered view doesn't look like sections went missing.
  const [query, setQuery] = useState('')
  const visibleSections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sections
    return sections.filter(s =>
      s.number.toLowerCase().includes(q) ||
      s.title.toLowerCase().includes(q),
    )
  }, [sections, query])

  const completeCount = sections.filter(s => s.status === 'complete').length
  const pct = sections.length > 0 ? Math.round((completeCount / sections.length) * 100) : 0

  return (
    <div className="flex w-[220px] flex-none flex-col border-r border-slate-200" style={{ backgroundColor: '#F8FAFC', minHeight: 0 }} data-section-nav>

      {/* Header */}
      <div className="flex flex-none items-center justify-between px-5 pt-4 pb-2 font-mono text-[10px] font-medium uppercase tracking-widest text-slate-500">
        <span>Sections</span>
        {query && (
          <span className="font-sans text-[10px] font-normal normal-case text-slate-400">
            {visibleSections.length} of {sections.length}
          </span>
        )}
      </div>

      {/* Section search — filters by number ("11.4") or title ("efficacy").
          Esc clears the query so the writer can abort without reaching for
          the mouse. The data-section-search hook lets Playwright target it. */}
      <div className="flex-none px-3 pb-2">
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setQuery('') }}
            placeholder="Search sections…"
            data-section-search
            className="h-7 w-full rounded border border-slate-200 bg-white pl-7 pr-7 text-[12px] outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
          />
          <svg
            width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          >
            <circle cx="6" cy="6" r="4" />
            <line x1="9" y1="9" x2="12" y2="12" strokeLinecap="round" />
          </svg>
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <line x1="3" y1="3" x2="9" y2="9" />
                <line x1="9" y1="3" x2="3" y2="9" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Scroll list */}
      <div className="flex-1 overflow-y-auto">
        {visibleSections.length === 0 && (
          <p className="px-5 py-6 text-center text-[12px] italic text-slate-400">
            No sections match "{query}".
          </p>
        )}
        {visibleSections.map(section => {
          const isActive     = activeSection === section.id
          const isLocked     = section.isLocked === true
          const lockOwner    = section.lockedByUserId ? TEAM_INITIALS[section.lockedByUserId] : null
          const presence     = section.presenceUserId ? TEAM_INITIALS[section.presenceUserId] : null
          const dotColour    = statusDotColour(section.status)
          const textColour   = isLocked ? '#94A3B8' : isActive ? '#1E293B' : '#64748B'
          const fontWeight   = isActive ? 700 : (isLocked ? 400 : 400)

          return (
            <div
              key={section.id}
              data-section-id={section.id}
              data-active={isActive || undefined}
              onClick={() => setActiveSection(section.id)}
              title={isLocked ? `Locked by ${lockOwner ?? 'another user'}` : undefined}
              className="relative flex h-9 min-w-0 cursor-pointer items-center gap-2 px-3 text-[13px] hover:bg-slate-100 transition-colors"
              style={{
                borderLeft:   `3px solid ${isActive ? '#2563EB' : 'transparent'}`,
                backgroundColor: isActive ? '#FFFFFF' : undefined,
                color: textColour,
                fontWeight,
              }}
            >
              {/* Pulse strip on active section */}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute top-0 bottom-0 -left-[3px] w-[3px] animate-pulse-blue"
                  style={{ backgroundColor: '#2563EB' }}
                />
              )}

              {/* Lock icon (locked sections only) OR status dot */}
              {isLocked ? (
                <span className="flex flex-none text-slate-400"><LockIcon /></span>
              ) : (
                <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: dotColour }} />
              )}

              <span className="flex-1 truncate">
                {section.number} {section.title}
              </span>

              {/* Reviewer badge (e.g. "IN REVIEW") on active section — reviewer variant */}
              {isActive && activeSectionBadge && (
                <span
                  className="flex-none font-mono text-[9px] font-medium tracking-wider"
                  style={{ color: '#2563EB' }}
                >
                  {activeSectionBadge}
                </span>
              )}

              {/* Presence avatar OR active user avatar OR lock owner */}
              {isActive && (
                <div
                  className="flex h-4 w-4 flex-none items-center justify-center rounded-full font-mono text-[9px] font-bold"
                  style={{ backgroundColor: USER_AVATAR[loggedInUser.colourKey].bg, color: USER_AVATAR[loggedInUser.colourKey].fg }}
                >
                  {loggedInUser.initials}
                </div>
              )}
              {!isActive && lockOwner && USER_AVATAR[lockOwner] && (
                <div
                  className="flex h-4 w-4 flex-none items-center justify-center rounded-full font-mono text-[9px] font-bold"
                  style={{ backgroundColor: USER_AVATAR[lockOwner].bg, color: USER_AVATAR[lockOwner].fg }}
                >
                  {lockOwner}
                </div>
              )}
              {!isActive && !lockOwner && presence && USER_AVATAR[presence] && (
                <div
                  className="flex h-4 w-4 flex-none items-center justify-center rounded-full font-mono text-[9px] font-bold"
                  style={{ backgroundColor: USER_AVATAR[presence].bg, color: USER_AVATAR[presence].fg }}
                >
                  {presence}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer — progress */}
      <div className="flex flex-none flex-col gap-2 border-t border-slate-200 px-4 py-3.5">
        <p className="text-[11px] text-slate-500">
          {completeCount} of {sections.length} sections{progressLabelSuffix ? ` ${progressLabelSuffix}` : ''} · {pct}%
        </p>
        <div className="h-1.5 overflow-hidden rounded-[3px] bg-slate-200">
          <div className="h-full" style={{ width: `${pct}%`, backgroundColor: '#2563EB' }} />
        </div>
      </div>
    </div>
  )
}
