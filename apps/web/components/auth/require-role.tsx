'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'
import type { UserRole } from '@repo/types'

interface RequireRoleProps {
  roles: readonly UserRole[]
  redirectTo?: string
  fallback?: React.ReactNode
  children: React.ReactNode
}

// Client-side defense-in-depth only — the API (and now middleware.ts) are the real
// boundaries. `user` is null until AuthBootstrap's /auth/me call resolves, so the
// `user &&` check below is naturally false pre-bootstrap — no separate ready flag
// needed here, no redirect-flash before the session is known.
export function RequireRole({ roles, redirectTo = '/dashboard', fallback = null, children }: RequireRoleProps) {
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const blocked = !!user && !roles.includes(user.role)

  React.useEffect(() => {
    if (blocked) router.replace(redirectTo)
  }, [blocked, redirectTo, router])

  if (blocked) return <>{fallback}</>
  return <>{children}</>
}
