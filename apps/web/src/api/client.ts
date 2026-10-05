// Fetch wrapper used by every data hook.
//
// Base URL:
//   VITE_API_URL points at the real API (e.g. https://qa-api.clinwrite.ai).
//   When unset, we fall back to the same origin so MSW can intercept — the
//   prototype dev experience is unchanged.
//
// Auth:
//   `credentials: 'include'` makes the aurora_session cookie travel on every
//   cross-origin request. The API enforces SameSite=Lax, HttpOnly, Secure in
//   production, so we never touch the raw token from JS. 401 responses bounce
//   the user to the login URL (VITE_AUTH_LOGIN_URL, default `${API}/auth/login`).

const API_BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')
const LOGIN_URL =
  (import.meta.env.VITE_AUTH_LOGIN_URL as string | undefined) ?? `${API_BASE}/auth/login`

// A caller can opt out of the auto-redirect for a specific request — useful
// when a route needs to render its own "please log in" UI instead of leaving
// the SPA entirely (e.g. gated preview panels).
export interface RequestOptions extends RequestInit {
  on401?: 'redirect' | 'throw'
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API error ${status}`)
  }
}

async function request<T>(endpoint: string, options?: RequestOptions): Promise<T> {
  const { on401 = 'redirect', ...init } = options ?? {}
  const res = await fetch(`${API_BASE}${endpoint}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  })

  if (res.status === 401 && on401 === 'redirect' && typeof window !== 'undefined') {
    // Preserve where the user was heading so we can bounce them back post-login.
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
    window.location.assign(`${LOGIN_URL}?return_to=${returnTo}`)
    // Give the navigation time to kick in before throwing — avoids a flash of
    // broken UI reacting to the rejection.
    await new Promise(resolve => setTimeout(resolve, 100))
    throw new ApiError(401, null)
  }

  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null))

  // 204 No Content paths skip the parse so TypeScript's `T` can be `void`.
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get:    <T>(endpoint: string, options?: RequestOptions)                => request<T>(endpoint, options),
  post:   <T>(endpoint: string, body: unknown, options?: RequestOptions) => request<T>(endpoint, { ...options, method: 'POST',  body: JSON.stringify(body) }),
  patch:  <T>(endpoint: string, body: unknown, options?: RequestOptions) => request<T>(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
  put:    <T>(endpoint: string, body: unknown, options?: RequestOptions) => request<T>(endpoint, { ...options, method: 'PUT',   body: JSON.stringify(body) }),
  delete: <T>(endpoint: string, options?: RequestOptions)                => request<T>(endpoint, { ...options, method: 'DELETE' }),
}

export const apiConfig = {
  baseUrl: API_BASE,
  loginUrl: LOGIN_URL,
}
