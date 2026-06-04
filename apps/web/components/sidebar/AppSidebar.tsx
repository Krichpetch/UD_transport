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
  SidebarHeader,
} from '@/components/ui/sidebar'
import { LayoutDashboard, Building2, Car, FileText, Settings, LogOut, User } from 'lucide-react'
import Link from 'next/link'

const navItems = [
  { label: 'Dashboard', labelTh: 'ภาพรวม', icon: LayoutDashboard, href: '/dashboard' },
  { label: 'Stations', labelTh: 'จัดการสถานี', icon: Building2, href: '/stations' },
  // { label: 'Vehicles', labelTh: 'จัดการยานพาหนะ', icon: Car, href: '/vehicles' },
  // { label: 'Reports', labelTh: 'รายงาน', icon: FileText, href: '/reports' },
  { label: 'Settings', labelTh: 'ตั้งค่าระบบ', icon: Settings, href: '/settings' },
]

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon" style={{ '--sidebar-width-icon': '4rem' } as React.CSSProperties}>
      {/* Nav */}
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
    </Sidebar>
  )
}
