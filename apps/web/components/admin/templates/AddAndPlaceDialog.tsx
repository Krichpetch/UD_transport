'use client'

import * as React from 'react'
import { AlertTriangle, Check, Loader2, Send } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DIALOG_HEADER_CLS, DIALOG_TITLE_CLS, INPUT_CLS, SELECT_CLS } from '@/lib/ui-classes'
import { TransportBadge } from '@/components/shared/badges'
import { useAddAndPlace } from '@/hooks/use-facility-groups'
import { OPERATOR_LABEL } from '@/lib/template-format'
import { flattenGroupNodes, type GroupNodeRow } from '@/lib/api/facility-groups'
import type { ThresholdOperator } from '@repo/types'
import { FACILITY_CATALOG } from '@repo/types'

type QuestionType = 'presence' | 'presence_standard' | 'measured'

function byDocOrder(a: GroupNodeRow, b: GroupNodeRow): number {
  return a.sortKey - b.sortKey
}

// Session S5-fix (round 3) — same FACILITY_CATALOG-order sort groups/page.tsx uses for its list,
// applied here to the group picker so both pages read the facility groups in the same order.
function byFacilityCatalogOrder(a: GroupNodeRow, b: GroupNodeRow): number {
  const aCode = a.facilityCode ?? Infinity
  const bCode = b.facilityCode ?? Infinity
  if (aCode !== bCode) return aCode - bCode
  return byDocOrder(a, b)
}

