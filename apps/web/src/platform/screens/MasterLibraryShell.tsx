// Master Library — unified admin surface for content standards.
//
// Single sidebar entry (hidden from IT-admin) → this shell with a
// horizontal tab bar. Each tab is a nested React Router route, so
// switching tabs is client-side AJAX navigation (no page reload, no
// full-shell re-render). The existing standalone admin screens
// (TemplateLibrary, AiPrompts, DocumentTypePolicies, …) are reused
// verbatim as the tab bodies — no duplicated UI.
//
// Tabs by role (SME decision, 2026-11-18): a Project Manager sees every tab; everyone else sees only Master
// Documents and Best Practices (the two "library" tabs). Hidden tabs are left out of the strip with their counts,
// their data is not fetched, and a deep link to one redirects to Master Documents. This is a UI rule only: the
// read APIs behind those tabs stay open to every signed-in user because other screens (New Document, the editor,
// AI features) read templates, prompts, checklists, frameworks and policies through them.
//
// Role model (ask: 2026-11-10):
//   - IT Admin cannot reach these — the sidebar hides the entry and
//     every tab's write-gated API route refuses with 503 / 403. Admin
//     is a system operator, not a content owner.
//   - PM is the content admin. Reads + writes everything here.
//   - Everyone else reads Master Documents + Best Practices only (see "Tabs by role" above).
//     The other tabs' write routes are PM-only on the API as well.

import { useMemo, useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { platformApi } from '../api/platformApi'
import { documentsApi } from '../../api/documents'
import { MasterLibrarySlotContext } from '../components/MasterLibraryHeading'
import { usePlatformStore } from '../store/platformStore'

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
  { slug: 'documents',             label: 'Master Documents' },
  { slug: 'best-practices',        label: 'Best Practices'  },
  { slug: 'templates',             label: 'Templates'       },
  { slug: 'ai-prompts',            label: 'AI Prompts'      },
  // Section Templates — per-section formatting JSON the AI sees on every
  // draft + rewrite. Migration 90. PM-only writes.
  { slug: 'section-templates',     label: 'Section Templates' },
  { slug: 'checklists',            label: 'Checklists'      },
  { slug: 'ich-frameworks',        label: 'ICH Frameworks'  },
  { slug: 'policies',              label: 'Doc Type Policies' },
  // Phase M-B.1 — mirror of Doc Type Policies for Module B (manuscripts,
  // abstracts, posters, reviews, letters, PLS). PM-only writes; reads
  // allowed for any authed user so contributors can see what's wired.
  { slug: 'publication-policies',  label: 'Publication Policies' },
  // Phase M-C.1 — medical-writing policy admin. PM-only writes; reads
  // allowed for any authed Module-C user.
  { slug: 'med-content-policies',  label: 'Medical Content Policies' },
  // Phase M-D.1 — regulatory-writing policy admin. PM-only writes;
  // reads allowed for any authed Module-D user.
  { slug: 'regulatory-policies',   label: 'Regulatory Policies' },
  // Phase M-E.1 — ideation / KOL engagement policy admin. PM-only
  // writes; reads allowed for any authed Module-E user.
  { slug: 'ideation-policies',     label: 'Ideation Policies' },
]

// Tabs everyone can see; the rest are for the Project Manager only.
export const LIBRARY_TAB_SLUGS = ['documents', 'best-practices']
export const tabsFor = (isPm: boolean): Tab[] => (isPm ? MASTER_LIBRARY_TABS : MASTER_LIBRARY_TABS.filter(t => LIBRARY_TAB_SLUGS.includes(t.slug)))

// Master Documents lists documents only (sections are pulled from inside them).
export const MASTER_DOCUMENT_ITEM_TYPES = ['document']

// Each tab shows how many items it holds, beside its name: "Templates (4)". The counts come from the same
// queries the tabs themselves run (same keys), so opening a tab reuses the data and a change made on a tab
// updates its count. Master Documents is paged, so its count is the library's total (X-Total-Count) with no
// filters, as the tab opens. A tab whose list can't be read (e.g. not allowed) shows no count.
// A count only when the response really is a list. An unexpected shape (an error body, a changed endpoint) shows no
// count for that tab instead of throwing and taking the whole Master Library down.
const countOf = (v: unknown): number | undefined => (Array.isArray(v) ? v.length : undefined)

