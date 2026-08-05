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
import { LayoutDashboard, BarChart3, Building2, Settings, LogOut, User, Users, ClipboardCheck, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth.store'
import type { UserRole } from '@repo/types'

const ROLE_LABEL: Record<string, string> = {
  ADMIN:     'ผู้ดูแลระบบ',
  AUDITOR:   'ผู้ตรวจสอบ',
  EXECUTIVE: 'ผู้บริหาร',
}

// Role-driven nav — each item declares which roles see it, rather than one hardcoded
// "ADMIN gets an extra item" ternary. /stations (and its checklist detail page) carry full
// mutating controls (approve/reject/edit/import), so they're ADMIN-only here; EXECUTIVE keeps
// the read-only /dashboard as their home instead of the admin operational overview.
//
// Session F3, Part F — "เอาหน้า Dashboard ของ Executive มาใส่ให้ Admin ด้วย" (สนข. 2026-08-03).
// ADMIN now sees the SAME /dashboard entry, not a fork of it: the page, its guards and its three
// backing endpoints (/stations/summary, /stations/metrics, /stations/map-nodes) already admitted
// ADMIN — this was purely a nav-visibility gap. /admin/overview stays ADMIN's login landing
// (ROLE_DESTINATIONS unchanged); the dashboard is an ADDITIONAL entry, not a replacement, so the
// two are relabelled to tell them apart (both used to read plain "ภาพรวม").
const NAV_ITEMS: { labelTh: string; icon: LucideIcon; href: string; roles: UserRole[] }[] = [
  { labelTh: 'ภาพรวมระบบ',     icon: LayoutDashboard, href: '/admin/overview',  roles: ['ADMIN'] },
  { labelTh: 'แดชบอร์ดผู้บริหาร', icon: BarChart3,       href: '/dashboard',       roles: ['ADMIN', 'EXECUTIVE'] },
  { labelTh: 'จัดการสถานี',    icon: Building2,       href: '/stations',        roles: ['ADMIN'] },
  { labelTh: 'จัดการแบบประเมิน', icon: ClipboardCheck,  href: '/admin/templates', roles: ['ADMIN'] },
  { labelTh: 'จัดการผู้ใช้งาน', icon: Users,           href: '/users',           roles: ['ADMIN'] },
  { labelTh: 'ตั้งค่าระบบ',     icon: Settings,        href: '/settings',       roles: ['ADMIN', 'EXECUTIVE'] },
]

export function AppSidebar() {
  const router = useRouter()
  const { user, logout } = useAuthStore()
  const items = NAV_ITEMS.filter((item) => !!user && item.roles.includes(user.role))

  function handleLogout() {
    logout()
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
              {items.map((item) => (
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
              <p className="text-sidebar-foreground truncate text-xs font-medium">{user?.displayName || user?.username || '—'}</p>
              <p className="text-sidebar-foreground/60 truncate text-[10px]">{ROLE_LABEL[user?.role ?? ''] ?? ''}</p>
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