// Session S4b-fix, Fix 3 — "เพิ่มรายการ / เพิ่มกลุ่มข้อย่อย": create one item ONCE and apply it to
// chosen templates at a chosen position, the additive counterpart to GroupedItemEditDialog's
// propagate-an-edit flow. Same preview -> confirm two-step (a structural add fanned out across N
// templates is exactly as broadcast as a propagated edit), same modal chrome as the other admin
// template dialogs.
//
// Session S5-fix (round 2) — the anchor picker is now: choose a top-level facility group, then
// choose ANY node in its subtree (the group itself, or any depth below it — an intermediate
// length-tier sub-group is just as valid an anchor as a leaf now, since round 2 no longer
// flattens that hierarchy away). One id (`anchorNodeId`) replaces the old two-field "is this a
// group or an item" split.
export function AddAndPlaceDialog({
  version,
  roots,
  onClose,
}: {
  version: number
  roots: GroupNodeRow[]
  onClose: () => void
}) {
  const addAndPlace = useAddAndPlace(version)

  const [groupId, setGroupId] = React.useState('')
  const [anchorNodeId, setAnchorNodeId] = React.useState('')
  const [side, setSide] = React.useState<'before' | 'after'>('before')
  const [targetIds, setTargetIds] = React.useState<Set<string>>(new Set())

  const [labelTh, setLabelTh] = React.useState('')
  const [type, setType] = React.useState<QuestionType>('presence')
  const [facilityCode, setFacilityCode] = React.useState<number | ''>('')
  const [operator, setOperator] = React.useState<ThresholdOperator>('gte')
  const [value, setValue] = React.useState<number | ''>('')
  const [unit, setUnit] = React.useState('mm')

  const [previewed, setPreviewed] = React.useState(false)

  const sortedGroups = React.useMemo(() => [...roots].sort(byFacilityCatalogOrder), [roots])
  const group = roots.find((g) => g.id === groupId)
  const groupSubtree = React.useMemo(() => (group ? flattenGroupNodes([group]).sort(byDocOrder) : []), [group])
  const anchor = groupSubtree.find((n) => n.id === anchorNodeId)
  const anchorLabel = anchor?.labelTh
  const facilityEntry = facilityCode === '' ? undefined : FACILITY_CATALOG.find((e) => e.code === facilityCode)

  function onGroupChange(id: string) {
    setGroupId(id)
    setAnchorNodeId('')
    setPreviewed(false)
    addAndPlace.reset()
    const g = roots.find((x) => x.id === id)
    setTargetIds(new Set(g?.instances.map((i) => i.templateId) ?? []))
  }

  function toggleTarget(templateId: string) {
    setTargetIds((cur) => {
      const next = new Set(cur)
      if (next.has(templateId)) next.delete(templateId)
      else next.add(templateId)
      return next
    })
    setPreviewed(false)
  }

  function buildContent() {
    return {
      labelTh,
      type,
      facilityCode: facilityCode === '' ? undefined : facilityCode,
      threshold: type === 'measured' ? { operator, value: value === '' ? null : value, unit, autoGrade: true } : undefined,
    }
  }

  const canPreview = !!groupId && !!anchorNodeId && targetIds.size > 0 && !!labelTh.trim() && (type !== 'measured' || !!unit)

  function preview() {
    addAndPlace.mutate(
      { anchorNodeId, side, targetTemplateIds: [...targetIds], content: buildContent(), confirm: false },
      { onSuccess: () => setPreviewed(true) },
    )
  }

  function confirm() {
    addAndPlace.mutate(
      { anchorNodeId, side, targetTemplateIds: [...targetIds], content: buildContent(), confirm: true },
      { onSuccess: () => setPreviewed(false) },
    )
  }

  const result = addAndPlace.data

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col overflow-hidden p-0 sm:max-w-2xl">
        <div className={DIALOG_HEADER_CLS}>
          <DialogTitle className={DIALOG_TITLE_CLS}>เพิ่มรายการ / เพิ่มกลุ่มข้อย่อย</DialogTitle>
          <p className="text-muted-foreground mt-1 text-sm">สร้างรายการใหม่ครั้งเดียว แล้ววางในตำแหน่งที่เลือกของทุกแบบประเมินที่เลือกไว้</p>
        </div>

        <div className="themed-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4 text-sm">
          <div>
            <label className="text-muted-foreground mb-1 block text-sm">กลุ่มสิ่งอำนวยความสะดวก</label>
            <select className={`${SELECT_CLS} text-sm`} value={groupId} onChange={(e) => onGroupChange(e.target.value)}>
              <option value="">เลือกกลุ่ม…</option>
              {sortedGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.labelTh} ({g.instanceCount} ที่)
                </option>
              ))}
            </select>
          </div>

          {group && (
            <>
              <div>
                <label className="text-muted-foreground mb-1 block text-sm">ตำแหน่งอ้างอิง (anchor) — รายการที่จะวางไว้ก่อน/หลัง</label>
                <select
                  className={`${SELECT_CLS} text-sm`}
                  value={anchorNodeId}
                  onChange={(e) => {
                    setAnchorNodeId(e.target.value)
                    setPreviewed(false)
                  }}
                >
                  <option value="">เลือกรายการอ้างอิง…</option>
                  {groupSubtree.map((n) => (
                    <option key={n.id} value={n.id}>
                      {'— '.repeat(n.depth)}
                      {n.depth === 0 ? '(ทั้งกลุ่มนี้เอง) ' : ''}
                      {n.instances[0]?.nodeCode} — {n.labelTh}
                    </option>
                  ))}
                </select>
              </div>

              {anchorNodeId && (
                <div className="flex items-center gap-4">
                  {(['before', 'after'] as const).map((s) => (
                    <label key={s} className="text-foreground flex items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        checked={side === s}
                        onChange={() => {
                          setSide(s)
                          setPreviewed(false)
                        }}
                      />
                      {s === 'before' ? `ก่อน "${anchorLabel}"` : `หลัง "${anchorLabel}"`}
                    </label>
                  ))}
                </div>
              )}

              <div>
                <p className="text-muted-foreground mb-1 text-sm">แบบประเมินเป้าหมาย ({targetIds.size}/{group.instances.length})</p>
                <div className="border-border max-h-32 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {[...group.instances].sort((a, b) => a.parentCode.localeCompare(b.parentCode)).map((i) => (
                    <label key={i.templateId} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={targetIds.has(i.templateId)} onChange={() => toggleTarget(i.templateId)} />
                      <TransportBadge type={i.mode} />
                      <span className="text-muted-foreground">{i.variantKey === 'standard' ? '' : i.variantKey}</span>
                      <span className="text-muted-foreground text-xs">({i.status === 'DRAFT' ? 'ร่าง' : i.status === 'ACTIVE' ? 'ใช้งานอยู่ — ต้องสร้างร่างก่อน' : 'เลิกใช้'})</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="border-border space-y-2.5 border-t pt-3">
                <p className="text-foreground text-sm font-semibold">เนื้อหารายการใหม่</p>
                <input
                  className={`${INPUT_CLS} text-sm`}
                  value={labelTh}
                  onChange={(e) => {
                    setLabelTh(e.target.value)
                    setPreviewed(false)
                  }}
                  placeholder="ข้อความคำถาม เช่น ถังขยะแบบยกเคลื่อนที่ได้"
                />
                <div className="grid grid-cols-2 gap-2.5">
                  <select className={`${SELECT_CLS} text-sm`} value={type} onChange={(e) => { setType(e.target.value as QuestionType); setPreviewed(false) }}>
                    <option value="presence">มี/ไม่มี</option>
                    <option value="presence_standard">มี/ไม่มี + มาตรฐาน</option>
                    <option value="measured">ต้องวัดค่า</option>
                  </select>
                  <select
                    className={`${SELECT_CLS} text-sm`}
                    value={facilityCode}
                    onChange={(e) => { setFacilityCode(e.target.value === '' ? '' : Number(e.target.value)); setPreviewed(false) }}
                  >
                    <option value="">ไม่ระบุหมวดหมู่สิ่งอำนวยความสะดวก</option>
                    {FACILITY_CATALOG.map((f) => (
                      <option key={f.code} value={f.code}>
                        {f.code}. {f.nameTh}
                      </option>
                    ))}
                  </select>
                </div>
                {facilityEntry && (
                  <p className="text-muted-foreground text-xs">
                    จะกำหนดข้อยกเว้นทางกฎหมายอัตโนมัติ: {facilityEntry.lawRefs.join(', ')}
                    {facilityEntry.beyondLaw ? ' (นอกเหนือกฎหมาย)' : ''}
                  </p>
                )}
                {type === 'measured' && (
                  <div className="grid grid-cols-3 gap-2.5">
                    <select className={`${SELECT_CLS} text-sm`} value={operator} onChange={(e) => { setOperator(e.target.value as ThresholdOperator); setPreviewed(false) }}>
                      {(['gte', 'lte'] as ThresholdOperator[]).map((op) => (
                        <option key={op} value={op}>
                          {OPERATOR_LABEL[op]}
                        </option>
                      ))}
                    </select>
                    <input type="number" className={`${INPUT_CLS} text-sm`} placeholder="ค่า" value={value} onChange={(e) => { setValue(e.target.value === '' ? '' : Number(e.target.value)); setPreviewed(false) }} />
                    <input className={`${INPUT_CLS} text-sm`} placeholder="หน่วย" value={unit} onChange={(e) => { setUnit(e.target.value); setPreviewed(false) }} />
                  </div>
                )}
              </div>
            </>
          )}

          {result && (
            <div className="border-border space-y-2 border-t pt-3">
              {result.resolved.length > 0 && (
                <div>
                  <p className="text-foreground text-sm font-semibold">{previewed ? 'จะวางใน' : 'วางแล้วใน'} {result.resolved.length} แบบประเมิน</p>
                  <ul className="mt-1 space-y-0.5">
                    {result.resolved.map((r) => (
                      <li key={r.templateId} className="text-muted-foreground text-xs">
                        <TransportBadge type={r.mode} /> {r.variantKey === 'standard' ? '' : r.variantKey} — {r.containerCode} ({side === 'before' ? 'ก่อน' : 'หลัง'} {r.anchorCode})
                        {r.code && <> → รหัสใหม่ <span className="font-mono">{r.code}</span></>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.skipped.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-800">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <AlertTriangle size={13} /> ข้าม {result.skipped.length} แบบประเมิน
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {result.skipped.map((s) => (
                      <li key={s.templateId}>
                        {s.mode ?? s.templateId} {s.variantKey && s.variantKey !== 'standard' ? s.variantKey : ''} — {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!previewed && result.correlationId && (
                <p className="flex items-center gap-1 text-sm text-[#52aa4e]">
                  <Check size={13} /> เขียนสำเร็จ (correlation: {result.correlationId.slice(0, 8)}…)
                </p>
              )}
            </div>
          )}
          {addAndPlace.isError && <p className="text-sm text-red-500">{(addAndPlace.error as Error).message}</p>}
        </div>

        <div className="border-border flex shrink-0 items-center justify-end gap-2 border-t px-6 py-4">
          <button type="button" onClick={onClose} className="border-border rounded-lg border px-4 py-2 text-sm font-medium">
            ปิด
          </button>
          {!previewed ? (
            <button
              type="button"
              disabled={!canPreview || addAndPlace.isPending}
              onClick={preview}
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
            >
              {addAndPlace.isPending ? <Loader2 size={14} className="mr-1 inline animate-spin" /> : null}
              ดูตัวอย่างตำแหน่ง
            </button>
          ) : (
            <button
              type="button"
              disabled={addAndPlace.isPending || !result || result.resolved.length === 0}
              onClick={confirm}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {addAndPlace.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              ยืนยันวางใน {result?.resolved.length ?? 0} แบบประเมิน
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
