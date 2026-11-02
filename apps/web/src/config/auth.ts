// Auth mode for the SPA.
//
// AUTH_BYPASS — no sign-in: the API's AUTH_BYPASS_EMAIL resolves every
// request and the top bar offers the demo persona switcher. Env-driven so
// each deployment flips it without a code change: VITE_BYPASS_AUTH=true /
// false wins; unset means bypass in dev and real sign-in in production.
//
// With bypass off, AuthGuard sends anyone without a session to /sign-in
// (password login) and anyone on a temporary password to /set-password.
const bypassFlag = (import.meta.env.VITE_BYPASS_AUTH as string | undefined)?.toLowerCase()

export const AUTH_BYPASS =
  bypassFlag === 'false' ? false
    : bypassFlag === 'true' ? true
      : import.meta.env.MODE !== 'production'

// Screens reachable without a session. API 401s on these never bounce to the
// login URL (that would loop on the sign-in page itself).
export const PUBLIC_AUTH_PATHS = ['/sign-in', '/forgot-password', '/reset-password', '/accept-invitation']

/** A same-site path to return to after sign-in, or null for anything else. */
export function safeReturnTo(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null
  if (PUBLIC_AUTH_PATHS.some(p => raw === p || raw.startsWith(`${p}?`)) || raw.startsWith('/set-password')) return null
  return raw
}
