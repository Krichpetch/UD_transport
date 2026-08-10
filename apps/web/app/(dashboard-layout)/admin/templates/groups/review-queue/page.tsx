'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { RequireRole } from '@/components/auth/require-role'
import { useConfirmGroupedMeasurement, useGroupedReviewQueue } from '@/hooks/use-facility-groups'

const VERSION = 3

export default function GroupedReviewQueuePage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <GroupedReviewQueueContent />
    </RequireRole>
  )
}

// Session S4b, Part 4.1 — collapses S3a's review-queue (unconfirmedMeasurementRows, one row per
// physical measurement) by canonical item: confirming a canonical measurement confirms every
// instance that carries it in one action. The per-template counters on
// /admin/templates/review-queue are unchanged and remain the activation-gate source of truth —
// this is the grouped WORK QUEUE that gets an admin there faster, not a replacement for it.
function GroupedReviewQueueContent() {
  const { data, isLoading, error } = useGroupedReviewQueue(VERSION)
  const confirmItem = useConfirmGroupedMeasurement(VERSION)
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)

  if (isLoading) return <div className="text-muted-foreground flex items-center justify-center p-16 text-sm">กำลังโหลด…</div>
  if (error || !data) {
    return (
      <div className="flex items-center justify-center p-16 text-sm text-red-500">
        เกิดข้อผิดพลาด: {(error as Error)?.message ?? 'ไม่สามารถโหลดข้อมูลได้'}
      </div>
    )
  }

  function confirm(itemId: string, measurementKey: string) {
    const key = `${itemId}::${measurementKey}`
    setPendingKey(key)
    confirmItem.mutate({ itemId, measurementKey }, { onSettled: () => setPendingKey(null) })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/templates/groups" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-foreground text-xl font-bold">คิวยืนยันเกณฑ์ตัวเลข (แบบกลุ่ม)</h1>
          <p className="text-muted-foreground text-sm">ยืนยันเกณฑ์ที่ใช้ร่วมกันครั้งเดียว เพื่อยืนยันทุกจุดที่ใช้เกณฑ์นี้พร้อมกัน</p>
        </div>
      </div>

      <div className="bg-card border-border rounded-xl border p-4">
        <p className="text-foreground text-sm">
          {data.totalUnconfirmedRows} แถวที่ยังไม่ยืนยัน ย่อเหลือ <span className="font-semibold">{data.distinctRows}</span> รายการให้ยืนยัน
          {data.totalUnconfirmedRows > 0 && (
            <span className="text-muted-foreground">
              {' '}
              (ลดลง {Math.round((1 - data.distinctRows / data.totalUnconfirmedRows) * 100)}%)
            </span>
          )}
        </p>
      </div>

      {data.rows.length === 0 && <div className="text-muted-foreground p-8 text-center text-sm">ยืนยันครบทุกเกณฑ์แล้ว ✓</div>}

      <div className="bg-card border-border overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">รายการ</th>
              <th className="px-3 py-2.5 text-left font-medium">เกณฑ์</th>
              <th className="px-3 py-2.5 text-left font-medium">ค่า</th>
              <th className="px-3 py-2.5 text-left font-medium">จำนวนจุดที่ยังไม่ยืนยัน</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {data.rows.map((row) => {
              const key = `${row.canonicalItemId}::${row.measurementKey}`
              return (
                <tr key={key} className="hover:bg-secondary/20">
                  <td className="text-foreground max-w-xs truncate px-3 py-2.5">{row.labelTh}</td>
                  <td className="text-muted-foreground px-3 py-2.5">
                    {row.measurementKey} ({row.operator})
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5">
                    {row.value ?? '-'} {row.unit}
                  </td>
                  <td className="px-3 py-2.5">
                    {row.unconfirmedCount}/{row.instanceCount}
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      disabled={confirmItem.isPending && pendingKey === key}
                      onClick={() => confirm(row.canonicalItemId, row.measurementKey)}
                      className="bg-primary text-primary-foreground flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                    >
                      {confirmItem.isPending && pendingKey === key ? <Loader2 size={13} className="animate-spin" /> : null}
                      ยืนยันทั้งหมด ({row.unconfirmedCount})
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {confirmItem.isError && <p className="text-sm text-red-500">{(confirmItem.error as Error).message}</p>}
    </div>
  )
}
