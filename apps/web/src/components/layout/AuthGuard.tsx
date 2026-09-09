import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store'

// BYPASS_AUTH_IN_PROTOTYPE: set true so all screens are accessible without login.
// Remove this flag when real auth is implemented in Phase 2.
const BYPASS_AUTH_IN_PROTOTYPE = true

export function AuthGuard({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  if (!isAuthenticated && !BYPASS_AUTH_IN_PROTOTYPE) {
    return <Navigate to="/sign-in" replace />
  }
  return <>{children}</>
}
