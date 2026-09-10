import { Outlet, useLocation } from 'react-router-dom'
import { TopNav }  from './TopNav'
import { Sidebar } from './Sidebar'

const MODULES = ['clinical-writing', 'scientific-writing', 'medical-writing', 'regulatory-writing', 'ideation-publishing']

function useActiveModule(): string {
  const { pathname } = useLocation()
  return MODULES.find(m => pathname.includes(m)) ?? 'clinical-writing'
}

export function AppShell() {
  const activeModule = useActiveModule()

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar activeModule={activeModule} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNav />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
