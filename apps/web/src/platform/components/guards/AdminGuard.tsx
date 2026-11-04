// AdminGuard — wraps sPM04, sPM06, sPM07, sPM13, sPM15, sPM17.
// Checks currentUser.role client-side (no API call, per brief §7).
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { usePlatformStore } from '../../store'
import { isAdminRole } from '../../../config/roles'

// Enforced: the signed-in user's role (from /auth/me) now decides access.
const BYPASS_ROLE_GUARD_IN_PROTOTYPE = false

export function AdminGuard({ children, allowPm }: { children: ReactNode; allowPm?: boolean }) {
  const currentUser = usePlatformStore(s => s.currentUser)
  const allowed     = isAdminRole(currentUser.role) || (!!allowPm && currentUser.role === 'pm')

  if (!allowed && !BYPASS_ROLE_GUARD_IN_PROTOTYPE) {
    return <Navigate to="/home" replace />
  }

  return (
    <div data-guard="admin" data-guard-role={currentUser.role}>
      {children}
    </div>
  )
}
