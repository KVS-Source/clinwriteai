// Fetch wrapper used by every data hook.
//
// Base URL:
//   VITE_API_URL points at the real API (e.g. https://api.clinwrite.ai).
//   When unset, we fall back to the same origin so MSW can intercept — the
//   prototype dev experience is unchanged.
//
// Auth:
//   `credentials: 'include'` makes the aurora_session cookie travel on every
//   cross-origin request. The API enforces SameSite=Lax, HttpOnly, Secure in
//   production, so we never touch the raw token from JS. 401 responses bounce
//   the user to the login URL (VITE_AUTH_LOGIN_URL, default `${API}/auth/login`).

const API_BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')
// `||` not `??`: a blank VITE_AUTH_LOGIN_URL= line in .env.local comes through
// as '' and must fall back to the default (otherwise location.assign('')
// just reloads the current page).
const LOGIN_URL =
  (import.meta.env.VITE_AUTH_LOGIN_URL as string | undefined) || `${API_BASE}/auth/login`

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

// Dev/demo only: when a persona was picked from the top-bar "Switch persona"
// menu, tell the API so the data matches the persona on screen. The API
// honours X-Demo-Persona when AUTH_BYPASS_EMAIL is set (dev + demo). The
// value is the demo user id (e.g. 'user-sa'); the API accepts either an id
// or an email. The seeded User rows include ids for the PLATFORM_DEMO_USERS
// personas so the lookup resolves to the right role.
const PERSONA_STORAGE_KEY = 'clinwrite.demo.currentUserId'
// A demo build (VITE_BYPASS_AUTH=true) is a production-mode build too, so the
// header must still go out there or the API resolves a different user than
// the one on screen (e.g. UI says Super Admin, API says admin → 403).
const BYPASS_AUTH = (import.meta.env.VITE_BYPASS_AUTH as string | undefined)?.toLowerCase() === 'true'
function demoPersonaHeader(): Record<string, string> {
  if (import.meta.env.MODE === 'production' && !BYPASS_AUTH) return {}
  try {
    const id = window.localStorage.getItem(PERSONA_STORAGE_KEY)
    return id ? { 'X-Demo-Persona': id } : {}
  } catch { return {} }
}

async function request<T>(endpoint: string, options?: RequestOptions): Promise<T> {
  const { on401 = 'redirect', ...init } = options ?? {}
  const res = await fetch(`${API_BASE}${endpoint}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...demoPersonaHeader(),
      ...(init.headers ?? {}),
    },
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

// Binary download through the same auth path as every other call (session cookie,
// demo-persona header, 401 handling). Throws ApiError with the server's JSON body
// on failure, so callers can show the real reason ("file_missing", "quarantined"...).
async function download(endpoint: string, options?: Pick<RequestOptions, 'on401'>): Promise<{ blob: Blob; filename: string | null }> {
  const { on401 = 'throw' } = options ?? {}
  const res = await fetch(`${API_BASE}${endpoint}`, { credentials: 'include', headers: { ...demoPersonaHeader() } })
  if (res.status === 401 && on401 === 'redirect' && typeof window !== 'undefined') {
    window.location.assign(`${LOGIN_URL}?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`)
    throw new ApiError(401, null)
  }
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null))
  const cd = res.headers.get('content-disposition') ?? ''
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  const plain = /filename="([^"]*)"/i.exec(cd)
  let filename: string | null = null
  try { filename = utf8 ? decodeURIComponent(utf8[1]!) : (plain?.[1] ?? null) } catch { filename = plain?.[1] ?? null }
  return { blob: await res.blob(), filename }
}

export const api = {
  get:    <T>(endpoint: string, options?: RequestOptions)                => request<T>(endpoint, options),
  post:   <T>(endpoint: string, body: unknown, options?: RequestOptions) => request<T>(endpoint, { ...options, method: 'POST',  body: JSON.stringify(body) }),
  patch:  <T>(endpoint: string, body: unknown, options?: RequestOptions) => request<T>(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
  put:    <T>(endpoint: string, body: unknown, options?: RequestOptions) => request<T>(endpoint, { ...options, method: 'PUT',   body: JSON.stringify(body) }),
  delete: <T>(endpoint: string, options?: RequestOptions)                => request<T>(endpoint, { ...options, method: 'DELETE' }),
  download,
}

export const apiConfig = {
  baseUrl: API_BASE,
  loginUrl: LOGIN_URL,
}
