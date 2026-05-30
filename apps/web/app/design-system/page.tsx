import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Sidebar } from '@/components/ui/sidebar'

// A scratchpad page showing all your components in one place
export default function DesignSystem() {
  return (
    <SidebarProvider>
      <Sidebar />
      <div className="space-y-8 p-8">
        <SidebarTrigger />

        <section>
          <h2>Buttons</h2>
          {/* render your variants here */}
        </section>
        <section>
          <h2>Badges</h2>
          {/* status badges */}
        </section>
      </div>
    </SidebarProvider>
  )
}
