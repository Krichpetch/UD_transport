'use client'

import * as React from 'react'
import type { TemplateGuidance } from '@repo/types'
import { Check, Loader2 } from 'lucide-react'
import { INPUT_CLS } from '@/lib/ui-classes'
import { useEditGuidance } from '@/hooks/use-templates-admin'

// Part E — small, rides along the threshold-edit action family. Plain text per node; nothing
// here touches labels/codes.
export function GuidanceEditor({
  templateId,
  nodeCode,
  guidance,
  readOnly,
}: {
  templateId: string
  nodeCode: string
  guidance?: TemplateGuidance
  readOnly: boolean
}) {
  const editGuidance = useEditGuidance(templateId)
  const [text, setText] = React.useState(guidance?.text ?? '')
  const [reference, setReference] = React.useState(guidance?.reference ?? '')

  React.useEffect(() => {
    setText(guidance?.text ?? '')
    setReference(guidance?.reference ?? '')
  }, [guidance?.text, guidance?.reference])

  if (readOnly) {
    if (!guidance) return null
    return (
      <div className="bg-secondary/40 rounded-lg p-3 text-xs">
        <p className="text-foreground font-semibold">คำแนะนำในการตรวจ</p>
        <p className="text-muted-foreground mt-1">{guidance.text}</p>
        {guidance.reference && <p className="text-muted-foreground mt-1 text-[10px]">อ้างอิง: {guidance.reference}</p>}
      </div>
    )
  }

  return (
    <div className="border-border bg-card rounded-xl border p-3">
      <p className="text-foreground mb-2 text-xs font-semibold">คำแนะนำในการตรวจ (คู่มือการตรวจประเมิน)</p>
      <textarea
        className={`${INPUT_CLS} min-h-[64px] resize-y text-xs`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="ข้อความคำแนะนำที่ผู้ตรวจจะเห็นในหน้าตรวจ"
      />
      <input
        className={`${INPUT_CLS} mt-1.5 py-1.5 text-xs`}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder="อ้างอิง (ถ้ามี)"
      />
      <button
        type="button"
        onClick={() => editGuidance.mutate({ nodeCode, body: { text, reference: reference || undefined } })}
        disabled={editGuidance.isPending || !text}
        className="bg-primary text-primary-foreground mt-2 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
      >
        {editGuidance.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
        บันทึกคำแนะนำ
      </button>
    </div>
  )
}
