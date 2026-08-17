'use client'

import * as React from 'react'
import type { TemplateNode } from '@repo/types'
import { LAW_REFERENCE_SEED } from '@repo/types'
import { Loader2, Trash2 } from 'lucide-react'
import { INPUT_CLS, SELECT_CLS } from '@/lib/ui-classes'
import { useEditLabelByLaw } from '@/hooks/use-templates-admin'

interface LabelByLawDraft {
  labelTh: string
  sourceText?: string | null
}

// Era-editor safety session, Part C.3 — the labelByLaw sibling of MeasurementEditor.tsx's
// EraOverridesSection: same per-law list / draftFor / save / remove / add-law interaction pattern,
// just keyed off `node.labelByLaw` (a pure container's case-condition heading text) with two text
// inputs per law instead of a value/tiers block. Individual editor only this session — see
// TemplateNodeEditorDialog.tsx's `!node.answerType` render gate.
export function LabelByLawEditor({ templateId, node, readOnly }: { templateId: string; node: TemplateNode; readOnly: boolean }) {
  const editLabelByLaw = useEditLabelByLaw(templateId)
  const [drafts, setDrafts] = React.useState<Record<string, LabelByLawDraft>>({})
  const [addingLaw, setAddingLaw] = React.useState('')

  const existingCodes = Object.keys(node.labelByLaw ?? {})
  const availableToAdd = LAW_REFERENCE_SEED.filter((l) => !existingCodes.includes(l.code))

  function draftFor(lawCode: string): LabelByLawDraft {
    return drafts[lawCode] ?? node.labelByLaw?.[lawCode] ?? { labelTh: '' }
  }

  return (
    <div className="border-border bg-card space-y-2 rounded-xl border p-3">
      <p className="text-foreground text-sm font-semibold">ข้อความตามยุคกฎหมาย (labelByLaw)</p>
      <p className="text-muted-foreground text-xs">
        สำหรับหัวข้อเงื่อนไข (เช่น &ldquo;กรณีทางลาดที่ความยาวไม่เกิน…&rdquo;) ที่ข้อความเปลี่ยนไปตามกฎหมายแต่ละยุค โดยไม่มีคำตอบ/คะแนนของตัวเอง
      </p>
      {existingCodes.length === 0 && <p className="text-muted-foreground text-[11px]">ยังไม่มีข้อความตามยุคกฎหมายสำหรับรายการนี้</p>}
      {existingCodes.map((lawCode) => {
        const law = LAW_REFERENCE_SEED.find((l) => l.code === lawCode)
        const draft = draftFor(lawCode)
        return (
          <div key={lawCode} className="bg-secondary/40 rounded-lg p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-foreground text-[11px] font-medium">{law?.nameTh ?? lawCode}</p>
              {!readOnly && (
                <button
                  type="button"
                  disabled={editLabelByLaw.isPending}
                  onClick={() => editLabelByLaw.mutate({ nodeCode: node.code, body: { lawCode, entry: null } })}
                  className="flex items-center gap-1 text-[10px] text-red-500 hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 size={11} />
                  ลบ
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              <input
                className={`${INPUT_CLS} py-1 text-xs`}
                value={draft.labelTh}
                readOnly={readOnly}
                placeholder="ข้อความหัวข้อสำหรับกฎหมายนี้"
                onChange={(e) => setDrafts((d) => ({ ...d, [lawCode]: { ...draft, labelTh: e.target.value } }))}
              />
              <input
                className={`${INPUT_CLS} py-1 text-[11px]`}
                value={draft.sourceText ?? ''}
                readOnly={readOnly}
                placeholder="ข้อความอ้างอิงจากเอกสารต้นฉบับ (sourceText) สำหรับกฎหมายนี้"
                onChange={(e) => setDrafts((d) => ({ ...d, [lawCode]: { ...draft, sourceText: e.target.value } }))}
              />
            </div>
            {!readOnly && (
              <button
                type="button"
                disabled={editLabelByLaw.isPending || !draft.labelTh.trim()}
                onClick={() =>
                  editLabelByLaw.mutate({
                    nodeCode: node.code,
                    body: { lawCode, entry: { labelTh: draft.labelTh, sourceText: draft.sourceText || undefined } },
                  })
                }
                className="bg-primary text-primary-foreground mt-1.5 flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium disabled:opacity-50"
              >
                {editLabelByLaw.isPending ? <Loader2 size={10} className="animate-spin" /> : null}
                บันทึกข้อความตามกฎหมายนี้
              </button>
            )}
          </div>
        )
      })}

      {!readOnly && availableToAdd.length > 0 && (
        <div className="flex items-center gap-1.5">
          <select className={`${SELECT_CLS} py-1 text-[11px]`} value={addingLaw} onChange={(e) => setAddingLaw(e.target.value)}>
            <option value="">+ เพิ่มข้อความตามกฎหมาย…</option>
            {availableToAdd.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nameTh}
              </option>
            ))}
          </select>
          {addingLaw && (
            <button
              type="button"
              onClick={() => {
                setDrafts((d) => ({ ...d, [addingLaw]: { labelTh: node.labelTh } }))
                setAddingLaw('')
              }}
              className="border-border shrink-0 rounded border px-2 py-1 text-[11px]"
            >
              เพิ่ม
            </button>
          )}
        </div>
      )}
      {editLabelByLaw.isError && <p className="text-[11px] text-red-500">{(editLabelByLaw.error as Error).message}</p>}
    </div>
  )
}
