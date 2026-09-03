'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { RequireRole } from '@/components/auth/require-role'
import { useGroupsByLaw } from '@/hooks/use-facility-groups'
import { ClassificationBadge, ConflictBadge } from '@/components/admin/templates/GroupedItemBadges'
import { InstanceBreakdownChips } from '@/components/admin/templates/InstanceBreakdownChips'
import { GroupedItemEditDialog } from '@/components/admin/templates/GroupedItemEditDialog'
import { describeAnswerSpec } from '@/lib/template-format'
import { INPUT_CLS } from '@/lib/ui-classes'
import { GROUPED_EDITOR_VERSION, type GroupNodeRow, type LawGroupRow } from '@/lib/api/facility-groups'

// UDT-60 — the law-centric lens on the grouped facility editor's SAME canonical leaves (see
// facility-groups.service.ts#getGroupsByLaw's doc): re-bucketed by law code instead of by facility
// container, so an admin editing lawRefs/era can work through "which items does MHT_2564 cover"
// rather than hunting one facility group at a time. Pinned to the same GROUPED_EDITOR_VERSION every
// other grouped-editor page uses — one shared constant, not a re-hardcoded 3 (see that constant's
// own doc). Editing reuses GroupedItemEditDialog wholesale (its lawRefs + era sections are exactly
// what this page exists to surface) — no separate write path.
const TABLE_GRID_COLS = 'grid-cols-[6rem_1fr_10rem_11rem]'

export default function TemplateLawsPage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <TemplateLawsContent />
    </RequireRole>
  )
}

// Same search convention as groups/page.tsx's groupNodeMatchesQuery — label text or node code,
// pre-normalized (trimmed + lowercased) by the caller. Every item here is already a LEAF (lawRefs
// is a leaf-only concept — see this page's own doc), so there's no descendant tree to recurse into.
function itemMatchesQuery(item: GroupNodeRow, query: string): boolean {
  if (item.labelTh.toLowerCase().includes(query)) return true
  return item.instances.some((i) => i.nodeCode.toLowerCase().includes(query))
}

const BUDDHIST_YEAR_OFFSET = 543

// effectiveDate is ISO Gregorian (see LawReferenceSeed's own doc in @repo/types) — displayed in
// Buddhist year to match every other date on this site, never converted anywhere else in this file.
function formatEffectiveDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return `${d}/${m}/${y! + BUDDHIST_YEAR_OFFSET}`
}

interface SectionData {
  key: string
  title: string
  effectiveNote: string
  isFloor: boolean
  itemCount: number
  items: GroupNodeRow[]
}

function toSectionData(law: LawGroupRow): SectionData {
  const effectiveNote = law.effectiveDate
    ? `มีผล ${formatEffectiveDate(law.effectiveDate)}`
    : law.effectiveYear
      ? `มีผล พ.ศ. ${law.effectiveYear}`
      : 'ยังไม่ยืนยันวันที่มีผล'
  return { key: law.code, title: law.nameTh, effectiveNote, isFloor: law.isFloor, itemCount: law.itemCount, items: law.items }
}

