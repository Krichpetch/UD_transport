'use client'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
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

    </Sidebar>
  )
}
