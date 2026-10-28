import { NavLink } from 'react-router-dom'

export interface SubNavTab {
  to:        string
  label:     string
  end?:      boolean
  /** When true, the tab renders as a greyed-out span (not a link). */
  disabled?: boolean
  /** Tooltip shown on the tab — useful for explaining why a tab is disabled. */
  title?:    string
}

interface SubNavProps {
  tabs: SubNavTab[]
  label?: string
}

export function SubNav({ tabs, label }: SubNavProps) {
  return (
    <nav
      className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-6"
      style={{ minHeight: 42 }}
      data-subnav
      aria-label={label ?? 'Resource sub-navigation'}
    >
      {tabs.map(t => (
        t.disabled ? (
          <span
            key={t.to}
            className="whitespace-nowrap px-3 py-2 text-[12px] font-semibold select-none cursor-not-allowed"
            style={{ color: '#CBD5E1', borderBottom: '2px solid transparent' }}
            aria-disabled="true"
            title={t.title}
            data-subnav-tab={t.label}
            data-subnav-disabled="true"
          >
            {t.label}
          </span>
        ) : (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            title={t.title}
            className="whitespace-nowrap px-3 py-2 text-[12px] font-semibold transition-colors"
            style={({ isActive }) => ({
              color:        isActive ? '#0D9488' : '#64748B',
              borderBottom: isActive ? '2px solid #0D9488' : '2px solid transparent',
            })}
            data-subnav-tab={t.label}
          >
            {t.label}
          </NavLink>
        )
      ))}
    </nav>
  )
}
