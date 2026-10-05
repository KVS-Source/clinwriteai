import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store'

// Auth bypass is now env-driven so cutover can flip per-env without a
// code change. Default-true for dev (keeps the prototype usable without
// an IdP), default-false in prod builds. Set VITE_BYPASS_AUTH=false in
// your `.env.local` to walk the real sign-in flow locally.
//
// The MODE check is Vite's built-in `import.meta.env.MODE` (set to
// 'production' by vite build). We only trust the explicit env var if
// it's set; otherwise the mode gate decides.
const bypassFlag = (import.meta.env.VITE_BYPASS_AUTH as string | undefined)?.toLowerCase()
const BYPASS_AUTH =
  bypassFlag === 'false' ? false
    : bypassFlag === 'true' ? true
      : import.meta.env.MODE !== 'production'

export function AuthGuard({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  if (!isAuthenticated && !BYPASS_AUTH) {
    return <Navigate to="/sign-in" replace />
  }
  return <>{children}</>
}
