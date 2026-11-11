// Master Library — unified admin surface for content standards.
//
// Single sidebar entry (hidden from IT-admin) → this shell with a
// horizontal tab bar. Each tab is a nested React Router route, so
// switching tabs is client-side AJAX navigation (no page reload, no
// full-shell re-render). The existing standalone admin screens
// (TemplateLibrary, AiPrompts, DocumentTypePolicies, …) are reused
// verbatim as the tab bodies — no duplicated UI.
//
// Role model (ask: 2026-11-10):
//   - IT Admin cannot reach these — the sidebar hides the entry and
//     every tab's write-gated API route refuses with 503 / 403. Admin
//     is a system operator, not a content owner.
//   - PM is the content admin. Reads + writes everything here.
//   - Contributor / author / auditor can read Master Documents + Best
//     Practices (the two "library" tabs); the other tabs are gated
//     server-side (PM-only writes) so a contributor opening them sees
//     them in read mode only.
//
// If a user who shouldn't be here lands via deep link, the inner
// screens' own error states take over (the gated APIs return 503 /
// 403 and the empty-state renders).

import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { MasterLibrarySlotContext } from '../components/MasterLibraryHeading'

export interface Tab {
  slug:  string       // URL segment — '/master-library/<slug>'
  label: string
}

// Order is prescribed (2026-11-10): Master Documents first, Best
// Practices second, then the four standards tools, Doc Type Policies
// last (it's the aggregated editor — admins typically reach it after
// the atomic tools).
// Also read by the top bar, which shows "Master Library / <active tab>" as its breadcrumb.
export const MASTER_LIBRARY_TABS: Tab[] = [
  { slug: 'documents',      label: 'Master Documents' },
  { slug: 'best-practices', label: 'Best Practices'  },
  { slug: 'templates',      label: 'Templates'       },
  { slug: 'ai-prompts',     label: 'AI Prompts'      },
  { slug: 'checklists',     label: 'Checklists'      },
  { slug: 'ich-frameworks', label: 'ICH Frameworks'  },
  { slug: 'policies',       label: 'Doc Type Policies' },
]

export function MasterLibraryShell() {
  const { pathname } = useLocation()
  // The matched tab is the first segment after /master-library/. Used
  // to style the active tab chip; routing itself is handled by NavLink.
  const activeSlug = useMemo(() => {
    const m = /^\/master-library\/([^/]+)/.exec(pathname)
    return m?.[1] ?? 'documents'
  }, [pathname])

  // The header's heading slot: each page puts its own title + subtitle here (see MasterLibraryHeading).
  const [headingSlot, setHeadingSlot] = useState<HTMLElement | null>(null)

  return (
    <MasterLibrarySlotContext.Provider value={headingSlot}>
    <div className="flex h-full min-h-0 flex-col bg-slate-50" data-screen="master-library">
      <header className="flex-none border-b border-slate-200 bg-white px-5 pt-4">
        <div ref={setHeadingSlot} data-master-library-heading />
        {/* Scrolls sideways on narrow screens, but never up and down and with no scrollbar showing: the
            active tab's underline used to poke 1px below the strip, which put scroll arrows on its right. */}
        <nav
          className="-mx-5 mt-4 flex items-end gap-0 overflow-x-auto overflow-y-hidden border-b border-slate-200 px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          data-master-library-tabs
        >
          {MASTER_LIBRARY_TABS.map(tab => (
            <NavLink
              key={tab.slug}
              to={`/master-library/${tab.slug}`}
              role="tab"
              aria-selected={activeSlug === tab.slug}
              data-tab={tab.slug}
              className={({ isActive }) => {
                const active = isActive || activeSlug === tab.slug
                return [
                  'relative whitespace-nowrap px-4 py-2.5 text-[13px] font-medium transition-colors',
                  active
                    ? 'text-blue-700 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-blue-600'
                    : 'text-slate-600 hover:text-slate-900',
                ].join(' ')
              }}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
    </MasterLibrarySlotContext.Provider>
  )
}
