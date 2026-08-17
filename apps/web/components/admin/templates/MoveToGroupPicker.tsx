'use client'

import * as React from 'react'
import { ArrowRightLeft, Check, Loader2 } from 'lucide-react'
import { INPUT_CLS, SELECT_CLS } from '@/lib/ui-classes'
import { useAttachNodeToGroup, useFacilityGroups } from '@/hooks/use-facility-groups'
import { GROUPED_EDITOR_VERSION, flattenLeafNodes } from '@/lib/api/facility-groups'

// Era-editor safety session, Part E.3 — "ย้ายไปกลุ่มอื่น" (move to a different group), offered for
// any node that ISN'T currently master-attached (see attachNodeToGroup's own scope-decision doc in
// facility-groups.service.ts — this UI never offers switching an already-attached node directly,
// mirroring the backend guard). Motivating case: an item repeats N times with a wording bug (e.g.
// rail_metro's A1.4-5 saying "รถไฟ" instead of "รถไฟฟ้า"), landing it in its own wrong-worded fuzzy
// pool instead of the correctly-worded sibling cluster for the same checklist position.
//
// NOT scoped to groups sharing the source node's own leaf `code` — live feedback (2026-08-17)
// caught that this was backwards: a wording bug is exactly what causes two clusters for the SAME
// checklist item to end up under DIFFERENT codes in the first place (or, as with A1.4-5, the wrong
// pool simply isn't findable by code at all), so a code-equality filter hid the real target in the
// one case this feature exists for. Any existing leaf group is a valid target — search-filtered by
// label text instead, since the full list (~hundreds of edit units) is too long to scan unfiltered.
export function MoveToGroupPicker({
  templateId,
  sourceNodeCode,
  excludeGroupId,
}: {
  templateId: string
  sourceNodeCode: string
  excludeGroupId?: string | null
}) {
  const groupsQuery = useFacilityGroups(GROUPED_EDITOR_VERSION)
  const attachNodeToGroup = useAttachNodeToGroup(GROUPED_EDITOR_VERSION)
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [targetItemId, setTargetItemId] = React.useState('')

  const allCandidates = React.useMemo(() => {
    if (!groupsQuery.data) return []
    return flattenLeafNodes(groupsQuery.data.containerGroups)
      .filter(
        (g) =>
          g.id !== excludeGroupId &&
          !g.instances.some((i) => i.templateId === templateId && i.nodeCode === sourceNodeCode),
      )
      .sort((a, b) => a.labelTh.localeCompare(b.labelTh, 'th'))
  }, [groupsQuery.data, excludeGroupId, sourceNodeCode, templateId])

  const candidates = React.useMemo(() => {
    const q = search.trim()
    if (!q) return allCandidates
    return allCandidates.filter((g) => g.labelTh.includes(q))
  }, [allCandidates, search])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-border flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-secondary/60"
      >
        <ArrowRightLeft size={12} />
        ย้ายไปกลุ่มอื่น
      </button>
    )
  }

  return (
    <div className="border-border bg-secondary/30 space-y-1.5 rounded-lg border p-2">
      <p className="text-muted-foreground text-[11px]">เลือกกลุ่มปลายทาง (ค้นหาได้ทุกกลุ่ม ไม่จำกัดเฉพาะรหัสเดียวกัน)</p>
      {groupsQuery.isLoading && <p className="text-muted-foreground text-[11px]">กำลังโหลด…</p>}
      {!groupsQuery.isLoading && allCandidates.length > 0 && (
        <input
          className={`${INPUT_CLS} py-1 text-[11px]`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อกลุ่มปลายทาง…"
        />
      )}
      {!groupsQuery.isLoading && candidates.length === 0 && (
        <p className="text-muted-foreground text-[11px]">{allCandidates.length === 0 ? 'ไม่พบกลุ่มปลายทางอื่น' : 'ไม่พบกลุ่มที่ตรงกับคำค้นหา'}</p>
      )}
      {candidates.length > 0 && (
        <div className="flex items-center gap-1.5">
          <select className={`${SELECT_CLS} py-1 text-[11px]`} value={targetItemId} onChange={(e) => setTargetItemId(e.target.value)}>
            <option value="">เลือกกลุ่มปลายทาง… ({candidates.length} กลุ่ม)</option>
            {candidates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.labelTh} ({g.instanceCount} จุด)
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!targetItemId || attachNodeToGroup.isPending}
            onClick={() =>
              attachNodeToGroup.mutate(
                { targetItemId, body: { templateId, nodeCode: sourceNodeCode } },
                { onSuccess: () => { setOpen(false); setTargetItemId(''); setSearch('') } },
              )
            }
            className="bg-primary text-primary-foreground flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-medium disabled:opacity-50"
          >
            {attachNodeToGroup.isPending ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            ยืนยันย้าย
          </button>
        </div>
      )}
      <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground text-[11px] hover:underline">
        ยกเลิก
      </button>
      {attachNodeToGroup.isError && <p className="text-[11px] text-red-500">{(attachNodeToGroup.error as Error).message}</p>}
    </div>
  )
}
