'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppSidebar } from '@/components/sidebar/AppSidebar'
import { AppNavbar } from '@/components/navbar/AppNavbar'
import { RequireRole } from '@/components/auth/require-role'
import { useAuthStore, useAuthHasHydrated } from '@/stores/auth.store'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const hydrated = useAuthHasHydrated()
  const token = useAuthStore((s) => s.token)

  React.useEffect(() => {
    if (hydrated && !token) router.replace('/login')
  }, [hydrated, token, router])

  if (!hydrated || !token) return null

  return (
    <RequireRole roles={['ADMIN', 'EXECUTIVE', 'REVIEWER']} redirectTo="/audit">
      <TooltipProvider>
        <SidebarProvider style={{ '--sidebar-width-icon': '4rem' } as React.CSSProperties}>
          <AppSidebar />
          <div className="flex min-h-screen w-full min-w-0 flex-col">
            <AppNavbar />
            {/* min-w-0 — without it, a flex child that doesn't shrink (e.g. an unbroken row of
                text/badges somewhere in `children`) forces this whole column wider than the
                viewport, which cascades up into the sidebar+main flex row and scrolls the ENTIRE
                page horizontally rather than just the offending element. */}
            <main className="min-w-0 flex-1 p-6">
              {children}
            </main>
          </div>
        </SidebarProvider>
      </TooltipProvider>
    </RequireRole>
  )
}