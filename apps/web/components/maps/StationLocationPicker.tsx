'use client'

import dynamic from 'next/dynamic'

// Leaflet requires window — must be loaded client-side only
const StationLocationPickerInner = dynamic(() => import('./StationLocationPickerInner'), {
  ssr: false,
  loading: () => (
    <div className="bg-secondary flex h-full w-full animate-pulse items-center justify-center rounded-lg">
      <p className="text-muted-foreground text-xs">กำลังโหลดแผนที่...</p>
    </div>
  ),
})

interface StationLocationPickerProps {
  lat: number | null
  lng: number | null
  onChange: (lat: number, lng: number) => void
}

export function StationLocationPicker({ lat, lng, onChange }: StationLocationPickerProps) {
  return <StationLocationPickerInner lat={lat} lng={lng} onChange={onChange} />
}