function TemplateLawsContent() {
  const { data, isLoading, error } = useGroupsByLaw(GROUPED_EDITOR_VERSION)
  const [editing, setEditing] = React.useState<GroupNodeRow | null>(null)
  // Default OPEN — unlike the facility-grouped editor's dozens of container groups, there are only
  // 5 laws plus "unassigned", small enough to scan all at once without collapsing first.
  const [closedSections, setClosedSections] = React.useState<Record<string, boolean>>({})
  const [query, setQuery] = React.useState('')
  const normalizedQuery = query.trim().toLowerCase()

  function toggle(key: string) {
    setClosedSections((cur) => ({ ...cur, [key]: !(cur[key] ?? false) }))
  }

  if (isLoading) return <div className="text-muted-foreground flex items-center justify-center p-16 text-sm">กำลังโหลด…</div>
  if (error || !data) {
    return (
      <div className="flex items-center justify-center p-16 text-sm text-red-500">
        เกิดข้อผิดพลาด: {(error as Error)?.message ?? 'ไม่สามารถโหลดข้อมูลได้'}
      </div>
    )
  }

  const sections: SectionData[] = [
    ...data.laws.map(toSectionData),
    {
      key: 'unassigned',
      title: 'ยังไม่ระบุกฎหมาย',
      effectiveNote: 'รายการที่ไม่ผูกกับกฎหมายฉบับใดเลย — ตรวจสอบว่าตกหล่นหรือตั้งใจ',
      isFloor: false,
      itemCount: data.unassigned.itemCount,
      items: data.unassigned.items,
    },
  ]
  const totalTagged = data.laws.reduce((sum, l) => sum + l.itemCount, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/templates/groups" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-foreground text-xl font-bold">แก้ไขตามกฎหมายอ้างอิง</h1>
          <p className="text-muted-foreground text-sm">
            ดูรายการตรวจสอบแยกตามกฎหมายที่บังคับใช้ — แก้ไขข้อยกเว้นทางกฎหมาย (lawRefs) และข้อยกเว้นตามยุคกฎหมาย (byLaw) ได้จากที่นี่ รายการเดียวกันอาจปรากฏได้มากกว่าหนึ่งกฎหมาย
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="กฎหมายที่ติดตาม" value={data.laws.length} />
        <StatCard label="รายการที่ระบุกฎหมายแล้ว" value={totalTagged} />
        <StatCard label="รายการที่ยังไม่ระบุกฎหมาย" value={data.unassigned.itemCount} />
      </div>

      <div className="relative min-w-0">
        <Search size={15} className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหารหัสหรือชื่อรายการ…"
          className={`${INPUT_CLS} py-2 pl-8 pr-8 text-sm`}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="space-y-3">
        {sections.map((section) => (
          <LawSection
            key={section.key}
            section={section}
            isOpen={normalizedQuery ? true : !(closedSections[section.key] ?? false)}
            onToggle={() => toggle(section.key)}
            query={normalizedQuery}
            onEdit={setEditing}
          />
        ))}
      </div>

      <GroupedItemEditDialog version={GROUPED_EDITOR_VERSION} item={editing} onClose={() => setEditing(null)} />
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

function LawSection({
  section,
  isOpen,
  onToggle,
  query,
  onEdit,
}: {
  section: SectionData
  isOpen: boolean
  onToggle: () => void
  query: string
  onEdit: (n: GroupNodeRow) => void
}) {
  const unassigned = section.key === 'unassigned'
  const items = query ? section.items.filter((it) => itemMatchesQuery(it, query)) : section.items
  if (query && items.length === 0) return null

  return (
    <div className="bg-card border-border overflow-hidden rounded-xl border">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        className={`flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition-colors ${
          unassigned ? 'bg-status-warn/10 hover:bg-status-warn/20' : 'bg-secondary/40 hover:bg-secondary/60'
        }`}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-foreground text-sm font-semibold">{section.title}</span>
          {section.isFloor && (
            <span
              title="กฎหมายฐาน — บังคับใช้กับทุกสถานีไม่ว่าจะสร้างก่อนปีใด"
              className="bg-secondary text-muted-foreground rounded-full px-2 py-0.5 text-xs"
            >
              กฎหมายฐาน
            </span>
          )}
          <span className="text-muted-foreground text-xs">{section.effectiveNote}</span>
          <span className="text-muted-foreground text-xs">({section.itemCount} รายการ)</span>
        </div>
        {isOpen ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
      </div>

      {isOpen && (
        <>
          <TableHeaderRow />
          {items.length === 0 ? (
            <div className="text-muted-foreground px-4 py-3 text-sm">ไม่มีรายการภายใต้กฎหมายนี้</div>
          ) : (
            items.map((item) => <LawItemRow key={item.id} item={item} onEdit={onEdit} />)
          )}
        </>
      )}
    </div>
  )
}

function TableHeaderRow() {
  return (
    <div className={`border-border bg-secondary/20 grid ${TABLE_GRID_COLS} border-b`}>
      {['รหัส', 'รายการ', 'สถานะ', 'การดำเนินการ'].map((label) => (
        <div key={label} className="text-muted-foreground px-3 py-2 text-3xs font-medium tracking-wide uppercase">
          {label}
        </div>
      ))}
    </div>
  )
}

// Every item here is a LEAF, always — no depth/indent/chevron needed (unlike groups/page.tsx's
// TableRow, which also renders containers and their children).
function LawItemRow({ item, onEdit }: { item: GroupNodeRow; onEdit: (n: GroupNodeRow) => void }) {
  const representative = item.instances[0]
  return (
    <div className={`border-border grid ${TABLE_GRID_COLS} items-center border-b last:border-0`}>
      <div className="px-2 py-2.5">
        {representative && (
          <span className="bg-secondary text-muted-foreground rounded px-1.5 py-0.5 font-mono text-3xs whitespace-nowrap">{representative.nodeCode}</span>
        )}
      </div>

      <div className="min-w-0 py-2.5 pr-3 pl-3">
        <p className="text-foreground text-sm leading-snug">{item.labelTh}</p>
        {representative && <p className="text-muted-foreground mt-0.5 text-xs">{describeAnswerSpec(representative.answerType, representative.measurements)}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-1 px-3 py-2.5">
        <InstanceBreakdownChips breakdown={item.breakdown} compact />
        <ClassificationBadge item={item} />
        <ConflictBadge item={item} />
      </div>

      <div className="flex items-center gap-1 px-3 py-2.5">
        {item.propagatable ? (
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="border-border hover:bg-secondary/60 rounded-lg border px-3 py-1.5 text-xs font-medium"
          >
            แก้ไข & เผยแพร่
          </button>
        ) : item.hasConflict ? (
          <Link
            href="/admin/templates/groups/conflicts"
            className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/20"
          >
            แก้ไขความขัดแย้งก่อน
          </Link>
        ) : (
          <span className="text-muted-foreground text-xs">แก้ไขทีละแบบประเมิน</span>
        )}
      </div>
    </div>
  )
}
