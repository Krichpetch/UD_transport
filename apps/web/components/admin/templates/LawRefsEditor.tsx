'use client'

import * as React from 'react'
import type { TemplateNode } from '@repo/types'
import { LAW_REFERENCE_SEED } from '@repo/types'
import { Check, Loader2 } from 'lucide-react'
import { useEditLawRefs } from '@/hooks/use-templates-admin'

// Session S3b, Part D — lawRefs multi-select + beyondLaw toggle, on ITEMS and LEAVES both (per
// Dr.Aliz's note: most redaction lives at the top A.X item level, not just on leaves). Editable
// on DRAFT and ACTIVE both — this is applicability data (era resolution reads it going forward),
// never a structural change, so it isn't gated behind the DRAFT-only structural editor. F1's era
// redaction derives from FROZEN per-checklist stamps, so an edit here only affects FUTURE audits —
// the same "future audits only" note shown for threshold edits on ACTIVE templates.
export function LawRefsEditor({
  templateId,
  node,
  readOnly,
}: {
  templateId: string
  node: TemplateNode
  readOnly: boolean
}) {
  const editLawRefs = useEditLawRefs(templateId)
  const [lawRefs, setLawRefs] = React.useState<string[]>(node.lawRefs ?? [])
  const [beyondLaw, setBeyondLaw] = React.useState(node.beyondLaw ?? false)

  React.useEffect(() => {
    setLawRefs(node.lawRefs ?? [])
    setBeyondLaw(node.beyondLaw ?? false)
  }, [node.code, node.lawRefs, node.beyondLaw])

  function toggle(code: string) {
    setLawRefs((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]))
  }

  const dirty = JSON.stringify([...lawRefs].sort()) !== JSON.stringify([...(node.lawRefs ?? [])].sort()) || beyondLaw !== (node.beyondLaw ?? false)

  return (
    <div className="border-border bg-card space-y-2 rounded-xl border p-3">
      <p className="text-foreground text-sm font-semibold">ข้อยกเว้นทางกฎหมาย (lawRefs)</p>
      <p className="text-muted-foreground text-[11px]">
        กฎหมายที่กำหนดให้ต้องมีรายการนี้ — ใช้ในการซ่อนรายการที่ไม่เข้าข่ายตามปีที่ก่อสร้าง (มีผลกับการตรวจครั้งต่อไปเท่านั้น ไม่กระทบรายงานที่ตรวจไปแล้ว)
      </p>

      {readOnly ? (
        <div className="text-muted-foreground text-xs">
          {(node.lawRefs ?? []).length === 0 ? (
            <p>ยังไม่ได้ระบุ</p>
          ) : (
            <ul className="list-inside list-disc">
              {(node.lawRefs ?? []).map((code) => (
                <li key={code}>{LAW_REFERENCE_SEED.find((l) => l.code === code)?.nameTh ?? code}</li>
              ))}
            </ul>
          )}
          {node.beyondLaw && <p className="mt-1">โครงการเพิ่มเติมนอกเหนือกฎหมาย (beyondLaw)</p>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {LAW_REFERENCE_SEED.map((law) => (
              <label key={law.code} className="text-foreground flex items-start gap-1.5 text-xs">
                <input type="checkbox" className="mt-0.5" checked={lawRefs.includes(law.code)} onChange={() => toggle(law.code)} />
                <span>{law.nameTh}</span>
              </label>
            ))}
          </div>
          <label className="text-foreground flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={beyondLaw} onChange={(e) => setBeyondLaw(e.target.checked)} />
            โครงการเพิ่มเติมนอกเหนือกฎหมาย (beyondLaw)
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => editLawRefs.mutate({ nodeCode: node.code, lawRefs, beyondLaw })}
              disabled={editLawRefs.isPending || !dirty}
              className="bg-primary text-primary-foreground flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {editLawRefs.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              บันทึกข้อยกเว้นทางกฎหมาย
            </button>
            {editLawRefs.isError && <span className="text-[11px] text-red-500">{(editLawRefs.error as Error).message}</span>}
          </div>
        </>
      )}
    </div>
  )
}
