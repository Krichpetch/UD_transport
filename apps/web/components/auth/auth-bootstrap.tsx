'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { getMe } from '@/lib/api/auth'
import { useAuthStore } from '@/stores/auth.store'
import { subscribeAuthBroadcast } from '@/lib/auth-broadcast'

// Mounted once at the app root. Two jobs:
//  1. Recover the session from the httpOnly cookie on load — so a freshly opened
//     tab knows who it's logged in as (this is the UDT-47 cross-tab fix). Sets the
//     `ready` flag guards wait on.
//  2. Live cross-tab sync: when another tab logs in or out, mirror it here.
export function AuthBootstrap() {
  const router = useRouter()
  const setUser = useAuthStore((s) => s.setUser)
  const setReady = useAuthStore((s) => s.setReady)

  React.useEffect(() => {
    let active = true
    getMe()
      .then((user) => { if (active) setUser(user) })
      .catch(() => { if (active) setUser(null) })
      .finally(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [setUser, setReady])

  React.useEffect(() => {
    return subscribeAuthBroadcast((msg) => {
      if (msg.type === 'logout') {
        setUser(null)
        router.replace('/login')
      } else {
        setUser(msg.user)
        router.refresh()
      }
    })
  }, [router, setUser])

  return null
}
