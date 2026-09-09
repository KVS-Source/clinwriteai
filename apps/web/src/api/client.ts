const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api'

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API error ${status}`)
  }
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null))
  return res.json() as Promise<T>
}

export const api = {
  get:    <T>(endpoint: string)                => request<T>(endpoint),
  post:   <T>(endpoint: string, body: unknown) => request<T>(endpoint, { method: 'POST',  body: JSON.stringify(body) }),
  patch:  <T>(endpoint: string, body: unknown) => request<T>(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(endpoint: string)                => request<T>(endpoint, { method: 'DELETE' }),
}
