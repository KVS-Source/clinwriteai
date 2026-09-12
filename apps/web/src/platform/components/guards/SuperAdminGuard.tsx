// SuperAdminGuard — wraps sPM05, sPM12, sPM18.
// Only Super Admin (GenBioCa-internal) may pass. Client Admins are redirected.
// Prototype mode allows all roles through with a visible dev banner.
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { usePlatformStore } from '../../store'

const BYPASS_ROLE_GUARD_IN_PROTOTYPE = true

export function SuperAdminGuard({ children }: { children: ReactNode }) {
  const currentUser = usePlatformStore(s => s.currentUser)
  const allowed     = currentUser.role === 'super-admin'

  if (!allowed && !BYPASS_ROLE_GUARD_IN_PROTOTYPE) {
    return <Navigate to="/projects" replace />
  }

  return (
    <div data-guard="super-admin" data-guard-role={currentUser.role}>
      {children}
    </div>
  )
}
