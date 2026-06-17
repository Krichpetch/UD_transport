import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { UserRole } from '@repo/types'

export interface AuthUser {
  id: string
  username: string
  role: UserRole
}

interface AuthState {
  user: AuthUser | null
  token: string | null
  login: (user: AuthUser, token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      login:  (user, token) => set({ user, token }),
      logout: () => set({ user: null, token: null }),
    }),
    {
      name:    'auth',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
)
