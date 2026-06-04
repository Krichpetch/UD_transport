import * as React from 'react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppSidebar } from '@/components/sidebar/AppSidebar'
import { AppNavbar } from '@/components/navbar/AppNavbar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider style={{ '--sidebar-width-icon': '4rem' } as React.CSSProperties}>
        <AppSidebar />
        <div className="flex min-h-screen w-full flex-col">
          <AppNavbar />
          <main className="flex-1 p-6">
            {children}
          </main>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}