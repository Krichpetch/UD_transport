'use client'

import type { StationStatus, TransportMode, RailSubtype } from '@repo/types'

export function StatusBadge({ status }: { status: StationStatus }) {
  const map: Record<StationStatus, string> = {
    'ผ่านมาตรฐาน': 'bg-status-pass/10 text-status-pass',
    'ต้องปรับปรุง': 'bg-status-warn/10 text-status-warn-foreground',
    'ไม่ผ่าน':      'bg-status-fail/10 text-status-fail',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? 'bg-secondary text-muted-foreground'}`}>
      {status}
    </span>
  )
}

export function TransportBadge({ type }: { type: string }) {
  // Keyed against @repo/types' TransportMode/RailSubtype so the map can't silently drift
  // from the canonical mode values again (it did once, for ทางเรือ vs ทางน้ำ).
  const map: Record<TransportMode | RailSubtype, string> = {
    'ทางบก':    'bg-blue-50 text-blue-700',
    'ทางราง':   'bg-purple-50 text-purple-700',
    'ทางน้ำ':   'bg-cyan-50 text-cyan-700',
    'ทางอากาศ': 'bg-orange-50 text-orange-700',
    'รถไฟ':     'bg-purple-50 text-purple-700',
    'รถไฟฟ้า':  'bg-indigo-50 text-indigo-700',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[type as TransportMode | RailSubtype] ?? 'bg-secondary text-muted-foreground'}`}>
      {type}
    </span>
  )
}

export function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 75 ? 'var(--status-pass)' : score >= 50 ? 'var(--status-warn)' : 'var(--status-fail)'
  return (
    <div className="flex items-center gap-2">
      <div className="bg-secondary h-1.5 w-16 overflow-hidden rounded-full">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold" style={{ color }}>{score}</span>
    </div>
  )
}
