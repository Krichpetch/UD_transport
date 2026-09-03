'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, ChevronUp, ExternalLink, ListChecks, Plus, Search, Trash2, X } from 'lucide-react'
import { RequireRole } from '@/components/auth/require-role'
import { useFacilityGroups } from '@/hooks/use-facility-groups'
import { ClassificationBadge, ConflictBadge } from '@/components/admin/templates/GroupedItemBadges'
import { InstanceBreakdownChips } from '@/components/admin/templates/InstanceBreakdownChips'
import { ModesUsedBadge } from '@/components/admin/templates/ModesUsedBadge'
import { GroupedItemEditDialog } from '@/components/admin/templates/GroupedItemEditDialog'
import { AddAndPlaceDialog } from '@/components/admin/templates/AddAndPlaceDialog'
import { DeleteGroupDialog } from '@/components/admin/templates/DeleteGroupDialog'
import { describeAnswerSpec } from '@/lib/template-format'
import { INPUT_CLS } from '@/lib/ui-classes'
import { flattenLeafNodes, type GroupNodeRow } from '@/lib/api/facility-groups'

// Session S4b, Part 3.1 — browse the facility-grouped view of the v3 template candidates.
// Hardcoded to version 3: the whole grouped-editor feature (facility-type-redundancy-report.md)
// is scoped to the v3 migration-pipeline candidates specifically, not a general cross-version tool
// — see the session brief's "Out of scope" list. (Part 5 added a VersionScope capability to the
// API for retirement-planning comparisons, but the EDITOR itself stays pinned to v3.)
const VERSION = 3

// Session S5-fix (round 5) — same column-grid shape the station checklist page
// (stations/[id]/page.tsx#ChecklistRow) uses: one fixed grid template shared by the header row
// and every data row, so columns stay aligned regardless of a row's depth in the tree (hierarchy
// is expressed INSIDE the "รายการ" cell via indent + chevron, never by shifting the whole row).
// Session S5-fix (round 6) — รหัส widened (real node codes like "B6.10-4.8" were wrapping onto a
// second line in the old 3.5rem column); ใช้ร่วมกัน narrowed to match InstanceBreakdownChips'
// new single-badge-plus-tooltip rendering, which no longer needs the old multi-chip width.
// UDT-61, Part 1 — that same column is now ModesUsedBadge (one chip per mode, potentially several
// per row) instead of a single count pill, so it's widened back out; สถานะ narrowed since it lost
// the redundant "ใช้ร่วมกัน N จุด" text and now only ever shows a count chip plus at most one badge.
// UDT-61, Part 2 — การดำเนินการ widened slightly to fit a single-mode row's new แก้ไข button plus
// its "go to this template" link icon alongside the delete button.
const TABLE_GRID_COLS = 'grid-cols-[6rem_1fr_11rem_10rem_13rem]'

export default function TemplateGroupsPage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <TemplateGroupsContent />
    </RequireRole>
  )
}

function byDocOrder(a: GroupNodeRow, b: GroupNodeRow): number {
  return a.sortKey - b.sortKey
}

// Session S5-fix (round 3) — depth-0 groups sort by their FACILITY_CATALOG number (1-33,
// @repo/types), not by document position or id: "ประตูสำหรับคนพิการ" (1) before "ทางลาด" (3)
// before "ห้องน้ำสำหรับคนพิการ" (9), etc., matching the source catalog's own ordering. A group
// with no facilityCode tag at all sorts to the bottom, after every tagged one — never guessed at.
function byFacilityCatalogOrder(a: GroupNodeRow, b: GroupNodeRow): number {
  const aCode = a.facilityCode ?? Infinity
  const bCode = b.facilityCode ?? Infinity
  if (aCode !== bCode) return aCode - bCode
  return byDocOrder(a, b)
}

function countLeaves(node: GroupNodeRow): number {
  return node.children.reduce((sum, c) => sum + countLeaves(c), 0) + (node.isLeaf ? 1 : 0)
}

