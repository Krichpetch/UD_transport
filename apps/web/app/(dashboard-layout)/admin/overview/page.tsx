'use client'

import * as React from 'react'
import Link from 'next/link'
import { RequireRole } from '@/components/auth/require-role'
import { useAdminOverview } from '@/hooks/use-admin'
import {
  ClipboardList,
  TrendingUp,
  RotateCcw,
  Building2,
  MapPin,
  Users,
  type LucideIcon,
} from 'lucide-react'

const METRIC_ICONS: Record<string, LucideIcon> = {
  pendingReviews: ClipboardList,
  submissionsLast7Days: TrendingUp,
  rejectedAwaitingResubmission: RotateCcw,
  neverAuditedInScope: Building2,
  approximateOrPendingCoords: MapPin,
  activeAuditors7d: Users,
}

export default function AdminOverviewPage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <AdminOverviewContent />
    </RequireRole>
  )
}

function AdminOverviewContent() {
  const { data, isLoading, error } = useAdminOverview()

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center p-16 text-sm">
        กำลังโหลด…
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="flex items-center justify-center p-16 text-sm text-red-500">
        เกิดข้อผิดพลาด: {(error as Error)?.message ?? 'ไม่สามารถโหลดข้อมูลได้'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-foreground text-xl font-bold">ภาพรวมงานผู้ดูแลระบบ</h1>
        <p className="text-muted-foreground text-sm">สรุปงานที่ต้องดำเนินการและสถานะข้อมูลสถานี</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {data.metrics.map((m) => {
          const Icon = METRIC_ICONS[m.key] ?? ClipboardList
          return (
            <div key={m.key} className="bg-card border-border rounded-xl border p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {m.label}
                </p>
                <div className="bg-primary/10 rounded-lg p-1.5">
                  <Icon size={14} className="text-primary" />
                </div>
              </div>
              <p className="text-foreground text-3xl font-bold">{m.value.toLocaleString()}</p>
            </div>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-card border-border rounded-xl border">
          <div className="border-border flex items-center justify-between border-b px-5 py-3">
            <h2 className="text-foreground text-sm font-semibold">รอการอนุมัติ</h2>
            <Link href="/stations" className="text-accent text-xs hover:underline">
              ดูทั้งหมด →
            </Link>
          </div>
          <div className="themed-scrollbar max-h-80 overflow-y-auto">
            {data.pendingReviewsList.length === 0 ? (
              <p className="text-muted-foreground p-5 text-xs">ไม่มีรายการรอการอนุมัติ</p>
            ) : (
              data.pendingReviewsList.map((row) => (
                <Link
                  key={row.checklistId}
                  href={`/stations/${row.stationId}`}
                  className="border-border hover:bg-secondary/40 flex items-center justify-between border-b px-5 py-3 text-xs transition-colors last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-foreground truncate font-medium">{row.stationNameTh}</p>
                    <p className="text-muted-foreground truncate">ผู้ตรวจ: {row.auditorUsername}</p>
                  </div>
                  <span className="text-muted-foreground shrink-0 pl-3">
                    {row.submittedAt ? new Date(row.submittedAt).toLocaleDateString('th-TH') : '—'}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="bg-card border-border rounded-xl border">
          <div className="border-border flex items-center justify-between border-b px-5 py-3">
            <h2 className="text-foreground text-sm font-semibold">ถูกปฏิเสธ รอส่งใหม่</h2>
            <Link href="/stations" className="text-accent text-xs hover:underline">
              ดูทั้งหมด →
            </Link>
          </div>
          <div className="themed-scrollbar max-h-80 overflow-y-auto">
            {data.returnedWorkList.length === 0 ? (
              <p className="text-muted-foreground p-5 text-xs">ไม่มีรายการที่ถูกปฏิเสธ</p>
            ) : (
              data.returnedWorkList.map((row) => (
                <Link
                  key={`${row.stationId}-${row.auditorUsername}`}
                  href={`/stations/${row.stationId}`}
                  className="border-border hover:bg-secondary/40 flex items-center justify-between gap-3 border-b px-5 py-3 text-xs transition-colors last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-foreground truncate font-medium">{row.stationNameTh}</p>
                    <p className="text-muted-foreground truncate">ผู้ตรวจ: {row.auditorUsername}</p>
                    {row.reviewNotes && (
                      <p className="truncate text-red-600" title={row.reviewNotes}>
                        หมายเหตุ: {row.reviewNotes}
                      </p>
                    )}
                  </div>
                  <span className="text-muted-foreground shrink-0">
                    {row.reviewedAt ? new Date(row.reviewedAt).toLocaleDateString('th-TH') : '—'}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
