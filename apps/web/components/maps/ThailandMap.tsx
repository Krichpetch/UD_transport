'use client'

import dynamic from 'next/dynamic'

// Leaflet requires window — must be loaded client-side only
const ThailandMapInner = dynamic(() => import('./ThailandMapInner'), {
  ssr: false,
  loading: () => (
    <div className="bg-secondary flex h-full w-full animate-pulse items-center justify-center rounded-lg">
      <p className="text-muted-foreground text-xs">กำลังโหลดแผนที่...</p>
    </div>
  ),
})

export function ThailandMap() {
  return <ThailandMapInner />
}