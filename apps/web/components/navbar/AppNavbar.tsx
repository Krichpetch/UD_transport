'use client'

import { SidebarTrigger } from '@/components/ui/sidebar'
import { Bell, Search } from 'lucide-react'
import * as React from 'react'

interface AppNavbarProps {
  title?: string
  subtitle?: string
}

export function AppNavbar({ title, subtitle }: AppNavbarProps) {
  return (
    <header className="border-border bg-card/80 supports-[backdrop-filter]:bg-card/60 sticky top-0 z-30 flex items-center justify-between gap-4 border-b px-4 py-3 backdrop-blur">
      {/* Left: Trigger + Logo */}
      <div className="flex items-center gap-3">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
        <div className="bg-accent flex size-8 shrink-0 items-center justify-center rounded-md">
          {/* your icon here */}
        </div>
        <div className="hidden sm:block">
          <p className="text-foreground text-sm font-semibold">
            {title ?? 'สำนักงานนโยบายและแผนการขนส่งและจราจร '}
          </p>
          <p className="text-muted-foreground text-xs">{subtitle ?? 'ระบบสิ่งอำนวยความสะดวก'}</p>
        </div>
      </div>

      {/* Right: Search + Bell + Admin */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <button className="border-border text-muted-foreground hover:bg-secondary hidden items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors sm:flex">
          <Search size={13} />
          <span className="hidden sm:inline">ค้นหา...</span>
          <kbd className="bg-muted hidden rounded px-1 text-[10px] sm:inline">⌘K</kbd>
        </button>

        {/* Notifications */}
        <button className="border-border text-muted-foreground hover:bg-secondary relative rounded-lg border p-1.5 transition-colors">
          <Bell size={15} />
          <span className="bg-destructive absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full text-[8px] text-white">
            3
          </span>
        </button>
      </div>
    </header>
  )
}
