import { logout as apiLogout } from '@/lib/api/auth'
import { useAuthStore } from '@/stores/auth.store'
import { postAuthBroadcast } from '@/lib/auth-broadcast'

// Ends the session everywhere: clears the server-side httpOnly cookie, wipes the
// in-memory user, and tells other tabs to log out too. Callers redirect to /login
// afterward. Local state is dropped even if the network call fails.
export async function signOut(): Promise<void> {
  try {
    await apiLogout()
  } catch {
    // ignore — still clear local state + notify other tabs below
  }
  useAuthStore.getState().logout()
  postAuthBroadcast({ type: 'logout' })
}
