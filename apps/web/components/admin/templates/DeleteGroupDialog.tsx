'use client'

import * as React from 'react'
import { AlertTriangle, Check, Loader2, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DIALOG_HEADER_CLS, DIALOG_TITLE_CLS } from '@/lib/ui-classes'
import { TransportBadge } from '@/components/shared/badges'
import { useDeleteGroup } from '@/hooks/use-facility-groups'
import type { GroupNodeRow } from '@/lib/api/facility-groups'

// Live feedback (2026-08-17) — "a way to delete any facility group that doesn't need to be there
// anymore", the symmetric counterpart to AddAndPlaceDialog's "เพิ่มรายการ / เพิ่มกลุ่มข้อย่อย".
// Real motivating case: an admin-added item across land/rail_train/air that turned out to be an
// unwanted near-duplicate typo of an already-correct item elsewhere. Same preview -> confirm
// two-step as add-and-place (a multi-template delete is exactly as broadcast as a multi-template
// add), destructive red styling on the actual confirm button since this can't be undone from the
// UI itself (only by re-adding).
export function DeleteGroupDialog({
  version,
  item,
  onClose,
}: {
  version: number
  item: GroupNodeRow
  onClose: () => void
}) {
  const deleteGroup = useDeleteGroup(version)
  const [targetIds, setTargetIds] = React.useState<Set<string>>(new Set(item.instances.map((i) => i.templateId)))
  const [previewed, setPreviewed] = React.useState(false)

  function toggleTarget(templateId: string) {
    setTargetIds((cur) => {
      const next = new Set(cur)
      if (next.has(templateId)) next.delete(templateId)
      else next.add(templateId)
      return next
    })
    setPreviewed(false)
  }

  const canPreview = targetIds.size > 0

  function preview() {
    deleteGroup.mutate(
      { canonicalItemId: item.id, targetTemplateIds: [...targetIds], confirm: false },
      { onSuccess: () => setPreviewed(true) },
    )
  }

  function confirm() {
    deleteGroup.mutate(
      { canonicalItemId: item.id, targetTemplateIds: [...targetIds], confirm: true },
      { onSuccess: () => setPreviewed(false) },
    )
  }

  const result = deleteGroup.data

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col overflow-hidden p-0 sm:max-w-xl">
        <div className={DIALOG_HEADER_CLS}>
          <DialogTitle className={DIALOG_TITLE_CLS}>ลบกลุ่ม: &ldquo;{item.labelTh}&rdquo;</DialogTitle>
          <p className="text-muted-foreground mt-1 text-sm">ลบรายการนี้ออกจากแบบประเมินที่เลือกไว้ ทำได้เฉพาะเวอร์ชันร่างเท่านั้น</p>
        </div>

        <div className="themed-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4 text-sm">
          {!item.isLeaf && (
            <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <p className="text-xs">รายการนี้เป็นกลุ่ม/หมวดหมู่ที่มีรายการย่อยอยู่ข้างใน — การลบจะลบรายการย่อยทั้งหมดไปด้วย</p>
            </div>
          )}

          <div>
            <p className="text-muted-foreground mb-1 text-sm">
              แบบประเมินเป้าหมาย ({targetIds.size}/{item.instances.length})
            </p>
            <div className="border-border max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
              {[...item.instances].sort((a, b) => a.parentCode.localeCompare(b.parentCode)).map((i) => (
                <label key={i.templateId} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={targetIds.has(i.templateId)} onChange={() => toggleTarget(i.templateId)} />
                  <TransportBadge type={i.mode} />
                  <span className="text-muted-foreground">{i.variantKey === 'standard' ? '' : i.variantKey}</span>
                  <span className="font-mono text-xs">{i.nodeCode}</span>
                  <span className="text-muted-foreground text-xs">({i.status === 'DRAFT' ? 'ร่าง' : i.status === 'ACTIVE' ? 'ใช้งานอยู่ — ต้องสร้างร่างก่อน' : 'เลิกใช้'})</span>
                </label>
              ))}
            </div>
          </div>

          {result && (
            <div className="border-border space-y-2 border-t pt-3">
              {result.resolved.length > 0 && (
                <div>
                  <p className="text-foreground text-sm font-semibold">{previewed ? 'จะลบจาก' : 'ลบแล้วจาก'} {result.resolved.length} แบบประเมิน</p>
                  <ul className="mt-1 space-y-0.5">
                    {result.resolved.map((r) => (
                      <li key={r.templateId} className="text-muted-foreground text-xs">
                        <TransportBadge type={r.mode} /> {r.variantKey === 'standard' ? '' : r.variantKey} — {r.nodeCode} &ldquo;{r.labelTh}&rdquo;
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
                  <Check size={13} /> ลบสำเร็จ (correlation: {result.correlationId.slice(0, 8)}…)
                </p>
              )}
            </div>
          )}
          {deleteGroup.isError && <p className="text-sm text-red-500">{(deleteGroup.error as Error).message}</p>}
        </div>

        <div className="border-border flex shrink-0 items-center justify-end gap-2 border-t px-6 py-4">
          <button type="button" onClick={onClose} className="border-border rounded-lg border px-4 py-2 text-sm font-medium">
            ปิด
          </button>
          {!previewed ? (
            <button
              type="button"
              disabled={!canPreview || deleteGroup.isPending}
              onClick={preview}
              className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
            >
              {deleteGroup.isPending ? <Loader2 size={14} className="mr-1 inline animate-spin" /> : null}
              ดูตัวอย่างก่อนลบ
            </button>
          ) : (
            <button
              type="button"
              disabled={deleteGroup.isPending || !result || result.resolved.length === 0}
              onClick={confirm}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {deleteGroup.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              ยืนยันลบจาก {result?.resolved.length ?? 0} แบบประเมิน
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