function useTabCounts(isPm: boolean): Partial<Record<string, number>> {
  const opts = { retry: false, staleTime: 30_000 } as const
  // The PM-only tabs' lists are read (for the counts) only when the tab is shown.
  const pmOpts = { ...opts, enabled: isPm } as const
  const documents = useQuery({
    queryKey: ['library', 'tab-count'],
    queryFn:  () => platformApi.countLibrary({ itemType: MASTER_DOCUMENT_ITEM_TYPES }),
    ...opts,
  })
  const bestPractices = useQuery({ queryKey: ['best-practices'], queryFn: () => platformApi.listBestPractices(), ...opts })
  // The Best Practices page hides modules this tenant hasn't enabled (Platform items always show), so the count does too.
  const enabled = useQuery({ queryKey: ['library-enabled-modules'], queryFn: () => platformApi.getEnabledModules(), retry: false, staleTime: 5 * 60_000 })
  const templates = useQuery({ queryKey: ['document-templates-admin'], queryFn: () => platformApi.listDocumentTemplatesAdmin(), ...pmOpts })
  const policies = useQuery({ queryKey: ['document-type-policies'], queryFn: () => platformApi.listDocumentTypePolicies(), ...pmOpts })
  const pubPolicies = useQuery({ queryKey: ['publication-type-policies'], queryFn: () => platformApi.listPublicationTypePolicies(), ...pmOpts })
  const medPolicies = useQuery({ queryKey: ['med-content-type-policies'], queryFn: () => platformApi.listMedContentTypePolicies(), ...pmOpts })
  const regPolicies = useQuery({ queryKey: ['regulatory-type-policies'], queryFn: () => platformApi.listRegulatoryTypePolicies(), ...pmOpts })
  const ideaPolicies = useQuery({ queryKey: ['ideation-type-policies'], queryFn: () => platformApi.listIdeationTypePolicies(), ...pmOpts })
  const sectionTemplates = useQuery({ queryKey: ['section-templates-approved'], queryFn: () => platformApi.listSectionTemplates(), ...pmOpts })
  const checklists = useQuery({ queryKey: ['checklist-templates'], queryFn: () => documentsApi.listChecklistTemplates(), ...pmOpts })
  const frameworks = useQuery({ queryKey: ['regulatory-frameworks'], queryFn: () => platformApi.listFrameworks(), ...pmOpts })
  return {
    documents:        typeof documents.data === 'number' ? documents.data : undefined,
    'best-practices': Array.isArray(bestPractices.data)
      ? bestPractices.data.filter(i => i.module === 'platform' || !Array.isArray(enabled.data?.modules) || (enabled.data!.modules as string[]).includes(i.module)).length
      : undefined,
    templates:        countOf(templates.data),
    'ai-prompts':     countOf(policies.data?.policies),     // one SME prompt per doc-type policy
    'section-templates': countOf(sectionTemplates.data?.templates),
    // One per template (deliverable + scope), not per version — matches the list, which shows each template's latest version.
    checklists:       Array.isArray(checklists.data) ? new Set(checklists.data.map(c => `${c.deliverableType}|${c.projectId ?? ''}`)).size : undefined,
    'ich-frameworks': countOf(frameworks.data),
    policies:         countOf(policies.data?.policies),
    'publication-policies': countOf(pubPolicies.data?.policies),
    'med-content-policies': countOf(medPolicies.data?.policies),
    'regulatory-policies':  countOf(regPolicies.data?.policies),
    'ideation-policies':    countOf(ideaPolicies.data?.policies),
  }
}

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
  // Until the signed-in user is known, show the two public tabs only and don't redirect anyone.
  const user = usePlatformStore(s => s.currentUser)
  const isPm = usePlatformStore(s => s.hasRole)(['pm'])
  const tabs = tabsFor(isPm)
  const counts = useTabCounts(isPm)

  // A deep link to a tab this user doesn't have goes to Master Documents (no blank page, no error screen).
  if (user && !isPm && !LIBRARY_TAB_SLUGS.includes(activeSlug)) return <Navigate to="/master-library/documents" replace />

  return (
    <MasterLibrarySlotContext.Provider value={headingSlot}>
    <div className="flex h-full min-h-0 flex-col bg-slate-50" data-screen="master-library">
      <header className="relative flex-none border-b border-slate-200 bg-white px-5 pt-4">
        <div ref={setHeadingSlot} data-master-library-heading />
        {/* Scrolls sideways on narrow screens, but never up and down and with no scrollbar showing: the
            active tab's underline used to poke 1px below the strip, which put scroll arrows on its right. */}
        <nav
          className="-mx-5 mt-4 flex items-end gap-0 overflow-x-auto overflow-y-hidden border-b border-slate-200 px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          data-master-library-tabs
        >
          {tabs.map(tab => (
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
              {counts[tab.slug] !== undefined && (
                <>{' '}<span className="font-normal opacity-70" data-tab-count={counts[tab.slug]}>({counts[tab.slug]})</span></>
              )}
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
