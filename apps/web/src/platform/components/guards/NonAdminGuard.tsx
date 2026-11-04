// NonAdminGuard — the inverse of AdminGuard: wraps project screens, which admins
// must not view. Their domain is users, audit and settings, so they land on
// their home page instead (including the app's redirects to /projects after
// onboarding, T&C and unknown URLs, and a persona switch on a project page).
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { usePlatformStore } from '../../store'
import { isAdminRole } from '../../../config/roles'

export function NonAdminGuard({ children }: { children: ReactNode }) {
  const role = usePlatformStore(s => s.currentUser.role)
  if (isAdminRole(role)) return <Navigate to="/home" replace />
  return <>{children}</>
}
