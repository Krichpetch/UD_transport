'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore, useAuthHasHydrated } from '@/stores/auth.store'

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const hydrated = useAuthHasHydrated()
  const token = useAuthStore((s) => s.token)

  React.useEffect(() => {
    if (hydrated && !token) router.replace('/login')
  }, [hydrated, token, router])

  if (!hydrated || !token) return null

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>
    </div>
  )
}
