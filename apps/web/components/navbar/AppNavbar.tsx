'use client'

import { SidebarTrigger } from '@/components/ui/sidebar'
import { Bell, Search, Building2, X, ChevronRight } from 'lucide-react'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useStations } from '@/hooks/use-stations'

interface AppNavbarProps {
  title?: string
  subtitle?: string
}

export function AppNavbar({ title, subtitle }: AppNavbarProps) {
  const router = useRouter()
  const { data: stations = [] } = useStations()

  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')
  const [notifOpen, setNotifOpen] = React.useState(false)

  const urgentStations = React.useMemo(
    () => stations.filter(s => s.status === 'ไม่ผ่าน' || s.urgentIssues.length > 0),
    [stations],
  )

  const searchResults = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return []
    return stations
      .filter(s =>
        s.nameTh.includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.province.includes(q)
      )
      .slice(0, 8)
  }, [stations, searchQuery])

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true) }
      if (e.key === 'Escape') { setSearchOpen(false); setNotifOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function goTo(path: string) {
    router.push(path)
    setSearchOpen(false)
    setSearchQuery('')
    setNotifOpen(false)
  }

  return (
    <>
      <header className="border-border bg-card/80 supports-[backdrop-filter]:bg-card/60 sticky top-0 z-30 flex items-center justify-between gap-4 border-b px-4 py-3 backdrop-blur">
        {/* Left: Trigger + Logo */}
        <div className="flex items-center gap-3">
          <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
          <div className="bg-primary flex size-8 shrink-0 items-center justify-center rounded-md">
            <Building2 size={15} className="text-primary-foreground" />
          </div>
          <div className="hidden sm:block">
            <p className="text-foreground text-sm font-semibold">
              {title ?? 'สำนักงานนโยบายและแผนการขนส่งและจราจร '}
            </p>
            <p className="text-muted-foreground text-xs">{subtitle ?? 'ระบบสิ่งอำนวยความสะดวก'}</p>
          </div>
        </div>

        {/* Right: Search + Bell */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSearchOpen(true)}
            className="border-border text-muted-foreground hover:bg-secondary hidden items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors sm:flex"
          >
            <Search size={13} />
            <span>ค้นหา...</span>
            <kbd className="bg-muted rounded px-1 text-[10px]">⌘K</kbd>
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setNotifOpen(o => !o)}
              className="border-border text-muted-foreground hover:bg-secondary relative rounded-lg border p-1.5 transition-colors"
            >
              <Bell size={15} />
              {urgentStations.length > 0 && (
                <span className="bg-destructive absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full text-[8px] text-white">
                  {Math.min(urgentStations.length, 99)}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="bg-card border-border absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border shadow-lg">
                <div className="border-border flex items-center justify-between border-b px-4 py-3">
                  <p className="text-foreground text-sm font-semibold">การแจ้งเตือน</p>
                  <button onClick={() => setNotifOpen(false)}>
                    <X size={14} className="text-muted-foreground" />
                  </button>
                </div>
                {urgentStations.length === 0 ? (
                  <p className="text-muted-foreground px-4 py-6 text-center text-xs">ไม่มีการแจ้งเตือน</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto">
                    {urgentStations.map(s => (
                      <button
                        key={s.id}
                        onClick={() => goTo(`/stations/${encodeURIComponent(s.id)}`)}
                        className="border-border hover:bg-secondary flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors last:border-0"
                      >
                        <div className="bg-destructive/10 shrink-0 rounded-lg p-1.5">
                          <Bell size={12} className="text-destructive" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground truncate text-xs font-medium">{s.nameTh}</p>
                          <p className="text-muted-foreground text-[10px]">{s.province} · {s.status}</p>
                        </div>
                        <ChevronRight size={12} className="text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Search overlay */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40"
          onClick={() => { setSearchOpen(false); setSearchQuery('') }}
        >
          <div
            className="bg-card border-border mx-auto mt-24 w-full max-w-lg rounded-xl border shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="border-border flex items-center gap-3 border-b px-4 py-3">
              <Search size={15} className="text-muted-foreground shrink-0" />
              <input
                autoFocus
                className="text-foreground placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
                placeholder="ค้นหาสถานี จังหวัด..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')}>
                  <X size={13} className="text-muted-foreground" />
                </button>
              )}
            </div>

            {searchResults.length > 0 ? (
              <div className="max-h-64 overflow-y-auto py-1">
                {searchResults.map(s => (
                  <button
                    key={s.id}
                    onClick={() => goTo(`/stations/${encodeURIComponent(s.id)}`)}
                    className="hover:bg-secondary flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground text-sm">{s.nameTh}</p>
                      <p className="text-muted-foreground text-xs">{s.province} · {s.responsibleAgency}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : searchQuery ? (
              <p className="text-muted-foreground px-4 py-8 text-center text-sm">ไม่พบสถานีที่ตรงกัน</p>
            ) : (
              <p className="text-muted-foreground px-4 py-8 text-center text-xs">พิมพ์ชื่อสถานีหรือจังหวัด</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