// Same searchbar behavior as TemplateTree.tsx's nodeMatchesQuery (the individual per-template
// editor) — matches on label text OR node code, self-or-any-descendant, so a query surfaces a
// branch even when only a deeply-nested child matches. `query` is expected pre-normalized
// (trimmed + lowercased) by the caller, matching TemplateTree's own convention. A GroupNodeRow has
// no single "code" of its own (unlike TemplateNode) — it's checked against every instance's
// nodeCode instead, since any of them is a code a user might search by.
function groupNodeMatchesQuery(node: GroupNodeRow, query: string): boolean {
  if (node.labelTh.toLowerCase().includes(query)) return true
  if (node.instances.some((i) => i.nodeCode.toLowerCase().includes(query))) return true
  return node.children.some((c) => groupNodeMatchesQuery(c, query))
}

function TemplateGroupsContent() {
  const { data, isLoading, error } = useFacilityGroups(VERSION)
  const [editing, setEditing] = React.useState<GroupNodeRow | null>(null)
  const [deleting, setDeleting] = React.useState<GroupNodeRow | null>(null)
  const [addingNew, setAddingNew] = React.useState(false)
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({})
  const [query, setQuery] = React.useState('')
  const normalizedQuery = query.trim().toLowerCase()

  function toggleGroup(id: string) {
    setOpenGroups((cur) => ({ ...cur, [id]: !(cur[id] ?? false) }))
  }

  if (isLoading) return <div className="text-muted-foreground flex items-center justify-center p-16 text-sm">กำลังโหลด…</div>
  if (error || !data) {
    return (
      <div className="flex items-center justify-center p-16 text-sm text-red-500">
        เกิดข้อผิดพลาด: {(error as Error)?.message ?? 'ไม่สามารถโหลดข้อมูลได้'}
      </div>
    )
  }

  const allRoots = [...data.containerGroups].sort(byFacilityCatalogOrder)
  const roots = normalizedQuery ? allRoots.filter((r) => groupNodeMatchesQuery(r, normalizedQuery)) : allRoots
  const conflictCount = flattenLeafNodes(data.containerGroups).filter((it) => it.hasConflict && !it.conflictAcknowledged).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/templates" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-foreground text-xl font-bold">แก้ไขตามกลุ่มสิ่งอำนวยความสะดวก</h1>
            <p className="text-muted-foreground text-sm">แก้ไขรายการที่ซ้ำกันข้ามแบบประเมินครั้งเดียว แล้วเผยแพร่ไปยังทุกจุดที่ใช้ร่วมกัน — เหมือนหน้าแก้ไขทีละแบบประเมิน แต่แก้ครั้งเดียวได้ทุกจุด</p>
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

      {/* Same searchbar as the individual per-template editor (TemplateTree.tsx) — matches on
          code or label text, any depth, and auto-expands every branch containing a match (both
          the top-level group header AND nested rows) so a hit is never hidden behind a collapsed
          group. Non-matching top-level groups are filtered out of `roots` entirely rather than
          just collapsed, since there can be dozens of them. */}
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
        {roots.map((root, i) => {
          const isOpen = normalizedQuery ? true : (openGroups[root.id] ?? false)
          const leafCount = countLeaves(root)
          return (
            <div key={root.id} className="bg-card border-border overflow-hidden rounded-xl border">
              {/* Session S5-fix (round 5) — the "dropdown group" header, one per main facility
                  type, kept exactly like stations/[id]/page.tsx's own group header: a single
                  clickable bar that toggles the table below open/closed. The top-level node is
                  still a real editable entity here (round 2) — its own "แก้ไข & เผยแพร่" button
                  sits inside the same header as a SIBLING, stopPropagation'd, never nested inside
                  the toggle (an interactive element inside a <button> is invalid HTML and breaks
                  on hydration — the header itself is a div with button semantics instead). */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleGroup(root.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleGroup(root.id)
                  }
                }}
                className="bg-secondary/40 hover:bg-secondary/60 flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition-colors"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-foreground shrink-0 text-sm font-bold">{i + 1}.</span>
                  <span className="text-foreground text-sm font-semibold">{root.labelTh}</span>
                  {!root.facilityTagged && (
                    <span className="bg-secondary text-muted-foreground rounded-full px-2 py-0.5 text-xs">ไม่มีหมวดหมู่สิ่งอำนวยความสะดวก</span>
                  )}
                  <span className="text-muted-foreground text-xs">({leafCount} รายการ)</span>
                  <InstanceBreakdownChips breakdown={root.breakdown} compact />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {root.hasConflict && <ConflictBadge item={root} />}
                  {root.propagatable && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing(root)
                      }}
                      className="border-border bg-card hover:bg-secondary/60 rounded-lg border px-3 py-1.5 text-xs font-medium"
                    >
                      แก้ไข & เผยแพร่
                    </button>
                  )}
                  {/* Live feedback (2026-08-17) — "a way to delete any facility group that
                      doesn't need to be there anymore". Not gated on propagatable (unlike edit) —
                      an unwanted or conflicted group should still be removable. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleting(root)
                    }}
                    title="ลบกลุ่มนี้"
                    className="text-muted-foreground hover:bg-secondary/60 hover:text-red-600 rounded-lg border border-transparent p-1.5"
                  >
                    <Trash2 size={14} />
                  </button>
                  {isOpen ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                </div>
              </div>

              {isOpen && (
                <>
                  <TableHeaderRow />
                  {[...root.children].sort(byDocOrder).map((child) => (
                    <TableRow key={child.id} node={child} depth={1} onEdit={setEditing} onDelete={setDeleting} query={normalizedQuery} />
                  ))}
                  {root.children.length === 0 && (
                    <div className="text-muted-foreground px-4 py-3 text-sm">รายการนี้ไม่มีรายการย่อย</div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      <GroupedItemEditDialog version={VERSION} item={editing} onClose={() => setEditing(null)} />
      {addingNew && data && <AddAndPlaceDialog version={VERSION} roots={data.containerGroups} onClose={() => setAddingNew(false)} />}
      {deleting && <DeleteGroupDialog version={VERSION} item={deleting} onClose={() => setDeleting(null)} />}
    </div>
  )
}

function TableHeaderRow() {
  return (
    <div className={`border-border bg-secondary/20 grid ${TABLE_GRID_COLS} border-b`}>
      {['รหัส', 'รายการ', 'โหมดที่ใช้งาน', 'สถานะ', 'การดำเนินการ'].map((label) => (
        <div key={label} className="text-muted-foreground px-3 py-2 text-3xs font-medium tracking-wide uppercase">
          {label}
        </div>
      ))}
    </div>
  )
}

// Session S5-fix (round 5) — one table row per node, ANY depth: mirrors TemplateTree.tsx's own
// "every node is selectable, chevron is its own click target" pattern, now laid out in the same
// grid-column format as the station checklist table instead of a stacked card. A container's own
// length-tier sub-groups (e.g. the ramp's ≤2500mm/2500-6000mm/≥6000mm cases) still render as their
// own expandable rows — hierarchy lives entirely inside the "รายการ" cell (indent + chevron), so
// the รหัส/โหมดที่ใช้งาน/สถานะ/การดำเนินการ columns stay aligned no matter how deep a row sits.
function TableRow({
  node,
  depth,
  onEdit,
  onDelete,
  query,
}: {
  node: GroupNodeRow
  depth: number
  onEdit: (n: GroupNodeRow) => void
  onDelete: (n: GroupNodeRow) => void
  query: string
}) {
  // Every hook called unconditionally, before any early return below (Rules of Hooks) — this row's
  // `key` keeps the same component instance across a query changing from non-matching to matching
  // (or back), so a hook skipped only on the non-matching path would desync React's per-instance
  // hook order the moment that row starts/stops matching.
  const [manuallyOpen, setManuallyOpen] = React.useState(true)
  const sortedChildren = React.useMemo(() => [...node.children].sort(byDocOrder), [node.children])
  const searching = query.length > 0
  if (searching && !groupNodeMatchesQuery(node, query)) return null
  // Same "search forces every matching branch open" behavior as TemplateTree.tsx's NodeRow — a
  // result should never stay hidden behind a row someone collapsed before they started searching.
  const open = searching ? true : manuallyOpen
  const hasChildren = node.children.length > 0
  const representative = node.instances[0]

  return (
    <div>
      <div className={`border-border grid ${TABLE_GRID_COLS} items-center border-b last:border-0`}>
        <div className="px-2 py-2.5">
          {representative && (
            <span className="bg-secondary text-muted-foreground rounded px-1.5 py-0.5 font-mono text-3xs whitespace-nowrap">{representative.nodeCode}</span>
          )}
        </div>

        <div className="flex min-w-0 items-start gap-1.5 py-2.5 pr-3" style={{ paddingLeft: `${depth * 20 + 12}px` }}>
          {hasChildren ? (
            <button type="button" onClick={() => setManuallyOpen((o) => !o)} className="hover:bg-secondary mt-0.5 shrink-0 rounded p-0.5">
              <ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
          ) : (
            <span className="w-[22px] shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm leading-snug">{node.labelTh}</p>
            {node.isLeaf && representative && (
              <p className="text-muted-foreground mt-0.5 text-xs">{describeAnswerSpec(representative.answerType, representative.measurements)}</p>
            )}
          </div>
        </div>

        <div className="px-3 py-2.5">
          <ModesUsedBadge breakdown={node.breakdown} compact />
        </div>

        <div className="flex flex-wrap items-center gap-1 px-3 py-2.5">
          <InstanceBreakdownChips breakdown={node.breakdown} compact />
          <ClassificationBadge item={node} />
          <ConflictBadge item={node} />
        </div>

        <div className="flex items-center gap-1 px-3 py-2.5">
          {node.propagatable ? (
            <button
              type="button"
              onClick={() => onEdit(node)}
              className="border-border hover:bg-secondary/60 rounded-lg border px-3 py-1.5 text-xs font-medium"
            >
              แก้ไข & เผยแพร่
            </button>
          ) : node.hasConflict ? (
            <Link
              href="/admin/templates/groups/conflicts"
              className="rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/20"
            >
              แก้ไขความขัดแย้งก่อน
            </Link>
          ) : node.instances.length === 1 ? (
            // UDT-61, Part 2 — a single-mode item has nothing to fan out to, but that's no reason
            // to leave it uneditable: the edit dialog now writes directly to its one instance (see
            // facility-groups.service.ts#propagateItemEdit), and the link jumps straight to that
            // instance's own template in the individual per-template editor.
            <>
              <button
                type="button"
                onClick={() => onEdit(node)}
                className="border-border hover:bg-secondary/60 rounded-lg border px-3 py-1.5 text-xs font-medium"
              >
                แก้ไข
              </button>
              <Link
                href={`/admin/templates/${node.instances[0]!.templateId}`}
                title="ไปที่แบบประเมินนี้"
                className="text-muted-foreground hover:bg-secondary/60 hover:text-foreground rounded-lg border border-transparent p-1.5"
              >
                <ExternalLink size={13} />
              </Link>
            </>
          ) : (
            <span className="text-muted-foreground text-xs">แก้ไขทีละแบบประเมิน</span>
          )}
          {/* Live feedback (2026-08-17) — not gated on propagatable, same reasoning as the root
              header's own delete button above. */}
          <button
            type="button"
            onClick={() => onDelete(node)}
            title="ลบรายการนี้"
            className="text-muted-foreground hover:bg-secondary/60 hover:text-red-600 shrink-0 rounded-lg border border-transparent p-1.5"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {hasChildren && open && (
        <div>
          {sortedChildren.map((child) => (
            <TableRow key={child.id} node={child} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} query={query} />
          ))}
        </div>
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
