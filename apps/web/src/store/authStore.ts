import { create } from 'zustand'
import type { User } from '@platform/types'

interface AuthStore {
  user: User | null
  isAuthenticated: boolean
  hasMFA: boolean
  hasAcceptedTC: boolean
  login: (user: User) => void
  verifyMFA: () => void
  acceptTC: () => void
  logout: () => void
}

export const useAuthStore = create<AuthStore>(set => ({
  user: null,
  isAuthenticated: false,
  hasMFA: false,
  hasAcceptedTC: false,
  login: (user) => set({ user, isAuthenticated: true }),
  verifyMFA: () => set({ hasMFA: true }),
  acceptTC: () => set({ hasAcceptedTC: true }),
  logout: () => set({ user: null, isAuthenticated: false, hasMFA: false }),
}))
