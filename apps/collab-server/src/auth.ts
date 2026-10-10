// Session auth — Phase 2.3.3.
//
// The sidecar validates the session cookie by calling the API's
// /auth/me endpoint with the cookie forwarded verbatim. Keeps the
// sidecar from needing the JWT secret or Prisma access — it just
// trusts the API to make the real decision.
//
// Fail-closed: any non-200 response → reject the connection.

export interface SessionIdentity {
  userId: string
  name:   string
  email:  string
}

export async function verifySession(apiBaseUrl: string, sessionToken: string): Promise<SessionIdentity> {
  const url = `${apiBaseUrl.replace(/\/$/, '')}/auth/me`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      // Replay the session cookie back to the API; it uses that to
      // identify the user via the same middleware that gates every
      // other authenticated route.
      cookie: `aurora_session=${sessionToken}`,
      accept: 'application/json',
    },
  })
  if (res.status !== 200) {
    throw new Error(`auth/me returned ${res.status}`)
  }
  const body = await res.json() as { id?: string; name?: string; email?: string }
  if (!body.id) throw new Error('auth/me response missing user id')
  return {
    userId: body.id,
    name:   body.name  ?? body.email ?? body.id,
    email:  body.email ?? '',
  }
}
