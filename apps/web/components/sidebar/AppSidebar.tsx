'use client'

import * as React from 'react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
} from '@/components/ui/sidebar'
import { LayoutDashboard, Building2, Settings, LogOut, User } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const navItems = [
  { labelTh: 'ภาพรวม', icon: LayoutDashboard, href: '/dashboard' },
  { labelTh: 'จัดการสถานี', icon: Building2, href: '/stations' },
  { labelTh: 'ตั้งค่าระบบ', icon: Settings, href: '/settings' },
]

export function AppSidebar() {
  const router = useRouter()

  function handleLogout() {
    // Phase 2: clear JWT / session cookie here before redirecting
    router.push('/login')
  }

  return (
    <Sidebar collapsible="icon" style={{ '--sidebar-width-icon': '4rem' } as React.CSSProperties}>
      {/* ── Nav ── */}
      <SidebarContent>
        <SidebarGroup className="px-2 py-2">
          <SidebarGroupLabel className="text-sidebar-foreground/50 mb-1 text-[10px] tracking-widest uppercase group-data-[collapsible=icon]:hidden">
            เมนูหลัก
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild tooltip={item.labelTh} className="rounded-lg">
                    <Link href={item.href}>
                      <item.icon size={18} />
                      <span>{item.labelTh}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* ── Footer: user profile + logout ── */}
      <SidebarFooter className="px-2 py-3">
        <div className="border-sidebar-border border-t pt-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="bg-sidebar-accent flex size-8 shrink-0 items-center justify-center rounded-full">
              <User size={14} className="text-sidebar-foreground" />
            </div>
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <p className="text-sidebar-foreground truncate text-xs font-medium">ผู้บริหาร</p>
              <p className="text-sidebar-foreground/60 truncate text-[10px]">admin@mot.go.th</p>
            </div>
            <button
              onClick={handleLogout}
              title="ออกจากระบบ"
              className="text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-md p-1.5 transition-colors group-data-[collapsible=icon]:hidden"
            >
              <LogOut size={14} />
            </button>
          </div>

          {/* Collapsed state — show logout icon directly */}
          <div className="hidden justify-center pt-1 group-data-[collapsible=icon]:flex">
            <button
              onClick={handleLogout}
              title="ออกจากระบบ"
              className="text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-md p-1.5 transition-colors"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
