import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { TopNav }  from './TopNav'
import { Sidebar } from './Sidebar'
import { useDocumentStore } from '../../store'

const MODULES = ['clinical-writing', 'scientific-writing', 'medical-writing', 'regulatory-writing', 'ideation-publishing']
const PLATFORM_ROUTES = ['/admin', '/super-admin', '/library', '/notifications', '/reports', '/services']

function useActiveModule(): string {
  const { pathname } = useLocation()
  if (PLATFORM_ROUTES.some(p => pathname === p || pathname.startsWith(p + '/'))) return 'platform'
  return MODULES.find(m => pathname.includes(m)) ?? 'clinical-writing'
}

/** True when the user is inside a document editor (any module's deep-link
 *  to an individual document). We shrink the left nav to an icon rail on
 *  these pages so the content pane has maximum room. */
function useAutoCollapsed(): boolean {
  const { pathname } = useLocation()
  return /\/documents\/[^/]+/.test(pathname)
}

// The user's choice survives reloads; it is only a convenience, so storage failures are ignored.
const STORAGE_KEY = 'clinwrite.sidebar.editorOpen'
const readPref = (): boolean | null => {
  try { const v = window.localStorage.getItem(STORAGE_KEY); return v === null ? null : v === '1' } catch { return null }
}
const writePref = (open: boolean) => {
  try { window.localStorage.setItem(STORAGE_KEY, open ? '1' : '0') } catch { /* ignore */ }
}

export function AppShell() {
  const activeModule  = useActiveModule()
  const autoCollapsed = useAutoCollapsed()
  const { pathname }  = useLocation()

  // Inside an editor the rail is the default, and the arrow opens the full navigation (all modules).
  // Outside an editor the sidebar is open by default and the arrow collapses it. A choice made in
  // one place doesn't carry into the other: the editor remembers its own, other pages reset.
  const [editorOpen, setEditorOpen] = useState<boolean | null>(readPref)
  const [pageCollapsed, setPageCollapsed] = useState(false)
  useEffect(() => { setPageCollapsed(false) }, [autoCollapsed])

  const collapsed = autoCollapsed ? !(editorOpen ?? false) : pageCollapsed
  const toggle = () => {
    if (autoCollapsed) { const next = !(editorOpen ?? false); setEditorOpen(next); writePref(next) }
    else setPageCollapsed(c => !c)
  }

  // ⌘J / Ctrl+J — toggle the AI Chat panel. The EditorToolbar advertises
  // this shortcut via its ⌘J kbd tag; this is where it's actually wired.
  //
  // Mounted at AppShell (always alive) rather than inside DocumentEditor so
  // the keystroke isn't lost on the first-ever press on a cold page load, or
  // if the editor hasn't mounted yet. useCapture=true runs us BEFORE any
  // child's keydown handler could stopPropagation() us. e.code='KeyJ' is
  // keyboard-layout independent — e.key could be anything on non-QWERTY
  // layouts. preventDefault blocks Chrome's Downloads-panel binding.
  const activePanel    = useDocumentStore(s => s.activePanel)
  const setActivePanel = useDocumentStore(s => s.setActivePanel)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      if (e.code !== 'KeyJ') return
      // Only act on document editor pages. On home/dashboard/list pages
      // there's no AI panel to toggle, so swallow the key as a no-op
      // instead of fighting the browser's Downloads shortcut for nothing.
      if (!/\/documents\/[^/]+/.test(pathname)) return
      e.preventDefault()
      setActivePanel(activePanel === 'ai' ? null : 'ai')
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true } as EventListenerOptions)
  }, [activePanel, setActivePanel, pathname])

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar activeModule={activeModule} collapsed={collapsed} onToggle={toggle} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNav />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
