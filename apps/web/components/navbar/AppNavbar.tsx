'use client'

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '@/components/ui/navigation-menu'
import * as React from 'react'
import { SidebarTrigger } from '../ui/sidebar'

export function AppNavbar() {
  return (
    <div className="border-variant width-full flex items-center justify-between gap-4 px-4 py-4">
      <div className="flex items-center gap-3 px-4 py-4">
        <SidebarTrigger />
        <div className="bg-accent flex size-8 shrink-0 items-center justify-center rounded-md">
          {/* your icon here */}
        </div>
        <div>
          <p className="text-sidebar-secondary text-sm font-semibold">กระทรวงคมนาคม</p>
          <p className="text-sidebar-secondary/60 text-xs">ระบบสิ่งอำนวยความสะดวก</p>
        </div>
      </div>
      <div className="align-center hidden flex-row gap-6 px-4 py-4 md:flex">
        <NavigationMenu className="border-variant">
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Products</NavigationMenuTrigger>
              <NavigationMenuContent>
                <NavigationMenuLink href="/products">Product 1</NavigationMenuLink>
                <NavigationMenuLink href="/products">Product 2</NavigationMenuLink>
              </NavigationMenuContent>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:hidden">
          <div className="bg-primary size-8 shrink-0 rounded-full" />
          <div>
            <p className="text-sidebar-secondary text-xs font-medium">ผู้บริหาร</p>
            <p className="text-sidebar-secondary/60 text-xs">admin@mot.go.th</p>
          </div>
        </div>
      </div>
    </div>
  )
}
