import type { AuthUser } from '@/stores/auth.store'

// Cross-tab auth sync. An httpOnly cookie can't be watched via the `storage`
// event (that only fires for localStorage), so login/logout in one tab is
// announced to the others over a same-origin BroadcastChannel instead.
export type AuthBroadcast =
  | { type: 'login'; user: AuthUser }
  | { type: 'logout' }

const CHANNEL = 'ud-auth'

export function postAuthBroadcast(msg: AuthBroadcast): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return
  const bc = new BroadcastChannel(CHANNEL)
  bc.postMessage(msg)
  bc.close()
}

export function subscribeAuthBroadcast(handler: (msg: AuthBroadcast) => void): () => void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return () => {}
  const bc = new BroadcastChannel(CHANNEL)
  bc.onmessage = (e: MessageEvent<AuthBroadcast>) => handler(e.data)
  return () => bc.close()
}
