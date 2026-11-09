import { api } from './client'
import type { User } from '@platform/types'
import { applyActiveRole } from '../config/activeRole'

// Password-login profile (POST /auth/password-login → shapeUserForClient).
export interface PasswordLoginUser {
  id: string
  email: string
  name: string
  role: string
  modules: string[]
  tenantId: string | null
  status: string
}

// Every call here answers 401 with a real reason (wrong password, expired
// session) the screen shows, so none of them bounce to the login URL.
const NO_REDIRECT = { on401: 'throw' as const }

export const authApi = {
  login: (body: { email: string; password: string }) =>
    api.post<{ sessionToken: string; requiresMFA: boolean; user: Pick<User, 'id' | 'name' | 'initials' | 'role'> }>('/auth/login', body),
  verifyMFA: (body: { code: string }) =>
    api.post<{ sessionToken: string }>('/auth/mfa', body),
  me: () => api.get<User>('/auth/me').then(u => applyActiveRole(u)),
  logout: () => api.post<void>('/auth/logout', {}, NO_REDIRECT),

  // Password auth (Phase A).
  passwordLogin: (body: { email: string; password: string }) =>
    api.post<{ ok: true; user: PasswordLoginUser; mustChangePassword: boolean }>('/auth/password-login', body, NO_REDIRECT),
  forgotPassword: (email: string) =>
    api.post<{ ok: true; message: string; expiresInMinutes?: number }>('/auth/forgot-password', { email }, NO_REDIRECT),
  resetPassword: (token: string, newPassword: string) =>
    api.post<{ ok: true }>('/auth/reset-password', { token, newPassword }, NO_REDIRECT),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: true }>('/auth/change-password', { currentPassword, newPassword }, NO_REDIRECT),
  // Register from an invite link: set a password, which activates the account.
  // tenantRef: the optional free-text Tenant ID, sent only when entered.
  registerFromInvite: (token: string, name: string, newPassword: string, tenantRef?: string) =>
    api.post<{ ok: true; email: string }>('/auth/invitations/register', { token, name, newPassword, acceptTerms: true, ...(tenantRef && { tenantRef }) }, NO_REDIRECT),
  session: () =>
    api.get<User & { email: string; mustChangePassword?: boolean }>('/auth/me', NO_REDIRECT).then(u => applyActiveRole(u)),
}
