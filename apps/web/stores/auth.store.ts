import { create } from 'zustand'
import type { UserRole } from '@repo/types'

export interface AuthUser {
  id: string
  username: string
  role: UserRole
  displayName?: string | null
  // UDT-53 — true when this ADMIN is a "sys admin" (governs user management). Drives the /users
  // page gating; the API is still the real authority.
  isSuperAdmin?: boolean
}

// In-memory only. The JWT now lives in an httpOnly cookie (invisible to JS), so
// this store no longer holds a token or persists to web storage. `user` is
// rehydrated on every page load by AuthBootstrap via GET /api/auth/me.
interface AuthState {
  user: AuthUser | null
  // false until the /auth/me bootstrap has resolved. Guards wait on this so they
  // don't flash-redirect a logged-in user before their session is known.
  ready: boolean
  setUser: (user: AuthUser | null) => void
  setReady: (ready: boolean) => void
  login: (user: AuthUser) => void
  logout: () => void
  updateUser: (patch: Partial<AuthUser>) => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  ready: false,
  setUser: (user) => set({ user }),
  setReady: (ready) => set({ ready }),
  login: (user) => set({ user }),
  logout: () => set({ user: null }),
  updateUser: (patch) => set((s) => (s.user ? { user: { ...s.user, ...patch } } : s)),
}))
