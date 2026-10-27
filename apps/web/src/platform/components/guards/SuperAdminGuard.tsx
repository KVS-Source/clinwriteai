// SuperAdminGuard — wraps sPM05, sPM12, sPM18 (platform-ops screens).
// After the 2026-10-27 role consolidation, "super admin" is spelled
// 'admin' + tenantId=null (platform admin). GenBioCa-internal operators
// are the only ones with tenantId=null; tenant-scoped admins (and any
// client user) fail the check and bounce to /home.
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { usePlatformStore } from '../../store'

// Enforced: the signed-in user's role (from /auth/me) now decides access.
const BYPASS_ROLE_GUARD_IN_PROTOTYPE = false

export function SuperAdminGuard({ children }: { children: ReactNode }) {
  const currentUser = usePlatformStore(s => s.currentUser)
  const allowed     = currentUser.role === 'admin' && currentUser.tenantId == null

  if (!allowed && !BYPASS_ROLE_GUARD_IN_PROTOTYPE) {
    return <Navigate to="/home" replace />
  }

  return (
    <div data-guard="platform-admin" data-guard-role={currentUser.role}>
      {children}
    </div>
  )
}
