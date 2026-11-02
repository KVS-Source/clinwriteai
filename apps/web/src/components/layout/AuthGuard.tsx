import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useSession } from '../../platform/store'
import { AUTH_BYPASS } from '../../config/auth'

// Auth bypass is env-driven (see config/auth.ts) so cutover can flip per-env
// without a code change. Set VITE_BYPASS_AUTH=false in your `.env.local` to
// walk the real sign-in flow locally.
//
// With bypass off, the API session decides — not in-memory state — so a
// reload keeps you signed in: no session → /sign-in (with return_to), a
// temporary password → /set-password before anything else.
export function AuthGuard({ children }: { children: ReactNode }) {
  const location = useLocation()
  // Wait for /auth/me so role-gated pages never flash for the wrong user.
  const session = useSession()
  if (!session.ready) {
    return <div className="flex h-screen items-center justify-center bg-slate-50 text-[13px] text-slate-500" data-session-loading>Loading your workspace…</div>
  }
  if (!AUTH_BYPASS) {
    if (session.status !== 'signed-in') {
      const returnTo = encodeURIComponent(location.pathname + location.search)
      return <Navigate to={`/sign-in?return_to=${returnTo}`} replace />
    }
    if (session.mustChangePassword) return <Navigate to="/set-password" replace />
  }
  return <>{children}</>
}
