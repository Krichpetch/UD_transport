'use client'

import dynamic from 'next/dynamic'
import type { Station } from '@repo/types'

// Leaflet requires window — must be loaded client-side only
const ThailandMapInner = dynamic(() => import('./ThailandMapInner'), {
  ssr: false,
  loading: () => (
    <div className="bg-secondary flex h-full w-full animate-pulse items-center justify-center rounded-lg">
      <p className="text-muted-foreground text-xs">กำลังโหลดแผนที่...</p>
    </div>
  ),
})

interface ThailandMapProps {
  stations: Station[]
}

export function ThailandMap({ stations }: ThailandMapProps) {
  return <ThailandMapInner stations={stations} />
}
