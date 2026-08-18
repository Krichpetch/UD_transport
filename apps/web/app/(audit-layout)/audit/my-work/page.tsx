'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, ChevronRight, RotateCcw } from 'lucide-react'
import { useMyChecklists } from '@/hooks/use-checklists'
import type { MyChecklistStatus, MyChecklistRow } from '@/lib/api/checklists'
import { getLineColor } from '@/lib/line-colors'

// Session F1, Part E — "งานของฉัน": every checklist belonging to the logged-in auditor, newest
// first, filterable by status. Supersedes the auditor home's inline "งานที่ถูกตีกลับ" list (see
// audit/page.tsx) as the one place to browse ALL of an auditor's work, not just returned items —
// the header badge count (layout.tsx) stays, it just now links here instead.
const PAGE_SIZE = 20

const STATUS_TABS: { value: MyChecklistStatus | ''; label: string }[] = [
  { value: '',          label: 'ทั้งหมด' },
  { value: 'DRAFT',     label: 'กำลังทำ' },
  { value: 'SUBMITTED', label: 'รอตรวจ' },
  { value: 'APPROVED',  label: 'ผ่านแล้ว' },
  { value: 'REJECTED',  label: 'ถูกตีกลับ' },
]

function statusBadge(status: MyChecklistStatus) {
  const map: Record<MyChecklistStatus, { label: string; cls: string }> = {
    DRAFT:     { label: 'กำลังทำ',   cls: 'bg-gray-100 text-gray-700' },
    SUBMITTED: { label: 'รอตรวจ',    cls: 'bg-amber-50 text-amber-700' },
    APPROVED:  { label: 'ผ่านแล้ว',  cls: 'bg-green-50 text-green-700' },
    REJECTED:  { label: 'ถูกตีกลับ', cls: 'bg-red-50 text-red-700' },
  }
  const { label, cls } = map[status]
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{label}</span>
}

function modeLabel(mode: string, railSubtype: string | null) {
  return mode === 'ทางราง' && railSubtype ? railSubtype : mode
}

function rowDate(row: MyChecklistRow): string {
  const d = row.status === 'DRAFT' ? row.updatedAt : (row.submittedAt ?? row.updatedAt)
  return new Date(d).toLocaleDateString('th-TH')
}

const VALID_STATUSES: readonly MyChecklistStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']

export default function MyWorkPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialStatus = searchParams.get('status')
  const [status, setStatus] = React.useState<MyChecklistStatus | ''>(
    initialStatus && (VALID_STATUSES as readonly string[]).includes(initialStatus) ? (initialStatus as MyChecklistStatus) : '',
  )
  const [page, setPage] = React.useState(1)

  React.useEffect(() => { setPage(1) }, [status])

  const { data, isLoading } = useMyChecklists(page, PAGE_SIZE, status || undefined)

  // Part E.4 — strictly read-only beyond navigation: every row action here is either a route
  // push into the existing /audit flow (DRAFT/REJECTED — Part D's tested hydrate path, no second
  // resume mechanism) or into the detail view (SUBMITTED/APPROVED) — read-only there too, except
  // for the SUBMITTED-only self-unsubmit control (see UnsubmitButton in [id]/page.tsx). No action
  // on THIS list page itself.
  function openRow(row: MyChecklistRow) {
    if (row.status === 'DRAFT' || row.status === 'REJECTED') {
      router.push(`/audit?station=${row.stationId}`)
    } else {
      router.push(`/audit/my-work/${row.id}`)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-base font-bold text-foreground">งานของฉัน</h1>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setStatus(t.value)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              status === t.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-white text-muted-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
      ) : !data || data.data.length === 0 ? (
        <div className="rounded-xl bg-white p-6 text-center text-sm text-muted-foreground shadow-sm">
          ไม่พบรายการ
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl bg-white shadow-sm">
          {data.data.map((row) => (
            <button
              key={row.id}
              onClick={() => openRow(row)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-secondary/60"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-medium text-foreground">{row.station.nameTh}</p>
                  {statusBadge(row.status)}
                  {/* Session S3b, Part A.5 — completed tutorials are read-only history, like any
                      other completed work, just visibly marked so they're never mistaken for a
                      real audit. */}
                  {row.isTraining && (
                    <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                      ฝึกหัด
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {modeLabel(row.station.mode, row.station.railSubtype)}
                  {row.station.line && (
                    <>
                      {' · '}
                      <span style={{ color: getLineColor(row.station.line) }}>{row.station.line}</span>
                    </>
                  )}
                  {row.station.province ? ` · ${row.station.province}` : ''}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{rowDate(row)}</span>
                  {row.status === 'DRAFT' && row.progress && (
                    <span className="text-[10px] font-medium text-primary">
                      {row.progress.answered}/{row.progress.total} ข้อ
                    </span>
                  )}
                  {row.status === 'REJECTED' && (
                    <span className="flex items-center gap-0.5 text-[10px] font-medium text-red-600">
                      <RotateCcw size={10} /> ต้องแก้ไข
                    </span>
                  )}
                  {(row.status === 'APPROVED' || row.status === 'SUBMITTED') && row.score != null && (
                    <span className="text-[10px] font-medium text-foreground">คะแนน {row.score}%</span>
                  )}
                </div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pb-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs disabled:opacity-40"
          >
            ก่อนหน้า
          </button>
          <span className="text-xs text-muted-foreground">{page} / {data.totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page >= data.totalPages}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-xs disabled:opacity-40"
          >
            ถัดไป
          </button>
        </div>
      )}
    </div>
  )
}
