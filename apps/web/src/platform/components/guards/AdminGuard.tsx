// AdminGuard — wraps sPM04, sPM06, sPM07, sPM13, sPM15, sPM17.
// Checks currentUser.role client-side (no API call, per brief §7).
// Prototype mode allows all roles through with a visible dev banner.
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { usePlatformStore } from '../../store'

const BYPASS_ROLE_GUARD_IN_PROTOTYPE = true

export function AdminGuard({ children }: { children: ReactNode }) {
  const currentUser = usePlatformStore(s => s.currentUser)
  const allowed     = currentUser.role === 'admin' || currentUser.role === 'super-admin'

  if (!allowed && !BYPASS_ROLE_GUARD_IN_PROTOTYPE) {
    return <Navigate to="/projects" replace />
  }

  return (
    <div data-guard="admin" data-guard-role={currentUser.role}>
      {children}
    </div>
  )
}
