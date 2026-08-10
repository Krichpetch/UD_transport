'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, ListChecks, Plus } from 'lucide-react'
import { RequireRole } from '@/components/auth/require-role'
import { useFacilityGroups } from '@/hooks/use-facility-groups'
import { ClassificationBadge, ConflictBadge } from '@/components/admin/templates/GroupedItemBadges'
import { InstanceBreakdownChips } from '@/components/admin/templates/InstanceBreakdownChips'
import { GroupedItemEditDialog } from '@/components/admin/templates/GroupedItemEditDialog'
import { AddAndPlaceDialog } from '@/components/admin/templates/AddAndPlaceDialog'
import { describeAnswerSpec } from '@/lib/template-format'
import { sortByNodeCode } from '@/lib/template-code-order'
import type { CanonicalItemRow } from '@/lib/api/facility-groups'

// Session S4b, Part 3.1 — browse the facility-grouped view of the v3 template candidates.
// Hardcoded to version 3: the whole grouped-editor feature (facility-type-redundancy-report.md)
// is scoped to the v3 migration-pipeline candidates specifically, not a general cross-version tool
// — see the session brief's "Out of scope" list. (Part 5 added a VersionScope capability to the
// API for retirement-planning comparisons, but the EDITOR itself stays pinned to v3.)
const VERSION = 3

export default function TemplateGroupsPage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <TemplateGroupsContent />
    </RequireRole>
  )
}

function TemplateGroupsContent() {
  const { data, isLoading, error } = useFacilityGroups(VERSION)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [editing, setEditing] = React.useState<CanonicalItemRow | null>(null)
  const [addingNew, setAddingNew] = React.useState(false)

  function toggle(groupId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  if (isLoading) return <div className="text-muted-foreground flex items-center justify-center p-16 text-sm">กำลังโหลด…</div>
  if (error || !data) {
    return (
      <div className="flex items-center justify-center p-16 text-sm text-red-500">
        เกิดข้อผิดพลาด: {(error as Error)?.message ?? 'ไม่สามารถโหลดข้อมูลได้'}
      </div>
    )
  }

  const itemsByGroup = new Map<string, CanonicalItemRow[]>()
  for (const item of data.canonicalItems) {
    if (!itemsByGroup.has(item.containerGroupId)) itemsByGroup.set(item.containerGroupId, [])
    itemsByGroup.get(item.containerGroupId)!.push(item)
  }
  const conflictCount = data.canonicalItems.filter((it) => it.hasConflict && !it.conflictAcknowledged).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/templates" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-foreground text-xl font-bold">แก้ไขตามกลุ่มสิ่งอำนวยความสะดวก</h1>
            <p className="text-muted-foreground text-sm">แก้ไขรายการที่ซ้ำกันข้ามแบบประเมินครั้งเดียว แล้วเผยแพร่ไปยังทุกจุดที่ใช้ร่วมกัน</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {conflictCount > 0 && (
            <Link
              href="/admin/templates/groups/conflicts"
              className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-500/20"
            >
              <AlertTriangle size={15} />
              ข้อมูลขัดแย้ง {conflictCount} รายการ
            </Link>
          )}
          <Link
            href="/admin/templates/groups/review-queue"
            className="border-border bg-card hover:bg-secondary/60 flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium"
          >
            <ListChecks size={15} />
            คิวยืนยันเกณฑ์ (แบบกลุ่ม)
          </Link>
          <button
            type="button"
            onClick={() => setAddingNew(true)}
            className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium hover:opacity-90"
          >
            <Plus size={15} />
            เพิ่มรายการ / เพิ่มกลุ่มข้อย่อย
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="กลุ่มสิ่งอำนวยความสะดวก" value={data.stats.distinctContainerGroups} />
        <StatCard label="จุดตรวจทั้งหมด (leaves)" value={data.stats.totalLeaves} />
        <StatCard label="หน่วยแก้ไข (edit units)" value={data.stats.editUnits} />
        <StatCard label="ลดงานแก้ไขลง" value={`${Math.round((1 - data.stats.editUnits / data.stats.totalLeaves) * 100)}%`} />
      </div>

      <div className="space-y-2">
        {[...itemsByGroup.entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .map(([groupId, items]) => {
            const group = data.containerGroups.find((g) => g.id === groupId)!
            const isOpen = expanded.has(groupId)
            const sharedCount = items.filter((it) => it.classification === 'SHARED').length
            const conflicted = items.filter((it) => it.hasConflict).length
            return (
              <div key={groupId} className="bg-card border-border rounded-xl border">
                <button type="button" onClick={() => toggle(groupId)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3.5 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className="text-foreground text-base font-semibold">{group.labelTh}</span>
                    {!group.facilityTagged && (
                      <span className="bg-secondary text-muted-foreground rounded-full px-2 py-0.5 text-xs">ไม่มีหมวดหมู่สิ่งอำนวยความสะดวก</span>
                    )}
                    <InstanceBreakdownChips breakdown={group.breakdown} compact />
                  </div>
                  <div className="flex items-center gap-2.5 text-sm">
                    <span className="text-muted-foreground">{items.length} รายการ ({sharedCount} ใช้ร่วมกัน)</span>
                    {conflicted > 0 && <span className="font-medium text-red-600">{conflicted} ขัดแย้ง</span>}
                  </div>
                </button>
                {isOpen && (
                  <div className="border-border divide-border divide-y border-t">
                    {sortByNodeCode(items, (item) => item.instances[0]?.nodeCode ?? '').map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="bg-secondary text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]">
                              {item.instances[0]?.nodeCode}
                            </span>
                            <p className="text-foreground truncate text-sm">{item.labelTh}</p>
                          </div>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {describeAnswerSpec(item.instances[0]?.answerType, item.instances[0]?.measurements ?? [])}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <ClassificationBadge item={item} />
                            <ConflictBadge item={item} />
                            <InstanceBreakdownChips breakdown={item.breakdown} compact />
                          </div>
                        </div>
                        {item.propagatable ? (
                          <button
                            type="button"
                            onClick={() => setEditing(item)}
                            className="border-border hover:bg-secondary/60 shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium"
                          >
                            แก้ไข & เผยแพร่
                          </button>
                        ) : item.hasConflict ? (
                          <Link
                            href="/admin/templates/groups/conflicts"
                            className="shrink-0 rounded-lg bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-500/20"
                          >
                            แก้ไขความขัดแย้งก่อน
                          </Link>
                        ) : (
                          <span className="text-muted-foreground shrink-0 text-sm">แก้ไขทีละแบบประเมิน</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
      </div>

      <GroupedItemEditDialog version={VERSION} item={editing} onClose={() => setEditing(null)} />
      {addingNew && data && (
        <AddAndPlaceDialog version={VERSION} groups={data.containerGroups} items={data.canonicalItems} onClose={() => setAddingNew(false)} />
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card border-border rounded-lg border p-4">
      <p className="text-muted-foreground text-xs uppercase">{label}</p>
      <p className="text-foreground text-2xl font-bold">{value}</p>
    </div>
  )
}
