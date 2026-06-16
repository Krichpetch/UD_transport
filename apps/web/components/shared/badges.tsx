'use client'

import type { StationStatus } from '@repo/types'

export function StatusBadge({ status }: { status: StationStatus }) {
  const map: Record<StationStatus, string> = {
    'ผ่านมาตรฐาน': 'bg-[#52aa4e]/10 text-[#52aa4e]',
    'ต้องปรับปรุง': 'bg-[#ffc107]/10 text-[#b38600]',
    'ไม่ผ่าน':      'bg-[#f44336]/10 text-[#f44336]',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? 'bg-secondary text-muted-foreground'}`}>
      {status}
    </span>
  )
}

export function TransportBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    'ทางบก':    'bg-blue-50 text-blue-700',
    'ทางราง':   'bg-purple-50 text-purple-700',
    'ทางเรือ':  'bg-cyan-50 text-cyan-700',
    'ทางอากาศ': 'bg-orange-50 text-orange-700',
    'รถไฟ':     'bg-purple-50 text-purple-700',
    'รถไฟฟ้า':  'bg-indigo-50 text-indigo-700',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[type] ?? 'bg-secondary text-muted-foreground'}`}>
      {type}
    </span>
  )
}

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? '#52aa4e' : score >= 50 ? '#ffc107' : '#f44336'
  return (
    <div className="flex items-center gap-2">
      <div className="bg-secondary h-1.5 w-16 overflow-hidden rounded-full">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-xs font-semibold" style={{ color }}>{score}</span>
    </div>
  )
}
