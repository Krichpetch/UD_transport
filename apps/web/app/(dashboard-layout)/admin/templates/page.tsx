'use client'

import * as React from 'react'
import Link from 'next/link'
import { RequireRole } from '@/components/auth/require-role'
import { useTemplateList } from '@/hooks/use-templates-admin'
import { TemplateStatusBadge } from '@/components/admin/templates/TemplateStatusBadge'
import { TransportBadge } from '@/components/shared/badges'
import { LayoutGrid, ListChecks } from 'lucide-react'
import type { TemplateListRow } from '@/lib/api/templates'

export default function TemplatesAdminPage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <TemplatesAdminContent />
    </RequireRole>
  )
}

// Picker mode -> variantKey -> version (Part A.1). Grouped client-side from the flat list —
// only 13 rows total, no pagination needed.
function groupByModeVariant(rows: TemplateListRow[]) {
  const groups = new Map<string, Map<string, TemplateListRow[]>>()
  for (const row of rows) {
    if (!groups.has(row.mode)) groups.set(row.mode, new Map())
    const byVariant = groups.get(row.mode)!
    if (!byVariant.has(row.variantKey)) byVariant.set(row.variantKey, [])
    byVariant.get(row.variantKey)!.push(row)
  }
  for (const byVariant of groups.values()) {
    for (const rows of byVariant.values()) rows.sort((a, b) => a.version - b.version)
  }
  return groups
}

function TemplatesAdminContent() {
  const { data, isLoading, error } = useTemplateList()

  if (isLoading) {
    return <div className="text-muted-foreground flex items-center justify-center p-16 text-sm">กำลังโหลด…</div>
  }
  if (error || !data) {
    return (
      <div className="flex items-center justify-center p-16 text-sm text-red-500">
        เกิดข้อผิดพลาด: {(error as Error)?.message ?? 'ไม่สามารถโหลดข้อมูลได้'}
      </div>
    )
  }

  const groups = groupByModeVariant(data)
  // Total unconfirmed measurements across every template — the "how do I approve?" entry
  // point (Part E.3.a) needs this count up front, not buried a click away in the queue page.
  const unconfirmedTotal = data.reduce(
    (sum, row) => sum + (row.summary.measurementCount - row.summary.confirmedCount),
    0,
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold">จัดการแบบประเมิน</h1>
          <p className="text-muted-foreground text-sm">
            แก้ไขเกณฑ์ตัวเลข ข้อยกเว้นตามยุคกฎหมาย รูปภาพประกอบ และคำอธิบายของแบบประเมินแต่ละเวอร์ชัน
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Session S4b — the facility-grouped editor: same checklist item repeated across up to
              51 places (see facility-type-redundancy-report.md), edited once instead of per-copy. */}
          <Link
            href="/admin/templates/groups"
            className="border-border bg-card hover:bg-secondary/60 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <LayoutGrid size={14} />
            แก้ไขตามกลุ่มสิ่งอำนวยความสะดวก
          </Link>
          {unconfirmedTotal > 0 ? (
            <Link
              href="/admin/templates/review-queue"
              className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
            >
              <ListChecks size={15} />
              ยืนยันเกณฑ์ ({unconfirmedTotal} รายการรอ)
            </Link>
          ) : (
            <Link
              href="/admin/templates/review-queue"
              className="border-border bg-card hover:bg-secondary/60 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <ListChecks size={14} />
              คิวรอตรวจสอบเกณฑ์
            </Link>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {[...groups.entries()].map(([mode, byVariant]) => (
          <div key={mode} className="bg-card border-border rounded-xl border">
            <div className="border-border flex items-center gap-2 border-b px-5 py-3">
              <TransportBadge type={mode} />
            </div>
            <div className="divide-border divide-y">
              {[...byVariant.entries()].map(([variantKey, rows]) => (
                <div key={variantKey} className="px-5 py-3">
                  <p className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wide uppercase">
                    {variantKey === 'standard' ? 'มาตรฐาน' : variantKey}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {rows.map((row) => (
                      <Link
                        key={row.id}
                        href={`/admin/templates/${row.id}`}
                        className="border-border hover:border-primary/40 hover:bg-secondary/40 rounded-lg border p-3 text-xs transition-colors"
                      >
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-foreground font-semibold">เวอร์ชัน {row.version}</span>
                          <TemplateStatusBadge status={row.status} />
                        </div>
                        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>{row.summary.itemCount} รายการ</span>
                          <span>{row.summary.leafCount} จุดตรวจ</span>
                          <span>{row.summary.measurementCount} เกณฑ์ตัวเลข</span>
                        </div>
                        {row.summary.measurementCount > 0 && (
                          <div className="mt-1.5">
                            <div className="bg-secondary h-1 w-full overflow-hidden rounded-full">
                              <div
                                className="h-full rounded-full bg-[#52aa4e] transition-all"
                                style={{ width: `${Math.round((row.summary.confirmedCount / row.summary.measurementCount) * 100)}%` }}
                              />
                            </div>
                            <p className="text-muted-foreground mt-1">
                              ยืนยันแล้ว {row.summary.confirmedCount}/{row.summary.measurementCount}
                            </p>
                          </div>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
