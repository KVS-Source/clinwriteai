import { Outlet, useLocation } from 'react-router-dom'
import { TopNav }  from './TopNav'
import { Sidebar } from './Sidebar'

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
function useSidebarCollapsed(): boolean {
  const { pathname } = useLocation()
  return /\/documents\/[^/]+/.test(pathname)
}

export function AppShell() {
  const activeModule = useActiveModule()
  const collapsed    = useSidebarCollapsed()

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar activeModule={activeModule} collapsed={collapsed} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNav />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
