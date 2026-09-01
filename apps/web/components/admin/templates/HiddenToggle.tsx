'use client'

import * as React from 'react'
import type { TemplateNode } from '@repo/types'
import { EyeOff, Loader2 } from 'lucide-react'
import { useEditHidden } from '@/hooks/use-templates-admin'

// Session S4a, Part C — admin-authored ABSOLUTE hide. Distinct from lawRefs/era redaction (year-
// dependent, still shown to the auditor as a collapsed footer note) and from a group's `optional`
// (still shown, just non-blocking at submit): hidden means this node (and its whole subtree)
// never appears on the auditor form at all, not even as a footer note — see
// @repo/types#filterHiddenItems. Effective on the NEXT audit/preview fetch only; has zero effect
// on checklists already submitted.
export function HiddenToggle({
  templateId,
  node,
  readOnly,
}: {
  templateId: string
  node: TemplateNode
  readOnly: boolean
}) {
  const editHidden = useEditHidden(templateId)
  const hidden = node.hidden === true

  return (
    <div className="border-border bg-card space-y-2 rounded-xl border p-3">
      <p className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
        <EyeOff size={13} /> ซ่อนจากแบบฟอร์ม
      </p>
      <p className="text-muted-foreground text-2xs">
        ซ่อนรายการนี้ (และรายการย่อยทั้งหมด) ออกจากแบบฟอร์มผู้ตรวจโดยสมบูรณ์ ไม่ผูกกับปีที่ก่อสร้าง
        และไม่แสดงแม้เป็นหมายเหตุท้ายกลุ่ม — มีผลกับการตรวจครั้งต่อไปเท่านั้น ไม่กระทบรายงานที่ตรวจไปแล้ว
      </p>
      {readOnly ? (
        <p className="text-muted-foreground text-xs">{hidden ? 'ซ่อนอยู่' : 'ไม่ได้ซ่อน'}</p>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => editHidden.mutate({ nodeCode: node.code, hidden: !hidden })}
            disabled={editHidden.isPending}
            className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
              hidden ? 'bg-amber-100 text-amber-800' : 'border-border border text-foreground hover:bg-secondary/60'
            }`}
          >
            {editHidden.isPending ? <Loader2 size={12} className="animate-spin" /> : <EyeOff size={12} />}
            {hidden ? 'ยกเลิกการซ่อน' : 'ซ่อนรายการนี้'}
          </button>
          {editHidden.isError && <span className="text-2xs text-red-500">{(editHidden.error as Error).message}</span>}
        </div>
      )}
    </div>
  )
}
