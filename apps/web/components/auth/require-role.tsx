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

// Client-side defense-in-depth only — the API is the real boundary. Mirrors the /users
// page's original inline guard exactly: `user` is null until the auth store's sessionStorage
// rehydration finishes, so the `user &&` check below is naturally false pre-hydration —
// no separate hydrated flag needed, no redirect-flash before the token loads.
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
