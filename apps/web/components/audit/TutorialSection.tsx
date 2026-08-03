'use client'

import { GraduationCap, ChevronRight, Loader2 } from 'lucide-react'
import { useTrainingStations } from '@/hooks/use-stations'
import { ModeIcon } from './StationSearchPicker'

interface Props {
  onSelect: (id: string) => void
}

// Session S3b, Part A.5 — "แบบฝึกหัด" (tutorial) section on the auditor home: one card per
// seeded practice station (see seed-training-stations.ts), selecting it exactly like a real
// station pick (onSelect -> /audit?station=<id>). The E-form itself is unchanged; only the
// station is a fixture — see ChecklistsService.submit's isTraining branch for the server-side
// behavior (proximity skip, auto-finalize, repeatable).
export function TutorialSection({ onSelect }: Props) {
  const { data: stations, isLoading } = useTrainingStations()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl bg-white p-4 text-xs text-muted-foreground shadow-sm">
        <Loader2 size={14} className="animate-spin" /> กำลังโหลดแบบฝึกหัด…
      </div>
    )
  }
  if (!stations || stations.length === 0) return null

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <GraduationCap size={15} className="text-accent" />
        <span className="text-sm font-semibold text-foreground">แบบฝึกหัด</span>
      </div>
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        ฝึกใช้งานแบบฟอร์มตรวจสอบจริงกับสถานีจำลอง — ไม่นับรวมในผลการตรวจสอบจริง ทำซ้ำได้ไม่จำกัด
      </p>
      <div className="divide-y divide-border">
        {stations.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-secondary active:bg-secondary"
          >
            <span className="shrink-0 text-muted-foreground">
              <ModeIcon mode={s.mode} railSubtype={s.railSubtype} size={16} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {s.nameTh}
            </span>
            <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  )
}
