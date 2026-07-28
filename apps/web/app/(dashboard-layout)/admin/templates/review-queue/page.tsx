'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { RequireRole } from '@/components/auth/require-role'
import { useReviewQueue } from '@/hooks/use-templates-admin'
import { TransportBadge } from '@/components/shared/badges'
import { SELECT_CLS, ALL_VALUE } from '@/lib/ui-classes'

const MODES = ['ทางบก', 'ทางราง', 'ทางเรือ', 'ทางอากาศ']

export default function ReviewQueuePage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <ReviewQueueContent />
    </RequireRole>
  )
}

// Part B.3 — the in-app replacement for threshold_review.csv / the activation-gate metric: all
// measurements with confirmed:false across templates, filterable by mode/variant, with progress
// counters per template and overall. Each row deep-links into the template editor at that leaf
// via ?node=<code> (read by admin/templates/[id]/page.tsx).
function ReviewQueueContent() {
  const [mode, setMode] = React.useState<string>(ALL_VALUE)
  const { data, isLoading, error } = useReviewQueue({ mode: mode === ALL_VALUE ? undefined : mode })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/templates" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-foreground text-xl font-bold">คิวรอตรวจสอบเกณฑ์ตัวเลข</h1>
          <p className="text-muted-foreground text-sm">เกณฑ์ที่สกัดอัตโนมัติหรือยังไม่ได้รับการยืนยันจากผู้ดูแลระบบ</p>
        </div>
      </div>

      <select className={`${SELECT_CLS} w-48`} value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value={ALL_VALUE}>ทุกประเภทการขนส่ง</option>
        {MODES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      {isLoading && <div className="text-muted-foreground p-8 text-center text-sm">กำลังโหลด…</div>}
      {error && <div className="p-8 text-center text-sm text-red-500">{(error as Error).message}</div>}

      {data && (
        <>
          <div className="bg-card border-border rounded-xl border p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-foreground text-sm font-semibold">ความคืบหน้าโดยรวม</p>
              <p className="text-muted-foreground text-xs">
                {data.overall.confirmed}/{data.overall.total} (
                {data.overall.total > 0 ? Math.round((data.overall.confirmed / data.overall.total) * 100) : 0}%)
              </p>
            </div>
            <div className="bg-secondary h-2 w-full overflow-hidden rounded-full">
              <div
                className="h-full rounded-full bg-[#52aa4e] transition-all"
                style={{ width: `${data.overall.total > 0 ? (data.overall.confirmed / data.overall.total) * 100 : 0}%` }}
              />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.perTemplate.map((t) => (
              <Link
                key={t.templateId}
                href={`/admin/templates/${t.templateId}`}
                className="border-border hover:bg-secondary/40 rounded-lg border p-3 text-xs transition-colors"
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <TransportBadge type={t.mode} />
                  <span className="text-muted-foreground">
                    {t.variantKey === 'standard' ? '' : t.variantKey} v{t.version}
                  </span>
                </div>
                <p className="text-foreground">
                  {t.confirmed}/{t.total} ยืนยันแล้ว
                </p>
              </Link>
            ))}
          </div>

          <div className="bg-card border-border overflow-hidden rounded-xl border">
            <table className="w-full text-xs">
              <thead className="bg-secondary/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">ประเภท</th>
                  <th className="px-3 py-2 text-left font-medium">รหัส</th>
                  <th className="px-3 py-2 text-left font-medium">รายการ</th>
                  <th className="px-3 py-2 text-left font-medium">เกณฑ์</th>
                  <th className="px-3 py-2 text-left font-medium">ค่า</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-muted-foreground px-3 py-8 text-center">
                      ไม่มีเกณฑ์รอตรวจสอบ
                    </td>
                  </tr>
                )}
                {data.rows.map((row) => (
                  <tr key={`${row.templateId}-${row.nodeCode}-${row.measurementKey}`} className="hover:bg-secondary/20">
                    <td className="px-3 py-2">
                      <TransportBadge type={row.mode} />
                    </td>
                    <td className="text-muted-foreground px-3 py-2 font-mono">{row.nodeCode}</td>
                    <td className="text-foreground max-w-xs truncate px-3 py-2">{row.labelTh}</td>
                    <td className="text-muted-foreground px-3 py-2">{row.operator}</td>
                    <td className="text-muted-foreground px-3 py-2">
                      {row.value ?? '-'} {row.unit}
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/templates/${row.templateId}?node=${encodeURIComponent(row.nodeCode)}`} className="text-accent hover:underline">
                        แก้ไข →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
