'use client'

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
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { LayoutDashboard, Building2, Car, FileText, Settings } from 'lucide-react'

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { label: 'จัดการสถานี', icon: Building2, href: '/stations' },
  { label: 'จัดการยานพาหนะ', icon: Car, href: '/vehicles' },
  { label: 'รายงาน', icon: FileText, href: '/reports' },
  { label: 'ตั้งค่าระบบ', icon: Settings, href: '/settings' },
]

export function AppSidebar() {
  return (
    
    <Sidebar collapsible="icon" style={{ '--sidebar-width-icon': '4rem' } as React.CSSProperties}>
      {/* Logo + app name */}
      <SidebarHeader className="px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="bg-accent flex size-8 shrink-0 items-center justify-center rounded-md">
            {/* your icon here */}
          </div>
          <div className="group-data-[collapsible=icon]:hidden">
            <p className="text-sidebar-foreground text-sm font-semibold">กระทรวงคมนาคม</p>
            <p className="text-sidebar-foreground/60 text-xs">ระบบสิ่งอำนวยความสะดวก</p>
          </div>
        </div>
      </SidebarHeader>

      {/* Nav items */}
      <SidebarContent>
        <SidebarGroup className="px-3 py-2">
          <SidebarGroupLabel className="mb-1">เมนูหลัก</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild tooltip={item.label}>
                    <a href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* User info at bottom */}
      <SidebarFooter className="px-4 py-4">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:hidden">
          <div className="bg-primary size-8 shrink-0 rounded-full" />
          <div>
            <p className="text-sidebar-foreground text-xs font-medium">ผู้บริหาร</p>
            <p className="text-sidebar-foreground/60 text-xs">admin@mot.go.th</p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
