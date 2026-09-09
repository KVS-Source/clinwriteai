import { api } from './client'
import type { User } from '@platform/types'

export const authApi = {
  login: (body: { email: string; password: string }) =>
    api.post<{ sessionToken: string; requiresMFA: boolean; user: Pick<User, 'id' | 'name' | 'initials' | 'role'> }>('/auth/login', body),
  verifyMFA: (body: { code: string }) =>
    api.post<{ sessionToken: string }>('/auth/mfa', body),
  me: () => api.get<User>('/auth/me'),
  logout: () => api.post<void>('/auth/logout', {}),
}
