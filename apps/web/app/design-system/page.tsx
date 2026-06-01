import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/sidebar/AppSidebar'
import { AppNavbar } from '@/components/navbar/AppNavbar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'

// A scratchpad page showing all your components in one place
export default function DesignSystem() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <div className="flex min-h-screen w-full flex-col">
          <AppNavbar />
          <div className="w-full space-y-8 p-8">
            <section className="space-y-4">
              <div className="bg-primary flex w-full items-center gap-4 rounded p-4">
                <h2 className="text-primary-foreground text-lg font-semibold">Buttons</h2>
              </div>

              <div className="flex items-center gap-4">
                <Button variant="default">Button</Button>
                <Button variant="outline">Button</Button>
                <Button variant="ghost">Button</Button>
              </div>
            </section>
            <section>
              <h2>Badges</h2>
              {/* status badges */}
            </section>
          </div>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}
