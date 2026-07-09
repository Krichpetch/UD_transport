'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Settings, LogOut } from 'lucide-react'
import { useAuthStore, useAuthHasHydrated } from '@/stores/auth.store'

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const hydrated = useAuthHasHydrated()
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  React.useEffect(() => {
    if (hydrated && !token) router.replace('/login')
  }, [hydrated, token, router])

  function handleLogout() {
    logout()
    router.push('/login')
  }

  if (!hydrated || !token) return null

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <header className="border-border bg-card/80 supports-[backdrop-filter]:bg-card/60 sticky top-0 z-30 flex items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <p className="text-foreground truncate text-sm font-semibold">{user?.username ?? '-'}</p>
          <p className="text-muted-foreground text-xs">ผู้ตรวจสอบ</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link
            href="/settings"
            title="บัญชีของฉัน"
            className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded-lg border p-1.5 transition-colors"
          >
            <Settings size={15} />
          </Link>
          <button
            onClick={handleLogout}
            title="ออกจากระบบ"
            className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded-lg border p-1.5 transition-colors"
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>
    </div>
  )
}
