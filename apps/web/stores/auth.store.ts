import * as React from 'react'
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

// sessionStorage rehydration happens after mount — without this, a guard that
// checks `token` on first render would flash-redirect a logged-in user on refresh.
// `.persist` is only touched inside the effect: during SSR, createJSONStorage()
// throws (no sessionStorage in Node) so zustand never attaches `.persist` at all.
export function useAuthHasHydrated() {
  const [hydrated, setHydrated] = React.useState(false)

  React.useEffect(() => {
    setHydrated(useAuthStore.persist.hasHydrated())
    return useAuthStore.persist.onFinishHydration(() => setHydrated(true))
  }, [])

  return hydrated
}
