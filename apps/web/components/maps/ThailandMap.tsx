'use client'

import { mockStations } from '@/lib/mock-data'

// Phase 1: SVG placeholder map with station dots
// Replace with React-Leaflet in Phase 3

const STATUS_COLORS: Record<string, string> = {
  'ผ่านมาตรฐาน': 'var(--status-pass)',
  'ต้องปรับปรุง': 'var(--status-warn)',
  'ไม่ผ่าน': 'var(--status-fail)',
}

// Rough lat/lng to SVG coordinate mapping for Thailand
// Thailand bounds: lat 5.5–20.5 N, lng 97.5–105.7 E
function toSvg(lat: number, lng: number, width = 300, height = 420): { x: number; y: number } {
  const x = ((lng - 97.5) / (105.7 - 97.5)) * width
  const y = ((20.5 - lat) / (20.5 - 5.5)) * height
  return { x, y }
}

export function ThailandMap() {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg">
      {/* Background grid */}
      <svg
        viewBox="0 0 300 420"
        className="h-full w-full max-h-[360px]"
        style={{ background: 'var(--secondary)' }}
      >
        {/* Thailand outline — simplified silhouette */}
        <path
          d="M 130 20 L 170 18 L 195 35 L 210 55 L 215 80 L 210 100
             L 225 115 L 230 135 L 220 155 L 215 175 L 225 195 L 228 215
             L 218 230 L 205 240 L 195 260 L 185 280 L 178 305 L 172 330
             L 165 355 L 158 375 L 150 395
             L 142 375 L 135 355 L 128 330
             L 120 305 L 112 280 L 102 260
             L 85 245 L 72 235 L 65 220 L 70 200
             L 80 185 L 85 165 L 78 148 L 72 128
             L 80 110 L 90 95 L 88 75 L 95 55
             L 110 38 Z"
          fill="var(--muted-foreground)"
          fillOpacity={0.08}
          stroke="var(--border)"
          strokeWidth="1.5"
        />

        {/* Station dots */}
        {mockStations.map((station) => {
          const { x, y } = toSvg(station.lat, station.lng)
          const color = STATUS_COLORS[station.status]
          return (
            <g key={station.id}>
              <circle
                cx={x}
                cy={y}
                r={7}
                fill={color}
                fillOpacity={0.2}
              />
              <circle
                cx={x}
                cy={y}
                r={4}
                fill={color}
                stroke="white"
                strokeWidth={1.5}
              />
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex flex-col gap-1 rounded-md bg-white/80 px-2 py-1.5 backdrop-blur text-[10px]">
        {Object.entries(STATUS_COLORS).map(([label, color]) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: color }} />
            <span className="text-foreground/70">{label}</span>
          </div>
        ))}
      </div>

      <p className="text-muted-foreground absolute top-2 right-2 text-[9px] italic">
        Phase 1 — placeholder
      </p>
    </div>
  )
}